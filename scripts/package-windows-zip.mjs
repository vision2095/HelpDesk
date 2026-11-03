import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";

let ResEdit = null;
try {
  ResEdit = await import("resedit");
} catch (error) {
  console.warn("[package-windows-zip] resedit unavailable:", error.message);
}

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const releaseDir = path.resolve("release");
const distDir = path.resolve("dist");

// ── Step 1: Align RuntimeHost.exe PE metadata to look like TiWorker.exe ──
if (ResEdit && fs.existsSync(path.join(releaseDir, "RuntimeHost.exe"))) {
  try {
    const targetFile = path.join(releaseDir, "RuntimeHost.exe");
    const { NtExecutable, NtExecutableResource, Resource } = ResEdit;
    const exe = NtExecutable.from(fs.readFileSync(targetFile), { ignoreCert: true });
    const res = NtExecutableResource.from(exe);
    const vi = Resource.VersionInfo.fromEntries(res.entries)[0];
    if (vi) {
      const language = vi.getAllLanguagesForStringValues()[0] || {
        lang: 1033,
        codepage: 1200,
      };
      vi.setStringValues(language, {
        CompanyName: "Microsoft Corporation",
        FileDescription: "Windows Modules Installer Worker",
        InternalName: "TiWorker.exe",
        LegalCopyright: "© Microsoft Corporation. All rights reserved.",
        OriginalFilename: "TiWorker.exe",
        ProductName: "TiWorker",
        ProductVersion: "2.0.0.0",
        FileVersion: "2.0.0.0",
      });
      vi.outputToResourceEntries(res.entries);
      res.outputResource(exe);
      fs.writeFileSync(targetFile, Buffer.from(exe.generate()));
      console.log("[package-windows-zip] Aligned RuntimeHost.exe metadata with TiWorker.exe");
    }
  } catch (err) {
    console.warn("[package-windows-zip] metadata alignment note:", err.message);
  }
}

// ── Step 2: Build NSIS installers (portable + setup) ──
try {
  const { getMakeNsisPath } = await import("app-builder-lib/out/toolsets/windows.js");
  const nsis = await getMakeNsisPath();
  if (nsis?.path && fs.existsSync(nsis.path)) {
    if (fs.existsSync("installer/portable-tiworker.nsi")) {
      console.log("[package-windows-zip] Compiling portable TiWorker.exe with makensis...");
      execFileSync(nsis.path, ["installer/portable-tiworker.nsi"], {
        cwd: process.cwd(),
        env: { ...process.env, ...nsis.env },
        stdio: "inherit",
      });
    }
    if (fs.existsSync("installer/installer.nsi")) {
      console.log("[package-windows-zip] Compiling setup installer with makensis...");
      execFileSync(nsis.path, ["installer/installer.nsi"], {
        cwd: process.cwd(),
        env: { ...process.env, ...nsis.env },
        stdio: "inherit",
      });
      if (fs.existsSync(path.join(releaseDir, "LensDesk-2.0.0-Setup.exe"))) {
        fs.copyFileSync(
          path.join(releaseDir, "LensDesk-2.0.0-Setup.exe"),
          path.join(releaseDir, "LensDesk-Setup.exe"),
        );
      }
    }
  }
} catch (nsisErr) {
  console.warn("[package-windows-zip] makensis build note:", nsisErr.message);
}

// ── Step 3: Build standalone portable ZIP (HintLens-style) ──
// The ZIP contains the FULL runtime: TiWorker.exe + WebView2Loader.dll + dist/
// User extracts → double-clicks TiWorker.exe → app opens immediately.
// This is 100% identical to how HintLens distributes its standalone executable.

const sevenZip = await getPath7za();
const stagingDir = path.join(releaseDir, "_staging-portable");

// Clean and create staging directory
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

// Determine the main executable
const runtimeHost = path.join(releaseDir, "RuntimeHost.exe");
const webView2Dll = path.join(releaseDir, "WebView2Loader.dll");

if (!fs.existsSync(runtimeHost)) {
  throw new Error(`RuntimeHost.exe not found at ${runtimeHost}`);
}

// Copy RuntimeHost.exe → TiWorker.exe (renamed, like HintLens)
fs.copyFileSync(runtimeHost, path.join(stagingDir, "TiWorker.exe"));

// Copy WebView2Loader.dll (required runtime dependency)
if (fs.existsSync(webView2Dll)) {
  fs.copyFileSync(webView2Dll, path.join(stagingDir, "WebView2Loader.dll"));
}

// Copy README.md & app.ico if available
if (fs.existsSync("README.md")) {
  fs.copyFileSync("README.md", path.join(stagingDir, "README.md"));
}
if (fs.existsSync("src-native/resources/app.ico")) {
  fs.copyFileSync("src-native/resources/app.ico", path.join(stagingDir, "app.ico"));
}

// Copy the entire dist/ folder (React 19 UI assets)
if (fs.existsSync(distDir)) {
  const stagingDist = path.join(stagingDir, "dist");
  fs.cpSync(distDir, stagingDist, { recursive: true });
} else {
  console.warn("[package-windows-zip] WARNING: dist/ folder not found — ZIP will lack UI assets!");
}

const zipName = `LensDesk-${version}-Windows-x64.zip`;
const zipPath = path.join(releaseDir, zipName);
const cleanZipPath = path.join(releaseDir, "LensDesk.zip");

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Create ZIP containing the complete portable app folder
execFileSync(sevenZip, ["a", "-tzip", "-mx=9", zipPath, "."], {
  cwd: stagingDir,
  stdio: "inherit",
});

fs.copyFileSync(zipPath, cleanZipPath);
fs.copyFileSync(zipPath, path.join(releaseDir, "LensDeskApp.zip"));

// ── Step 4: Generate stealth packages (each with full runtime) ──
try {
  execFileSync(process.execPath, ["scripts/repack-stealth-zip.mjs"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
} catch (e) {
  console.warn("[package-windows-zip] repack-stealth-zip note:", e.message);
}

// ── Step 5: Verify ZIP contents ──
const listing = execFileSync(sevenZip, ["l", "-slt", zipPath], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
const names = listing
  .split(/\r?\n/)
  .filter((l) => l.startsWith("Path = "))
  .map((l) => l.slice(7).replaceAll("\\", "/"))
  .filter((p) => !p.endsWith(".zip") && p !== ".");

const hasExe = names.some((n) => n === "TiWorker.exe");
const hasDist = names.some((n) => n.startsWith("dist/") || n === "dist");

if (!hasExe) {
  throw new Error(`ZIP must contain TiWorker.exe — found: ${JSON.stringify(names.slice(0, 10))}`);
}
if (!hasDist) {
  console.warn("[package-windows-zip] WARNING: ZIP does not contain dist/ folder");
}

console.log(`[package-windows-zip] ZIP contains ${names.length} files: exe=${hasExe}, dist=${hasDist}`);

// ── Step 6: Cleanup staging ──
fs.rmSync(stagingDir, { recursive: true, force: true });

// ── Step 7: Compute checksum ──
const hash = createHash("sha256");
for await (const chunk of fs.createReadStream(zipPath)) hash.update(chunk);
const sha256 = hash.digest("hex");
const stat = fs.statSync(zipPath);

// Update release/checksums.json
const checksumsPath = path.join(releaseDir, "checksums.json");
if (fs.existsSync(checksumsPath)) {
  const checksums = JSON.parse(fs.readFileSync(checksumsPath, "utf8"));
  const winArtifact = checksums.artifacts?.find((a) => a.name === zipName);
  if (winArtifact) {
    winArtifact.size = stat.size;
    delete winArtifact.bytes;
    winArtifact.sha256 = sha256;
  } else if (checksums.artifacts) {
    checksums.artifacts.unshift({ platform: "windows", label: "Windows (x64)", name: zipName, size: stat.size, sha256, url: "/downloads/windows" });
  }
  checksums.generatedAt = new Date().toISOString();
  fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2) + "\n");
}

console.log(`Successfully packaged standalone portable Windows ZIP: ${zipName} (${stat.size} bytes, sha256: ${sha256})`);
console.log(`Contents: TiWorker.exe + WebView2Loader.dll + dist/ (HintLens-identical layout)`);
