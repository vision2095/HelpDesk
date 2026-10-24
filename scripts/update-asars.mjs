import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import asar from "@electron/asar";

const archives = [
  "release/mac-arm64/LensDesk.app/Contents/Resources/app.asar",
  "release/mac/LensDesk.app/Contents/Resources/app.asar",
  "release/win-unpacked/resources/app.asar",
];

const copyDir = (src, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

async function updateArchive(archivePath) {
  if (!fs.existsSync(archivePath)) {
    console.log(`Skipping missing archive: ${archivePath}`);
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-asar-"));
  console.log(`Unpacking ${archivePath} to ${tmpDir}...`);
  asar.extractAll(archivePath, tmpDir);

  // Overwrite updated sources
  fs.copyFileSync("package.json", path.join(tmpDir, "package.json"));
  fs.mkdirSync(path.join(tmpDir, "resources"), { recursive: true });
  fs.copyFileSync("resources/icon.png", path.join(tmpDir, "resources/icon.png"));

  // Remove old dist and replace
  if (fs.existsSync(path.join(tmpDir, "dist"))) {
    fs.rmSync(path.join(tmpDir, "dist"), { recursive: true, force: true });
  }
  copyDir("dist", path.join(tmpDir, "dist"));
  copyDir("desktop", path.join(tmpDir, "desktop"));
  copyDir("server", path.join(tmpDir, "server"));

  console.log(`Repacking to ${archivePath}...`);
  await asar.createPackage(tmpDir, archivePath);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`Updated ${archivePath} successfully.`);
}

for (const arch of archives) {
  await updateArchive(arch);
}

import { execSync } from "node:child_process";

// Also update installed apps if present
const appBundles = [
  "release/mac-arm64/LensDesk.app",
  "release/mac/LensDesk.app",
  "/Applications/LensDesk.app",
  "/Users/vivek/Desktop/LensDesk.app",
];

const desktopAppAsar = "/Users/vivek/Desktop/LensDesk.app/Contents/Resources/app.asar";
if (fs.existsSync(desktopAppAsar)) {
  await updateArchive(desktopAppAsar);
}

const installedAppAsar = "/Applications/LensDesk.app/Contents/Resources/app.asar";
if (fs.existsSync(installedAppAsar)) {
  await updateArchive(installedAppAsar);
}

// Re-sign mac bundles if on darwin
if (process.platform === "darwin") {
  for (const appPath of appBundles) {
    if (fs.existsSync(appPath)) {
      try {
        console.log(`Re-signing ${appPath}...`);
        execSync(
          `codesign --force --deep --sign "Apple Development: ivivekverma@icloud.com (3N3A4VY4XB)" "${appPath}"`,
          { stdio: "inherit" },
        );
      } catch (err) {
        console.warn(`Could not sign ${appPath}:`, err.message);
      }
    }
  }
}
