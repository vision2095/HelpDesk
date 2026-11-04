import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The workspace copy must use the same genuine packaging implementation as
// the repository root. It must never create TiWorker.exe or rewrite PE
// metadata to impersonate a Windows component.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
process.chdir(root);
await import(pathToFileURL(path.join(root, "scripts/package-windows-zip.mjs")).href);
