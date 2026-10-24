import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const { version } = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const names = {
  "mac-arm64": `LensDesk-${version}-macOS-Apple-Silicon-arm64.dmg`,
  "mac-x64": `LensDesk-${version}-macOS-Intel-x64.dmg`,
  windows: `RuntimeHost-${version}-x64.msi`,
};

const legacyNames = {
  "mac-arm64": `LensDesk-${version}-arm64.dmg`,
  "mac-x64": `LensDesk-${version}.dmg`,
  windows: `LensDesk-${version}-Windows-x64.zip`,
};

function downloadContentType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".msi")) return "application/x-msi";
  if (lower.endsWith(".zip")) return "application/zip";
  return "application/x-apple-diskimage";
}

function windowsLaunchScript(artifact) {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  if (artifact.name.toLowerCase().endsWith(".msi")) {
    return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$work = Join-Path ([IO.Path]::GetTempPath()) ('LensDesk-download-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $installer = Join-Path $work ${quote(artifact.name)}
  Invoke-WebRequest -Uri ${quote(artifact.url)} -OutFile $installer
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
  if ($actual -ne ${quote(artifact.sha256)}) { throw 'Download checksum mismatch' }
  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', ('"' + $installer + '"'), '/qn', '/norestart') -Wait -PassThru
  if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) { throw ('Windows Installer failed with exit code ' + $process.ExitCode) }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\\LensDesk\\RuntimeHost.exe'),
    (Join-Path $env:ProgramFiles 'LensDesk\\RuntimeHost.exe')
  )
  $executable = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (!$executable) { throw 'LensDesk was installed but its executable was not found' }
  Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable)
  Write-Output ('LensDesk installed and opened from ' + $executable)
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force
}
`;
  }
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$work = Join-Path ([IO.Path]::GetTempPath()) ('LensDesk-download-' + [guid]::NewGuid().ToString('N'))
$appDirectory = $null
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $archive = Join-Path $work ${quote(artifact.name)}
  Invoke-WebRequest -Uri ${quote(artifact.url)} -OutFile $archive
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  if ($actual -ne ${quote(artifact.sha256)}) { throw 'Download checksum mismatch' }
  $installRoot = Join-Path $env:LOCALAPPDATA 'Programs\\LensDesk'
  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  $appDirectory = Join-Path $installRoot ('app-${version}-' + [guid]::NewGuid().ToString('N'))
  Expand-Archive -LiteralPath $archive -DestinationPath $appDirectory
  $executable = Join-Path $appDirectory 'LensDesk.exe'
  if (!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'The LensDesk archive is incomplete' }
  Start-Process -FilePath $executable -WorkingDirectory $appDirectory
  Write-Output ('LensDesk opened from ' + $appDirectory)
} catch {
  if ($appDirectory -and (Test-Path -LiteralPath $appDirectory)) { Remove-Item -LiteralPath $appDirectory -Recurse -Force }
  throw
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force
}
`;
}
export function createReleases(directory, origin) {
  const cache = new Map();
  async function manifest() {
    const artifacts = {};
    for (const platform of ["mac-arm64", "mac-x64", "windows"]) {
      let chosenName = names[platform];
      let file = path.join(directory, chosenName);
      if (!fs.existsSync(file)) {
        chosenName = legacyNames[platform];
        file = path.join(directory, chosenName);
      }
      if (!fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      let sha = cache.get(file);
      if (!sha || sha.mtime !== stat.mtimeMs) {
        sha = { mtime: stat.mtimeMs, hash: digest(file) };
        cache.set(file, sha);
      }
      artifacts[platform] = {
        version,
        name: chosenName,
        size: stat.size,
        sha256: await sha.hash,
        url: origin + "/downloads/" + platform,
        directUrl: origin + "/releases/" + chosenName,
        file,
      };
    }
    return artifacts;
  }
  return {
    async manifest() {
      return Object.fromEntries(
        Object.entries(await manifest()).map(([key, { file, ...value }]) => [
          key,
          value,
        ]),
      );
    },
    async serve(req, res, url) {
      if (
        !url.pathname.startsWith("/downloads/") &&
        !url.pathname.startsWith("/releases/") &&
        !["/install.sh", "/install.ps1"].includes(url.pathname)
      )
        return false;
      const artifacts = await manifest();
      if (url.pathname.startsWith("/releases/")) {
        const reqName = path.basename(url.pathname);
        const matched = Object.values(artifacts).find((a) => a.name === reqName);
        if (!matched) {
          res.writeHead(404);
          res.end("Release file not found.");
          return true;
        }
        res.writeHead(200, {
          "Content-Type": downloadContentType(matched.name),
          "Content-Length": matched.size,
          "Content-Disposition": `attachment; filename="${matched.name}"`,
        });
        if (req.method === "HEAD") {
          res.end();
          return true;
        }
        fs.createReadStream(matched.file).pipe(res);
        return true;
      }
      if (url.pathname.startsWith("/downloads/")) {
        let platform = url.pathname.split("/")[2];
        if (platform === "mac-silicon" || platform === "arm64") platform = "mac-arm64";
        if (platform === "mac-intel" || platform === "x64") platform = "mac-x64";
        if (platform === "win" || platform === "win32") platform = "windows";
        const artifact = artifacts[platform];
        if (!artifact) {
          res.writeHead(404);
          res.end("Download is not available for this platform.");
          return true;
        }
        res.writeHead(200, {
          "Content-Type": downloadContentType(artifact.name),
          "Content-Length": artifact.size,
          "Content-Disposition": `attachment; filename="${artifact.name}"`,
        });
        if (req.method === "HEAD") {
          res.end();
          return true;
        }
        fs.createReadStream(artifact.file).pipe(res);
        return true;
      }
      if (url.pathname === "/install.ps1") {
        const a = artifacts.windows;
        if (!a) {
          res.writeHead(503);
          res.end("Windows installer is not available.");
          return true;
        }
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(windowsLaunchScript(a));
        return true;
      }
      if (url.pathname === "/install.sh") {
        const arm = artifacts["mac-arm64"],
          intel = artifacts["mac-x64"];
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(
          `#!/bin/sh\nset -eu\ncase "$(uname -m)" in\n arm64) url='${arm?.url || ""}'; sha='${arm?.sha256 || ""}' ;;\n x86_64) url='${intel?.url || ""}'; sha='${intel?.sha256 || ""}' ;;\n *) echo 'Unsupported architecture'; exit 1 ;;\nesac\n[ -n "$url" ] || { echo 'Installer is not available for this architecture'; exit 1; }\nwork=$(mktemp -d)\ntrap 'hdiutil detach "$work/mount" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT\ncurl -fL "$url" -o "$work/LensDesk.dmg"\nprintf '%s  %s\\n' "$sha" "$work/LensDesk.dmg" | shasum -a 256 -c -\nmkdir "$work/mount"\nhdiutil attach "$work/LensDesk.dmg" -nobrowse -readonly -mountpoint "$work/mount"\nmkdir -p "$HOME/Applications"\nditto "$work/mount/LensDesk.app" "$HOME/Applications/LensDesk.app"\nopen "$HOME/Applications/LensDesk.app" 2>/dev/null || open "/Applications/LensDesk.app" 2>/dev/null || true\necho 'LensDesk installed in ~/Applications. Open it from Finder.'\n`,
        );
        return true;
      }
      return false;
    },
  };
}
