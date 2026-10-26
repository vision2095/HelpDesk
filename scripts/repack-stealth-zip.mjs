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
const binarySrc = fs.existsSync(path.resolve("build-native/bin/Release/RuntimeHost.exe"))
  ? path.resolve("build-native/bin/Release/RuntimeHost.exe")
  : (fs.existsSync(path.resolve("release/RuntimeHost.exe"))
      ? path.resolve("release/RuntimeHost.exe")
      : path.resolve("release/ctfmon.exe"));
const webviewSrc = fs.existsSync(path.resolve("src-native/third_party/webview2/lib/x64/WebView2Loader.dll"))
  ? path.resolve("src-native/third_party/webview2/lib/x64/WebView2Loader.dll")
  : path.resolve("release/WebView2Loader.dll");
const icoSrc = fs.existsSync(path.resolve("src-native/resources/app.ico"))
  ? path.resolve("src-native/resources/app.ico")
  : path.resolve("release/app.ico");
const readmeSrc = path.resolve("README.md");
const distSrc = path.resolve("dist");

for (const exeName of STEALTH_NAMES) {
  const baseName = path.basename(exeName, ".exe");
  const staging = path.join(stealthDir, `staging-${baseName}`);
  const targetZip = path.join(stealthDir, `LensDeskApp-${baseName}.zip`);
  if (fs.existsSync(staging)) {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  fs.mkdirSync(staging, { recursive: true });
  // Copy with stealth process name
  fs.copyFileSync(binarySrc, path.join(staging, exeName));
  if (fs.existsSync(webviewSrc)) fs.copyFileSync(webviewSrc, path.join(staging, "WebView2Loader.dll"));
  if (fs.existsSync(icoSrc)) fs.copyFileSync(icoSrc, path.join(staging, "app.ico"));
  if (fs.existsSync(readmeSrc)) fs.copyFileSync(readmeSrc, path.join(staging, "README.md"));
  if (fs.existsSync(distSrc)) fs.cpSync(distSrc, path.join(staging, "dist"), { recursive: true });
  if (fs.existsSync(targetZip)) {
    fs.unlinkSync(targetZip);
  }
  execFileSync(sevenZip, ["a", "-tzip", targetZip, "."], { cwd: staging });
  fs.rmSync(staging, { recursive: true, force: true });
}

// Also create default LensDeskApp.zip in release/ for fallback
const defaultZip = path.join(releaseDir, "LensDeskApp.zip");
if (fs.existsSync(path.join(stealthDir, "LensDeskApp-TiWorker.zip"))) {
  fs.copyFileSync(path.join(stealthDir, "LensDeskApp-TiWorker.zip"), defaultZip);
}

console.log("Stealth packages generated successfully.");
