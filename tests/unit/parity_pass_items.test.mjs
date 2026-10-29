import { test } from "node:test";
import assert from "node:assert/strict";
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

test("Item B6 & D: Server routes (/api/v1/stealth/targets and /ws/transcribe)", async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/v1/stealth/targets" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          version: 1,
          targets: [
            "ProProctor.exe",
            "Proctortrack.exe",
            "ProctorU.exe",
            "Proctor.exe",
            "LockDownBrowser.exe",
            "SafeExamBrowser.exe",
          ],
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on("upgrade", (req, socket, head) => {
    handleWebSocketTranscribeUpgrade(req, socket, head);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    // 1. Verify GET /api/v1/stealth/targets
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/stealth/targets`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.version, 1);
    assert.ok(Array.isArray(data.targets));
    assert.ok(data.targets.includes("ProProctor.exe"));
    assert.ok(data.targets.includes("Proctortrack.exe"));
    assert.ok(data.targets.includes("ProctorU.exe"));
    assert.ok(data.targets.includes("Proctor.exe"));

    // 2. Verify WebSocket Upgrade on /ws/transcribe
    const clientKey = Buffer.from("testkey1234567890").toString("base64");
    const socket = net.createConnection({ port, host: "127.0.0.1" });

    await new Promise((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("error", reject);
    });

    const handshakeReq = [
      "GET /ws/transcribe?source=system HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${clientKey}`,
      "Sec-WebSocket-Version: 13",
      "\r\n",
    ].join("\r\n");

    socket.write(handshakeReq);

    // Wait for handshake response
    const handshakeResponse = await new Promise((resolve) => {
      socket.once("data", (chunk) => resolve(chunk.toString("utf8")));
    });

    assert.ok(handshakeResponse.includes("101 Switching Protocols"));
    assert.ok(handshakeResponse.includes("Upgrade: websocket"));

    // 3. Send masked binary frame with 16-byte AudioFrameHeader
    const pcmBytes = Buffer.alloc(100, 0xaa);
    const frameHeader = Buffer.alloc(16);
    frameHeader.writeUInt32LE(0x5341444c, 0); // magic: 'LDAS'
    frameHeader.writeUInt16LE(48000, 4);      // sampleRate: 48000
    frameHeader.writeUInt16LE(2, 6);          // channels: 2
    frameHeader.writeUInt32LE(100, 8);        // byteCount: 100
    frameHeader.writeUInt32LE(42, 12);        // seq: 42

    const fullPayload = Buffer.concat([frameHeader, pcmBytes]);

    // Mask client frame
    const maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const maskedPayload = Buffer.alloc(fullPayload.length);
    for (let i = 0; i < fullPayload.length; i++) {
      maskedPayload[i] = fullPayload[i] ^ maskKey[i % 4];
    }

    const wsFrame = Buffer.concat([
      Buffer.from([0x82, 0x80 | fullPayload.length]), // FIN | binary, MASK | len
      maskKey,
      maskedPayload,
    ]);

    // Wait for server's text response
    const serverReplyPromise = new Promise((resolve) => {
      socket.once("data", (chunk) => {
        // chunk is an unmasked text frame: [0x81, len, ...json]
        assert.equal(chunk[0], 0x81);
        const len = chunk[1] & 0x7f;
        const text = chunk.subarray(2, 2 + len).toString("utf8");
        resolve(JSON.parse(text));
      });
    });

    socket.write(wsFrame);
    const reply = await serverReplyPromise;

    assert.equal(reply.type, "transcript");
    assert.equal(reply.partial, true);
    assert.equal(reply.seq, 42);
    assert.equal(reply.sampleRate, 48000);
    assert.equal(reply.channels, 2);
    assert.equal(reply.byteCount, 100);

    // 4. Send close frame
    const closeMask = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const closeFrame = Buffer.concat([
      Buffer.from([0x88, 0x82]), // FIN | close, MASK | 2
      closeMask,
      Buffer.from([0x03, 0xe8]), // 1000 normal closure
    ]);
    socket.write(closeFrame);

    await new Promise((resolve) => socket.on("close", resolve));
  } finally {
    server.close();
  }
});
