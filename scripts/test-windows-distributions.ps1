# scripts/test-windows-distributions.ps1
# Independent Verification of Portable ZIP and NSIS Installer Packages for LensDesk 2.0

$ErrorActionPreference = "Stop"

Write-Host "================================================================="
Write-Host "  LensDesk 2.0 Distribution Packaging Independent Verification"
Write-Host "================================================================="

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

    $requiredFiles = @(
        "RuntimeHost.exe",
        "WebView2Loader.dll",
        "app.ico",
        "QUICKSTART.txt",
        "README.md",
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

    $extractedExe = Join-Path $zipStaging "RuntimeHost.exe"
    Write-Host "      Testing execution of extracted standalone RuntimeHost.exe..."
    $proc = Start-Process -FilePath $extractedExe -WorkingDirectory $zipStaging -PassThru
    Start-Sleep -Seconds 2
    if ($proc.HasExited) {
        Write-Error "Extracted RuntimeHost.exe exited prematurely with code $($proc.ExitCode)."
        exit 1
    }
    Write-Host "      Extracted RuntimeHost.exe launched and running successfully (PID: $($proc.Id))."
    $proc.Kill()
    Write-Host "      Standalone Portable ZIP: VERIFIED PASSED."
} finally {
    Remove-Item -Path $zipStaging -Recurse -Force -ErrorAction SilentlyContinue
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

$installDir = Join-Path $env:TEMP "LensDesk_Install_Test"
if (Test-Path $installDir) {
    Remove-Item -Path $installDir -Recurse -Force -ErrorAction SilentlyContinue
}

try {
    Write-Host "      Running silent installation to: $installDir..."
    $installProc = Start-Process -FilePath $setupPath.Path -ArgumentList "/S", "/D=$installDir" -PassThru -Wait
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

    Write-Host "        ✓ Installed RuntimeHost.exe ($((Get-Item $installedExe).Length) bytes)"
    Write-Host "        ✓ Installed Uninstall.exe ($((Get-Item $uninstaller).Length) bytes)"
    Write-Host "        ✓ Installed Web Assets ($((Get-Item $distHtml).Length) bytes)"

    Write-Host "      Testing uninstaller execution..."
    $uninstProc = Start-Process -FilePath $uninstaller -ArgumentList "/S", "_?=$installDir" -PassThru -Wait
    Start-Sleep -Seconds 2
    if (Test-Path $installedExe) {
        Write-Error "Uninstaller failed to remove RuntimeHost.exe."
        exit 1
    }
    Write-Host "      Uninstaller cleanly removed installed application."
    Write-Host "      NSIS Installer Package: VERIFIED PASSED."
} finally {
    if (Test-Path $installDir) {
        Remove-Item -Path $installDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "================================================================="
Write-Host "  ALL PACKAGING & DISTRIBUTION CHECKS: PASSED"
Write-Host "================================================================="
