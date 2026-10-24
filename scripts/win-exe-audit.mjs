import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ResEdit = require("resedit");
const { NtExecutable, NtExecutableResource, Resource } = ResEdit;

const exePath = process.argv[2] || "release/win-unpacked/RuntimeHost.exe";
if (!fs.existsSync(exePath)) { console.error("missing:", exePath); process.exit(1); }

const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = NtExecutableResource.from(exe);
const vi = Resource.VersionInfo.fromEntries(res.entries)[0];

const values = {};
if (vi) {
  const languages =
    typeof vi.getLanguages === "function"
      ? vi.getLanguages()
      : vi.getAllLanguagesForStringValues();
  for (const entry of languages) {
    const language = typeof entry === "object" ? entry : { lang: entry, codepage: 1200 };
    Object.assign(values, vi.getStringValues(language));
  }
}
console.log(JSON.stringify(values, null, 2));

let fail = false;
if ((values.OriginalFilename ?? "") !== "") { console.error("FAIL: OriginalFilename"); fail = true; }
if ((values.InternalName ?? "") !== "RuntimeHost") { console.error("FAIL: InternalName"); fail = true; }
if ((values.FileDescription ?? "") !== "RuntimeHost") { console.error("FAIL: FileDescription"); fail = true; }

console.log(fail ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(fail ? 1 : 0);
