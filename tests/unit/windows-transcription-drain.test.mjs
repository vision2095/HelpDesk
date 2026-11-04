import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { handleWebSocketTranscribeUpgrade } from "../../server/cloud/websocket-transcribe.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function audioFrame(rate, seq) {
  const frame = Buffer.alloc(116, 0x11);
  frame.writeUInt32LE(0x5341444c, 0);
  frame.writeUInt16LE(rate, 4);
  frame.writeUInt16LE(2, 6);
  frame.writeUInt32LE(100, 8);
  frame.writeUInt32LE(seq, 12);
  return frame;
}
async function makeSession(t, transcribe, options = {}) {
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => {
    handleWebSocketTranscribeUpgrade(req, socket, head, {
      authenticate: async () => ({ user: { id: "test-user" } }),
      transcribe,
      batchSeconds: 0.0001,
      ...options,
    }).catch(() => socket.destroy());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/transcribe?token=test`);
  await once(socket, "open");
  t.after(() => socket.close());
  return socket;
}
function watchMessages(socket) {
  const messages = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    messages.push(JSON.parse(event.data));
    for (const waiter of waiters.splice(0)) waiter();
  });
  return {
    messages,
    async next(predicate) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const found = messages.find(predicate);
        if (found) return found;
        await Promise.race([
          new Promise((resolve) => waiters.push(resolve)),
          new Promise((resolve) => setTimeout(resolve, 20)),
        ]);
      }
      throw new Error("Timed out waiting for transcription message");
    },
  };
}

test("stop waits for in-flight and buffered audio before final transcript", async (t) => {
  const first = deferred();
  const second = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  const calls = [];
  const socket = await makeSession(t, async (_auth, payload) => {
    const wav = Buffer.from(payload.data, "base64");
    calls.push(wav);
    if (calls.length === 1) { firstStarted.resolve(); return first.promise; }
    secondStarted.resolve();
    return second.promise;
  });
  const seen = watchMessages(socket);
  socket.send(audioFrame(48000, 1));
  await firstStarted.promise;
  socket.send(audioFrame(48000, 2));
  socket.send("stop");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(seen.messages.some((message) => message.final), false);
  first.resolve({ text: "first" });
  await secondStarted.promise;
  assert.equal(seen.messages.some((message) => message.final), false);
  second.resolve({ text: "second" });
  const final = await seen.next((message) => message.final === true);
  assert.equal(final.text, "first second");
  assert.equal(calls.length, 2);
  for (const wav of calls) {
    assert.equal(wav.readUInt32LE(24), 48000);
    assert.equal(wav.readUInt32LE(40), 100);
  }
});

test("a mid-session PCM format change is rejected before audio can be mixed", async (t) => {
  const first = deferred();
  const started = deferred();
  const calls = [];
  const socket = await makeSession(t, async (_auth, payload) => {
    calls.push(payload);
    started.resolve();
    return first.promise;
  });
  const seen = watchMessages(socket);
  socket.send(audioFrame(48000, 1));
  await started.promise;
  socket.send(audioFrame(44100, 2));
  const error = await seen.next((message) => message.type === "error");
  assert.match(error.error, /format changed/i);
  assert.equal(calls.length, 1);
  first.resolve({ text: "first" });
});

for (const failedBatch of [1, 2]) {
  test(`provider failure in batch ${failedBatch} never sends a successful final`, async (t) => {
    const first = deferred();
    const second = deferred();
    const firstStarted = deferred();
    const secondStarted = deferred();
    let count = 0;
    const socket = await makeSession(t, async () => {
      count++;
      if (count === 1) { firstStarted.resolve(); return first.promise; }
      secondStarted.resolve();
      return second.promise;
    });
    const seen = watchMessages(socket);
    socket.send(audioFrame(48000, 1));
    await firstStarted.promise;
    if (failedBatch === 2) socket.send(audioFrame(48000, 2));
    socket.send("stop");
    if (failedBatch === 1) first.reject(new Error("provider unavailable"));
    else {
      first.resolve({ text: "first" });
      await secondStarted.promise;
      second.reject(new Error("provider unavailable"));
    }
    const error = await seen.next((message) => message.type === "error");
    assert.match(error.error, /provider unavailable/);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(seen.messages.some((message) => message.final === true), false);
  });
}

test("an over-limit audio frame is rejected without an acknowledgement", async (t) => {
  const socket = await makeSession(t, async () => ({ text: "unexpected" }), { maxSessionSeconds: 0.0001 });
  const seen = watchMessages(socket);
  socket.send(audioFrame(48000, 99));
  const error = await seen.next((message) => message.type === "error");
  assert.match(error.error, /time limit/);
  assert.equal(seen.messages.some((message) => message.seq === 99), false);
});
