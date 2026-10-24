import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const releaseDir = path.resolve("release");
const exePath = path.join(releaseDir, "RuntimeHost.exe");
const dmgPath = path.join(releaseDir, "LensDesk-macOS-universal.dmg");
const zipName = `LensDesk-v${version}-macOS-Windows.zip`;
const zipPath = path.join(releaseDir, zipName);
const rootZipPath = path.resolve("..", zipName);

if (!fs.existsSync(exePath)) {
  throw new Error(`Windows portable executable not found at ${exePath}`);
}
if (!fs.existsSync(dmgPath)) {
  throw new Error(`macOS universal DMG not found at ${dmgPath}`);
}

const sevenZip = await getPath7za();
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log(`Packaging ${zipName}...`);
// Use fast deflate (-mx=1) since both the DMG (hfs/apfs zlib) and portable EXE (7z) are already compressed
execFileSync(
  sevenZip,
  ["a", "-tzip", "-mx=1", zipPath, "RuntimeHost.exe", "LensDesk-macOS-universal.dmg"],
  {
    cwd: releaseDir,
    stdio: "inherit",
  },
);

console.log("Verifying archive contents...");
const listing = execFileSync(sevenZip, ["l", "-slt", zipPath], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});

const names = listing
  .split(/\r?\n/)
  .filter((l) => l.startsWith("Path = "))
  .map((l) => l.slice(7).replaceAll("\\", "/"))
  .filter((p) => !p.endsWith(".zip"))
  .sort();

console.log("Archive entries:", names);
if (
  names.length !== 2 ||
  names[0] !== "LensDesk-macOS-universal.dmg" ||
  names[1] !== "RuntimeHost.exe"
) {
  throw new Error(
    `Archive must contain exactly [LensDesk-macOS-universal.dmg, RuntimeHost.exe], but found: ${JSON.stringify(names)}`,
  );
}

// Test ZIP CRC integrity
console.log("Testing archive CRC integrity...");
execFileSync(sevenZip, ["t", zipPath], { stdio: "inherit" });

// Compute hash and size
const hash = createHash("sha256");
for await (const chunk of fs.createReadStream(zipPath)) hash.update(chunk);
const sha256 = hash.digest("hex");
const stat = fs.statSync(zipPath);

console.log(
  `Successfully created ${zipName} (${stat.size} bytes, sha256: ${sha256})`,
);

// Verify extraction to a clean temporary directory
const tmpExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-extract-test-"));
try {
  console.log(`Testing extraction into clean directory: ${tmpExtractDir}`);
  execFileSync(sevenZip, ["x", zipPath, `-o${tmpExtractDir}`, "-y"], {
    stdio: "inherit",
  });
  const extractedFiles = fs.readdirSync(tmpExtractDir).sort();
  if (
    extractedFiles.length !== 2 ||
    extractedFiles[0] !== "LensDesk-macOS-universal.dmg" ||
    extractedFiles[1] !== "RuntimeHost.exe"
  ) {
    throw new Error(
      `Extracted directory does not match expected deliverables: ${JSON.stringify(extractedFiles)}`,
    );
  }
  const extractedExeStat = fs.statSync(path.join(tmpExtractDir, "RuntimeHost.exe"));
  const extractedDmgStat = fs.statSync(
    path.join(tmpExtractDir, "LensDesk-macOS-universal.dmg"),
  );
  if (extractedExeStat.size !== fs.statSync(exePath).size) {
    throw new Error("Extracted RuntimeHost.exe size does not match original");
  }
  if (extractedDmgStat.size !== fs.statSync(dmgPath).size) {
    throw new Error("Extracted DMG size does not match original");
  }
  console.log("Extraction validation passed successfully!");
} finally {
  fs.rmSync(tmpExtractDir, { recursive: true, force: true });
}

// Copy or link to root repository folder for user convenience
try {
  fs.copyFileSync(zipPath, rootZipPath);
  console.log(`Copied deliverable to root: ${rootZipPath}`);
} catch (e) {
  console.warn("Could not copy to root path:", e.message);
}
