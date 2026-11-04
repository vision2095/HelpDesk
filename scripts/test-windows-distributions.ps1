# scripts/test-windows-distributions.ps1
# Independent Verification of Portable ZIP and NSIS Installer Packages for LensDesk 2.0

$ErrorActionPreference = "Stop"

Write-Host "================================================================="
Write-Host "  LensDesk 2.0 Distribution Packaging Independent Verification"
Write-Host "================================================================="

# Both the application and installer write to the current user profile. The
# installer and uninstaller also mutate fixed registry and shortcut paths.
# Never run them in a normal user account, even when preflight finds no state.
if ($env:LENSDESK_DISPOSABLE_WINDOWS_USER -cne '1') {
    throw 'Set LENSDESK_DISPOSABLE_WINDOWS_USER=1 only in a dedicated, disposable Windows user profile before running distribution tests.'
}

# The installer writes per-user shortcuts and registry entries even when /D
# points elsewhere. Refuse to disturb an existing installation or shortcuts.
$existingState = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LensDesk",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\RuntimeHost.exe",
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'LensDesk.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'LensDesk')
)
foreach ($item in $existingState) {
    if (Test-Path -LiteralPath $item) {
        throw "Distribution test requires an isolated Windows user; existing LensDesk state found at $item"
    }
}

# 1. Test Portable ZIP Package
Write-Host "[1/2] Verifying Standalone Portable ZIP Package..."
$zipPath = Resolve-Path "release/LensDesk-2.0.0-Windows-x64.zip" -ErrorAction SilentlyContinue
if (-not $zipPath -or -not (Test-Path $zipPath)) {
    Write-Error "Portable ZIP not found at release/LensDesk-2.0.0-Windows-x64.zip"
    exit 1
}

$zipSize = (Get-Item $zipPath).Length
Write-Host "      Found ZIP: $($zipPath.Path) ($([Math]::Round($zipSize / 1KB, 2)) KB)"

$zipStaging = Join-Path $env:TEMP "LensDesk_Zip_Test_$([System.Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $zipStaging -Force | Out-Null

try {
    Expand-Archive -Path $zipPath -DestinationPath $zipStaging -Force
    Write-Host "      Extracted successfully to staging directory."

    $exeName = "RuntimeHost.exe"
    $forbidden = @('TiWorker.exe','ctfmon.exe','SearchProtocolHost.exe','RuntimeBroker.exe','smartscreen.exe','sihost.exe','SecurityHealthSystray.exe')
    foreach ($name in $forbidden) {
        if (Test-Path (Join-Path $zipStaging $name)) {
            Write-Error "Portable ZIP contains prohibited process-impersonation file: $name"
            exit 1
        }
    }
    $forbiddenElectron = @('node.dll','ffmpeg.dll','libEGL.dll','libGLESv2.dll','resources/app.asar','app-64.7z','icudtl.dat','resources.pak','LICENSE.electron.txt','LICENSES.chromium.html')
    foreach ($name in $forbiddenElectron) {
        if (Test-Path (Join-Path $zipStaging $name)) {
            Write-Error "Portable ZIP contains Electron runtime file: $name"
            exit 1
        }
    }
    $requiredFiles = @(
        $exeName,
        "WebView2Loader.dll",
        "dist/index.html"
    )

    foreach ($file in $requiredFiles) {
        $p = Join-Path $zipStaging $file
        if (-not (Test-Path $p)) {
            Write-Error "Missing required file in portable ZIP: $file"
            exit 1
        }
        $sz = (Get-Item $p).Length
        Write-Host "        ✓ $file ($sz bytes)"
    }

    $extractedExe = Join-Path $zipStaging $exeName
    $portableHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $extractedExe).Hash
    $versionInfo = (Get-Item $extractedExe).VersionInfo
    if ($versionInfo.ProductName -ne "LensDesk 2.0" -or $versionInfo.OriginalFilename -ne "RuntimeHost.exe") {
        Write-Error "Portable RuntimeHost.exe has unexpected product metadata: ProductName='$($versionInfo.ProductName)' OriginalFilename='$($versionInfo.OriginalFilename)'"
        exit 1
    }
    Write-Host "        ✓ Genuine LensDesk metadata (ProductName='$($versionInfo.ProductName)', OriginalFilename='$($versionInfo.OriginalFilename)')"

    Write-Host "      Testing execution of extracted standalone RuntimeHost.exe..."
    $proc = $null
    try {
        $proc = Start-Process -FilePath $extractedExe -WorkingDirectory $zipStaging -PassThru
        Start-Sleep -Seconds 2
        if ($proc.HasExited) {
            throw "Extracted RuntimeHost.exe exited prematurely with code $($proc.ExitCode)."
        }
        Write-Host "      Extracted RuntimeHost.exe launched and running successfully (PID: $($proc.Id))."
    } finally {
        if ($proc -and -not $proc.HasExited) {
            $proc.Kill()
            $proc.WaitForExit()
        }
    }
    Write-Host "      Standalone Portable ZIP: VERIFIED PASSED."
} finally {
    if (Test-Path -LiteralPath $zipStaging) {
        Remove-Item -LiteralPath $zipStaging -Recurse -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $zipStaging) {
        throw "Portable ZIP staging directory remains: $zipStaging"
    }
}

# 2. Test NSIS Windows Installer Package
Write-Host "[2/2] Verifying NSIS Installer Package..."
$setupPath = Resolve-Path "release/LensDesk-2.0.0-Setup.exe" -ErrorAction SilentlyContinue
if (-not $setupPath -or -not (Test-Path $setupPath)) {
    Write-Error "NSIS Setup installer not found at release/LensDesk-2.0.0-Setup.exe"
    exit 1
}

$setupSize = (Get-Item $setupPath).Length
Write-Host "      Found Installer: $($setupPath.Path) ($([Math]::Round($setupSize / 1KB, 2)) KB)"

$installDir = Join-Path $env:TEMP "LensDesk_Install_Test_$([System.Guid]::NewGuid().ToString('N'))"
# Claim the unique directory without overwriting anything already present.
New-Item -ItemType Directory -Path $installDir -ErrorAction Stop | Out-Null

try {
    Write-Host "      Running silent installation to: $installDir..."
    $installProc = Start-Process -FilePath $setupPath.Path -ArgumentList "/S", "/D=$installDir" -PassThru
    $installExited = $installProc.WaitForExit(30000)
    if (-not $installExited) {
        $installProc.Kill()
        $installProc.WaitForExit()
        Write-Error "Installer timed out after 30s."
        exit 1
    }
    if ($installProc.ExitCode -ne 0) {
        Write-Error "Installer exited with non-zero code: $($installProc.ExitCode)"
        exit 1
    }
    Write-Host "      Installation completed with exit code: 0"

    $installedExe = Join-Path $installDir "RuntimeHost.exe"
    $uninstaller = Join-Path $installDir "Uninstall.exe"
    if (-not (Test-Path $uninstaller)) {
        $uninstaller = Join-Path $installDir "uninst.exe"
    }
    $distHtml = Join-Path $installDir "dist\index.html"

    if (-not (Test-Path $installedExe)) { Write-Error "Installed RuntimeHost.exe missing."; exit 1 }
    if (-not (Test-Path $uninstaller)) { Write-Error "Installed Uninstall.exe missing."; exit 1 }
    if (-not (Test-Path $distHtml)) { Write-Error "Installed web assets missing."; exit 1 }

    $installedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installedExe).Hash
    if ($portableHash -ne $installedHash) {
        Write-Error "Installer RuntimeHost.exe does not match the portable ZIP binary."
        exit 1
    }
    Write-Host "        ✓ Installed RuntimeHost.exe ($((Get-Item $installedExe).Length) bytes, sha256=$portableHash)"
    Write-Host "        ✓ Installed Uninstall.exe ($((Get-Item $uninstaller).Length) bytes)"
    Write-Host "        ✓ Installed Web Assets ($((Get-Item $distHtml).Length) bytes)"

    Write-Host "      Testing uninstaller execution..."
    $uninstProc = Start-Process -FilePath $uninstaller -ArgumentList "/S", "_?=$installDir" -PassThru
    $uninstExited = $uninstProc.WaitForExit(20000)
    if (-not $uninstExited) {
        Write-Warning "Uninstaller process did not finish within 20s; stopping process."
        $uninstProc.Kill()
        $uninstProc.WaitForExit()
        throw "Uninstaller timed out after 20s."
    }
    if ($uninstProc.ExitCode -ne 0) {
        throw "Uninstaller exited with non-zero code: $($uninstProc.ExitCode)"
    }
    # Poll up to 15 seconds for uninstaller background worker to finish deleting files
    $removed = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        if (-not (Test-Path $installedExe)) {
            $removed = $true
            break
        }
    }
    if (-not $removed) {
        Write-Error "Uninstaller failed to remove RuntimeHost.exe."
        exit 1
    }
    Write-Host "      Uninstaller cleanly removed installed application."
} finally {
    # Only remove shared state that still identifies this unique test directory.
    # A concurrently created installation or shortcut must never be removed.
    $shell = $null
    $removedOwnedProgramShortcut = $false
    $cleanupErrors = [System.Collections.Generic.List[string]]::new()
    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcutTargets = @{
            (Join-Path ([Environment]::GetFolderPath('Desktop')) 'LensDesk.lnk') = (Join-Path $installDir 'RuntimeHost.exe')
            (Join-Path ([Environment]::GetFolderPath('Programs')) 'LensDesk\LensDesk.lnk') = (Join-Path $installDir 'RuntimeHost.exe')
            (Join-Path ([Environment]::GetFolderPath('Programs')) 'LensDesk\Uninstall.lnk') = (Join-Path $installDir 'Uninstall.exe')
            (Join-Path ([Environment]::GetFolderPath('Programs')) 'LensDesk\Website.lnk') = (Join-Path $installDir 'LensDesk.url')
        }
        foreach ($shortcut in $shortcutTargets.Keys) {
            if (Test-Path -LiteralPath $shortcut) {
                $target = $shell.CreateShortcut($shortcut).TargetPath
                if ([string]::Equals($target, $shortcutTargets[$shortcut], [StringComparison]::OrdinalIgnoreCase)) {
                    Remove-Item -LiteralPath $shortcut -Force
                    if ([string]::Equals((Split-Path -Parent $shortcut), (Join-Path ([Environment]::GetFolderPath('Programs')) 'LensDesk'), [StringComparison]::OrdinalIgnoreCase)) {
                        $removedOwnedProgramShortcut = $true
                    }
                } else {
                    Write-Warning "Preserving shortcut with unexpected target: $shortcut"
                }
            }
        }
    } catch {
        $cleanupErrors.Add("Could not clean test shortcuts: $_")
    }
    try {
    $programDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'LensDesk'
    if ($removedOwnedProgramShortcut -and (Test-Path -LiteralPath $programDir) -and @(Get-ChildItem -LiteralPath $programDir -Force).Count -eq 0) {
        Remove-Item -LiteralPath $programDir -Force
    }
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LensDesk'
    $appPathKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\RuntimeHost.exe'
    if (Test-Path -LiteralPath $uninstallKey) {
        $entry = Get-ItemProperty -LiteralPath $uninstallKey
        if ([string]::Equals($entry.UninstallString, (Join-Path $installDir 'Uninstall.exe'), [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $uninstallKey -Force
        } else { Write-Warning "Preserving uninstall registry key with unexpected or missing path." }
    }
    if (Test-Path -LiteralPath $appPathKey) {
        $entry = Get-Item -LiteralPath $appPathKey
        if ([string]::Equals($entry.GetValue(''), (Join-Path $installDir 'RuntimeHost.exe'), [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $appPathKey -Force
        } else { Write-Warning "Preserving app-path registry key with unexpected or missing path." }
    }
    } catch {
        $cleanupErrors.Add("Could not clean all owned test state: $_")
    } finally {
        try {
            if (Test-Path -LiteralPath $installDir) {
                Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction Stop
            }
        } catch { $cleanupErrors.Add("Could not remove test directory: $_") }
    }
    try {
        if (Test-Path -LiteralPath $installDir) { $cleanupErrors.Add("Test directory remains: $installDir") }
        if ($shell -and $shortcutTargets) {
            foreach ($shortcut in $shortcutTargets.Keys) {
                if ((Test-Path -LiteralPath $shortcut) -and
                    [string]::Equals($shell.CreateShortcut($shortcut).TargetPath, $shortcutTargets[$shortcut], [StringComparison]::OrdinalIgnoreCase)) {
                    $cleanupErrors.Add("Test shortcut remains: $shortcut")
                }
            }
        }
        if ((Test-Path -LiteralPath $uninstallKey) -and
            [string]::Equals((Get-ItemProperty -LiteralPath $uninstallKey).UninstallString, (Join-Path $installDir 'Uninstall.exe'), [StringComparison]::OrdinalIgnoreCase)) {
            $cleanupErrors.Add("Test uninstall registry key remains: $uninstallKey")
        }
        if ((Test-Path -LiteralPath $appPathKey) -and
            [string]::Equals((Get-Item -LiteralPath $appPathKey).GetValue(''), (Join-Path $installDir 'RuntimeHost.exe'), [StringComparison]::OrdinalIgnoreCase)) {
            $cleanupErrors.Add("Test app-path registry key remains: $appPathKey")
        }
    } catch { $cleanupErrors.Add("Could not verify test cleanup: $_") }
    if ($cleanupErrors.Count -gt 0) { throw ($cleanupErrors -join "; ") }
}

Write-Host "      NSIS Installer Package: VERIFIED PASSED."
Write-Host "================================================================="
Write-Host "  ALL PACKAGING & DISTRIBUTION CHECKS: PASSED"
Write-Host "================================================================="
