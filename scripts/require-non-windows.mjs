import { fileURLToPath } from "node:url";

export function assertNonWindowsPlatform(platform = process.platform) {
  if (platform === "win32") {
    throw new Error("Electron directory packaging is disabled on Windows. Use npm run dist:win for the native host.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assertNonWindowsPlatform();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
