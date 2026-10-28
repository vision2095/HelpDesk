import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createReleases } from "../server/cloud/releases.mjs";
const { version } = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const windowsName = `RuntimeHost-${version}-x64.msi`;
const legacyWindowsName = `LensDesk-${version}-Windows-x64.zip`;

async function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "lensdesk-releases-"),
  );
  let releases;
  const server = createServer(async (req, res) => {
    if (!(await releases.serve(req, res, new URL(req.url, origin)))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  releases = createReleases(directory, origin);
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  });
  return { directory, releases, origin };
}

test("Windows download serves the MSI with its name, exact bytes and SHA-256 when a portable ZIP also exists", async (t) => {
  const { directory, releases, origin } = await fixture(t);
  const bytes = Buffer.from("test MSI artifact");
  fs.writeFileSync(path.join(directory, windowsName), bytes);
  fs.writeFileSync(path.join(directory, legacyWindowsName), "legacy portable ZIP");
  fs.writeFileSync(
    path.join(directory, `LensDesk-${version}-Windows-x64.exe`),
    "legacy installer",
  );
  fs.writeFileSync(
    path.join(directory, `LensDesk-${version}-arm64.dmg`),
    bytes,
  );
  const manifest = await releases.manifest();
  assert.equal(manifest.windows.name, windowsName);
  assert.equal(
    manifest.windows.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(manifest.windows.size, bytes.length);
  assert.equal(manifest["mac-x64"], undefined);
  assert.equal(JSON.stringify(manifest).includes(directory), false);
  const response = await fetch(manifest.windows.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-msi");
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="${windowsName}"`,
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const mac = await fetch(manifest["mac-arm64"].url);
  assert.equal(
    mac.headers.get("content-type"),
    "application/x-apple-diskimage",
  );
  await mac.arrayBuffer();
});

test("generated Windows launch script checks the MSI before running msiexec and then opens the installed app", async (t) => {
  const { directory, origin, releases } = await fixture(t);
  fs.writeFileSync(path.join(directory, windowsName), "test MSI artifact");
  const manifest = await releases.manifest();
  const response = await fetch(origin + "/install.ps1");
  const script = await response.text();
  assert.equal(response.status, 200);
  assert.ok(script.includes(manifest.windows.url));
  assert.ok(script.includes(manifest.windows.sha256));
  assert.ok(script.includes(windowsName));
  assert.ok(script.indexOf("Get-FileHash") < script.indexOf("'msiexec.exe'"));
  assert.ok(script.includes("'/i'"));
  assert.ok(script.includes("'/qn'"));
  assert.ok(script.indexOf("'msiexec.exe'") < script.indexOf("Start-Process -FilePath $executable"));
  assert.ok(script.includes("RuntimeHost.exe"));
  assert.ok(script.includes("Test-Path -LiteralPath $_"));
  assert.ok(script.includes("finally {"));
  assert.equal(script.includes("Expand-Archive"), false);
  assert.equal(script.includes("api.hintlens.com"), false);
});

test("a missing Windows MSI falls back to the portable ZIP when one is present", async (t) => {
  const { directory, releases, origin } = await fixture(t);
  fs.writeFileSync(path.join(directory, legacyWindowsName), "legacy portable ZIP");
  const manifest = await releases.manifest();
  assert.equal(manifest.windows.name, legacyWindowsName);
  const response = await fetch(manifest.windows.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  const script = await (await fetch(origin + "/install.ps1")).text();
  assert.ok(script.includes("Expand-Archive"));
});

test("a missing Windows MSI never silently falls back to an old EXE", async (t) => {
  const { directory, releases, origin } = await fixture(t);
  fs.writeFileSync(
    path.join(directory, `LensDesk-${version}-Windows-x64.exe`),
    "legacy installer",
  );
  assert.equal((await releases.manifest()).windows, undefined);
  assert.equal((await fetch(origin + "/downloads/windows")).status, 404);
  assert.equal((await fetch(origin + "/install.ps1")).status, 503);
  assert.equal(await releases.serve({}, null, new URL(origin + "/")), false);
});

test("release hashes refresh when the MSI is replaced", async (t) => {
  const { directory, releases } = await fixture(t);
  const file = path.join(directory, windowsName);
  fs.writeFileSync(file, "first MSI");
  const before = await releases.manifest();
  fs.writeFileSync(file, "second MSI");
  const modified = new Date(Date.now() + 2000);
  fs.utimesSync(file, modified, modified);
  const after = await releases.manifest();
  assert.notEqual(before.windows.sha256, after.windows.sha256);
  assert.equal(
    after.windows.sha256,
    createHash("sha256").update("second MSI").digest("hex"),
  );
});

test("macOS launch script still checks the available image hash and rejects an unavailable architecture", async (t) => {
  const { directory, releases, origin } = await fixture(t);
  fs.writeFileSync(
    path.join(directory, `LensDesk-${version}-arm64.dmg`),
    "image",
  );
  const manifest = await releases.manifest();
  const response = await fetch(origin + "/install.sh");
  const script = await response.text();
  assert.ok(script.includes(manifest["mac-arm64"].sha256));
  assert.ok(script.includes("shasum -a 256 -c -"));
  assert.ok(
    script.includes("Installer is not available for this architecture"),
  );
});

test("Windows packages an MSI while the macOS DMG targets and scripts stay unchanged", () => {
  const pkg = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(pkg.productName, "LensDesk");
  assert.equal(pkg.build.productName, "LensDesk");
  assert.equal(pkg.build.appId, "com.runtimehost.app");
  assert.equal(pkg.build.afterPack, "./scripts/fix-win-versioninfo.cjs");
  assert.equal(pkg.build.win.legalTrademarks, "RuntimeHost");
  assert.equal(pkg.build.msi.shortcutName, "RuntimeHost");
  assert.equal(pkg.build.nsis.shortcutName, "RuntimeHost");
  assert.deepEqual(pkg.build.win.target, ["msi", "zip", "portable"]);
  assert.deepEqual(pkg.build.asarUnpack, ["**/*.node"]);
  assert.equal(pkg.build.npmRebuild, false);
  assert.equal(pkg.build.win.executableName, "RuntimeHost");
  assert.equal(
    pkg.build.win.artifactName,
    "RuntimeHost-${version}-${arch}.${ext}",
  );
  assert.equal(
    pkg.build.msi.artifactName,
    "RuntimeHost-${version}-${arch}.${ext}",
  );
  assert.equal(pkg.build.msi.perMachine, false);
  assert.equal(pkg.build.msi.oneClick, false);
  assert.equal(pkg.build.portable.artifactName, "RuntimeHost.${ext}");
  assert.equal(pkg.build.win.signAndEditExecutable, false);
  assert.equal(pkg.description, "RuntimeHost");
  assert.equal(pkg.author, "RuntimeHost");
  assert.equal(pkg.build.mac.extendInfo.LSUIElement, false);
  assert.equal(pkg.build.mac.extendInfo.NSHighResolutionCapable, true);
  assert.equal(pkg.scripts["test:win-exe"], "node scripts/win-exe-audit.mjs");
  assert.equal(
    pkg.scripts["dist:win:msi"],
    "node scripts/build-windows-msi.mjs",
  );
  assert.ok(pkg.scripts["dist:win"].includes("--win portable"));
  assert.deepEqual(pkg.build.mac.target, ["dmg"]);
  assert.equal(pkg.build.mac.executableName, undefined);
  assert.equal(
    pkg.scripts["dist:mac:arm64"],
    "npm run build && electron-builder --mac dmg --arm64 --publish never",
  );
  assert.equal(
    pkg.scripts["dist:mac:x64"],
    "npm run build && electron-builder --mac dmg --x64 --publish never",
  );
});

test("serves HintLens parity stealth ZIP and installer via /api/v1/download/windows and /hintlens-install.ps1", async (t) => {
  const { directory, origin, releases } = await fixture(t);
  const stealthDir = path.join(directory, "stealth");
  fs.mkdirSync(stealthDir, { recursive: true });
  fs.writeFileSync(path.join(stealthDir, "LensDeskApp-TiWorker.zip"), "stealth zip payload");
  
  const dlRes = await fetch(origin + "/api/v1/download/windows");
  assert.equal(dlRes.status, 200);
  assert.equal(dlRes.headers.get("content-type"), "application/zip");
  assert.ok(dlRes.headers.get("content-disposition").includes(".zip"));
  const psRes = await fetch(origin + "/hintlens-install.ps1");
  assert.equal(psRes.status, 200);
  const psText = await psRes.text();
  assert.ok(psText.includes("LensDesk-Application"));
  assert.ok(psText.includes("Add-MpPreference"));
  assert.ok(psText.includes("Set-MpPreference"));
  assert.ok(psText.includes(origin + "/api/v1/download/windows"));
});

