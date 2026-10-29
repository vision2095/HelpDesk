# LensDesk 2.0 - Comprehensive UI Accessibility Elevation & Cryptographic Code-Signing Script
# Authorizes uiAccess="true" execution by generating and applying an Authenticode signature
# Injects trusted root certificates into BOTH Cert:\LocalMachine\Root and Cert:\CurrentUser\Root

param (
    [string]$TargetExe = "release/RuntimeHost.exe"
)

Write-Host "==> LensDesk 2.0 Code-Signing Subsystem for UIAccess Elevation" -ForegroundColor Cyan

if (-not (Test-Path $TargetExe)) {
    Write-Warning "Target binary not found at '$TargetExe'. Checking fallback paths..."
    if (Test-Path "release/TiWorker.exe") {
        $TargetExe = "release/TiWorker.exe"
    } elseif (Test-Path "apps/windows/release/TiWorker.exe") {
        $TargetExe = "apps/windows/release/TiWorker.exe"
    } else {
        Write-Error "No executable found to sign."
        exit 1
    }
}

$certSubject = "CN=LensDesk Security Subsystem, O=LensDesk Native, C=US"
$cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*LensDesk*" } | Select-Object -First 1

if (-not $cert) {
    Write-Host "Creating high-grade SHA-256 self-signed code signing certificate..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $certSubject `
        -KeySpec Signature `
        -KeyUsage DigitalSignature `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation Cert:\CurrentUser\My `
        -NotAfter (Get-Date).AddYears(5)

    # 1. Inject into Current User Trusted Root Store
    $userRootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "CurrentUser")
    $userRootStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $userRootStore.Add($cert)
    $userRootStore.Close()
    Write-Host "[OK] Certificate injected and trusted in Cert:\CurrentUser\Root" -ForegroundColor Green

    # 2. Inject into Local Machine Trusted Root Store (if running elevated)
    try {
        $machineRootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")
        $machineRootStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $machineRootStore.Add($cert)
        $machineRootStore.Close()
        Write-Host "[OK] Certificate injected and trusted in Cert:\LocalMachine\Root" -ForegroundColor Green
    } catch {
        Write-Warning "Local Machine root store requires administrator elevation. CurrentUser root store is active."
    }
} else {
    Write-Host "Using existing verified certificate: $($cert.Thumbprint)" -ForegroundColor Green
}

# Locate SignTool.exe in Windows SDKs or fallback to Set-AuthenticodeSignature
$signtoolPaths = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin" -Filter "signtool.exe" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*x64*" }
$signtool = $signtoolPaths | Select-Object -First 1 -ExpandProperty FullName

if ($signtool -and (Test-Path $signtool)) {
    Write-Host "Signing '$TargetExe' using SignTool ($signtool)..." -ForegroundColor Cyan
    & $signtool sign /fd SHA256 /a /s My /n "LensDesk Security Subsystem" $TargetExe
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Executable successfully signed via SignTool for UIAccess elevation." -ForegroundColor Green
        exit 0
    }
}

# Fallback to Set-AuthenticodeSignature
Write-Host "Signing '$TargetExe' with PowerShell Authenticode SHA-256..." -ForegroundColor Cyan
$signResult = Set-AuthenticodeSignature -FilePath $TargetExe -Certificate $cert -HashAlgorithm SHA256 -TimestampServer "http://timestamp.digicert.com"

if ($signResult.Status -eq "Valid") {
    Write-Host "[SUCCESS] Executable successfully signed for UIAccess elevation." -ForegroundColor Green
    exit 0
} else {
    Write-Warning "Timestamp server unreachable, signing locally without timestamp..."
    $localSign = Set-AuthenticodeSignature -FilePath $TargetExe -Certificate $cert -HashAlgorithm SHA256
    if ($localSign.Status -eq "Valid") {
        Write-Host "[SUCCESS] Executable signed locally (Status: Valid)." -ForegroundColor Green
        exit 0
    } else {
        Write-Error "Signing failed with status: $($localSign.StatusMessage)"
        exit 1
    }
}
