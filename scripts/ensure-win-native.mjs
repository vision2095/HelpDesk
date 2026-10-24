import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";

const prebuiltDir = path.join("native", "prebuilt", "win32-x64");
const prebuilt = path.join(prebuiltDir, "win_diagnostic.node");

if (process.platform === "win32") {
  execSync("node-gyp rebuild", { stdio: "inherit" });
  mkdirSync(prebuiltDir, { recursive: true });
  copyFileSync(path.join("build", "Release", "win_diagnostic.node"), prebuilt);
  console.log("[ensure-win-native] built:", prebuilt);
} else {
  console.log("[ensure-win-native] non-win32 host, prebuilt present:", existsSync(prebuilt));
}
