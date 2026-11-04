// derived: rea/native/windows/src/websocket_audio_sink.hpp
import { createHash } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const LDAS_MAGIC = 0x5341444c; // 'LDAS' in little endian
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_SESSION_SECONDS = 10 * 60;
const TRANSCRIBE_TIMEOUT_MS = 90 * 1000;

/**
 * Creates an unmasked WebSocket frame for server-to-client transmission (RFC 6455).
 * @param {string|Buffer} payload
 * @param {number} opcode 0x01 text, 0x02 binary, 0x08 close, 0x0a pong
 * @returns {Buffer}
 */
export function createWebSocketFrame(payload, opcode = 0x01) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const len = buf.length;
  let header;
  if (len <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, buf]);
}

function writeHttpError(socket, status, message) {
  if (socket.destroyed || !socket.writable) return;
  const reason =
    status === 401
      ? "Unauthorized"
      : status === 403
        ? "Forbidden"
        : status === 429
          ? "Too Many Requests"
          : status === 503
            ? "Service Unavailable"
            : "Bad Request";
  const body = JSON.stringify({ error: message || reason });
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Connection: close\r\n\r\n" +
      body,
  );
  socket.destroy();
}

function closeFrame(code, reason = "") {
  const text = Buffer.from(reason, "utf8").subarray(0, 120);
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return createWebSocketFrame(payload, 0x08);
}

function pcmToWav(pcm, sampleRate, channels) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function normalizeTranscript(result) {
  if (typeof result === "string") return result.trim();
  if (result && typeof result.text === "string") return result.text.trim();
  return "";
}

/**
 * Handles HTTP Upgrade for WebSocket transcription stream (/ws/transcribe).
 *
 * Authentication is mandatory. The caller supplies `authenticate(token)` and
 * `transcribe(auth, payload, seconds)` callbacks, so this module never invents
 * an account or starts a provider request without the server's authorization
 * and quota checks. Incoming LDAS frames carry 16-bit PCM; batches are wrapped
 * in a WAV container and sent to the configured hosted transcription provider.
 */
export async function handleWebSocketTranscribeUpgrade(req, socket, head, options = {}) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ws/transcribe") {
    writeHttpError(socket, 404, "Not found");
    return;
  }

  if (typeof options.authenticate !== "function" || typeof options.transcribe !== "function") {
    writeHttpError(socket, 503, "Transcription is not configured.");
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    writeHttpError(socket, 400, "Missing WebSocket key.");
    return;
  }

  const headerToken = String(req.headers.authorization || "").startsWith("Bearer ")
    ? String(req.headers.authorization).slice(7)
    : "";
  const token = url.searchParams.get("token") || headerToken;
  let auth;
  try {
    auth = await options.authenticate(token, req);
  } catch (error) {
    const status =
      Number(error?.statusCode) ||
      (error?.code === "RATE_LIMITED" ? 429 : 401);
    writeHttpError(socket, status, error?.message || "Sign in required.");
    return;
  }
  if (!auth) {
    writeHttpError(socket, 401, "Sign in to use live transcription.");
    return;
  }

  const acceptKey = createHash("sha1")
    .update(key.trim() + WS_GUID)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "\r\n",
    ].join("\r\n"),
  );

  const batchSeconds = Number(options.batchSeconds) > 0 ? Number(options.batchSeconds) : 5;
  const maxSessionSeconds =
    Number(options.maxSessionSeconds) > 0 ? Number(options.maxSessionSeconds) : MAX_SESSION_SECONDS;
  const maxFrameBytes =
    Number(options.maxFrameBytes) > 0 ? Number(options.maxFrameBytes) : MAX_FRAME_BYTES;

  let autoSeq = 1;
  let closed = false;
  let buffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let batch = [];
  let batchBytes = 0;
  let batchSampleRate = 0;
  let batchChannels = 0;
  let batchSecondsActual = 0;
  let totalSeconds = 0;
  let transcript = "";
  let activeFlush = null;
  let stopping = false;
  let sessionSampleRate = 0;
  let sessionChannels = 0;
  let pendingSequences = [];

  function sendText(obj) {
    if (closed || socket.destroyed || !socket.writable) return;
    try {
      socket.write(createWebSocketFrame(JSON.stringify(obj), 0x01));
    } catch {
      closed = true;
    }
  }

  function sendError(message, { fatal = false, code = 1008 } = {}) {
    sendText({ type: "error", error: message });
    if (fatal) {
      closed = true;
      try {
        if (socket.writable) socket.write(closeFrame(code, message));
      } catch {}
      socket.end();
    }
  }

  function resetBatch() {
    batch = [];
    batchBytes = 0;
    batchSampleRate = 0;
    batchChannels = 0;
    batchSecondsActual = 0;
  }

  function appendBatch(payload, sampleRate, channels, seq) {
    if (batchBytes + payload.length > MAX_BATCH_BYTES) {
      sendError("The audio batch is too large.", { fatal: true, code: 1009 });
      return false;
    }
    const seconds = payload.length / (sampleRate * channels * 2);
    if (totalSeconds + batchSecondsActual + seconds > maxSessionSeconds) {
      sendError("The live transcription session reached its time limit.", { fatal: true, code: 1009 });
      return false;
    }
    batchSampleRate = sampleRate;
    batchChannels = channels;
    batch.push(payload);
    batchBytes += payload.length;
    batchSecondsActual += seconds;
    pendingSequences.push(seq);
    if (!activeFlush && batchSecondsActual >= batchSeconds) {
      flushBatch().catch(() => {});
    }
    return true;
  }

  async function flushBatch() {
    // Serialize provider calls. A stop must wait for the active call, then
    // flush any remaining audio before sending the final transcript.
    if (activeFlush) {
      await activeFlush;
      return flushBatch();
    }
    if (closed || !batch.length) return;
    const operation = transcribeBatch();
    activeFlush = operation;
    try {
      await operation;
    } finally {
      if (activeFlush === operation) activeFlush = null;
    }
    if (!closed && batchSecondsActual >= batchSeconds) await flushBatch();
  }

  async function transcribeBatch() {
    const pcm = Buffer.concat(batch, batchBytes);
    const sampleRate = batchSampleRate;
    const channels = batchChannels;
    const seconds = batchSecondsActual;
    const sequences = pendingSequences;
    resetBatch();
    pendingSequences = [];
    totalSeconds += seconds;

    if (pcm.length > MAX_BATCH_BYTES) {
      sendError("The audio batch is too large.", { fatal: true, code: 1009 });
      return;
    }

    const data = pcmToWav(pcm, sampleRate, channels).toString("base64");
    if (data.length > 28_000_000) {
      sendError("The audio batch exceeds the transcription limit.", { fatal: true, code: 1009 });
      return;
    }

    try {
      const result = await Promise.race([
        options.transcribe(auth, { data, mime: "audio/wav" }, seconds),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Transcription timed out.")), TRANSCRIBE_TIMEOUT_MS).unref?.(),
        ),
      ]);
      const text = normalizeTranscript(result);
      if (text) transcript = `${transcript} ${text}`.trim();
      sendText({
        type: "transcript",
        partial: true,
        final: false,
        seq: sequences.at(-1) ?? autoSeq - 1,
        sampleRate,
        channels,
        text: transcript,
      });
    } catch (error) {
      // The submitted batch has not been transcribed. Do not report a final
      // success or silently continue after losing it.
      sendError(error?.message || "Live transcription failed; reconnect to try again.", { fatal: true, code: 1011 });
    }
  }

  function processData(chunk) {
    if (closed || stopping) return;
    if (buffer.length + chunk.length > MAX_BUFFER_BYTES + maxFrameBytes) {
      sendError("The WebSocket buffer exceeded its limit.", { fatal: true, code: 1009 });
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const b0 = buffer[0];
      const b1 = buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < offset + 2) break;
        payloadLen = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (buffer.length < offset + 8) break;
        const wide = buffer.readBigUInt64BE(offset);
        if (wide > BigInt(maxFrameBytes)) {
          sendError("The WebSocket frame exceeded its limit.", { fatal: true, code: 1009 });
          return;
        }
        payloadLen = Number(wide);
        offset += 8;
      }

      if (payloadLen > maxFrameBytes || payloadLen < 0) {
        sendError("The WebSocket frame exceeded its limit.", { fatal: true, code: 1009 });
        return;
      }

      let maskKey = null;
      if (masked) {
        if (buffer.length < offset + 4) break;
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + payloadLen) break;

      const rawPayload = buffer.subarray(offset, offset + payloadLen);
      let payload = Buffer.alloc(payloadLen);

      if (masked && maskKey) {
        for (let i = 0; i < payloadLen; i++) {
          payload[i] = rawPayload[i] ^ maskKey[i % 4];
        }
      } else {
        rawPayload.copy(payload);
      }

      buffer = buffer.subarray(offset + payloadLen);

      if (opcode === 0x08) {
        closed = true;
        try {
          if (socket.writable) socket.write(closeFrame(1000));
        } catch {}
        socket.end();
        return;
      }
      if (opcode === 0x09) {
        try {
          if (socket.writable) socket.write(createWebSocketFrame(payload, 0x0a));
        } catch {}
        continue;
      }
      if (opcode === 0x01) {
        // Text is accepted only as an explicit end-of-stream marker. This
        // flushes buffered audio before the client closes the socket.
        if (payload.toString("utf8").trim() === "stop") {
          stopping = true;
          flushBatch()
            .then(() => {
              if (closed) return;
              sendText({ type: "transcript", partial: false, final: true, text: transcript });
              closed = true;
              try {
                if (socket.writable) socket.write(closeFrame(1000));
              } catch {}
              socket.end();
            })
            .catch(() => {
              sendError("Could not finish live transcription.", { fatal: true, code: 1011 });
            });
          return;
        }
        continue;
      }
      if (opcode !== 0x02) continue;

      let seq = autoSeq++;
      let sampleRate = 48000;
      let channels = 2;
      let byteCount = payload.length;

      if (payload.length >= 16 && payload.readUInt32LE(0) === LDAS_MAGIC) {
        sampleRate = payload.readUInt16LE(4);
        channels = payload.readUInt16LE(6);
        byteCount = payload.readUInt32LE(8);
        seq = payload.readUInt32LE(12);
        if (
          sampleRate < 8000 ||
          sampleRate > 96000 ||
          channels < 1 ||
          channels > 2 ||
          byteCount !== payload.length - 16 ||
          byteCount === 0 ||
          byteCount % (channels * 2) !== 0
        ) {
          sendError("The audio frame header is invalid.", { fatal: true, code: 1008 });
          return;
        }
        payload = payload.subarray(16);
      } else if (payload.length === 0 || payload.length % (channels * 2) !== 0) {
        sendError("The audio frame is not valid 16-bit PCM.", { fatal: true, code: 1008 });
        return;
      }

      if (sessionSampleRate && (sessionSampleRate !== sampleRate || sessionChannels !== channels)) {
        sendError("Audio format changed; reconnect to continue transcription.", { fatal: true, code: 1008 });
        return;
      }
      sessionSampleRate = sampleRate;
      sessionChannels = channels;

      if (!appendBatch(payload, sampleRate, channels, seq)) return;

      // Acknowledge only audio that passed session and buffer limits.
      sendText({
        type: "transcript",
        partial: true,
        final: false,
        seq,
        sampleRate,
        channels,
        byteCount,
        text: transcript,
      });

    }
  }

  socket.on("data", processData);

  socket.on("error", () => {
    closed = true;
    socket.destroy();
  });

  socket.on("close", () => {
    closed = true;
  });

  // Node passes bytes read beyond the HTTP headers separately from later
  // socket data. They may contain a complete frame with no subsequent data.
  if (buffer.length) processData(Buffer.alloc(0));
}
