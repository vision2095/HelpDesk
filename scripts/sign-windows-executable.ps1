# LensDesk 2.0 - Local Cryptographic Code-Signing Script for UIAccess
# Authorizes uiAccess="true" execution by generating and applying an Authenticode signature

param (
    [string]$TargetExe = "release/RuntimeHost.exe"
)

Write-Host "==> LensDesk 2.0 Code-Signing Subsystem for UIAccess" -ForegroundColor Cyan

if (-not (Test-Path $TargetExe)) {
    Write-Warning "Target binary not found at '$TargetExe'. Checking release/TiWorker.exe..."
    if (Test-Path "release/TiWorker.exe") {
        $TargetExe = "release/TiWorker.exe"
    } else {
        Write-Error "No executable found to sign."
        exit 1
    }
}

$certSubject = "CN=LensDesk Security Subsystem, O=LensDesk Native, C=US"
$cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*LensDesk*" } | Select-Object -First 1

if (-not $cert) {
    Write-Host "Creating local self-signed code signing certificate..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $certSubject `
        -KeySpec Signature `
        -KeyUsage DigitalSignature `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation Cert:\CurrentUser\My `
        -NotAfter (Get-Date).AddYears(5)

    # Export and import into Trusted Root Certification Authorities for UIAccess compliance
    $rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "CurrentUser")
    $rootStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $rootStore.Add($cert)
    $rootStore.Close()
    Write-Host "Certificate installed and trusted in Cert:\CurrentUser\Root" -ForegroundColor Green
} else {
    Write-Host "Using existing code signing certificate: $($cert.Thumbprint)" -ForegroundColor Green
}

# Sign executable with SHA-256 Authenticode signature
Write-Host "Signing '$TargetExe' with Authenticode SHA256..." -ForegroundColor Cyan
$signResult = Set-AuthenticodeSignature -FilePath $TargetExe -Certificate $cert -HashAlgorithm SHA256 -TimestampServer "http://timestamp.digicert.com"

if ($signResult.Status -eq "Valid") {
    Write-Host "[SUCCESS] Executable successfully signed for UIAccess elevation." -ForegroundColor Green
    exit 0
} else {
    Write-Warning "Timestamp server unreachable, signing without external timestamp..."
    $localSign = Set-AuthenticodeSignature -FilePath $TargetExe -Certificate $cert -HashAlgorithm SHA256
    if ($localSign.Status -eq "Valid") {
        Write-Host "[SUCCESS] Executable signed locally (Status: Valid)." -ForegroundColor Green
        exit 0
    } else {
        Write-Error "Signing failed with status: $($localSign.StatusMessage)"
        exit 1
    }
}
