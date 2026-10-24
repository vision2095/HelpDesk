// These exercise production preferences, not copied algorithms or invented reference defaults.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { createPreferences } = createRequire(import.meta.url)(
  "../desktop/preferences.cjs",
);
async function fixture(task) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "lensdesk-reference-prefs-"),
  );
  try {
    await task(directory, await createPreferences(directory));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
test("gesture and capture preferences survive process reload and normalize known legacy labels", () =>
  fixture(async (directory, prefs) => {
    assert.equal(prefs.get().mouse.enabled, false);
    const next = prefs.get();
    next.mouse = {
      ...next.mouse,
      enabled: true,
      trigger: "Middle button (wheel click)",
      slots: 8,
      style: "flick",
      holdMs: 300,
      mappings: { 1: "Get Answer", 8: "Browser" },
    };
    next.capture = { mode: "specific", displayId: "test-display" };
    next.autoType = { ...next.autoType, wpm: 85, jitter: 45, pauses: 30 };
    await prefs.save(next);
    const restored = (await createPreferences(directory)).get();
    assert.equal(restored.mouse.trigger, "middle");
    assert.equal(restored.mouse.mappings[1], "getAnswer");
    assert.equal(restored.mouse.mappings[8], "browser");
    assert.equal(restored.mouse.holdMs, 300);
    assert.equal(restored.capture.displayId, "test-display");
    assert.equal(restored.autoType.wpm, 85);
  }));
test("invalid finite values and mouse/capture actions cannot poison later preference saves", () =>
  fixture(async (directory, prefs) => {
    for (const patch of [
      { mouse: { size: NaN } },
      { mouse: { opacity: Infinity } },
      { mouse: { holdMs: -1 } },
      { mouse: { slots: 5 } },
      { mouse: { trigger: "unrecognized" } },
      { mouse: { mappings: { 1: "execute code" } } },
      { capture: { mode: "invented" } },
      { autoType: { wpm: Infinity } },
      { autoType: { pauses: -1 } },
    ]) {
      const next = prefs.get();
      for (const [field, value] of Object.entries(patch))
        next[field] = { ...next[field], ...value };
      await assert.rejects(prefs.save(next));
    }
    const next = prefs.get();
    next.mouse.style = "flick";
    await prefs.save(next);
    assert.equal(
      (await createPreferences(directory)).get().mouse.style,
      "flick",
    );
  }));
test("missing/corrupt desktop configuration retains safe defaults and preserves corrupt source bytes", () =>
  fixture(async (directory) => {
    const file = path.join(directory, "desktop-preferences.json");
    await fs.writeFile(file, "{invalid");
    const prefs = await createPreferences(directory);
    assert.equal(prefs.get().mouse.enabled, false);
    assert.equal(await fs.readFile(file, "utf8"), "{invalid");
    assert.equal(prefs.get().capture.mode, "active");
  }));
