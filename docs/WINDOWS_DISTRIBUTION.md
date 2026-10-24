# Windows MSI distribution

`npm run dist:win:msi` builds `release/RuntimeHost-<package-version>-x64.msi`. The MSI is a standard Windows Installer package that installs the same LensDesk application (same Electron runtime, `resources/app.asar`, DLLs, locales, licenses, and product features) as the portable build. No application code differs between the two packages; only the delivery container and Windows executable name change.

The installer defaults to a per-user installation and does not require administrator rights unless the user explicitly chooses an all-users install. It installs under `%LOCALAPPDATA%\Programs\RuntimeHost` with the application executable named `RuntimeHost.exe`, creates Start-menu and desktop shortcuts, and can be removed from **Settings → Apps**. The product metadata, install folder, and Start-menu shortcut are `RuntimeHost`. RuntimeHost does not change OS display preferences, use random process names, or impersonate Windows components.

On Windows, the main window is frameless, transparent, always-on-top, excluded from the taskbar and Alt+Tab, and starts click-through with mouse input ignored. Press `Shift+M` (or use the tray menu) to toggle click-through and restore normal mouse and keyboard focus. The macOS build keeps its normal framed window, native close/minimize/maximize controls, and dock behavior.

Windows MSI builds must run on Windows. The installer is compiled with the WiX toolset and Windows Installer tooling; the build script stops on macOS with instructions to use a Windows machine or the Windows CI job. Set `ELECTRON_BUILDER_ALLOW_WINE_BUILD=1` only if you have a working cross-build Wine + WiX toolset.

## Legacy portable ZIP

`npm run dist:win` still builds the previous portable release, `release/LensDesk-<package-version>-Windows-x64.zip`. The archive contains ONLY the portable launcher `RuntimeHost.exe`; its embedded Electron runtime contains the same `RuntimeHost.exe` application executable. It remains available as a fallback for releases that do not contain an MSI. Users extract or run `RuntimeHost.exe`; the application uses the same normal RuntimeHost user-data location regardless of package format.

## Hosted download and PowerShell

The hosted release manifest resolves the `windows` entry to the current version's MSI (`application/x-msi`). If the MSI is absent, it falls back to the current version's portable ZIP (`application/zip`). An older EXE in the release directory is not a fallback. If neither package is present, the Windows download returns HTTP 404 and `/install.ps1` returns HTTP 503.

For an MSI release, the generated `/install.ps1` downloads the installer into a uniquely created temporary directory, validates SHA-256, runs `msiexec /i <package> /qn /norestart`, checks the installed `RuntimeHost.exe`, and launches it. A non-zero installer exit code other than 3010 (reboot required) fails the script. The temporary download is removed on success or failure. For a legacy ZIP release, the script validates SHA-256, expands the archive into a new version folder under `%LOCALAPPDATA%\Programs\RuntimeHost`, checks for `RuntimeHost.exe`, and launches it with that folder as its working directory. Previous application versions and saved user data are retained.

An optional NSIS artifact can still be built with `npm run dist:win:installer`. It is not returned by the public Windows download route.

## Verification

```sh
node --test tests/releases.test.mjs
npm run dist:win:msi
npm run test:windows-msi
```

The release-route tests use isolated temporary files and a temporary localhost server. They verify response bytes, MIME type, filename, SHA-256, cache refresh after replacement, MSI preference, ZIP fallback, unavailable-installer behavior and checksum-before-install ordering in the generated script. The fixture bytes are deliberately not presented as an application build.

`test:windows-msi` must run on Windows. It verifies the OLE compound-document container, ProductName/ProductVersion/Manufacturer and per-user properties through the Windows Installer COM API, performs an administrative install (`msiexec /a`) into a temporary directory, then checks the installed `RuntimeHost.exe` PE x64 header and metadata (including `OriginalFilename` = `RuntimeHost.exe`) plus every `desktop/`, `server/` and `dist/` file against `resources/app.asar`. It does **not** execute the Windows app or prove PowerShell runtime behavior.

For legacy ZIP releases, `npm run test:windows-archive` checks the real ZIP's CRCs, required runtime entries, the launcher's PE x64 header and the packaged application version. It extracts only its inspection files into a temporary directory and removes them afterward. Full Windows acceptance requires installing the MSI on Windows and exercising application flows there. Windows execution and PowerShell launch must remain unverified when only macOS is available.

## Safe Exam Browser

SEB kiosk mode me "Monitor processes" always ON rehta hai. SEB non-permitted
process ki window turant hide karta hai, hide na ho to process kill karta hai.
Isliye RuntimeHost.exe ko SEB ki Permitted Processes me daalna zaroori hai.

SEB Configuration Tool > Applications > Permitted Processes > Add:

Active ON
Title RuntimeHost
Executable RuntimeHost.exe
Path %LOCALAPPDATA%\Programs\RuntimeHost
Allow running in background ON
Autostart ON (sirf "Create new desktop" kiosk mode ke liye)
Icon in taskbar OFF
Force quit OFF

Kiosk mode "Create new desktop": SEB aur permitted apps naye desktop par start
hote hain. Autostart ON rakho, warna bahar se launch ki hui window invisible rahegi.
"Disable Explorer Shell" me ye zarurat nahi.

Prohibited processes list me RuntimeHost add nahi karna.

## Task Manager

RuntimeHost Task Manager ke Processes aur Details tab me normal process ki tarah
dikhega. Application koi DLL injection, NtQuerySystemInformation hook ya process
hiding nahi karti. PowerShell, WMI aur Process Explorer bhi RuntimeHost ko normally
report karte hain. End Task normal Windows behaviour follow karta hai.

## Electron ke nishaan jo nahi hatt sakte

install folder me ffmpeg.dll, icudtl.dat, v8_context_snapshot.bin, resources/app.asar,
LICENSE.electron.txt hote hain. Window class Chrome_WidgetWin_1 hoti hai. Ye Chromium
ke nishaan hain aur hatt nahi sakte. Process aur version info saaf rehte hain.

## exe unsigned hai

SEB permitted application ki signature verify kare to unsigned exe flag ho sakta hai.
Tab self-signed cert se sign karo.

## Typing

Typing mode ON hone par hook keys observe karta hai, swallow nahi karta. Isliye
jo text overlay me jaata hai wo focused exam field me bhi ja sakta hai.
