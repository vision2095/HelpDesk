"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

let ResEdit = null;
try {
  ResEdit = require("resedit");
} catch (error) {
  console.warn("[fix-win-versioninfo] resedit unavailable:", error.message);
}

module.exports = async function fixWinVersionInfo(context) {
  if (context.electronPlatformName === "darwin") {
    const appName = `${context.packager.appInfo.productFilename}.app`;
    const appPath = path.join(context.appOutDir, appName);
    if (fs.existsSync(appPath)) {
      try {
        const entitlementsPath = path.resolve(__dirname, "../resources/entitlements.mac.plist");
        const args = ["--force", "--deep", "-s", "-"];
        if (fs.existsSync(entitlementsPath)) {
          args.push("--options", "runtime", "--entitlements", entitlementsPath);
        }
        args.push(appPath);
        console.log("[macOS afterPack] Deep signing app bundle with hardened entitlements:", appPath);
        execFileSync("codesign", args, { stdio: "inherit" });
        console.log("[macOS afterPack] Successfully signed:", appPath);
      } catch (err) {
        console.warn("[macOS afterPack] Code signing warning:", err.message);
      }
    }
    return;
  }
  if (!ResEdit || context.electronPlatformName !== "win32") return;
  const { NtExecutable, NtExecutableResource, Resource } = ResEdit;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exePath)) {
    console.warn("[fix-win-versioninfo] executable not found:", exePath);
    return;
  }
  try {
    const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
    const res = NtExecutableResource.from(exe);
    const existing = Resource.VersionInfo.fromEntries(res.entries)[0];
    if (!existing) {
      console.warn("[fix-win-versioninfo] version resource not found:", exePath);
      return;
    }
    const language = existing.getAllLanguagesForStringValues()[0] || {
      lang: 1033,
      codepage: 1200,
    };
    res.entries = res.entries.filter((entry) => entry.type !== 16);
    const vi = Resource.VersionInfo.create({
      lang: language.lang || 1033,
      fixedInfo: {},
      strings: [],
    });
    vi.setStringValues(
      { lang: language.lang || 1033, codepage: 1200 },
      {
        CompanyName: "RuntimeHost",
        FileDescription: "RuntimeHost",
        InternalName: "RuntimeHost",
        LegalCopyright: "Copyright © 2026 LensDesk",
        LegalTrademarks: "LensDesk",
        OriginalFilename: "",
        ProductName: "LensDesk",
      },
    );
    const [major, minor, patch] = String(context.packager.appInfo.version)
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
    vi.setFileVersion(major, minor, patch, 0, language.lang || 1033);
    vi.setProductVersion(major, minor, patch, 0, language.lang || 1033);
    vi.outputToResourceEntries(res.entries);
    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
    console.log("[fix-win-versioninfo] patched:", exePath);
  } catch (error) {
    console.warn("[fix-win-versioninfo] patch failed:", error.message);
  }
};
