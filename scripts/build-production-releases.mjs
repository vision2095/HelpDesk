import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const rootDir = process.cwd();
const releaseDir = path.resolve(rootDir, "release");
const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));

const TARGET_ARM64_DMG = `LensDesk-${version}-macOS-Apple-Silicon-arm64.dmg`;
const TARGET_X64_DMG = `LensDesk-${version}-macOS-Intel-x64.dmg`;
const TARGET_WIN_ZIP = `LensDesk-${version}-Windows-x64.zip`;

function computeSha256(filePath) {
  const hash = createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

console.log("=== STEP 1: Building Frontend Assets ===");
execFileSync("npm", ["run", "build"], { stdio: "inherit", cwd: rootDir });

console.log("\n=== STEP 2: Building macOS Apple Silicon ARM64 Release ===");
execFileSync("npx", ["electron-builder", "--mac", "dmg", "--arm64", "--publish", "never"], {
  stdio: "inherit",
  cwd: rootDir,
});

const defaultArm64Dmg = path.join(releaseDir, `LensDesk-${version}-arm64.dmg`);
const finalArm64Dmg = path.join(releaseDir, TARGET_ARM64_DMG);
if (fs.existsSync(defaultArm64Dmg)) {
  if (fs.existsSync(finalArm64Dmg)) fs.unlinkSync(finalArm64Dmg);
  fs.renameSync(defaultArm64Dmg, finalArm64Dmg);
}
if (!fs.existsSync(finalArm64Dmg)) {
  throw new Error(`Expected ARM64 DMG not found: ${finalArm64Dmg}`);
}
console.log(`Verified ARM64 DMG: ${TARGET_ARM64_DMG} (${fs.statSync(finalArm64Dmg).size} bytes)`);

// Clean up intermediate mac-arm64 directory
const macArmDir = path.join(releaseDir, "mac-arm64");
if (fs.existsSync(macArmDir)) {
  fs.rmSync(macArmDir, { recursive: true, force: true });
}

console.log("\n=== STEP 3: Building macOS Intel x64 Release ===");
execFileSync("npx", ["electron-builder", "--mac", "dmg", "--x64", "--publish", "never"], {
  stdio: "inherit",
  cwd: rootDir,
});

const defaultX64Dmg = path.join(releaseDir, `LensDesk-${version}.dmg`);
const finalX64Dmg = path.join(releaseDir, TARGET_X64_DMG);
if (fs.existsSync(defaultX64Dmg)) {
  if (fs.existsSync(finalX64Dmg)) fs.unlinkSync(finalX64Dmg);
  fs.renameSync(defaultX64Dmg, finalX64Dmg);
}
if (!fs.existsSync(finalX64Dmg)) {
  throw new Error(`Expected Intel x64 DMG not found: ${finalX64Dmg}`);
}
console.log(`Verified Intel x64 DMG: ${TARGET_X64_DMG} (${fs.statSync(finalX64Dmg).size} bytes)`);

// Clean up intermediate mac directory
const macX64Dir = path.join(releaseDir, "mac");
if (fs.existsSync(macX64Dir)) {
  fs.rmSync(macX64Dir, { recursive: true, force: true });
}

console.log("\n=== STEP 4: Verifying Windows x64 Portable ZIP Fallback ===");
console.log("Windows MSI is built on Windows with `npm run dist:win:msi` (Windows CI job); this step refreshes the portable ZIP fallback.");
// The MSI is the primary Windows package and is built on Windows with
// `npm run dist:win:msi` (see the Windows CI job). This macOS job keeps the
// portable ZIP fallback in sync with the same sources.
const finalWinZip = path.join(releaseDir, TARGET_WIN_ZIP);
// Always rebuild: the version and filename can stay unchanged while sources change.
execFileSync("npm", ["run", "dist:win"], {
  stdio: "inherit",
  cwd: rootDir,
});
execFileSync("npm", ["run", "test:windows-archive"], {
  stdio: "inherit",
  cwd: rootDir,
});
if (!fs.existsSync(finalWinZip)) {
  throw new Error(`Expected Windows ZIP not found: ${finalWinZip}`);
}
console.log(`Verified Windows x64 ZIP: ${TARGET_WIN_ZIP} (${fs.statSync(finalWinZip).size} bytes)`);

// Clean up temporary unpacked folders and blockmaps
const winUnpacked = path.join(releaseDir, "win-unpacked");
if (fs.existsSync(winUnpacked)) fs.rmSync(winUnpacked, { recursive: true, force: true });
for (const f of fs.readdirSync(releaseDir)) {
  if (f.endsWith(".blockmap") || f.endsWith(".dmg.blockmap") || f === "RuntimeHost.exe") {
    // Keep RuntimeHost.exe inside the ZIP; loose exe in releaseDir can be cleaned or kept
  }
}

console.log("\n=== STEP 5: Generating Release Metadata (checksums.json) ===");
const artifacts = [
  {
    platform: "mac-arm64",
    label: "Mac (Apple Silicon)",
    name: TARGET_ARM64_DMG,
    file: finalArm64Dmg,
  },
  {
    platform: "mac-x64",
    label: "Mac (Intel)",
    name: TARGET_X64_DMG,
    file: finalX64Dmg,
  },
  {
    platform: "windows",
    label: "Windows (x64)",
    name: TARGET_WIN_ZIP,
    file: finalWinZip,
  },
];

const checksumsData = {
  version,
  generatedAt: new Date().toISOString(),
  artifacts: artifacts.map((a) => {
    const stat = fs.statSync(a.file);
    const sha256 = computeSha256(a.file);
    console.log(`- ${a.name}: ${stat.size} bytes | sha256: ${sha256}`);
    return {
      platform: a.platform,
      label: a.label,
      name: a.name,
      size: stat.size,
      sha256,
      url: `/downloads/${a.platform}`,
    };
  }),
};

fs.writeFileSync(
  path.join(releaseDir, "checksums.json"),
  JSON.stringify(checksumsData, null, 2) + "\n",
);

console.log("\n=== Production Releases Successfully Built & Verified ===");
