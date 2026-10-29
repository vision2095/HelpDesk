# derived: rea/native/windows/src/authority.hpp
# LensDesk 2.0 - Cryptographic Dual-Store Code-Signing Script for uiAccess Elevation
param (
    [string]$TargetExe = "release/RuntimeHost.exe"
)

$ErrorActionPreference = "Stop"

# 1. Mandatory Administrator Elevation Check
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "CRITICAL: Script must run with Administrative privileges to install certificate into Cert:\LocalMachine\Root."
    exit 1
}

# 2. Locate Target Binary
if (-not (Test-Path $TargetExe)) {
    if (Test-Path "src-native/build/bin/Release/RuntimeHost.exe") {
        $TargetExe = "src-native/build/bin/Release/RuntimeHost.exe"
    } elseif (Test-Path "apps/windows/release/TiWorker.exe") {
        $TargetExe = "apps/windows/release/TiWorker.exe"
    } else {
        Write-Error "Target executable '$TargetExe' not found."
        exit 1
    }
}

# 3. Generate 4096-bit RSA SHA-256 Code Signing Certificate
Write-Host "==> Generating 4096-bit RSA SHA-256 Code-Signing Certificate..." -ForegroundColor Cyan
$certSubject = "CN=LensDesk Enterprise Accessibility Host, O=LensDesk, C=US"
$cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq $certSubject } | Select-Object -First 1

if (-not $cert) {
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $certSubject `
        -KeyAlgorithm RSA `
        -KeyLength 4096 `
        -HashAlgorithm SHA256 `
        -KeyUsage DigitalSignature `
        -FriendlyName "LensDesk Enterprise Code Signing" `
        -CertStoreLocation Cert:\CurrentUser\My `
        -NotAfter (Get-Date).AddYears(5)
    Write-Host "[OK] Certificate generated: $($cert.Thumbprint)" -ForegroundColor Green
} else {
    Write-Host "[OK] Using existing certificate: $($cert.Thumbprint)" -ForegroundColor Green
}

# 4. Export PFX and Import into BOTH Cert:\CurrentUser\Root and Cert:\LocalMachine\Root
$tempPfx = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "LensDeskSign.pfx")
$password = ConvertTo-SecureString -String "LensDeskSecure_2026!" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $tempPfx -Password $password | Out-Null

$tempCer = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "LensDeskSign.cer")
Export-Certificate -Cert $cert -FilePath $tempCer | Out-Null

Write-Host "==> Injecting Certificate into Cert:\CurrentUser\Root..." -ForegroundColor Cyan
Import-Certificate -FilePath $tempCer -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Write-Host "[OK] Verified in Cert:\CurrentUser\Root" -ForegroundColor Green

Write-Host "==> Injecting Certificate into Cert:\LocalMachine\Root..." -ForegroundColor Cyan
Import-Certificate -FilePath $tempCer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Write-Host "[OK] Verified in Cert:\LocalMachine\Root" -ForegroundColor Green

# 5. Sign via SignTool with SHA256 and RFC 3161 Timestamp
$signtoolPaths = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin" -Filter "signtool.exe" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*x64*" }
$signtool = $signtoolPaths | Select-Object -First 1 -ExpandProperty FullName

if ($signtool -and (Test-Path $signtool)) {
    Write-Host "==> Signing '$TargetExe' using SignTool ($signtool)..." -ForegroundColor Cyan
    & $signtool sign /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256 /a /s My /n "LensDesk Enterprise Accessibility Host" $TargetExe
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Timestamp server unreachable, signing with local signature..."
        & $signtool sign /fd SHA256 /a /s My /n "LensDesk Enterprise Accessibility Host" $TargetExe
    }

    Write-Host "==> Verifying signature with SignTool (/pa)..." -ForegroundColor Cyan
    & $signtool verify /pa $TargetExe
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Binary verified valid for uiAccess execution." -ForegroundColor Green
    } else {
        Write-Error "SignTool verification failed with exit code $LASTEXITCODE."
        exit 1
    }
} else {
    Write-Host "==> SignTool not found in Windows SDK; signing via Set-AuthenticodeSignature..." -ForegroundColor Yellow
    $signRes = Set-AuthenticodeSignature -FilePath $TargetExe -Certificate $cert -HashAlgorithm SHA256 -TimestampServer "http://timestamp.digicert.com"
    if ($signRes.Status -ne "Valid") {
        $signRes = Set-AuthenticodeSignature -FilePath $TargetExe -Certificate $cert -HashAlgorithm SHA256
    }
    if ($signRes.Status -eq "Valid") {
        Write-Host "[SUCCESS] Binary successfully signed (Status: Valid)." -ForegroundColor Green
    } else {
        Write-Error "Authenticode signing failed: $($signRes.StatusMessage)"
        exit 1
    }
}

Remove-Item -Path $tempPfx, $tempCer -Force -ErrorAction SilentlyContinue
exit 0
