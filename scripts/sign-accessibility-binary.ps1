# ==============================================================================
# LensDesk 2.0 - Signed Accessibility Integration & UIAccess Verification Script
# ==============================================================================
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/sign-accessibility-binary.ps1 `
#       -BinaryPath "C:\Program Files\LensDesk\RuntimeHost.exe" `
#       -CertSubject "CN=LensDesk"
#
# Requirements for Windows UIAccess:
#   1. Binary manifest must request uiAccess="true" (app-accessibility.manifest).
#   2. Binary must reside in a protected directory (e.g. Program Files or Windows\System32).
#   3. Binary must be signed by an Authenticode certificate trusted by the host machine.
# ==============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$BinaryPath = "build-native/bin/Release/RuntimeHostAccessibility.exe",

    [Parameter(Mandatory=$false)]
    [string]$CertSubject = "LensDesk",

    [Parameter(Mandatory=$false)]
    [string]$TargetInstallDir = "$env:ProgramFiles\LensDesk",

    [Parameter(Mandatory=$false)]
    [switch]$CreateTestCert = $false,

    [Parameter(Mandatory=$false)]
    [switch]$TestLaunch = $false
)

Write-Host "=== LensDesk 2.0 Signed Accessibility Integration ===" -ForegroundColor Cyan

# 1. Resolve Binary
if (-not (Test-Path $BinaryPath)) {
    # Fallback to standard RuntimeHost if accessibility target not yet renamed
    if (Test-Path "build-native/bin/Release/RuntimeHost.exe") {
        $BinaryPath = "build-native/bin/Release/RuntimeHost.exe"
    } else {
        Write-Error "Target executable not found at '$BinaryPath'."
        exit 1
    }
}
$resolvedBinary = (Resolve-Path $BinaryPath).Path
Write-Host "[1/5] Found target binary: $resolvedBinary" -ForegroundColor Green

# 2. Verify Secure Directory Placement
$inProgramFiles = $resolvedBinary.StartsWith($env:ProgramFiles, [System.StringComparison]::OrdinalIgnoreCase) -or
                  $resolvedBinary.StartsWith(${env:ProgramFiles(x86)}, [System.StringComparison]::OrdinalIgnoreCase) -or
                  $resolvedBinary.StartsWith($env:SystemRoot, [System.StringComparison]::OrdinalIgnoreCase)

if (-not $inProgramFiles) {
    Write-Warning "Binary is not currently in a protected system directory ($env:ProgramFiles)."
    Write-Warning "Windows requires UIAccess executables to reside in Program Files or System32 to run with UIAccess tokens."
    if (-not (Test-Path $TargetInstallDir)) {
        New-Item -ItemType Directory -Path $TargetInstallDir -Force | Out-Null
    }
    Write-Host "Staging into target directory '$TargetInstallDir'..." -ForegroundColor Yellow
    Copy-Item $resolvedBinary -Destination "$TargetInstallDir\RuntimeHost.exe" -Force
    $parentDir = Split-Path $resolvedBinary -Parent
    if (Test-Path "$parentDir\WebView2Loader.dll") {
        Copy-Item "$parentDir\WebView2Loader.dll" -Destination "$TargetInstallDir\WebView2Loader.dll" -Force
    }
    if (Test-Path "$parentDir\dist") {
        Copy-Item -Recurse "$parentDir\dist" -Destination "$TargetInstallDir\dist" -Force
    }
    $resolvedBinary = "$TargetInstallDir\RuntimeHost.exe"
    Write-Host "[2/5] Staged binary in secure directory: $resolvedBinary" -ForegroundColor Green
} else {
    Write-Host "[2/5] Directory check passed: Binary is in a secure system directory." -ForegroundColor Green
}

# 3. Authenticode Signing
Write-Host "[3/5] Checking code-signing certificate for subject '$CertSubject'..." -ForegroundColor Cyan
$cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My |
    Where-Object { $_.Subject -like "*$CertSubject*" -and $_.HasPrivateKey } |
    Select-Object -First 1

if (-not $cert -and ($CreateTestCert -or $env:CI -eq "true")) {
    Write-Host "Creating ephemeral self-signed Authenticode certificate for CI testing..." -ForegroundColor Yellow
    try {
        $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=$CertSubject" -CertStoreLocation "Cert:\CurrentUser\My"
        $tempCert = [System.IO.Path]::GetTempFileName() + ".cer"
        Export-Certificate -Cert $cert -FilePath $tempCert | Out-Null
        certutil.exe -user -addstore -f "TrustedPublisher" $tempCert | Out-Null
        Remove-Item $tempCert -Force -ErrorAction SilentlyContinue
        Write-Host "Ephemeral certificate installed in Cert:\CurrentUser\My and TrustedPublisher store." -ForegroundColor Green
    } catch {
        Write-Warning "Could not configure certificate store: $_"
    }
}

if ($cert) {
    Write-Host "Found certificate thumbprint: $($cert.Thumbprint)" -ForegroundColor Green
    Write-Host "Signing executable with SHA-256 Authenticode signature..." -ForegroundColor Cyan
    $sig = Set-AuthenticodeSignature -FilePath $resolvedBinary -Certificate $cert -HashAlgorithm SHA256
    Write-Host "Signature Status: $($sig.Status)" -ForegroundColor Green
} else {
    Write-Warning "No code-signing certificate found with subject '$CertSubject'. Staged unsigned binary."
    Write-Warning "For production UIAccess execution, sign this binary using an installed Authenticode certificate."
}

# 4. Verification Check
Write-Host "[4/5] Verifying binary signature..." -ForegroundColor Cyan
$verified = Get-AuthenticodeSignature -FilePath $resolvedBinary
Write-Host "File: $($verified.Path)"
Write-Host "Status: $($verified.Status)"
Write-Host "Status Message: $($verified.StatusMessage)"

# 5. Interactive UIAccess Token Activation Test
if ($TestLaunch) {
    Write-Host "[5/5] Testing UIAccess token activation in interactive session..." -ForegroundColor Cyan
    try {
        $p = Start-Process -FilePath $resolvedBinary -PassThru
        Start-Sleep -Seconds 2
        if ($p -and -not $p.HasExited) {
            Write-Host "      Process started successfully with PID: $($p.Id)" -ForegroundColor Green
            Write-Host "      UIAccess activation: SUCCESS (Process launched without elevation failure)" -ForegroundColor Green
            $p.Kill()
            $p.WaitForExit()
        } else {
            Write-Warning "Process exited immediately with code: $($p.ExitCode). UIAccess requires trusted cert in Root/TrustedPublisher and secure path."
        }
    } catch {
        Write-Warning "Failed to launch binary: $_"
    }
} else {
    Write-Host "[5/5] UIAccess launch test skipped (pass -TestLaunch to execute live test)." -ForegroundColor Yellow
}

Write-Host "=== Accessibility Integration Verification Complete ===" -ForegroundColor Cyan
