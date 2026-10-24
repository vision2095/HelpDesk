import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { windowOptions } = require("../desktop/window-options.cjs");

test("darwin overlay windows are panels hidden from Mission Control", () => {
  const o = windowOptions("darwin");
  assert.equal(o.type, "panel");
  assert.equal(o.hiddenInMissionControl, true);
});

test("win32 and linux add no creation options", () => {
  // Taskbar/Alt+Tab exclusion happens at runtime with setSkipTaskbar while the
  // overlay is floating; creation must not fight that behavior.
  assert.deepEqual(windowOptions("win32"), {});
  assert.deepEqual(windowOptions("linux"), {});
});

test("windowOptions only returns known BrowserWindow keys", () => {
  const known = ["type", "hiddenInMissionControl"];
  for (const platform of ["darwin", "win32", "linux"]) {
    for (const key of Object.keys(windowOptions(platform)))
      assert.ok(known.includes(key), `unexpected key: ${key}`);
  }
});
