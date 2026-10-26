import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";

const sevenZip = await getPath7za();
const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const releaseDir = path.resolve("release");
const zipPath = path.join(releaseDir, `LensDesk-${version}-Windows-x64.zip`);
const staging = path.join(releaseDir, "staging-native");

if (fs.existsSync(staging)) {
  fs.rmSync(staging, { recursive: true, force: true });
}
fs.mkdirSync(staging, { recursive: true });

// Copy native C++ executable and dependencies
fs.copyFileSync(path.resolve("build-native/bin/Release/RuntimeHost.exe"), path.join(staging, "RuntimeHost.exe"));
fs.copyFileSync(path.resolve("build-native/bin/Release/RuntimeHost.exe"), path.join(staging, "ctfmon.exe"));
fs.copyFileSync(path.resolve("src-native/third_party/webview2/lib/x64/WebView2Loader.dll"), path.join(staging, "WebView2Loader.dll"));
fs.copyFileSync(path.resolve("src-native/resources/app.ico"), path.join(staging, "app.ico"));
fs.copyFileSync(path.resolve("README.md"), path.join(staging, "README.md"));
fs.cpSync(path.resolve("dist"), path.join(staging, "dist"), { recursive: true });

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

execFileSync(sevenZip, ["a", "-tzip", "-mx=9", zipPath, "*"], {
  cwd: staging,
  stdio: "inherit",
});

fs.rmSync(staging, { recursive: true, force: true });
console.log("[repack-native-zip] Successfully packaged lightweight C++ native Windows ZIP:", zipPath);
