import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
const source = fs.readFileSync(
  new URL("../desktop/autotype.cjs", import.meta.url),
  "utf8",
);
function helper({
  platform = "darwin",
  trusted = true,
  execute = async () => ({ stdout: "444" }),
  onWait = () => {},
} = {}) {
  const calls = [],
    waits = [],
    formats = new Map([
      ["text/plain", Buffer.from("original")],
      ["image/png", Buffer.from("image")],
    ]);
  const clipboard = {
    availableFormats: () => [...formats.keys()],
    readBuffer: (key) => formats.get(key),
    readText: () => formats.get("text/plain")?.toString() || "",
    clear: () => formats.clear(),
    writeBuffer: (key, value) => formats.set(key, value),
    writeText: (value) => {
      formats.clear();
      formats.set("text/plain", Buffer.from(value));
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    process: { platform, pid: 123 },
    setTimeout(callback, delay) {
      waits.push(delay);
      onWait(delay);
      return setTimeout(callback, Math.min(delay, 1));
    },
    clearTimeout,
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    require(name) {
      if (name === "node:fs") return fs;
      if (name === "node:os") return os;
      if (name === "node:path") return path;
      if (name === "node:child_process")
        return {
          execFile() {
            throw new Error("Unexpected native execution");
          },
        };
      if (name === "node:util")
        return {
          promisify:
            () =>
            async (...args) => {
              calls.push(args);
              return execute(...args);
            },
        };
      if (name === "electron")
        return {
          clipboard,
          systemPreferences: { isTrustedAccessibilityClient: () => trusted },
        };
      throw new Error(name);
    },
  });
  return { ...module.exports, calls, clipboard, waits };
}
test("permission denial never types or attempts clipboard fallback", async () => {
  const h = helper({ trusted: false });
  await assert.rejects(
    h.autoType({ text: "abc", delaySeconds: 0 }),
    /Accessibility/,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.clipboard.readText(), "original");
});
test("cancellation after partial typing never pastes or continues", async () => {
  const controller = new AbortController();
  let count = 0;
  const h = helper({
    execute: async () => {
      if (++count === 2) controller.abort();
      return { stdout: "444" };
    },
  });
  await assert.rejects(
    h.autoType({ text: "abc", delaySeconds: 0, signal: controller.signal }),
    /canceled/,
  );
  assert.equal(h.calls.length, 2);
  assert.equal(h.clipboard.readText(), "original");
});
test("native typing failure never retries with entire text", async () => {
  let count = 0;
  const h = helper({
    execute: async () => {
      if (++count === 3) throw new Error("Destination changed");
      return { stdout: "444" };
    },
  });
  await assert.rejects(
    h.autoType({ text: "abc", speed: "turbo", delaySeconds: 0 }),
    /Destination changed/,
  );
  assert.equal(h.calls.length, 3);
  assert.match(h.calls[1][1][1], /is not 444/);
  assert.equal(h.clipboard.readText(), "original");
});
test("Windows loads Forms and preserves changed clipboard content", async () => {
  let h;
  h = helper({
    platform: "win32",
    execute: async () => {
      h.clipboard.writeText("new user copy");
      return { stdout: "" };
    },
  });
  await h.autoType({ text: "answer", delaySeconds: 0 });
  assert.equal(h.calls[0][0], "powershell.exe");
  assert.match(
    h.calls[0][1].at(-1),
    /Add-Type -AssemblyName System.Windows.Forms/,
  );
  assert.equal(h.clipboard.readText(), "new user copy");
});
test("Windows restores original text and image formats after paste failure", async () => {
  const h = helper({
    platform: "win32",
    execute: async () => {
      throw new Error("paste failed");
    },
  });
  await assert.rejects(
    h.autoType({ text: "answer", delaySeconds: 0 }),
    /paste failed/,
  );
  assert.equal(h.clipboard.readText(), "original");
  assert.ok(h.clipboard.availableFormats().includes("image/png"));
});
test("typing rejects invalid options and already-canceled countdown", async () => {
  const h = helper();
  await assert.rejects(
    h.autoType({ text: "answer", delaySeconds: NaN }),
    /Invalid/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    h.autoType({ text: "answer", signal: controller.signal }),
    /canceled/,
  );
  assert.equal(h.calls.length, 0);
});

test("the real timing planner converts WPM, adds configured pauses and keeps every wait bounded", () => {
  const h = helper();
  const steady = { wpm: 100, jitter: 0, pauses: 0 };
  assert.deepEqual(
    Array.from(h.computeTypingDelays("abc", steady)),
    [120, 120, 0],
  );
  assert.deepEqual(
    Array.from(h.computeTypingDelays("a.\nb", { ...steady, pauses: 100 })),
    [120, 300, 360, 0],
  );
  const low = h.computeTypingDelays(
    "a\nb",
    { wpm: 10, jitter: 100, pauses: 100 },
    () => 0,
  );
  const high = h.computeTypingDelays(
    "a\nb",
    { wpm: 10, jitter: 100, pauses: 100 },
    () => 1,
  );
  assert.ok(low[0] < high[0]);
  assert.ok(high[1] > high[0]);
  assert.ok([...low, ...high].every((delay) => delay >= 0 && delay <= 5000));
  assert.equal(h.computeTypingDelays("😀\r\nx", steady).length, 3);
});

test("fine typing controls reject malformed and out-of-range values before native execution", async () => {
  const h = helper();
  for (const options of [
    { wpm: 9 },
    { wpm: 251 },
    { wpm: NaN },
    { wpm: null },
    { jitter: -1 },
    { jitter: 101 },
    { jitter: "50" },
    { pauses: -1 },
    { pauses: 101 },
    { pauses: Infinity },
    { method: "unrecognized" },
  ]) {
    await assert.rejects(
      h.autoType({ text: "answer", delaySeconds: 0, ...options }),
      /Invalid/,
    );
  }
  assert.equal(h.calls.length, 0);
  assert.throws(
    () => h.computeTypingDelays("abc", { jitter: 100 }, () => NaN),
    /timing sample/,
  );
});

test("macOS engine actually schedules the configured per-character delays and enters only the supplied characters", async () => {
  const h = helper();
  const result = await h.autoType({
    text: "a.\nb",
    codeOnly: false,
    delaySeconds: 0,
    wpm: 100,
    jitter: 0,
    pauses: 100,
    method: "keystroke",
  });
  assert.equal(result.method, "keystroke");
  assert.deepEqual(h.waits, [0, 120, 300, 360]);
  assert.equal(h.calls.length, 5);
  assert.ok(h.calls[1][1].at(-1).includes('keystroke "a"'));
  assert.ok(h.calls[2][1].at(-1).includes('keystroke "."'));
  assert.ok(h.calls[3][1].at(-1).includes("key code 36"));
  assert.ok(h.calls[4][1].at(-1).includes('keystroke "b"'));
});

test("macOS cancellation interrupts a configured pause before the next character", async () => {
  const controller = new AbortController();
  const h = helper({
    onWait(delay) {
      if (delay > 0) queueMicrotask(() => controller.abort());
    },
  });
  await assert.rejects(
    h.autoType({
      text: "abc",
      delaySeconds: 0,
      wpm: 10,
      jitter: 0,
      pauses: 100,
      signal: controller.signal,
    }),
    /canceled/,
  );
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.waits, [0, 1200]);
  assert.equal(h.clipboard.readText(), "original");
});

function windowsPayload(args) {
  const script = args[1].at(-1);
  const match = script.match(/^\$PayloadPath = '((?:[^']|'')*)'/);
  assert.ok(
    match,
    "keystroke helper receives a literal temporary payload path",
  );
  const file = match[1].replaceAll("''", "'");
  return { file, script, data: JSON.parse(fs.readFileSync(file, "utf8")) };
}

test("Windows explicit keystroke mode consumes the shared timing plan even with the turbo legacy speed", async () => {
  let payload;
  const h = helper({
    platform: "win32",
    execute: async (...args) => {
      payload = windowsPayload(args);
      return { stdout: "" };
    },
  });
  const result = await h.autoType({
    text: "a.\nb",
    codeOnly: false,
    delaySeconds: 0,
    method: "keystroke",
    speed: "turbo",
    wpm: 100,
    jitter: 0,
    pauses: 100,
  });
  assert.equal(result.method, "keystroke");
  assert.deepEqual(payload.data.characters, ["a", ".", "\n", "b"]);
  assert.deepEqual(payload.data.delays, [120, 300, 360, 0]);
  assert.ok(payload.script.includes("$payload.delays[$index]"));
  assert.ok(payload.script.includes("Destination changed. Typing stopped."));
  assert.equal(fs.existsSync(payload.file), false);
  assert.equal(fs.existsSync(path.dirname(payload.file)), false);
  assert.equal(h.clipboard.readText(), "original");
});

test("Windows keystroke failure after possible partial output never pastes or retries and deletes its temporary answer", async () => {
  let payload;
  const h = helper({
    platform: "win32",
    execute: async (...args) => {
      payload = windowsPayload(args);
      throw new Error("SendKeys failed after partial output");
    },
  });
  await assert.rejects(
    h.autoType({ text: "answer", delaySeconds: 0, method: "keystroke" }),
    /after partial output/,
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.clipboard.readText(), "original");
  assert.equal(fs.existsSync(path.dirname(payload.file)), false);
});

test("Windows cancellation aborts its native helper without clipboard fallback and removes temporary answer data", async () => {
  let payload;
  const controller = new AbortController();
  const h = helper({
    platform: "win32",
    execute: async (...args) => {
      payload = windowsPayload(args);
      assert.equal(args[2].signal, controller.signal);
      controller.abort();
      return { stdout: "" };
    },
  });
  await assert.rejects(
    h.autoType({
      text: "answer",
      delaySeconds: 0,
      method: "keystroke",
      signal: controller.signal,
    }),
    /canceled/,
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.clipboard.readText(), "original");
  assert.equal(fs.existsSync(path.dirname(payload.file)), false);
});

test("long Windows answers stay out of command arguments and receive a timeout longer than their typing duration", async () => {
  let payload;
  const h = helper({
    platform: "win32",
    execute: async (...args) => {
      payload = windowsPayload(args);
      assert.ok(args[1].join(" ").length < 10000);
      assert.ok(
        args[2].timeout >
          payload.data.delays.reduce((sum, delay) => sum + delay, 0),
      );
      return { stdout: "" };
    },
  });
  const text = "a".repeat(20000);
  await h.autoType({ text, delaySeconds: 0, method: "keystroke", wpm: 10 });
  assert.equal(payload.data.characters.length, 20000);
  assert.equal(h.calls.length, 1);
  assert.equal(fs.existsSync(path.dirname(payload.file)), false);
});
