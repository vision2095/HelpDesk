import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSettingsWriter } from "../src/settings-writer.ts";
import { createService } from "../server/core.mjs";
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lens-settings-"));
  const service = createService({ directory });
  t.after(() => {
    service.close();
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  });
  let cached = await service.dispatch("state");
  const writer = createSettingsWriter({
    getBase: () => cached.settings,
    read: () => service.dispatch("state"),
    save: (s) => service.dispatch("settings.save", s),
    onSaved: (s) => {
      cached = s;
    },
  });
  return { service, writer, getCached: () => cached };
}
test("consecutive and queued settings saves retain canonical revisions", async (t) => {
  const f = await fixture(t);
  const first = await f.writer.write({ language: "Hindi" });
  const second = await f.writer.write({ language: "English" });
  assert.equal(second.settings.version, first.settings.version + 1);
  await Promise.all([
    f.writer.write({ opacity: 0.6 }),
    f.writer.write({ opacity: 0.7 }),
    f.writer.write({ captureProtection: true }),
  ]);
  const result = await f.service.dispatch("state");
  assert.equal(result.settings.opacity, 0.7);
  assert.equal(result.settings.captureProtection, true);
  assert.equal(f.getCached().settings.version, result.settings.version);
});
test("settings writer preserves unrelated external changes and rejects overlapping edits", async (t) => {
  const f = await fixture(t);
  let remote = await f.service.dispatch("state");
  await f.service.dispatch("settings.save", {
    ...remote.settings,
    language: "French",
  });
  await f.writer.write({ opacity: 0.8 });
  assert.equal(f.getCached().settings.language, "French");
  remote = await f.service.dispatch("state");
  await f.service.dispatch("settings.save", {
    ...remote.settings,
    opacity: 0.9,
  });
  await assert.rejects(f.writer.write({ opacity: 0.6 }), /another device/);
  assert.equal((await f.service.dispatch("state")).settings.opacity, 0.9);
  await f.writer.write({ captureProtection: true });
  assert.equal(f.getCached().settings.captureProtection, true);
});
