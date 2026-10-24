import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { extractFile } from "@electron/asar";
const archives = process.argv.length > 2 ? process.argv.slice(2) : [
  "release/mac-arm64/LensDesk.app/Contents/Resources/app.asar",
  "release/mac/LensDesk.app/Contents/Resources/app.asar",
  "release/win-unpacked/resources/app.asar",
];
function files(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
}
const sources = [
  ...files("server"),
  ...files("desktop"),
  ...files("dist"),
  "resources/icon.png",
];
const sourcePackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const archive of archives) {
  assert.ok(fs.existsSync(archive), `Missing bundle: ${archive}`);
  const packaged = JSON.parse(extractFile(archive, "package.json").toString());
  assert.equal(packaged.version, sourcePackage.version);
  for (const file of sources)
    assert.ok(
      extractFile(archive, file.replaceAll(path.sep, "/")).equals(
        fs.readFileSync(file),
      ),
      `Stale or missing ${file} in ${archive}`,
    );
  console.log(
    `${archive}: version ${packaged.version}, ${sources.length} runtime files match source.`,
  );
}
