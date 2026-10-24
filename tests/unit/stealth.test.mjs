import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { applyStealthFlags, TOPMOST_LEVEL } = require("../../desktop/stealth.cjs");

function fakeWindow({ destroyed = false } = {}) {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    isDestroyed: () => destroyed,
    setAlwaysOnTop: record("setAlwaysOnTop"),
    setVisibleOnAllWorkspaces: record("setVisibleOnAllWorkspaces"),
    setSkipTaskbar: record("setSkipTaskbar"),
    setContentProtection: record("setContentProtection"),
    setIgnoreMouseEvents: record("setIgnoreMouseEvents"),
    setTitle: record("setTitle"),
    setWindowButtonVisibility: record("setWindowButtonVisibility"),
  };
}

test("applyStealthFlags forces screen-saver topmost level", () => {
  const win = fakeWindow();
  const applied = applyStealthFlags(win, { platform: "win32" });
  assert.equal(TOPMOST_LEVEL, "screen-saver");
  assert.ok(applied.includes("setAlwaysOnTop"));
  assert.deepEqual(
    win.calls.find(([name]) => name === "setAlwaysOnTop").slice(1),
    [true, "screen-saver"],
  );
});

test("applyStealthFlags sets content protection false when stealth is false", () => {
  const win = fakeWindow();
  applyStealthFlags(win, { platform: "win32", stealth: false });
  assert.deepEqual(
    win.calls.find(([name]) => name === "setContentProtection").slice(1),
    [false],
  );
});

test("applyStealthFlags returns [] for a destroyed window", () => {
  const win = fakeWindow({ destroyed: true });
  assert.deepEqual(applyStealthFlags(win, { platform: "win32" }), []);
  assert.deepEqual(win.calls, []);
});

test("applyStealthFlags clears the window title", () => {
  const win = fakeWindow();
  applyStealthFlags(win, { platform: "win32" });
  assert.deepEqual(
    win.calls.find(([name]) => name === "setTitle").slice(1),
    [""],
  );
});
