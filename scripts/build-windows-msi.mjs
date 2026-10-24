import { execSync } from "node:child_process";

if (
  process.platform !== "win32" &&
  process.env.ELECTRON_BUILDER_ALLOW_WINE_BUILD !== "1"
) {
  console.error(
    [
      "Windows MSI builds must run on Windows.",
      "The installer is compiled with the WiX toolset and Windows Installer tooling;",
      "electron-builder's cross-build path requires a working Wine + WiX setup.",
      "",
      "Run `npm run dist:win:msi` on Windows, or use the Windows CI job.",
      "To force a cross-build with a working Wine toolset, set",
      "ELECTRON_BUILDER_ALLOW_WINE_BUILD=1.",
    ].join("\n"),
  );
  process.exit(1);
}

// execSync resolves the npm/npx .cmd shims on Windows without extra quoting.
execSync("npm run build", { stdio: "inherit" });
execSync("npx electron-builder --win msi --x64 --publish never", {
  stdio: "inherit",
});
execSync("node scripts/package-windows-msi.mjs", { stdio: "inherit" });
