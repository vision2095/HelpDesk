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

$Cmake = (Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $Cmake) {
    $CmakeCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\18\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"),
        (Join-Path ${env:ProgramFiles} "Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe")
    )
    $Cmake = $CmakeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Cmake) {
    Write-Error "CMake was not found. Install Visual Studio Build Tools with the C++ CMake tools component."
    exit 1
}

& $Cmake -S src-native -B build-native -A x64
if ($LASTEXITCODE -ne 0) {
    Write-Error "CMake configuration failed."
    exit 1
}

# 3. Compile Native Windows Host (MSVC x64)
Write-Host "`n[Step 3/4] Compiling RuntimeHost.exe (MSVC Release x64)..." -ForegroundColor Yellow
& $Cmake --build build-native --config Release --target RuntimeHost
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

# Keep the runtime dist synchronized with the freshly built frontend and remove
# stale assets left by earlier Vite builds.
$OutputDist = Join-Path $OutputDir "dist"
if (Test-Path $OutputDist) {
    Remove-Item -Recurse -Force $OutputDist
}
Copy-Item -Recurse $DistDir $OutputDist

$ZipStaging = Join-Path $ReleaseDir "LensDesk-2.0.0-Windows-x64"
if (Test-Path $ZipStaging) {
    Remove-Item -Recurse -Force $ZipStaging
}
New-Item -ItemType Directory -Path $ZipStaging | Out-Null

Copy-Item $ExePath $ZipStaging
Copy-Item $LoaderDll $ZipStaging
Copy-Item -Recurse $DistDir (Join-Path $ZipStaging "dist")
Copy-Item (Join-Path $WorkspaceRoot "README.md") $ZipStaging -ErrorAction SilentlyContinue
Copy-Item (Join-Path $WorkspaceRoot "src-native\resources\app.ico") $ZipStaging -ErrorAction SilentlyContinue

$ZipPath = Join-Path $ReleaseDir "LensDesk-2.0.0-Windows-x64.zip"
if (Test-Path $ZipPath) {
    Remove-Item -Force $ZipPath
}

Compress-Archive -Path "$ZipStaging\*" -DestinationPath $ZipPath -CompressionLevel Optimal
Write-Host "Created Standalone Archive: $ZipPath" -ForegroundColor Green

# 5. Build NSIS Installer if makensis is available
$Makensis = (Get-Command makensis -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $Makensis) {
    $MakensisCandidates = @(
        (Join-Path ${env:ProgramFiles} "NSIS\makensis.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "NSIS\makensis.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\NSIS\makensis.exe"),
        (Join-Path $env:LOCALAPPDATA "NSIS\makensis.exe")
    )
    $Makensis = $MakensisCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ($Makensis) {
    Write-Host "`nBuilding NSIS Installer..." -ForegroundColor Yellow
    if (-not (Test-Path $ReleaseDir)) {
        New-Item -ItemType Directory -Path $ReleaseDir | Out-Null
    }
    & $Makensis "$WorkspaceRoot\installer\installer.nsi"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "NSIS installer compilation failed."
        exit 1
    }
    Write-Host "Installer built successfully." -ForegroundColor Green
} else {
    Write-Host "`nNote: makensis not found. Install NSIS 3.x or put makensis.exe on PATH to build the installer; the standalone zip is ready." -ForegroundColor Gray
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  LensDesk 2.0 Windows Native Build Completed Successfully!" -ForegroundColor Green
Write-Host "  Binary: RuntimeHost.exe (C++20, Direct3D 11, ImGui, WebView2)" -ForegroundColor Green
Write-Host "  Zero Electron runtime dependencies." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
