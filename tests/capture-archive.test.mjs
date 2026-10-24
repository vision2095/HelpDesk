import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { createCaptureArchive } = createRequire(import.meta.url)(
  "../desktop/capture-archive.cjs",
);
const image = "data:image/png;base64,iVBORw0KGgo=";
test("capture archives are opt-in, uniquely named, private, counted, and retained when disabled", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "lensdesk-archive-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let preferences = { captureArchive: { enabled: false, directory } };
  const archive = createCaptureArchive({ getPreferences: () => preferences });
  assert.deepEqual(await archive.save(image), { saved: false });
  await fs.writeFile(path.join(directory, "personal.png"), "other image");
  preferences.captureArchive = { enabled: true, directory };
  const results = await Promise.all([archive.save(image), archive.save(image)]);
  assert.notEqual(results[0].filename, results[1].filename);
  const status = await archive.status();
  assert.equal(status.files, 2);
  assert.equal(status.bytes, 16);
  if (process.platform !== "win32") {
    assert.equal(
      (await fs.stat(path.join(directory, results[0].filename))).mode & 0o777,
      0o600,
    );
  }
  preferences.captureArchive = { enabled: false, directory };
  await archive.save(image);
  assert.equal((await archive.status()).files, 2);
});
test("capture archive errors do not poison subsequent writes and quota excludes unrelated files", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "lensdesk-archive-limit-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const preferences = { captureArchive: { enabled: true, directory } };
  const archive = createCaptureArchive({ getPreferences: () => preferences });
  await assert.rejects(archive.save("data:text/plain;base64,SGk="), /Only PNG/);
  await archive.save(image);
  const [filename] = await fs.readdir(directory);
  await fs.truncate(path.join(directory, filename), 200 * 1024 * 1024);
  await assert.rejects(archive.save(image), /200 MB/);
  await fs.unlink(path.join(directory, filename));
  await archive.save(image);
  assert.equal((await archive.status()).files, 1);
});
