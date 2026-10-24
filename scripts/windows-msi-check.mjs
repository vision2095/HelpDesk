import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractFile } from "@electron/asar";
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
const msiPath = path.resolve(
  process.argv[2] || `release/RuntimeHost-${version}-x64.msi`,
);

assert.ok(fs.existsSync(msiPath), `Installer not found at ${msiPath}`);
assert.equal(
  process.platform,
  "win32",
  "MSI payload verification requires Windows (msiexec); run it on the Windows build job.",
);

// 1. An MSI is an OLE compound document, not a renamed executable.
const signature = Buffer.alloc(8);
const handle = fs.openSync(msiPath, "r");
try {
  fs.readSync(handle, signature, 0, signature.length, 0);
} finally {
  fs.closeSync(handle);
}
assert.ok(
  signature.equals(
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  ),
  "MSI must be an OLE compound document",
);

// 2. Read the installer's product metadata through the Windows Installer COM API.
const powershell = (script) =>
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );

const msiLiteral = msiPath.replaceAll("'", "''");
const propertiesOutput = powershell(`
$ErrorActionPreference = 'Stop'
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase('${msiLiteral}', 0)
$view = $database.OpenView('SELECT \`Property\`, \`Value\` FROM \`Property\`')
$view.Execute()
while ($null -ne ($record = $view.Fetch())) {
  Write-Output ($record.StringData(1) + '=' + $record.StringData(2))
}
$view.Close()
`);

const properties = Object.fromEntries(
  propertiesOutput
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]),
);

assert.equal(properties.ProductName, "LensDesk", "MSI ProductName must be LensDesk");
const numericVersion = (value) => value.split(".").slice(0, 3).join(".");
assert.equal(
  numericVersion(properties.ProductVersion),
  numericVersion(version),
  `MSI ProductVersion mismatch: expected ${version}, got ${properties.ProductVersion}`,
);
assert.equal(
  properties.Manufacturer,
  "LensDesk",
  "MSI Manufacturer must be LensDesk",
);
assert.equal(
  properties.ALLUSERS,
  "2",
  "MSI must default to a per-user installation",
);
assert.equal(
  properties.MSIINSTALLPERUSER,
  "1",
  "MSI must default to a per-user installation",
);

// 3. Administrative install extracts the exact payload without installing the app.
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "lensdesk-msi-check-"),
);
try {
  const extractDir = path.join(directory, "payload");
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync(
    "msiexec.exe",
    ["/a", msiPath, "/qn", "/norestart", `TARGETDIR="${extractDir}"`],
    { stdio: "inherit" },
  );

  function walk(current) {
    return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(current, entry.name);
      return entry.isDirectory() ? walk(file) : [file];
    });
  }

  const payload = walk(extractDir);
  const findFile = (relative) => {
    const normalized = relative.split(path.sep).join("/");
    const match = payload.find(
      (file) =>
        file.split(path.sep).join("/").toLowerCase().endsWith(normalized.toLowerCase()),
    );
    assert.ok(match, `MSI payload is missing ${relative}`);
    return match;
  };

  for (const required of [
    "RuntimeHost.exe",
    "resources/app.asar",
    "icudtl.dat",
    "resources.pak",
    "locales/en-US.pak",
    "LICENSE.electron.txt",
    "LICENSES.chromium.html",
  ]) {
    findFile(required);
  }

  // 4. The installed executable must be a genuine x64 Windows PE binary with LensDesk metadata.
  const executable = fs.readFileSync(findFile("RuntimeHost.exe"));
  assert.equal(
    executable.toString("ascii", 0, 2),
    "MZ",
    "Must be a valid DOS/Windows executable",
  );
  const peOffset = executable.readUInt32LE(0x3c);
  assert.equal(
    executable.toString("ascii", peOffset, peOffset + 4),
    "PE\0\0",
    "Must have PE signature",
  );
  assert.equal(
    executable.readUInt16LE(peOffset + 4),
    0x8664,
    "Installed application must be x64",
  );

  const versionStrings = readVersionStrings(executable);
  assert.equal(
    versionStrings.FileDescription,
    "RuntimeHost",
    "FileDescription must be RuntimeHost",
  );
  assert.equal(
    versionStrings.ProductName,
    "LensDesk",
    "ProductName must be LensDesk",
  );
  assert.equal(
    versionStrings.OriginalFilename,
    "",
    "OriginalFilename must be blank",
  );

  // 5. The packaged ASAR must match this source tree, not a previous release.
  const asarPath = findFile(path.join("resources", "app.asar"));
  const packaged = JSON.parse(extractFile(asarPath, "package.json"));
  assert.equal(
    packaged.version,
    version,
    `ASAR version mismatch: expected ${version}, got ${packaged.version}`,
  );
  assert.equal(
    packaged.name,
    "lensdesk",
    `ASAR name mismatch: expected lensdesk, got ${packaged.name}`,
  );

  function sourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(file) : [file];
    });
  }

  let checked = 0;
  for (const sourceDirectory of ["desktop", "server", "dist"]) {
    for (const file of sourceFiles(sourceDirectory)) {
      const relative = file.split(path.sep).join("/");
      assert.deepEqual(
        extractFile(asarPath, relative),
        fs.readFileSync(file),
        `Stale or missing packaged source: ${relative}. Rebuild the Windows MSI.`,
      );
      checked++;
    }
  }

  console.log(
    `Windows MSI passed OLE container, product metadata (ProductName=LensDesk, ProductVersion=${version}, per-user), x64 PE, and bundled runtime/ASAR checks across ${checked} packaged files. The Windows application was not executed.`,
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
