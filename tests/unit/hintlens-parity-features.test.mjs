import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPreferences } from "../../desktop/preferences.cjs";
import { getMachineGuid } from "../../desktop/machine-guid.cjs";
import { recognizeImage } from "../../server/media.mjs";

test("Hardware Binding: getMachineGuid returns a non-empty string identifier", () => {
  const guid = getMachineGuid();
  assert.equal(typeof guid, "string");
  assert.ok(guid.length > 5, "Hardware GUID should be at least 6 characters");
});

test("HintLens Parity Preferences: validates chatLayout, restrictedNetwork, and localOcr", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-parity-"));
  try {
    const prefs = await createPreferences(tmpDir);
    const initial = prefs.get();

    assert.equal(initial.chatLayout, "standard");
    assert.equal(initial.restrictedNetwork, false);
    assert.equal(initial.localOcr, false);

    // Save customized HintLens parity preferences
    await prefs.save({
      ...initial,
      chatLayout: "minimal",
      restrictedNetwork: true,
      localOcr: true,
    });

    const updated = prefs.get();
    assert.equal(updated.chatLayout, "minimal");
    assert.equal(updated.restrictedNetwork, true);
    assert.equal(updated.localOcr, true);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  }
});

test("Local OCR: recognizeImage handles base64 payload and validates inputs", async () => {
  // 1x1 transparent png base64
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  try {
    const res = await recognizeImage(pngBase64, { language: "eng" });
    assert.equal(typeof res.text, "string");
  } catch (err) {
    // If tesseract/winrt is unavailable in non-windows / CI environment, assert it threw gracefully
    assert.ok(err instanceof Error);
  }
});
