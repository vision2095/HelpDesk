import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { NtExecutable, NtExecutableResource, Resource } from "resedit";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));

function readVersionStrings(buffer) {
  const executable = NtExecutable.from(buffer);
  const resources = NtExecutableResource.from(executable);
  const entries = Resource.VersionInfo.fromEntries(resources.entries);
  if (entries.length === 0) return {};
  const info = entries[0];
  const languages = info.getAllLanguagesForStringValues();
  return languages.length === 0 ? {} : info.getStringValues(languages[0]);
}

const archive = path.resolve(
  process.argv[2] || `release/LensDesk-${version}-Windows-x64.zip`,
);
assert.ok(fs.existsSync(archive), `Archive not found at ${archive}`);

const isWindows = process.platform === "win32";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
  });
}

function listArchive() {
  if (isWindows) {
    return run("tar", ["-tf", archive]);
  }
  return run("unzip", ["-Z1", archive]);
}

function readArchiveEntry(name) {
  if (isWindows) {
    return run("tar", ["-xOf", archive, name], {
      encoding: "buffer",
      maxBuffer: 350 * 1024 * 1024,
    });
  }
  return run("unzip", ["-p", archive, name], {
    encoding: "buffer",
    maxBuffer: 350 * 1024 * 1024,
  });
}

if (!isWindows) {
  run("unzip", ["-t", archive]);
}

const names = listArchive()
  .split(/\r?\n/)
  .map((name) => name.trim().replaceAll("\\", "/"))
  .filter((name) => name && name !== "." && !name.endsWith(".zip"));

const prohibitedNames = [
  "TiWorker.exe",
  "ctfmon.exe",
  "SearchProtocolHost.exe",
  "RuntimeBroker.exe",
  "smartscreen.exe",
  "sihost.exe",
  "SecurityHealthSystray.exe",
];
for (const name of prohibitedNames) {
  assert.ok(
    !names.includes(name),
    `Native ZIP must not contain process-impersonation name: ${name}`,
  );
}

const exeFile = names.find((name) => name.endsWith(".exe"));
assert.ok(exeFile, "Native ZIP is missing the application executable");
assert.equal(
  names.length,
  1,
  `Native ZIP must contain strictly and exclusively 1 file (the application executable), found ${names.length}: ${names.join(", ")}`,
);

for (const forbidden of [
  "resources/app.asar",
  "app-64.7z",
  "icudtl.dat",
  "resources.pak",
  "LICENSE.electron.txt",
  "LICENSES.chromium.html",
]) {
  assert.ok(
    !names.includes(forbidden),
    `Native ZIP must not contain Electron runtime file: ${forbidden}`,
  );
}

assert.equal(names.length, 1, `Native ZIP must contain strictly 1 file (the application), found ${names.length}: ${names.join(", ")}`);
assert.equal(names[0], exeFile, `The single file in the ZIP must be the executable: ${exeFile}`);

const executable = readArchiveEntry(exeFile);
assert.equal(executable.toString("ascii", 0, 2), "MZ", "Native host must be a valid PE");
const peOffset = executable.readUInt32LE(0x3c);
assert.equal(
  executable.toString("ascii", peOffset, peOffset + 4),
  "PE\0\0",
  "Native host must have a PE signature",
);
assert.equal(executable.readUInt16LE(peOffset + 4), 0x8664, "Native host must be x64");

const versionStrings = readVersionStrings(executable);
assert.equal(
  versionStrings.FileDescription || "",
  "",
  `Unexpected native FileDescription: ${versionStrings.FileDescription}`,
);
assert.equal(versionStrings.ProductName, "LensDesk 2.0", "Unexpected native ProductName");
assert.equal(
  versionStrings.OriginalFilename,
  "RuntimeHost.exe",
  "Unexpected native OriginalFilename",
);
assert.equal(
  versionStrings.LegalCopyright,
  "Copyright (C) 2026 LensDesk. All rights reserved.",
  "Unexpected native LegalCopyright",
);
assert.equal(versionStrings.FileVersion, "2.0.0.0", "Unexpected native FileVersion");
assert.equal(versionStrings.ProductVersion, "2.0.0.0", "Unexpected native ProductVersion");

const builtExe = [
  "release/RuntimeHost.exe",
  "build-native/bin/Release/RuntimeHost.exe",
  "build-native/Release/RuntimeHost.exe",
].find((file) => fs.existsSync(file));
assert.ok(builtExe, "Built RuntimeHost.exe was not found; run the native build first");
assert.deepEqual(
  executable,
  fs.readFileSync(builtExe),
  "Native ZIP RuntimeHost.exe is stale; rebuild and repackage the release",
);

if (names.includes("WebView2Loader.dll")) {
  const loader = readArchiveEntry("WebView2Loader.dll");
  assert.deepEqual(
    loader,
    fs.readFileSync("src-native/third_party/webview2/lib/x64/WebView2Loader.dll"),
    "Native ZIP WebView2Loader.dll does not match the bundled SDK",
  );
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const distFiles = walk("dist").map((file) => file.split(path.sep).join("/"));
const packagedDist = names.filter(
  (name) => name.startsWith("dist/") && path.extname(name) !== "",
);
if (packagedDist.length > 0) {
  for (const relative of distFiles) {
    const packaged = readArchiveEntry(relative);
    const isText = /\.(svg|html|css|js|json|webmanifest|txt)$/i.test(relative);
    if (isText) {
      assert.equal(
        packaged.toString("utf8").replaceAll("\r", ""),
        fs.readFileSync(relative, "utf8").replaceAll("\r", ""),
        `Native ZIP contains a stale frontend asset: ${relative}`,
      );
    } else {
      assert.deepEqual(
        packaged,
        fs.readFileSync(relative),
        `Native ZIP contains a stale frontend asset: ${relative}`,
      );
    }
  }
  assert.deepEqual(
    packagedDist.sort(),
    distFiles.sort(),
    "Native ZIP frontend asset list does not match dist/",
  );
}

for (const [file, source] of [
  ["README.md", "README.md"],
  ["app.ico", "src-native/resources/app.ico"],
]) {
  if (!fs.existsSync(source) || !names.includes(file)) continue;
  const packaged = readArchiveEntry(file);
  if (file.endsWith(".md")) {
    assert.equal(
      packaged.toString("utf8").replaceAll("\r", ""),
      fs.readFileSync(source, "utf8").replaceAll("\r", ""),
      `Native ZIP contains a stale ${file}`,
    );
  } else {
    assert.deepEqual(packaged, fs.readFileSync(source), `Native ZIP contains a stale ${file}`);
  }
}

console.log(
  `Native Windows ZIP passed CRC, x64 PE/version metadata, genuine LensDesk identity, and single-file application executable packaging. No Electron or process-impersonation names are present. Windows code was not executed.`,
);
