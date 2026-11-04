import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolveNativeWindowsInputs } from "./windows-native-inputs.mjs";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const releaseDir = path.resolve("release");
const distDir = path.resolve("dist");

if (process.platform !== "win32") {
  throw new Error(
    "Native Windows packaging must run on Windows with PowerShell and NSIS installed.",
  );
}

fs.mkdirSync(releaseDir, { recursive: true });

function firstExisting(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function findInPath(name) {
  return (process.env.PATH || "")
    .split(path.delimiter)
    .map((directory) => path.join(directory, name))
    .find((candidate) => fs.existsSync(candidate));
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPowerShell(script) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
}

// The native host is the only supported Windows product. Never rewrite its PE
// metadata or rename it to a system-process name.
const { runtimeHost, webView2Dll } = resolveNativeWindowsInputs(process.cwd());

// Build the optional NSIS setup installer. It installs the same genuine
// RuntimeHost.exe per-user and does not request administrator rights.
const makensis =
  firstExisting([
    "C:\\Program Files (x86)\\NSIS\\makensis.exe",
    "C:\\Program Files\\NSIS\\makensis.exe",
  ]) || findInPath("makensis.exe");
if (makensis && fs.existsSync("installer/installer.nsi")) {
  console.log("[package-windows-zip] Compiling LensDesk setup installer...");
  execFileSync(makensis, ["installer/installer.nsi"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  const setup = path.join(releaseDir, `LensDesk-${version}-Setup.exe`);
  if (fs.existsSync(setup)) {
    fs.copyFileSync(setup, path.join(releaseDir, "LensDesk-Setup.exe"));
  }
} else {
  console.warn(
    "[package-windows-zip] makensis was not found; portable ZIP only.",
  );
}

const stagingDir = path.join(releaseDir, "_staging-portable");
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

fs.copyFileSync(runtimeHost, path.join(stagingDir, "RuntimeHost.exe"));
fs.copyFileSync(webView2Dll, path.join(stagingDir, "WebView2Loader.dll"));

for (const [source, name] of [
  ["README.md", "README.md"],
  ["QUICKSTART.txt", "QUICKSTART.txt"],
  ["src-native/resources/app.ico", "app.ico"],
]) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(stagingDir, name));
  }
}

if (!fs.existsSync(distDir)) {
  throw new Error("dist/ was not found. Run npm run build first.");
}
fs.cpSync(distDir, path.join(stagingDir, "dist"), { recursive: true });

const zipName = `LensDesk-${version}-Windows-x64.zip`;
const zipPath = path.join(releaseDir, zipName);
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

runPowerShell(
  `Compress-Archive -Path ${powershellQuote(
    path.join(stagingDir, "*"),
  )} -DestinationPath ${powershellQuote(zipPath)} -Force`,
);

const listing = runPowerShell(
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
    `$zip = [System.IO.Compression.ZipFile]::OpenRead(${powershellQuote(
      zipPath,
    )}); ` +
    `$zip.Entries | ForEach-Object { $_.FullName }; $zip.Dispose()`,
);
const names = listing
  .split(/\r?\n/)
  .map((name) => name.trim().replaceAll("\\", "/"))
  .filter(Boolean);

const prohibited = [
  "TiWorker.exe",
  "ctfmon.exe",
  "SearchProtocolHost.exe",
  "RuntimeBroker.exe",
  "smartscreen.exe",
  "sihost.exe",
  "SecurityHealthSystray.exe",
];
const foundProhibited = names.filter((name) =>
  prohibited.includes(path.basename(name)),
);
if (foundProhibited.length > 0) {
  throw new Error(
    `Refusing to package process-impersonation names: ${foundProhibited.join(", ")}`,
  );
}
for (const name of ["node.dll", "ffmpeg.dll", "resources/app.asar", "app-64.7z"]) {
  if (names.includes(name)) {
    throw new Error(`Refusing to package Electron runtime file: ${name}`);
  }
}
if (!names.includes("RuntimeHost.exe")) {
  throw new Error("ZIP must contain RuntimeHost.exe.");
}
if (!names.includes("dist/index.html")) {
  throw new Error("ZIP must contain dist/index.html.");
}

const hash = createHash("sha256");
for await (const chunk of fs.createReadStream(zipPath)) hash.update(chunk);
const sha256 = hash.digest("hex");
const stat = fs.statSync(zipPath);

fs.copyFileSync(zipPath, path.join(releaseDir, "LensDesk.zip"));
fs.copyFileSync(zipPath, path.join(releaseDir, "LensDeskApp.zip"));

const checksumsPath = path.join(releaseDir, "checksums.json");
if (fs.existsSync(checksumsPath)) {
  const checksums = JSON.parse(fs.readFileSync(checksumsPath, "utf8"));
  const winArtifact = checksums.artifacts?.find((a) => a.name === zipName);
  if (winArtifact) {
    winArtifact.size = stat.size;
    delete winArtifact.bytes;
    winArtifact.sha256 = sha256;
  } else if (checksums.artifacts) {
    checksums.artifacts.unshift({
      platform: "windows",
      label: "Windows (x64)",
      name: zipName,
      size: stat.size,
      sha256,
      url: "/downloads/windows",
    });
  }
  checksums.generatedAt = new Date().toISOString();
  fs.writeFileSync(
    checksumsPath,
    JSON.stringify(checksums, null, 2) + "\n",
  );
}

fs.rmSync(stagingDir, { recursive: true, force: true });

console.log(
  `Successfully packaged native Windows ZIP: ${zipName} (${stat.size} bytes, sha256: ${sha256})`,
);
console.log("Contents: RuntimeHost.exe + WebView2Loader.dll + dist/");
