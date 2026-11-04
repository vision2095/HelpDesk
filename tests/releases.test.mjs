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
const setupName = `LensDesk-${version}-Setup.exe`;
const zipName = `LensDesk-${version}-Windows-x64.zip`;
const legacyInstallerName = `LensDesk-${version}-Windows-x64.exe`;
const legacyMsiName = `RuntimeHost-${version}-x64.msi`;
const prohibitedNames = [
  "TiWorker.exe",
  "ctfmon.exe",
  "SearchProtocolHost.exe",
  "RuntimeBroker.exe",
  "smartscreen.exe",
  "sihost.exe",
  "SecurityHealthSystray.exe",
];

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
  releases = createReleases(directory, origin, { allowRemoteFallback: false });
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    try {
      fs.rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch {}
  });
  return { directory, releases, origin };
}

test("Windows prefers the native Setup installer with exact bytes and SHA-256", async (t) => {
  const { directory, releases } = await fixture(t);
  const setupBytes = Buffer.from("native LensDesk setup");
  fs.writeFileSync(path.join(directory, setupName), setupBytes);
  fs.writeFileSync(path.join(directory, zipName), "portable ZIP");
  fs.writeFileSync(
    path.join(directory, legacyInstallerName),
    "stale Electron-style installer",
  );
  fs.writeFileSync(path.join(directory, legacyMsiName), "stale MSI");

  const manifest = await releases.manifest();
  assert.equal(manifest.windows.name, setupName);
  assert.equal(
    manifest.windows.sha256,
    createHash("sha256").update(setupBytes).digest("hex"),
  );
  assert.equal(manifest.windows.size, setupBytes.length);
  assert.equal(JSON.stringify(manifest).includes(directory), false);

  const response = await fetch(manifest.windows.url);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/vnd.microsoft.portable-executable",
  );
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="${setupName}"`,
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), setupBytes);
});

test("generated Windows installer verifies the Setup hash, stays per-user, and never adds antivirus exclusions", async (t) => {
  const { directory, origin, releases } = await fixture(t);
  fs.writeFileSync(path.join(directory, setupName), "native LensDesk setup");
  const manifest = await releases.manifest();
  const response = await fetch(origin + "/install.ps1");
  const script = await response.text();
  assert.equal(response.status, 200);
  assert.ok(script.includes(manifest.windows.url));
  assert.ok(script.includes(manifest.windows.sha256));
  assert.ok(script.includes(setupName));
  assert.ok(script.indexOf("Get-FileHash") < script.indexOf("Start-Process -FilePath $download"));
  assert.ok(script.includes("Start-Process -FilePath $download"));
  assert.ok(script.includes("RuntimeHost.exe"));
  assert.ok(script.includes("$env:LOCALAPPDATA"));
  assert.equal(script.includes("msiexec.exe"), false);
  assert.equal(script.includes("Expand-Archive"), false);
  for (const forbidden of [
    "Add-MpPreference",
    "Set-MpPreference",
    "-Verb runAs",
    "RequestExecutionLevel admin",
    "LensDesk-Application",
    ...prohibitedNames,
  ]) {
    assert.equal(
      script.includes(forbidden),
      false,
      `generated installer must not contain ${forbidden}`,
    );
  }
});

test("a missing native Setup falls back to the portable RuntimeHost ZIP", async (t) => {
  const { directory, releases, origin } = await fixture(t);
  fs.writeFileSync(path.join(directory, zipName), "portable ZIP");
  const manifest = await releases.manifest();
  assert.equal(manifest.windows.name, zipName);
  const response = await fetch(manifest.windows.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  const script = await (await fetch(origin + "/install.ps1")).text();
  assert.ok(script.includes("Expand-Archive"));
  assert.ok(script.includes("RuntimeHost.exe"));
});

test("missing Windows artifacts never fall back to stale EXE, MSI, or stealth names", async (t) => {
  const { directory, releases, origin } = await fixture(t);
  fs.writeFileSync(path.join(directory, legacyInstallerName), "stale installer");
  fs.writeFileSync(path.join(directory, legacyMsiName), "stale MSI");
  fs.writeFileSync(path.join(directory, "LensDesk.zip"), "stale alias ZIP");
  fs.writeFileSync(path.join(directory, "LensDesk-Setup.exe"), "stale alias setup");
  fs.mkdirSync(path.join(directory, "stealth"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "stealth", "LensDeskApp-TiWorker.zip"),
    "stealth payload",
  );
  assert.equal((await releases.manifest()).windows, undefined);
  assert.equal((await fetch(origin + "/downloads/windows")).status, 404);
  assert.equal((await fetch(origin + "/api/v1/download/windows")).status, 404);
  assert.equal((await fetch(origin + "/install.ps1")).status, 503);
  assert.equal(await releases.serve({}, null, new URL(origin + "/")), false);
});

test("release hashes refresh when the native installer is replaced", async (t) => {
  const { directory, releases } = await fixture(t);
  const file = path.join(directory, setupName);
  fs.writeFileSync(file, "first setup");
  const before = await releases.manifest();
  fs.writeFileSync(file, "second setup");
  const modified = new Date(Date.now() + 2000);
  fs.utimesSync(file, modified, modified);
  const after = await releases.manifest();
  assert.notEqual(before.windows.sha256, after.windows.sha256);
  assert.equal(
    after.windows.sha256,
    createHash("sha256").update("second setup").digest("hex"),
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

test("Windows uses native packaging while macOS DMG targets and scripts stay unchanged", () => {
  const pkg = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(pkg.productName, "LensDesk");
  assert.equal(pkg.build.productName, "LensDesk");
  assert.equal(pkg.build.appId, "com.runtimehost.app");
  assert.equal(pkg.build.afterPack, "./scripts/fix-win-versioninfo.cjs");
  assert.equal(pkg.build.win, undefined);
  assert.equal(pkg.build.msi, undefined);
  assert.equal(pkg.build.nsis, undefined);
  assert.equal(pkg.build.portable, undefined);
  assert.deepEqual(pkg.build.asarUnpack, ["**/*.node"]);
  assert.equal(pkg.build.npmRebuild, false);
  assert.equal(
    pkg.scripts["dist:win"],
    "npm run build && node scripts/package-windows-zip.mjs",
  );
  assert.equal(
    pkg.scripts["dist:win:installer"],
    "npm run build && node scripts/package-windows-zip.mjs",
  );
  assert.equal(
    pkg.scripts["test:windows-archive"],
    "node scripts/windows-archive-check.mjs",
  );
  assert.equal(
    pkg.scripts["test:win-exe"],
    "node scripts/verify-native-binary.mjs release/RuntimeHost.exe",
  );
  for (const script of [
    "dist:win",
    "dist:win:installer",
  ]) {
    assert.equal(pkg.scripts[script].includes("electron-builder"), false);
    assert.equal(pkg.scripts[script].includes("--win"), false);
  }
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
  assert.equal(pkg.build.mac.extendInfo.LSUIElement, false);
  assert.equal(pkg.build.mac.extendInfo.NSHighResolutionCapable, true);
});

test("clean Windows aliases serve the genuine installer and prohibited stealth routes are gone", async (t) => {
  const { directory, origin, releases } = await fixture(t);
  fs.writeFileSync(path.join(directory, setupName), "native LensDesk setup");

  for (const route of [
    "/downloads/windows",
    "/api/v1/download/windows",
    "/download/windows",
    `/releases/${setupName}`,
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="${setupName}"`,
      route,
    );
    assert.equal(
      response.headers.get("content-disposition").includes("stealth"),
      false,
    );
    await response.arrayBuffer();
  }

  const psResponse = await fetch(origin + "/lensdesk-install.ps1");
  assert.equal(psResponse.status, 200);
  const psText = await psResponse.text();
  assert.equal(psText.includes("Add-MpPreference"), false);
  assert.equal(psText.includes("Set-MpPreference"), false);
  assert.equal(psText.includes("-Verb runAs"), false);
  assert.equal(psText.includes("LensDesk-Application"), false);
  for (const name of prohibitedNames) {
    assert.equal(psText.includes(name), false);
  }

  for (const route of [
    "/install-stealth.ps1",
    "/hintlens-install.ps1",
    "/api/v1/stealth/targets",
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 404, route);
  }

  const manifest = await releases.manifest();
  assert.equal(manifest.windows.name, setupName);
});
