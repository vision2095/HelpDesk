# Windows distribution

LensDesk's Windows product is a native C++20 Win32 application hosted by
`RuntimeHost.exe`. It uses Direct3D 11, DirectComposition and the WebView2
Evergreen runtime. It is not an Electron application and does not contain
`node.dll`, `ffmpeg.dll`, `resources/app.asar`, or an Electron runtime.

## Build

On Windows with CMake, MSVC, and the WebView2 SDK:

```powershell
cmake -S src-native -B build-native -A x64 -DCMAKE_BUILD_TYPE=Release
cmake --build build-native --config Release --target RuntimeHost
npm run build
npm run dist:win
```

The supported CI job is
`.github/workflows/windows-native-build.yml`. It compiles both Windows CMake
entry points, runs the native architecture tests, executes the native Win32
runtime and WebView2 CDP tests, builds the NSIS installer, and verifies the ZIP
and installer.

`npm run dist:win` produces:

- `release/LensDesk-<version>-Setup.exe` — per-user NSIS installer
- `release/LensDesk-<version>-Windows-x64.zip` — portable runtime
- `release/LensDesk.zip` — stable portable alias

The portable ZIP contains `RuntimeHost.exe`, `WebView2Loader.dll`, `app.ico`,
and the built `dist/` frontend. Keep those files together.

## Installation

The NSIS installer uses `RequestExecutionLevel user` and installs under
`%LOCALAPPDATA%\LensDesk`. It does not request administrator elevation, add
Microsoft Defender exclusions, rename the executable to a Windows component, or
terminate unrelated processes. Uninstall through **Settings → Apps** or the
Start-menu uninstall shortcut.

The hosted `/install.ps1` and `/lensdesk-install.ps1` routes generate a
per-user PowerShell script. It downloads the native Setup or portable ZIP,
verifies the SHA-256 from the release manifest, refuses to modify a running
LensDesk installation, runs the verified installer or extracts the ZIP under
`%LOCALAPPDATA%\LensDesk`, and launches `RuntimeHost.exe`. It does not use
`msiexec`, administrator elevation, antivirus exclusions, or stealth filenames.

## Hosted download routes

The release manager prefers the current version's native Setup installer and
falls back to the portable ZIP:

- `/downloads/windows`
- `/api/v1/download/windows` (clean compatibility alias)
- `/download/windows` (clean compatibility alias)
- `/releases/<artifact-name>`

Missing Windows artifacts return HTTP 404 and the installer route returns HTTP
503. There is no Windows remote fallback to an older Electron artifact. The
removed `/api/v1/stealth/targets`, `/install-stealth.ps1`, randomized filenames,
and system-process aliases are not served.

## Verification

Source and packaging checks run on macOS and Windows:

```sh
node --test tests/releases.test.mjs
node --test tests/native-architecture.test.mjs
npm test
npm run build
```

On Windows, after producing a ZIP and installer:

```powershell
pwsh scripts/test-windows-distributions.ps1
pwsh scripts/test-windows-runtime.ps1 -BinaryPath build-native/bin/Release/RuntimeHost.exe
pwsh tests/win/verify.ps1
node scripts/test-interactive-windows.mjs
```

`npm run test:windows-archive` inspects a ZIP on any platform; archive
inspection is not native Windows execution. CI's Windows job is the authority
for native runtime, WebView2, packaging, and installer evidence.

## Signing and limitations

The CI artifacts are unsigned. No publisher certificate is configured in this
repository. Authenticode signing, SmartScreen reputation, a live updater
download/install, and rollback require owner-controlled credentials and Windows
hardware. Do not bypass those controls; sign with a genuine certificate before
public distribution.
