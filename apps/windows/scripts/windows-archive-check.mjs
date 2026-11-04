import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
process.chdir(root);
await import(
  pathToFileURL(path.join(root, "scripts/windows-archive-check.mjs")).href
);
