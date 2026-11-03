import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { createHash } from "node:crypto";
import {
  DEFAULT_MODEL,
  PARITY_MODELS,
  LEGACY_MODELS,
  resolveModel,
} from "../../src/model_palette.ts";
import {
  handleWebSocketTranscribeUpgrade,
  createWebSocketFrame,
} from "../../server/cloud/websocket-transcribe.mjs";

test("Item C: Model Palette contract verification", () => {
  // Acceptance: DEFAULT_MODEL resolves to gemini-3.8-flash
  assert.equal(DEFAULT_MODEL, "gemini-3.8-flash");

  // Acceptance: picker renders 8 in exact order
  const expectedOrder = [
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "claude-haiku-4-5",
    "claude-sonnet-5",
    "claude-opus-5-5",
    "deepseek-flash",
    "openai/gpt-oss-120b",
  ];
  assert.equal(PARITY_MODELS.length, 8);
  for (let i = 0; i < expectedOrder.length; i++) {
    assert.equal(PARITY_MODELS[i].id, expectedOrder[i]);
  }

  // Acceptance: DEFAULT_MODEL resolves
  assert.equal(resolveModel(null), DEFAULT_MODEL);
  assert.equal(resolveModel(""), DEFAULT_MODEL);
  assert.equal(resolveModel("   "), DEFAULT_MODEL);

  // Acceptance: unknown saved ID falls back instead of rendering empty
  assert.equal(resolveModel("non-existent-model-xyz"), DEFAULT_MODEL);
  assert.equal(resolveModel("ancient-model-v0"), DEFAULT_MODEL);

  // Acceptance: existing/legacy IDs resolve correctly
  assert.equal(resolveModel("gpt-4o-mini"), "gpt-4o-mini");
  assert.equal(resolveModel("claude-3-5-haiku-20241022"), "claude-3-5-haiku-20241022");
  assert.equal(resolveModel("deepseek-chat"), "deepseek-chat");
});

test("Item B6 & D: /ws/transcribe requires authentication and transcribes real audio", async () => {
  const transcriptions = [];
  const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });

  server.on("upgrade", (req, socket, head) => {
    handleWebSocketTranscribeUpgrade(req, socket, head, {
      authenticate: async (token) => (token === "valid-token" ? { user: { id: "user-1" } } : null),
      transcribe: async (_auth, payload, seconds) => {
        transcriptions.push({ payload, seconds });
        return { text: "hello from the provider" };
      },
      batchSeconds: 0.0001,
    }).catch(() => socket.destroy());
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  function connect(path, { key = Buffer.from("testkey1234567890").toString("base64") } = {}) {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    return new Promise((resolve, reject) => {
      socket.on("connect", () => {
        socket.write(
          [
            `GET ${path} HTTP/1.1`,
            `Host: 127.0.0.1:${port}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${key}`,
            "Sec-WebSocket-Version: 13",
            "\r\n",
          ].join("\r\n"),
        );
        socket.once("data", (chunk) => resolve({ socket, response: chunk.toString("utf8") }));
      });
      socket.on("error", reject);
    });
  }

  function encodeClientFrame(payload, opcode = 0x02) {
    const maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i] ^ maskKey[i % 4];
    }
    return Buffer.concat([
      Buffer.from([0x80 | opcode, 0x80 | payload.length]),
      maskKey,
      masked,
    ]);
  }

  function frameParser(socket) {
    let buffer = Buffer.alloc(0);
    const messages = [];
    const waiters = [];
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) break;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) break;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + length) break;
        const payload = buffer.subarray(offset, offset + length);
        buffer = buffer.subarray(offset + length);
        if (opcode === 0x01) {
          messages.push(JSON.parse(payload.toString("utf8")));
          for (const waiter of waiters.splice(0)) waiter();
        }
      }
    });
    return {
      next(predicate = () => true, timeoutMs = 3000) {
        return new Promise((resolve, reject) => {
          const check = () => {
            const index = messages.findIndex(predicate);
            if (index >= 0) {
              resolve(messages.splice(index, 1)[0]);
              return true;
            }
            return false;
          };
          if (check()) return;
          const timer = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), timeoutMs);
          const waiter = () => {
            if (check()) {
              clearTimeout(timer);
              waiters.splice(waiters.indexOf(waiter), 1);
            }
          };
          waiters.push(waiter);
        });
      },
    };
  }

  try {
    const unauthenticated = await connect("/ws/transcribe?source=system");
    assert.match(unauthenticated.response, /HTTP\/1\.1 401 Unauthorized/);
    unauthenticated.socket.destroy();

    const { socket, response } = await connect("/ws/transcribe?source=system&token=valid-token");
    assert.match(response, /HTTP\/1\.1 101 Switching Protocols/);
    assert.match(response, /Upgrade: websocket/);
    const frames = frameParser(socket);

    const pcmBytes = Buffer.alloc(100, 0x11);
    const frameHeader = Buffer.alloc(16);
    frameHeader.writeUInt32LE(0x5341444c, 0); // magic: 'LDAS'
    frameHeader.writeUInt16LE(48000, 4); // sampleRate: 48000
    frameHeader.writeUInt16LE(2, 6); // channels: 2
    frameHeader.writeUInt32LE(100, 8); // byteCount: 100
    frameHeader.writeUInt32LE(42, 12); // seq: 42

    socket.write(encodeClientFrame(Buffer.concat([frameHeader, pcmBytes])));

    const ack = await frames.next((message) => message.type === "transcript" && message.seq === 42);
    assert.equal(ack.partial, true);
    assert.equal(ack.sampleRate, 48000);
    assert.equal(ack.channels, 2);
    assert.equal(ack.byteCount, 100);

    const transcribed = await frames.next(
      (message) => message.type === "transcript" && message.text === "hello from the provider",
    );
    assert.equal(transcribed.final, false);
    assert.equal(transcriptions.length, 1);
    assert.equal(transcriptions[0].payload.mime, "audio/wav");
    assert.ok(transcriptions[0].seconds > 0);
    const wav = Buffer.from(transcriptions[0].payload.data, "base64");
    assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
    assert.equal(wav.readUInt16LE(22), 2);
    assert.equal(wav.readUInt32LE(24), 48000);
    assert.equal(wav.readUInt32LE(40), 100);

    const invalidHeader = Buffer.alloc(16);
    invalidHeader.writeUInt32LE(0x5341444c, 0);
    invalidHeader.writeUInt16LE(48000, 4);
    invalidHeader.writeUInt16LE(2, 6);
    invalidHeader.writeUInt32LE(99, 8); // byteCount does not match payload
    invalidHeader.writeUInt32LE(43, 12);
    socket.write(encodeClientFrame(Buffer.concat([invalidHeader, Buffer.alloc(100)])));
    const error = await frames.next((message) => message.type === "error");
    assert.match(error.error, /header is invalid/i);

    socket.destroy();

    const source = fs.readFileSync(new URL("../../server/cloud/app.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /ProProctor\.exe/, "the cloud server must not ship proctoring target lists");
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
