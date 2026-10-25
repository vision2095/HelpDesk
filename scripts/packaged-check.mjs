import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-packaged-"));
const executable = path.resolve(
  process.env.LENSDESK_EXECUTABLE ||
    (fs.existsSync("release/mac-arm64/LensDesk.app")
      ? "release/mac-arm64/LensDesk.app/Contents/MacOS/LensDesk"
      : "release/mac-arm64/RuntimeHost.app/Contents/MacOS/RuntimeHost"),
);
const portServer = await import("node:net").then(({ createServer }) =>
  createServer(),
);
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve, reject) =>
  portServer.close((error) => (error ? reject(error) : resolve())),
);
const child = spawn(
  executable,
  [
    `--user-data-dir=${dir}`,
    `--remote-debugging-port=${port}`,
    "--enable-logging=stderr",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-12000);
  });
let browser, page;
try {
  let ready = false;
  for (let i = 0; i < 450; i++) {
    if (child.exitCode !== null)
      throw new Error(`Packaged process exited (${child.exitCode}): ${output}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Packaged app did not expose its test browser: ${output}`);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith("file:"));
  assert.ok(page, "packaged app opened its local renderer");
  page.setDefaultTimeout(15000);
  console.log("Packaged renderer URL:", page.url());
  await page.getByRole("heading", { name: /LensDesk Assistant|What would you like to explore\?|Your thinking space/i }).waitFor();
  assert.equal(
    await page
      .evaluate(() => window.lens.invoke("desktop.preferences"))
      .then((preferences) => preferences.packaged),
    true,
  );
  const state = await page.evaluate(() => window.lens.invoke("state"));
  assert.ok(Array.isArray(state.sessions));
  await page
    .getByRole("button", { name: "Account & cloud", exact: true })
    .click();
  await page.getByLabel("Cloud server URL").waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Session layout", { exact: true }).waitFor();
  await page.getByLabel("Save screenshots to disk", { exact: true }).waitFor();
  await page.getByLabel("Move window up shortcut", { exact: true }).waitFor();
  const detected = await page.evaluate(() =>
    window.lens.invoke("desktop.models.detect"),
  );
  assert.ok(
    Array.isArray(detected.servers) && Array.isArray(detected.unavailable),
  );
  const archive = await page.evaluate(() =>
    window.lens.invoke("desktop.captureArchive.status"),
  );
  assert.equal(archive.files, 0);
  assert.equal(archive.directory, "");
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.ok(
    fs.existsSync(path.join(dir, "workspace.sqlite")),
    "packaged app stored its test workspace in the temporary user-data directory",
  );
  console.log(
    "Packaged macOS app passed: launched production app; rendered account/appearance/archive/expanded shortcut controls; loaded local-detection module; kept the temporary workspace and preload sandbox isolated.",
  );
} catch (error) {
  console.error("Packaged diagnostics:", { url: page?.url(), text: await page?.locator("body").innerText().catch(() => "unavailable"), output });
  throw error;
} finally {
  if (child.exitCode === null) {
    try {
      await page?.keyboard.press("Meta+Q");
    } catch {}
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  await browser?.close().catch(() => {});
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve)).catch(() => {});
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
