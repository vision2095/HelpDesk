import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractFile } from "@electron/asar";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";
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

const sevenZip = await getPath7za();
const run = (args) =>
  execFileSync(sevenZip, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });

// 1. Test ZIP archive integrity
run(["t", archive]);

const names = run(["l", "-slt", archive])
  .split(/\r?\n/)
  .filter((l) => l.startsWith("Path = "))
  .map((l) => l.slice(7).replaceAll("\\", "/"))
  .filter((p) => !p.endsWith(".zip"));

// The native Win32/WebView2 build has a multi-file layout. Keep the original
// Electron single-file assertions below for legacy archives, and validate the
// native layout explicitly when it is detected.
if (names.includes("WebView2Loader.dll") && names.includes("dist/index.html")) {
  const required = [
    "RuntimeHost.exe",
    "WebView2Loader.dll",
    "app.ico",
    "README.md",
    "dist/index.html",
  ];
  for (const file of required) {
    assert.ok(names.includes(file), `Native ZIP is missing required file: ${file}`);
  }
  assert.ok(
    names.some((name) => /^dist\/assets\/.+\.js$/.test(name)),
    "Native ZIP is missing a compiled JavaScript asset",
  );
  assert.ok(
    names.some((name) => /^dist\/assets\/.+\.css$/.test(name)),
    "Native ZIP is missing a compiled CSS asset",
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
  const allowed = [
    ...required,
    "QUICKSTART.txt",
    "ctfmon.exe",
  ];
  assert.ok(
    names.every(
      (name) => allowed.includes(name) || name === "dist" || name.startsWith("dist/"),
    ),
    `Native ZIP contains unexpected files: ${JSON.stringify(names)}`,
  );

  const executable = execFileSync(sevenZip, ["x", "-so", archive, "RuntimeHost.exe"], {
    maxBuffer: 350 * 1024 * 1024,
  });
  assert.equal(executable.toString("ascii", 0, 2), "MZ", "Native host must be a valid PE");
  const peOffset = executable.readUInt32LE(0x3c);
  assert.equal(executable.toString("ascii", peOffset, peOffset + 4), "PE\0\0", "Native host must have a PE signature");
  assert.equal(executable.readUInt16LE(peOffset + 4), 0x8664, "Native host must be x64");

  const versionStrings = readVersionStrings(executable);
  assert.equal(
    versionStrings.FileDescription,
    "LensDesk 2.0 Native Windows Host",
    `Unexpected native FileDescription: ${versionStrings.FileDescription}`,
  );
  assert.equal(versionStrings.ProductName, "LensDesk 2.0", "Unexpected native ProductName");
  assert.equal(versionStrings.OriginalFilename, "RuntimeHost.exe", "Unexpected native OriginalFilename");
  assert.equal(
    versionStrings.LegalCopyright,
    "Copyright (C) 2026 LensDesk. All rights reserved.",
    "Unexpected native LegalCopyright",
  );
  assert.equal(versionStrings.FileVersion, "2.0.0.0", "Unexpected native FileVersion");
  assert.equal(versionStrings.ProductVersion, "2.0.0.0", "Unexpected native ProductVersion");

  const builtExe = [
    "build-native/bin/Release/RuntimeHost.exe",
    "build-native/Release/RuntimeHost.exe",
  ].find((file) => fs.existsSync(file));
  assert.ok(builtExe, "Built RuntimeHost.exe was not found; run the native build first");
  assert.deepEqual(
    executable,
    fs.readFileSync(builtExe),
    "Native ZIP RuntimeHost.exe is stale; rebuild and repackage the release",
  );

  const loader = execFileSync(sevenZip, ["x", "-so", archive, "WebView2Loader.dll"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.deepEqual(
    loader,
    fs.readFileSync("src-native/third_party/webview2/lib/x64/WebView2Loader.dll"),
    "Native ZIP WebView2Loader.dll does not match the bundled SDK",
  );

  function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(file) : [file];
    });
  }
  const distFiles = walk("dist").map((file) => file.split(path.sep).join("/"));
  for (const relative of distFiles) {
    const packaged = execFileSync(sevenZip, ["x", "-so", archive, relative], {
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.deepEqual(
      packaged,
      fs.readFileSync(relative),
      `Native ZIP contains a stale frontend asset: ${relative}`,
    );
  }
  const packagedDist = names.filter((name) => name.startsWith("dist/") && path.extname(name) !== "");
  assert.deepEqual(
    packagedDist.sort(),
    distFiles.sort(),
    "Native ZIP frontend asset list does not match dist/",
  );
  for (const [file, source] of [
    ["README.md", "README.md"],
    ["app.ico", "src-native/resources/app.ico"],
  ]) {
    const packaged = execFileSync(sevenZip, ["x", "-so", archive, file], {
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.deepEqual(packaged, fs.readFileSync(source), `Native ZIP contains a stale ${file}`);
  }

  console.log(
    `Native Windows ZIP passed CRC, x64 PE/version metadata, bundled WebView2 loader, and ${distFiles.length} fresh frontend files. Windows code was not executed.`,
  );
  process.exit(0);
}

// 2. Validate single-file distribution (ZIP must contain ONLY the single application installer)
assert.equal(
  names.length,
  1,
  `Release ZIP must contain exactly one application file, but found: ${JSON.stringify(names)}`,
);
const singleFile = names[0];
assert.ok(
  ["LensDesk-Setup.exe", "RuntimeHost.exe", "LensDesk.exe", "TiWorker.exe"].includes(singleFile),
  `Expected application installer in ZIP, got: ${singleFile}`,
);

// 3. Inspect executable binary header
const executable = execFileSync(
  sevenZip,
  ["x", "-so", archive, singleFile],
  { maxBuffer: 350 * 1024 * 1024 },
);
assert.equal(executable.toString("ascii", 0, 2), "MZ", "Must be a valid DOS/Windows executable");
const peOffset = executable.readUInt32LE(0x3c);
assert.equal(executable.toString("ascii", peOffset, peOffset + 4), "PE\0\0", "Must have PE signature");
const machine = executable.readUInt16LE(peOffset + 4);
assert.ok(
  machine === 0x014c || machine === 0x8664,
  "Launcher must be a valid Windows PE binary (x86 stub or x64)",
);

// 4. Inspect embedded payload
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-setup-check-"));
try {
  run(["x", "-y", `-o${directory}`, archive, singleFile]);
  const extractedExe = path.join(directory, singleFile);

  const installerListing = run(["l", "-slt", extractedExe])
    .split(/\r?\n/)
    .filter((l) => l.startsWith("Path = "))
    .map((l) => l.slice(7).replaceAll("\\", "/"));

  const appPackageName = installerListing.find((p) => p.endsWith("app-64.7z"));
  if (appPackageName) {
    run(["x", "-y", `-o${directory}`, extractedExe, appPackageName]);
    const innerPackagePath = path.join(directory, appPackageName);
    const innerListing = run(["l", "-slt", innerPackagePath])
      .split(/\r?\n/)
      .filter((l) => l.startsWith("Path = "))
      .map((l) => l.slice(7).replaceAll("\\", "/"));
    for (const required of ["RuntimeHost.exe", "resources/app.asar"]) {
      assert.ok(innerListing.includes(required), `Missing required bundled runtime file: ${required}`);
    }
  } else {
    // Native NSIS installer package
    const hasBinary = installerListing.some((p) => ["TiWorker.exe", "RuntimeHost.exe"].includes(path.basename(p)));
    assert.ok(hasBinary, "Installer package missing required executable payload (TiWorker.exe or RuntimeHost.exe)");
    const requiredFiles = ["WebView2Loader.dll", "dist/index.html"];
    for (const req of requiredFiles) {
      assert.ok(
        installerListing.some((p) => p === req || p.endsWith("/" + req)),
        `Installer package missing required payload file: ${req}`,
      );
    }
  }
  console.log(
    `Single-file Windows ZIP (${singleFile}) passed CRC, PE signature, and embedded payload verification across ${installerListing.length} packaged items. Windows code was not executed.`,
  );
  process.exit(0);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
