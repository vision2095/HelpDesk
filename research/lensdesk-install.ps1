# ============================================================
#  LensDesk Installer
#  Usage:  irm https://lensdesk.com/install.ps1 | iex
#  Auto-elevates to Administrator, then installs to C:\LensDesk-Application
#
#  NOTE: this file is intentionally pure ASCII. All box-drawing /
#  block glyphs are built at runtime from [char] codes so the script
#  renders correctly no matter how it is fetched (irm | iex decodes
#  the response as Latin-1 when the server sends no charset, which
#  would corrupt any literal UTF-8 glyphs stored in the file).
# ============================================================

$ProgressPreference = 'SilentlyContinue'   # hide IWR's slow native progress bar

# Make the console emit UTF-8 (also sets the output code page) so the
# glyphs we build below render as blocks instead of mojibake.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

# Enable modern TLS on older Windows / PowerShell.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 -bor 768 -bor 192
} catch {
    try { [Net.ServicePointManager]::SecurityProtocol = 3072 } catch {}
}

# ------------------------------------------------------------
#  Glyphs (built at runtime -> keeps this file pure ASCII)
# ------------------------------------------------------------
$Script:GBlock = [string][char]0x2588   # full block
$Script:GHrule = [string][char]0x2550   # horizontal double line
$Script:GDot   = [string][char]0x00B7   # middle dot
$Script:GTick  = [string][char]0x2713   # check mark
$Script:GCross = [string][char]0x2717   # ballot X

# ------------------------------------------------------------
#  Console UI helpers
# ------------------------------------------------------------
$Script:UiWidth   = 64
$Script:StepNo    = 0
$Script:StepTotal = 7

# ANSI-Shadow "LENSDESK", stored with ASCII placeholders:
#   # = block   | = vertical   7 = top-right   r = top-left
#   J = bottom-right   L = bottom-left   = = horizontal
$Script:BannerRaw = @(
    '##7     #######7###7   ##7#######7######7  #######7#######7##7  ##7',
    '##|     ##r====J####7  ##|##r====J##r==##7 ##r====J##r====J##| ##rJ',
    '##|     #####7  ##r##7 ##|#######7##|  ##| #####7  #######7####rJ  ',
    '##|     ##r==J  ##|L##7##|L====##|##|  ##| ##r==J  L====##|##r##7  ',
    '#######7#######7##| L####|#######|######rJ #######7#######|##| L##7',
    'L======JL======JL=J  L===JL======JL====J   L======JL======JL=J  L=J'
)

function Convert-BannerLine {
    param([string]$s)
    $s = $s.Replace('#', [string][char]0x2588)  # block
    $s = $s.Replace('|', [string][char]0x2551)  # vertical
    $s = $s.Replace('7', [string][char]0x2557)  # top-right
    $s = $s.Replace('r', [string][char]0x2554)  # top-left
    $s = $s.Replace('J', [string][char]0x255D)  # bottom-right
    $s = $s.Replace('L', [string][char]0x255A)  # bottom-left
    $s = $s.Replace('=', [string][char]0x2550)  # horizontal
    return $s
}
$Script:BannerLines = @($Script:BannerRaw | ForEach-Object { Convert-BannerLine $_ })

function Write-Rule {
    param([ConsoleColor]$Color = [ConsoleColor]::DarkCyan)
    Write-Host ($Script:GHrule * $Script:UiWidth) -ForegroundColor $Color
}

function Write-Centered {
    param([string]$Text, [ConsoleColor]$Color = [ConsoleColor]::Gray)
    $pad = [Math]::Max(0, [int](($Script:UiWidth - $Text.Length) / 2))
    Write-Host ((' ' * $pad) + $Text) -ForegroundColor $Color
}

function Write-Banner {
    Write-Host ''
    foreach ($line in $Script:BannerLines) {
        Write-Host $line -ForegroundColor Cyan
    }
    Write-Host ''
    Write-Rule ([ConsoleColor]::DarkCyan)
    Write-Centered 'LensDesk Desktop Installer' ([ConsoleColor]::White)
    Write-Centered 'Hardware-Accelerated Stealth Overlay' ([ConsoleColor]::DarkGray)
    Write-Rule ([ConsoleColor]::DarkCyan)
    Write-Host ''
}

function Write-Step {
    param([string]$Name)
    $Script:StepNo++
    $tag = "[$($Script:StepNo)/$($Script:StepTotal)]"
    Write-Host -NoNewline "$tag " -ForegroundColor DarkCyan
    Write-Host -NoNewline "$Name " -ForegroundColor White
}

function Write-StepDone {
    param([string]$Extra = '')
    Write-Host -NoNewline "$($Script:GTick) " -ForegroundColor Green
    if ($Extra) { Write-Host $Extra -ForegroundColor DarkGray } else { Write-Host '' }
}

function Write-StepFail {
    param([string]$ErrorMsg)
    Write-Host "$($Script:GCross) FAILED" -ForegroundColor Red
    if ($ErrorMsg) { Write-Host "    $ErrorMsg" -ForegroundColor DarkRed }
}

function Write-StepSkip {
    param([string]$Reason = '')
    Write-Host -NoNewline "$($Script:GDot) skipped" -ForegroundColor DarkYellow
    if ($Reason) { Write-Host " ($Reason)" -ForegroundColor DarkGray } else { Write-Host '' }
}

# ------------------------------------------------------------
#  Resilient downloader: WebClient first, BITS fallback, IWR last
# ------------------------------------------------------------
function Get-RemoteFile {
    param(
        [Parameter(Mandatory=$true)][string]$Uri,
        [Parameter(Mandatory=$true)][string]$OutFile
    )

    if (Test-Path $OutFile) { Remove-Item -Path $OutFile -Force -ErrorAction SilentlyContinue }

    # 1. System.Net.WebClient
    try {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add('User-Agent', 'LensDesk-Installer/2.0')
        $wc.DownloadFile($Uri, $OutFile)
        if ((Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 0)) { return }
    } catch {}

    # 2. Invoke-WebRequest
    try {
        Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec 120
        if ((Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 0)) { return }
    } catch {}

    # 3. Start-BitsTransfer (if service is available)
    try {
        Import-Module BitsTransfer -ErrorAction SilentlyContinue
        Start-BitsTransfer -Source $Uri -Destination $OutFile -ErrorAction Stop
        if ((Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 0)) { return }
    } catch {}

    # 4. curl.exe (present in Windows 10 build 17063+)
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        try {
            & $curl.Source -fsSL -o $OutFile $Uri
            if ((Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 0)) { return }
        } catch {}
    }

    throw "Failed to download $Uri after trying WebClient, IWR, BITS, and curl."
}

function Get-RemoteText {
    param([Parameter(Mandatory=$true)][string]$Uri)
    try {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add('User-Agent', 'LensDesk-Installer/2.0')
        return $wc.DownloadString($Uri)
    } catch {}
    try {
        return (Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 30).Content
    } catch {}
    throw "Failed to fetch text from $Uri"
}

# ------------------------------------------------------------
#  Configuration
# ------------------------------------------------------------
$DownloadUrl = "https://lensdesk.com/api/v1/download/windows"
$InstallUrl  = "https://lensdesk.com/install.ps1"
$FolderName  = "LensDesk-Application"
$ZipFileName = "LensDeskApp.zip"

# ------------------------------------------------------------
#  Auto-elevate to Administrator if needed
# ------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Clear-Host
    Write-Banner
    Write-Host ''
    Write-Centered 'Administrator access is required to install LensDesk.' ([ConsoleColor]::Yellow)
    Write-Centered 'Please approve the Windows prompt that appears . . .'   ([ConsoleColor]::DarkGray)
    Write-Host ''

    $tempScript = Join-Path $env:TEMP "lensdesk_install.ps1"
    try {
        Get-RemoteFile -Uri $InstallUrl -OutFile $tempScript
    } catch {
        $scriptContent = Get-RemoteText -Uri $InstallUrl
        Set-Content -Path $tempScript -Value $scriptContent -Encoding UTF8
    }

    try {
        Start-Process powershell -Verb runAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$tempScript`""
    } catch {
        Write-Centered 'Administrator access was declined. Installation cancelled.' ([ConsoleColor]::Red)
        Write-Host ''
    }
    exit
}

# ------------------------------------------------------------
#  Running as Administrator - install
# ------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Clear-Host
Write-Banner

$InstallPath     = "C:\$FolderName"
$ZipPath         = Join-Path $env:TEMP $ZipFileName
$TempRoot        = Join-Path $env:TEMP "lensdesk_install"
$TempExtractPath = Join-Path $TempRoot "extract"

try {
    # 1 --------------------------------------------------------
    Write-Step 'Checking for a running instance'
    if (Test-Path $InstallPath) {
        $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
            try { $_.Path -and $_.Path.StartsWith($InstallPath, [System.StringComparison]::OrdinalIgnoreCase) }
            catch { $false }
        })
        if ($running.Count -gt 0) {
            Write-Host ''
            Write-Rule ([ConsoleColor]::Yellow)
            Write-Centered 'LensDesk is currently running' ([ConsoleColor]::Yellow)
            Write-Centered 'Please close the app, then run this installer again.' ([ConsoleColor]::Gray)
            Write-Rule ([ConsoleColor]::Yellow)
            Write-Host ''
            exit 1
        }
    }
    Write-StepDone

    # 2 --------------------------------------------------------
    Write-Step 'Preparing install directory'
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    }
    Write-StepDone $InstallPath

    # 3 --------------------------------------------------------
    Write-Step 'Configuring Windows Defender exclusion'
    $hasMp = Get-Command Add-MpPreference -ErrorAction SilentlyContinue
    if ($hasMp) {
        try {
            Add-MpPreference -ExclusionPath $InstallPath -ErrorAction Stop
            Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction SilentlyContinue
            Write-StepDone
        } catch {
            Write-StepSkip 'Defender policy locked or third-party AV active'
        }
    } else {
        Write-StepSkip 'Add-MpPreference not available'
    }

    # 4 --------------------------------------------------------
    Write-Step 'Downloading LensDesk'
    Get-RemoteFile -Uri $DownloadUrl -OutFile $ZipPath
    $zipMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
    Write-StepDone "${zipMb} MB"

    # 5 --------------------------------------------------------
    Write-Step 'Extracting application payload'
    if (Test-Path $TempExtractPath) {
        Remove-Item -Path $TempExtractPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $TempExtractPath -Force | Out-Null

    Expand-Archive -Path $ZipPath -DestinationPath $TempExtractPath -Force
    $sourceDir = $TempExtractPath
    $subDirs = @(Get-ChildItem -Path $TempExtractPath -Directory)
    if ($subDirs.Count -eq 1 -and @(Get-ChildItem -Path $TempExtractPath -File).Count -eq 0) {
        $sourceDir = $subDirs[0].FullName
    }

    Copy-Item -Path "$sourceDir\*" -Destination $InstallPath -Recurse -Force
    Write-StepDone

    # Run setup if installer package is present
    $setupExe = Get-ChildItem -Path $InstallPath -Filter '*Setup.exe' -Recurse | Select-Object -First 1
    if ($setupExe) {
        Write-Step 'Installing LensDesk'
        try {
            Start-Process -FilePath $setupExe.FullName -ArgumentList '/S' -Wait
            Write-StepDone
        } catch {
            Write-StepSkip 'Silent installer deferred'
        }
    }

    # 6 --------------------------------------------------------
    Write-Step 'Creating Desktop shortcut'
    $DesktopDir = [Environment]::GetFolderPath('Desktop')
    $ShortcutPath = Join-Path $DesktopDir "$FolderName.lnk"

    # Target: check installed RuntimeHost, named folder exe, or extracted exe
    $installedCandidates = @(
        (Join-Path $env:LOCALAPPDATA 'LensDesk\RuntimeHost.exe'),
        (Join-Path $env:ProgramFiles 'LensDesk\RuntimeHost.exe'),
        (Join-Path $InstallPath "$FolderName.exe")
    )
    $TargetExe = $installedCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $TargetExe) {
        $firstExe = Get-ChildItem -Path $InstallPath -Filter '*.exe' -Recurse | Where-Object { $_.Name -notlike '*Setup.exe' } | Select-Object -First 1
        if ($firstExe) { $TargetExe = $firstExe.FullName }
        elseif ($setupExe) { $TargetExe = $setupExe.FullName }
    }

    if (Test-Path $TargetExe) {
        $ws = New-Object -ComObject WScript.Shell
        $sc = $ws.CreateShortcut($ShortcutPath)
        $sc.TargetPath = $TargetExe
        $sc.WorkingDirectory = Split-Path -Parent $TargetExe
        $sc.Save()
        Write-StepDone $ShortcutPath
    } else {
        Write-StepSkip "could not locate target exe in $InstallPath"
    }

    # 7 --------------------------------------------------------
    Write-Step 'Cleaning temporary files'
    Remove-Item -Path $ZipPath -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    $tempScript = Join-Path $env:TEMP "lensdesk_install.ps1"
    Remove-Item -Path $tempScript -Force -ErrorAction SilentlyContinue
    Write-StepDone

    # Done -----------------------------------------------------
    $sw.Stop()
    $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)

    Write-Host ''
    Write-Rule ([ConsoleColor]::Green)
    Write-Centered "Installation complete in ${secs}s!" ([ConsoleColor]::Green)
    Write-Centered "Installed to: $InstallPath" ([ConsoleColor]::White)
    if (Test-Path $ShortcutPath) {
        Write-Centered "Shortcut: $ShortcutPath" ([ConsoleColor]::Gray)
    }
    Write-Rule ([ConsoleColor]::Green)
    Write-Host ''

    # Launch immediately
    if (Test-Path $TargetExe) {
        Write-Host -NoNewline "Launching LensDesk . . . " -ForegroundColor Cyan
        Start-Process -FilePath $TargetExe -WorkingDirectory (Split-Path -Parent $TargetExe)
        Write-Host 'running' -ForegroundColor Green
        Write-Host ''
    }

} catch {
    Write-StepFail $_.Exception.Message
    Write-Host ''
    Write-Rule ([ConsoleColor]::Red)
    Write-Centered 'Installation Failed' ([ConsoleColor]::Red)
    Write-Centered $_.Exception.Message ([ConsoleColor]::DarkRed)
    Write-Rule ([ConsoleColor]::Red)
    Write-Host ''
    # Clean up what we can
    Remove-Item -Path $ZipPath -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}
