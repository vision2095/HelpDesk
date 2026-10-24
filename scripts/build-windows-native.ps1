# LensDesk 2.0 Native Windows Rebuild Script
# Builds genuine C++20 Win32 + Direct3D 11 + DirectComposition + Dear ImGui + WebView2 application

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  LensDesk 2.0 Windows Native Rebuild (C++20 Host)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$WorkspaceRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $WorkspaceRoot

# 1. Build React 19 Frontend Web Assets
Write-Host "`n[Step 1/4] Building React 19 Frontend (Vite)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Frontend build failed."
    exit 1
}

# 2. Configure CMake for Native C++20 Host
Write-Host "`n[Step 2/4] Configuring Native C++20 Host with CMake..." -ForegroundColor Yellow
$BuildDir = Join-Path $WorkspaceRoot "build-native"
if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

cmake -S src-native -B build-native -A x64
if ($LASTEXITCODE -ne 0) {
    Write-Error "CMake configuration failed."
    exit 1
}

# 3. Compile Native Windows Host (MSVC x64)
Write-Host "`n[Step 3/4] Compiling RuntimeHost.exe (MSVC Release x64)..." -ForegroundColor Yellow
cmake --build build-native --config Release --target RuntimeHost
if ($LASTEXITCODE -ne 0) {
    Write-Error "Compilation failed."
    exit 1
}

# 4. Packaging Release Artifacts
Write-Host "`n[Step 4/4] Packaging Release Artifacts..." -ForegroundColor Yellow
$ReleaseDir = Join-Path $WorkspaceRoot "release"
if (-not (Test-Path $ReleaseDir)) {
    New-Item -ItemType Directory -Path $ReleaseDir | Out-Null
}

$OutputDir = Join-Path $BuildDir "bin\Release"
if (-not (Test-Path (Join-Path $OutputDir "RuntimeHost.exe"))) {
    $OutputDir = Join-Path $BuildDir "Release"
}
$ExePath = Join-Path $OutputDir "RuntimeHost.exe"
$LoaderDll = Join-Path $WorkspaceRoot "src-native\third_party\webview2\lib\x64\WebView2Loader.dll"
$DistDir = Join-Path $WorkspaceRoot "dist"

$ZipStaging = Join-Path $ReleaseDir "LensDesk-2.0.0-Windows-x64"
if (Test-Path $ZipStaging) {
    Remove-Item -Recurse -Force $ZipStaging
}
New-Item -ItemType Directory -Path $ZipStaging | Out-Null

Copy-Item $ExePath $ZipStaging
Copy-Item $LoaderDll $ZipStaging
Copy-Item -Recurse $DistDir (Join-Path $ZipStaging "dist")

$ZipPath = Join-Path $ReleaseDir "LensDesk-2.0.0-Windows-x64.zip"
if (Test-Path $ZipPath) {
    Remove-Item -Force $ZipPath
}

Compress-Archive -Path "$ZipStaging\*" -DestinationPath $ZipPath -CompressionLevel Optimal
Write-Host "Created Standalone Archive: $ZipPath" -ForegroundColor Green

# 5. Build NSIS Installer if makensis is available
$Makensis = Get-Command makensis -ErrorAction SilentlyContinue
if ($Makensis) {
    Write-Host "`nBuilding NSIS Installer..." -ForegroundColor Yellow
    & makensis "$WorkspaceRoot\installer\installer.nsi"
    Write-Host "Installer built successfully." -ForegroundColor Green
} else {
    Write-Host "`nNote: makensis not found on PATH. Skipping installer compilation (standalone zip is ready)." -ForegroundColor Gray
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  LensDesk 2.0 Windows Native Build Completed Successfully!" -ForegroundColor Green
Write-Host "  Binary: RuntimeHost.exe (C++20, Direct3D 11, ImGui, WebView2)" -ForegroundColor Green
Write-Host "  Zero Electron runtime dependencies." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
