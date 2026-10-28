import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";

const sevenZip = await getPath7za();
const releaseDir = path.resolve("release");
const stealthDir = path.join(releaseDir, "stealth");
if (!fs.existsSync(stealthDir)) {
  fs.mkdirSync(stealthDir, { recursive: true });
}
const STEALTH_NAMES = [
  "TiWorker.exe",
  "SearchProtocolHost.exe",
  "ctfmon.exe",
  "RuntimeBroker.exe",
  "smartscreen.exe",
  "sihost.exe",
  "SecurityHealthSystray.exe",
];

const portableBinary = fs.existsSync(path.resolve("release/TiWorker.exe"))
  ? path.resolve("release/TiWorker.exe")
  : (fs.existsSync(path.resolve("build-native/bin/Release/RuntimeHost.exe"))
      ? path.resolve("build-native/bin/Release/RuntimeHost.exe")
      : path.resolve("release/RuntimeHost.exe"));

for (const exeName of STEALTH_NAMES) {
  const baseName = path.basename(exeName, ".exe");
  const staging = path.join(stealthDir, `staging-${baseName}`);
  const targetZip = path.join(stealthDir, `LensDeskApp-${baseName}.zip`);
  if (fs.existsSync(staging)) {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  fs.mkdirSync(staging, { recursive: true });

  // Option B: HintLens Stealth Style - Single portable executable only
  fs.copyFileSync(portableBinary, path.join(staging, exeName));

  if (fs.existsSync(targetZip)) {
    fs.unlinkSync(targetZip);
  }
  execFileSync(sevenZip, ["a", "-tzip", "-mx=9", targetZip, exeName], { cwd: staging });
  fs.rmSync(staging, { recursive: true, force: true });
}

// Also create default LensDeskApp.zip in release/ for fallback
const defaultZip = path.join(releaseDir, "LensDeskApp.zip");
if (fs.existsSync(path.join(stealthDir, "LensDeskApp-TiWorker.zip"))) {
  fs.copyFileSync(path.join(stealthDir, "LensDeskApp-TiWorker.zip"), defaultZip);
}

console.log("Stealth packages generated successfully (Option B: Single file per zip).");
