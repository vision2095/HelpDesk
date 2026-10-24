import { test } from "node:test";
import assert from "node:assert/strict";
import { measureAudio } from "../server/media.mjs";
export function wav(seconds = 2, sampleRate = 16000) {
  const samples = Math.floor(seconds * sampleRate),
    buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
test("audio metering uses decoded duration rather than encoded byte size", async () => {
  const a = await measureAudio(wav(2, 16000).toString("base64")),
    b = await measureAudio(wav(2, 48000).toString("base64"));
  assert.equal(a.durationSeconds, 2);
  assert.equal(b.durationSeconds, 2);
  assert.equal(a.sampleRate, 16000);
  assert.equal(b.sampleRate, 48000);
});
test("invalid media cannot consume a fabricated duration allowance", async () => {
  await assert.rejects(
    measureAudio(Buffer.from("not audio").toString("base64")),
    /valid supported media|No audio/,
  );
});
