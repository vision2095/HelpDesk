// derived: rea/native/windows/src/websocket_audio_sink.hpp
import { createHash } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const LDAS_MAGIC = 0x5341444c; // 'LDAS' in little endian

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

/**
 * Handles HTTP Upgrade for WebSocket transcription stream (/ws/transcribe).
 * Ingests 16-byte AudioFrameHeader binary frames and replies with JSON partial transcripts.
 */
export function handleWebSocketTranscribeUpgrade(req, socket, head, options = {}) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ws/transcribe") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const acceptKey = createHash("sha1")
    .update(key.trim() + WS_GUID)
    .digest("base64");

  const responseHeaders = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${acceptKey}`,
    "\r\n",
  ].join("\r\n");

  socket.write(responseHeaders);

  let buffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);

  function sendText(obj) {
    if (socket.destroyed || !socket.writable) return;
    const jsonStr = typeof obj === "string" ? obj : JSON.stringify(obj);
    socket.write(createWebSocketFrame(jsonStr, 0x01));
  }

  socket.on("data", (chunk) => {
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
        payloadLen = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey = null;
      if (masked) {
        if (buffer.length < offset + 4) break;
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + payloadLen) break;

      const rawPayload = buffer.subarray(offset, offset + payloadLen);
      const payload = Buffer.alloc(payloadLen);

      if (masked && maskKey) {
        for (let i = 0; i < payloadLen; i++) {
          payload[i] = rawPayload[i] ^ maskKey[i % 4];
        }
      } else {
        rawPayload.copy(payload);
      }

      buffer = buffer.subarray(offset + payloadLen);

      // Opcode handling
      if (opcode === 0x08) {
        // Close frame
        const closeFrame = Buffer.alloc(4);
        closeFrame[0] = 0x88;
        closeFrame[1] = 0x02;
        closeFrame.writeUInt16BE(1000, 2);
        try {
          socket.write(closeFrame);
        } catch {}
        socket.end();
        return;
      } else if (opcode === 0x09) {
        // Ping frame
        const pong = createWebSocketFrame(payload, 0x0a);
        try {
          socket.write(pong);
        } catch {}
      } else if (opcode === 0x02) {
        // Binary frame containing 16-byte AudioFrameHeader
        if (payload.length >= 16) {
          const magic = payload.readUInt32LE(0);
          const sampleRate = payload.readUInt16LE(4);
          const channels = payload.readUInt16LE(6);
          const byteCount = payload.readUInt32LE(8);
          const seq = payload.readUInt32LE(12);

          if (magic === LDAS_MAGIC) {
            // Emits JSON partial transcript text frames per contract
            sendText({
              type: "transcript",
              partial: true,
              seq,
              sampleRate,
              channels,
              byteCount,
              text: "",
            });
          }
        }
      }
    }
  });

  socket.on("error", () => {
    socket.destroy();
  });
}
