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
let exeTarget = "LensDesk-Setup.exe";
if (!fs.existsSync(path.join(releaseDir, exeTarget))) {
  exeTarget = "RuntimeHost.exe";
}
const exePath = path.join(releaseDir, exeTarget);
const zipName = `LensDesk-${version}-Windows-x64.zip`;
const zipPath = path.join(releaseDir, zipName);
const cleanZipPath = path.join(releaseDir, "LensDesk.zip");

if (!fs.existsSync(exePath)) {
  throw new Error(`Application executable not found at ${exePath}`);
}

// F4 option: keep the portable wrapper metadata aligned with RuntimeHost.
if (ResEdit && exeTarget === "RuntimeHost.exe") {
  const { NtExecutable, NtExecutableResource, Resource } = ResEdit;
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);
  const vi = Resource.VersionInfo.fromEntries(res.entries)[0];
  if (vi) {
    const language = vi.getAllLanguagesForStringValues()[0] || {
      lang: 1033,
      codepage: 1200,
    };
    vi.setStringValues(language, {
      CompanyName: "RuntimeHost",
      FileDescription: "RuntimeHost",
      InternalName: "RuntimeHost",
      LegalCopyright: "RuntimeHost",
      LegalTrademarks: "RuntimeHost",
      OriginalFilename: "",
      ProductName: "LensDesk",
    });
    vi.outputToResourceEntries(res.entries);
    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  }
}

const sevenZip = await getPath7za();
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Create ZIP containing ONLY the single application executable
execFileSync(sevenZip, ["a", "-tzip", "-mx=9", zipPath, exeTarget], {
  cwd: releaseDir,
  stdio: "inherit",
});
fs.copyFileSync(zipPath, cleanZipPath);

// Verify single-file contents
const listing = execFileSync(sevenZip, ["l", "-slt", zipPath], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
const names = listing
  .split(/\r?\n/)
  .filter((l) => l.startsWith("Path = "))
  .map((l) => l.slice(7).replaceAll("\\", "/"))
  .filter((p) => !p.endsWith(".zip"));

if (names.length !== 1 || names[0] !== exeTarget) {
  throw new Error(`Expected zip to contain only ${exeTarget}, found: ${JSON.stringify(names)}`);
}

// Compute hash and size
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

console.log(`Successfully packaged single-file Windows ZIP: ${zipName} (${stat.size} bytes, sha256: ${sha256})`);
