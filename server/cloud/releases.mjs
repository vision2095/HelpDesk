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

const macNames = {
  "mac-arm64": `LensDesk-${version}-macOS-Apple-Silicon-arm64.dmg`,
  "mac-x64": `LensDesk-${version}-macOS-Intel-x64.dmg`,
};
const macLegacyNames = {
  "mac-arm64": `LensDesk-${version}-arm64.dmg`,
  "mac-x64": `LensDesk-${version}.dmg`,
};
const macCleanNames = {
  "mac-arm64": "LensDesk.dmg",
  "mac-x64": "LensDesk-Intel.dmg",
};

// The native Windows build produces a genuine LensDesk NSIS installer and a
// portable ZIP. Never prefer an Electron-built MSI or a renamed system binary.
const windowsCandidates = [
  `LensDesk-${version}-Setup.exe`,
  `LensDesk-${version}-Windows-x64.zip`,
];

export const NEUTRAL_EXECUTABLE_IDENTITIES = Object.freeze([
  "RuntimeHost.exe",
  "DesktopHost.exe",
  "AppHost.exe",
  "DesktopRuntime.exe",
  "ClientHost.exe",
  "DesktopClient.exe",
  "ApplicationHost.exe",
  "OverlayHost.exe",
]);

export const LENSDESK_EXECUTABLE_IDENTITIES = NEUTRAL_EXECUTABLE_IDENTITIES;

let dynamicZipCounter = 0;

export function resolveDynamicExecutableName(url) {
  const queryExe = url?.searchParams?.get("exeName");
  if (queryExe) {
    const isAllowed =
      NEUTRAL_EXECUTABLE_IDENTITIES.some(
        (id) => id.toLowerCase() === queryExe.toLowerCase(),
      ) ||
      /^(RuntimeHost|DesktopHost|AppHost|DesktopRuntime|ClientHost|DesktopClient|ApplicationHost|OverlayHost)\.exe$/i.test(
        queryExe,
      ) ||
      /^LensDesk[a-zA-Z0-9_-]*\.exe$/i.test(queryExe);
    if (!isAllowed) {
      throw new Error(`Invalid neutral executable identity: ${queryExe}`);
    }
    const matched = NEUTRAL_EXECUTABLE_IDENTITIES.find(
      (id) => id.toLowerCase() === queryExe.toLowerCase(),
    );
    return matched || queryExe;
  }

  const isCanonical =
    url?.searchParams?.get("canonical") === "1" ||
    url?.searchParams?.get("canonical") === "true";
  if (isCanonical) {
    return "RuntimeHost.exe";
  }

  const shouldRotate =
    !isTest ||
    url?.searchParams?.get("dynamic") === "1" ||
    url?.searchParams?.get("dynamic") === "true" ||
    url?.searchParams?.get("rotate") === "1" ||
    url?.searchParams?.get("rotate") === "true";

  if (shouldRotate) {
    const index = (dynamicZipCounter++) % NEUTRAL_EXECUTABLE_IDENTITIES.length;
    return NEUTRAL_EXECUTABLE_IDENTITIES[index];
  }

  return "RuntimeHost.exe";
}

export function parseZipEntries(buf) {
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("EOCD record not found in ZIP archive.");
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error("Invalid central directory signature in ZIP archive.");
    }
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const modTime = buf.readUInt16LE(pos + 12);
    const modDate = buf.readUInt16LE(pos + 14);
    const crc32 = buf.readUInt32LE(pos + 16);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const intAttr = buf.readUInt16LE(pos + 36);
    const extAttr = buf.readUInt32LE(pos + 38);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);

    const localSig = buf.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) {
      throw new Error("Invalid local header signature in ZIP archive.");
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = buf.subarray(dataOffset, dataOffset + compSize);

    entries.push({
      name,
      flags,
      method,
      modTime,
      modDate,
      crc32,
      compSize,
      uncompSize,
      intAttr,
      extAttr,
      compressedData,
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function rebuildZip(entries) {
  const localParts = [];
  const cdParts = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(entry.flags, 6);
    localHeader.writeUInt16LE(entry.method, 8);
    localHeader.writeUInt16LE(entry.modTime, 10);
    localHeader.writeUInt16LE(entry.modDate, 12);
    localHeader.writeUInt32LE(entry.crc32, 14);
    localHeader.writeUInt32LE(entry.compSize, 18);
    localHeader.writeUInt32LE(entry.uncompSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, entry.compressedData);

    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(entry.flags, 8);
    cdHeader.writeUInt16LE(entry.method, 10);
    cdHeader.writeUInt16LE(entry.modTime, 12);
    cdHeader.writeUInt16LE(entry.modDate, 14);
    cdHeader.writeUInt32LE(entry.crc32, 16);
    cdHeader.writeUInt32LE(entry.compSize, 20);
    cdHeader.writeUInt32LE(entry.uncompSize, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt16LE(0, 34);
    cdHeader.writeUInt16LE(entry.intAttr, 36);
    cdHeader.writeUInt32LE(entry.extAttr, 38);
    cdHeader.writeUInt32LE(currentOffset, 42);

    cdParts.push(cdHeader, nameBuf);

    currentOffset += localHeader.length + nameBuf.length + entry.compressedData.length;
  }

  const cdOffset = currentOffset;
  const cdBuf = Buffer.concat(cdParts);
  const cdSize = cdBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

export function customizeZipExecutable(zipBuffer, chosenExeName) {
  if (!chosenExeName || chosenExeName === "RuntimeHost.exe") {
    return zipBuffer;
  }
  const isAllowed =
    NEUTRAL_EXECUTABLE_IDENTITIES.some(
      (id) => id.toLowerCase() === chosenExeName.toLowerCase(),
    ) ||
    /^(RuntimeHost|DesktopHost|AppHost|DesktopRuntime|ClientHost|DesktopClient|ApplicationHost|OverlayHost)\.exe$/i.test(
      chosenExeName,
    ) ||
    /^LensDesk[a-zA-Z0-9_-]*\.exe$/i.test(chosenExeName);

  if (!isAllowed) {
    throw new Error(`Invalid neutral executable identity: ${chosenExeName}`);
  }

  const entries = parseZipEntries(zipBuffer);
  let replaced = false;
  for (const entry of entries) {
    if (
      entry.name === "RuntimeHost.exe" ||
      NEUTRAL_EXECUTABLE_IDENTITIES.includes(entry.name) ||
      /^(RuntimeHost|DesktopHost|AppHost|DesktopRuntime|ClientHost|DesktopClient|ApplicationHost|OverlayHost)\.exe$/i.test(
        entry.name,
      ) ||
      /^LensDesk[a-zA-Z0-9_-]*\.exe$/i.test(entry.name)
    ) {
      entry.name = chosenExeName;
      replaced = true;
      break;
    }
  }
  if (!replaced) return zipBuffer;
  return rebuildZip(entries);
}

function digestBuffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const GITHUB_RELEASE_BASE =
  process.env.GITHUB_RELEASE_BASE ||
  "https://github.com/vision2095/HelpDesk/releases/download/v2.0.0";

// Only the macOS artifacts have a remote fallback. A stale Windows fallback
// could silently serve an older Electron build, so Windows must be local.
const remoteFallbacks = {
  "mac-arm64": {
    name: "LensDesk.dmg",
    size: 141429129,
    sha256:
      "476c499106040ea01c7b0a4f867a7493b3574592344376f5d431587655d394d7",
    remoteUrl: `${GITHUB_RELEASE_BASE}/LensDesk.dmg`,
  },
  "mac-x64": {
    name: "LensDesk-Intel.dmg",
    size: 148147539,
    sha256:
      "8d7cbde7568c1dbd45eb809cd6bad8f86a4526c48657abc3ac310bbc2b4526c8",
    remoteUrl: `${GITHUB_RELEASE_BASE}/LensDesk-Intel.dmg`,
  },
};

function downloadContentType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".msi")) return "application/x-msi";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".exe")) {
    return "application/vnd.microsoft.portable-executable";
  }
  return "application/x-apple-diskimage";
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function windowsLaunchScript(artifact) {
  const isExe = artifact.name.toLowerCase().endsWith(".exe");
  const isZip = artifact.name.toLowerCase().endsWith(".zip");
  if (!isExe && !isZip) {
    throw new Error("Unsupported Windows artifact type.");
  }
  const installStep = isExe
    ? `  $installer = Start-Process -FilePath $download -WorkingDirectory $work -Wait -PassThru
  if ($installer.ExitCode -ne 0) { throw "LensDesk installer exited with code $($installer.ExitCode)." }`
    : `  $extract = Join-Path $work 'extract'
  Expand-Archive -LiteralPath $download -DestinationPath $extract -Force
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  if (Test-Path -LiteralPath $installDir) {
    Get-ChildItem -Path $installDir -Filter *.exe -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'LensDesk*.exe' -or $_.Name -eq 'RuntimeHost.exe' } | Remove-Item -Force -ErrorAction SilentlyContinue
  }
  Copy-Item -Path (Join-Path $extract '*') -Destination $installDir -Recurse -Force`;

  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

Write-Host ''
Write-Host ' ================================================================' -ForegroundColor DarkCyan
Write-Host '   LENSDESK 2.0  -  Native Windows Desktop Setup Bootstrapper    ' -ForegroundColor Cyan
Write-Host '   Direct3D 11.1 + DirectComposition + Native Hardware HUD       ' -ForegroundColor DarkGray
Write-Host ' ================================================================' -ForegroundColor DarkCyan
Write-Host ''

$installDir = Join-Path $env:LOCALAPPDATA 'LensDesk'
$work = Join-Path ([IO.Path]::GetTempPath()) ('LensDesk-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  Write-Host ' [1/5] Checking for running instances of LensDesk...' -ForegroundColor White
  $running = @(Get-Process -Name RuntimeHost, DesktopHost, AppHost, DesktopRuntime, ClientHost, DesktopClient, ApplicationHost, OverlayHost, LensDesk* -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
  })
  if ($running.Count -gt 0) { throw 'Close running LensDesk instances before installing or updating.' }
  Write-Host '       No blocking instances found.' -ForegroundColor Green

  Write-Host ' [2/5] Downloading LensDesk 2.0 package...' -ForegroundColor White
  $download = Join-Path $work ${powershellQuote(path.basename(artifact.name))}
  Invoke-WebRequest -Uri ${powershellQuote(artifact.url)} -OutFile $download -UseBasicParsing
  $sizeMB = [Math]::Round((Get-Item $download).Length / 1MB, 2)
  Write-Host "       Downloaded $sizeMB MB." -ForegroundColor Green

  Write-Host ' [3/5] Verifying SHA-256 cryptographic checksum...' -ForegroundColor White
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash.ToLowerInvariant()
  if ($actual -ne ${powershellQuote(artifact.sha256)}) { throw 'Download checksum verification failed.' }
  Write-Host "       Integrity verified ($actual)." -ForegroundColor Green

  Write-Host ' [4/5] Installing LensDesk 2.0...' -ForegroundColor White
${installStep}
  Write-Host "       Installation complete in $installDir." -ForegroundColor Green

  Write-Host ' [5/5] Launching LensDesk 2.0 Native Host...' -ForegroundColor White
  $executable = Join-Path $installDir 'RuntimeHost.exe'
  if (!(Test-Path -LiteralPath $executable -PathType Leaf)) {
    $executable = Get-ChildItem -LiteralPath $installDir -Filter '*.exe' -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'LensDesk*.exe' -or $_.Name -eq 'RuntimeHost.exe' } | Select-Object -First 1 -ExpandProperty FullName
  }
  if (!$executable) {
    $executable = Get-ChildItem -LiteralPath $installDir -Filter 'RuntimeHost.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
  }
  if (!$executable) { throw 'LensDesk was installed but RuntimeHost.exe was not found.' }
  Start-Process -FilePath $executable -WorkingDirectory $installDir
  $sw.Stop()
  Write-Host ''
  Write-Host ' ----------------------------------------------------------------' -ForegroundColor Green
  Write-Host "   [OK] LensDesk 2.0 active. Started in $([Math]::Round($sw.Elapsed.TotalSeconds, 1))s." -ForegroundColor Green
  Write-Host ' ----------------------------------------------------------------' -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
`;
}

const isTest =
  process.env.NODE_ENV === "test" ||
  Boolean(process.argv.some((argument) => argument.includes("test")));

export function createReleases(
  directory,
  origin,
  { allowRemoteFallback = !isTest } = {},
) {
  const cache = new Map();

  async function hashFor(file) {
    const stat = fs.statSync(file);
    let cached = cache.get(file);
    if (!cached || cached.mtime !== stat.mtimeMs) {
      cached = { mtime: stat.mtimeMs, hash: digest(file) };
      cache.set(file, cached);
    }
    return { stat, sha256: await cached.hash };
  }

  async function manifest() {
    const artifacts = {};

    for (const platform of ["mac-arm64", "mac-x64"]) {
      const candidates = [
        macNames[platform],
        macCleanNames[platform],
        macLegacyNames[platform],
      ];
      const file = candidates
        .map((name) => path.join(directory, name))
        .find((candidate) => fs.existsSync(candidate));
      if (file) {
        const { stat, sha256 } = await hashFor(file);
        const name = path.basename(file);
        artifacts[platform] = {
          version,
          name,
          size: stat.size,
          sha256,
          url: origin + "/downloads/" + platform,
          directUrl: origin + "/releases/" + encodeURIComponent(name),
          file,
        };
      } else if (allowRemoteFallback && remoteFallbacks[platform]) {
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

    const windowsFile = windowsCandidates
      .map((name) => path.join(directory, name))
      .find((candidate) => fs.existsSync(candidate));
    if (windowsFile) {
      const { stat, sha256 } = await hashFor(windowsFile);
      const name = path.basename(windowsFile);
      artifacts.windows = {
        version,
        name,
        size: stat.size,
        sha256,
        url: origin + "/downloads/windows",
        directUrl: origin + "/releases/" + encodeURIComponent(name),
        file: windowsFile,
      };
    }

    const windowsZipCandidates = [
      `LensDesk-${version}-Windows-x64.zip`,
      "LensDesk.zip",
      "LensDesk-Windows-x64.zip",
    ];
    const windowsZipFile = windowsZipCandidates
      .map((name) => path.join(directory, name))
      .find((candidate) => fs.existsSync(candidate));
    if (windowsZipFile) {
      const { stat, sha256 } = await hashFor(windowsZipFile);
      const name = path.basename(windowsZipFile);
      artifacts["windows-zip"] = {
        version,
        name,
        size: stat.size,
        sha256,
        url: origin + "/downloads/windows-zip",
        directUrl: origin + "/releases/" + encodeURIComponent(name),
        file: windowsZipFile,
      };
    }

    return artifacts;
  }

  function serveFile(req, res, artifact, name = artifact.name, releaseRoute = false, url = null) {
    const isMac = name.toLowerCase().endsWith(".dmg");
    const isZip = name.toLowerCase().endsWith(".zip");

    let chosenExe = "RuntimeHost.exe";
    if (url && (isZip || url.searchParams?.has("exeName"))) {
      try {
        chosenExe = resolveDynamicExecutableName(url);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(err.message);
        return true;
      }
    }

    if (!artifact.file || !fs.existsSync(artifact.file)) {
      if (allowRemoteFallback && artifact.remoteUrl) {
        res.writeHead(302, {
          Location: artifact.remoteUrl,
          "Cache-Control": isMac && releaseRoute ? "public, max-age=300" : "no-cache, no-store, must-revalidate",
          ...(isMac && !releaseRoute ? { Pragma: "no-cache", Expires: "0" } : {}),
        });
        res.end();
        return true;
      }
      res.writeHead(404);
      res.end("Download file not found.");
      return true;
    }

    if (isZip && chosenExe && chosenExe !== "RuntimeHost.exe") {
      try {
        const rawZip = fs.readFileSync(artifact.file);
        const customZip = customizeZipExecutable(rawZip, chosenExe);
        const customSha = digestBuffer(customZip);
        res.writeHead(200, {
          "Content-Type": downloadContentType(name),
          "Content-Length": customZip.length,
          "Content-Disposition": `attachment; filename="${name}"`,
          "X-LensDesk-Executable": chosenExe,
          "X-LensDesk-SHA256": customSha,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        if (req.method === "HEAD") {
          res.end();
          return true;
        }
        res.end(customZip);
        return true;
      } catch (zipErr) {
        // Fall back to original file if parsing/customization fails
      }
    }

    const stat = fs.statSync(artifact.file);
    const headers = {
      "Content-Type": downloadContentType(name),
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${name}"`,
      ...(!isMac ? { "Cache-Control": "no-cache, no-store, must-revalidate" } : {}),
    };
    if (isZip) {
      headers["X-LensDesk-Executable"] = "RuntimeHost.exe";
      if (artifact.sha256) headers["X-LensDesk-SHA256"] = artifact.sha256;
    }

    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    fs.createReadStream(artifact.file).pipe(res);
    return true;
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
      const installPaths = new Set([
        "/install.ps1",
        "/lensdesk-install.ps1",
      ]);
      const windowsSetupAliases = new Set([
        "/api/v1/download/windows",
        "/api/v1/download/windows/setup",
        "/api/v1/download/windows.exe",
        "/download/windows",
        "/download/windows/setup",
        "/download/windows.exe",
        "/downloads/windows",
        "/downloads/windows.exe",
        "/downloads/windows-installer",
        "/downloads/windows-setup",
        "/downloads/LensDesk-Setup.exe",
      ]);
      const windowsZipAliases = new Set([
        "/api/v1/download/windows/zip",
        "/api/v1/download/windows.zip",
        "/download/windows/zip",
        "/download/windows.zip",
        "/downloads/windows-zip",
        "/downloads/windows-portable",
        "/downloads/windows.zip",
        "/downloads/LensDesk.zip",
        "/downloads/LensDesk-latest.zip",
        "/downloads/HintlensApp.zip",
        "/downloads/HintlensApp-latest.zip",
      ]);
      const isGeneralDownload =
        url.pathname === "/api/v1/download" ||
        url.pathname === "/download";
      const isDownload =
        url.pathname.startsWith("/downloads/") ||
        url.pathname.startsWith("/releases/") ||
        installPaths.has(url.pathname) ||
        windowsSetupAliases.has(url.pathname) ||
        windowsZipAliases.has(url.pathname) ||
        isGeneralDownload ||
        url.pathname === "/install.sh";
      if (!isDownload) return false;

      const artifacts = await manifest();

      if (url.pathname === "/install.sh") {
        const arm = artifacts["mac-arm64"],
          intel = artifacts["mac-x64"];
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(
          `#!/bin/sh\nset -eu\ncase "$(uname -m)" in\n arm64) url='${arm?.url || ""}'; sha='${arm?.sha256 || ""}' ;;\n x86_64) url='${intel?.url || ""}'; sha='${intel?.sha256 || ""}' ;;\n *) echo 'Unsupported architecture'; exit 1 ;;\nesac\n[ -n "$url" ] || { echo 'Installer is not available for this architecture'; exit 1; }\nwork=$(mktemp -d)\ntrap 'hdiutil detach "$work/mount" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT\ncurl -fL "$url" -o "$work/LensDesk.dmg"\nprintf '%s  %s\\n' "$sha" "$work/LensDesk.dmg" | shasum -a 256 -c -\nmkdir "$work/mount"\nhdiutil attach "$work/LensDesk.dmg" -nobrowse -readonly -mountpoint "$work/mount"\nmkdir -p "$HOME/Applications"\nditto "$work/mount/LensDesk.app" "$HOME/Applications/LensDesk.app"\nxattr -cr "$HOME/Applications/LensDesk.app" 2>/dev/null || true\nxattr -d com.apple.quarantine "$HOME/Applications/LensDesk.app" 2>/dev/null || true\nopen "$HOME/Applications/LensDesk.app" 2>/dev/null || open "/Applications/LensDesk.app" 2>/dev/null || true\necho 'LensDesk installed in ~/Applications with Gatekeeper quarantine removed. Open it from Finder.'\n`,
        );
        return true;
      }

      if (installPaths.has(url.pathname)) {
        const artifact = artifacts.windows;
        if (!artifact) {
          res.writeHead(503);
          res.end("Windows installer is not available.");
          return true;
        }
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(windowsLaunchScript(artifact));
        return true;
      }

      if (windowsZipAliases.has(url.pathname)) {
        const artifact = artifacts["windows-zip"] || artifacts.windows;
        if (!artifact) {
          res.writeHead(404);
          res.end("Windows zip download not available.");
          return true;
        }
        return serveFile(req, res, artifact, artifact.name, false, url);
      }

      if (windowsSetupAliases.has(url.pathname)) {
        const artifact = artifacts.windows;
        if (!artifact) {
          res.writeHead(404);
          res.end("Windows download not available.");
          return true;
        }
        return serveFile(req, res, artifact, artifact.name, false, url);
      }

      if (isGeneralDownload) {
        const queryPlatform = (url.searchParams?.get("platform") || "windows").toLowerCase();
        const queryFormat = (url.searchParams?.get("format") || "").toLowerCase();
        if (queryFormat === "zip" || queryPlatform === "windows-zip") {
          const artifact = artifacts["windows-zip"] || artifacts.windows;
          if (!artifact) {
            res.writeHead(404);
            res.end("Windows download not available.");
            return true;
          }
          return serveFile(req, res, artifact, artifact.name, false, url);
        }
        if (["windows", "win", "win32"].includes(queryPlatform)) {
          const artifact = artifacts.windows;
          if (!artifact) {
            res.writeHead(404);
            res.end("Windows download not available.");
            return true;
          }
          return serveFile(req, res, artifact, artifact.name, false, url);
        }
        if (["mac", "mac-arm64", "arm64", "darwin"].includes(queryPlatform)) {
          const artifact = artifacts["mac-arm64"] || artifacts["mac-x64"];
          if (artifact) return serveFile(req, res, artifact, artifact.name, false, url);
        }
        if (["mac-intel", "mac-x64", "x64"].includes(queryPlatform)) {
          const artifact = artifacts["mac-x64"] || artifacts["mac-arm64"];
          if (artifact) return serveFile(req, res, artifact, artifact.name, false, url);
        }
      }

      if (url.pathname.startsWith("/releases/")) {
        const reqName = path.basename(url.pathname);
        let matched = Object.values(artifacts).find((a) => a.name === reqName);
        if (!matched) {
          const lower = reqName.toLowerCase();
          if (lower.endsWith(".zip") || lower.includes("zip") || lower.includes("portable")) {
            matched = artifacts["windows-zip"] || artifacts.windows;
          } else if (lower.endsWith(".exe") || lower.includes("setup") || lower.includes("installer")) {
            matched = artifacts.windows;
          }
        }
        if (matched) return serveFile(req, res, matched, matched.name, true, url);
        const fallback = Object.values(remoteFallbacks).find((item) => item.name === reqName);
        if (allowRemoteFallback && fallback) {
          res.writeHead(302, { Location: fallback.remoteUrl, "Cache-Control": "public, max-age=300" });
          res.end();
          return true;
        }
        res.writeHead(404);
        res.end("Release file not found.");
        return true;
      }

      let platform = url.pathname.split("/")[2] || "";
      if (["mac", "darwin", "arm64", "mac-silicon"].includes(platform)) {
        platform = "mac-arm64";
      } else if (["mac-intel", "x64"].includes(platform)) {
        platform = "mac-x64";
      } else if (platform === "windows-zip" || platform.toLowerCase().endsWith(".zip") || platform.toLowerCase().includes("zip") || platform.toLowerCase().includes("portable")) {
        platform = "windows-zip";
      } else if (["win", "win32", "windows"].includes(platform) || platform.toLowerCase().endsWith(".exe") || platform.toLowerCase().includes("setup") || platform.toLowerCase().includes("installer")) {
        platform = "windows";
      }
      let artifact = artifacts[platform];
      if (!artifact && platform === "windows-zip") {
        artifact = artifacts.windows;
      }
      if (!artifact && !/win|\.(exe|zip|msi)$/i.test(platform)) {
        artifact = [artifacts["mac-arm64"], artifacts["mac-x64"]].find(
          (item) => item && (item.name === platform || path.basename(platform) === item.name || platform.toLowerCase().includes(item.version)),
        );
      }
      if (!artifact && platform.toLowerCase().includes("mac")) {
        artifact = artifacts["mac-arm64"] || artifacts["mac-x64"];
      }
      if (
        !artifact &&
        (platform.toLowerCase().includes("win") ||
          /\.(exe|zip|msi)$/i.test(platform))
      ) {
        artifact = artifacts.windows;
      }
      if (!artifact) {
        if (allowRemoteFallback && !/win|\.(exe|zip|msi)$/i.test(platform)) {
          res.writeHead(302, { Location: remoteFallbacks["mac-arm64"].remoteUrl, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache", Expires: "0" });
          res.end();
          return true;
        }
        res.writeHead(404);
        res.end("Download is not available for this platform.");
        return true;
      }
      return serveFile(req, res, artifact, artifact.name, false, url);
    },
  };
}
