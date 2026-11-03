# Build the nested Windows native target without creating or replacing releases.
$ErrorActionPreference = "Stop"
$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$NativeSource = Join-Path $WorkspaceRoot "apps\windows\src-native"
$BuildDir = Join-Path $WorkspaceRoot "apps\windows\build-native"
$Cmake = Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $Cmake) {
    throw "CMake was not found on PATH. Install Visual Studio Build Tools with C++ CMake tools and add CMake to PATH."
}

Push-Location $WorkspaceRoot
try {
    Write-Host "Building frontend assets..."
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed ($LASTEXITCODE)." }

    Write-Host "Configuring nested native Windows target..."
    & $Cmake.Source -S $NativeSource -B $BuildDir -A x64
    if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed ($LASTEXITCODE)." }

    Write-Host "Compiling RuntimeHost..."
    & $Cmake.Source --build $BuildDir --config Release --target RuntimeHost
    if ($LASTEXITCODE -ne 0) { throw "Native compilation failed ($LASTEXITCODE)." }

    Write-Host "Native build completed: $BuildDir\bin\Release\RuntimeHost.exe"
} finally {
    Pop-Location
}
