# Verifies the live LensDesk native Windows overlay contract.
# Run while RuntimeHost.exe is open:
#   npm run test:overlay-windows
#
# This script is read-only. It does not enumerate desktops, inspect unrelated
# processes, change policy, or terminate anything.

param(
  [int]$TargetPid = 0,
  [string]$BinaryPath = ""
)

$ErrorActionPreference = "Stop"
$script:fail = $false

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class LensDeskOverlayNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
  public static extern IntPtr GetWindowLongPtrW(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowDisplayAffinity(IntPtr hWnd, out uint affinity);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int count);
}
'@

function Fail([string]$message) {
  Write-Host "FAIL: $message"
  $script:fail = $true
}

if ($TargetPid -gt 0) {
  $target = Get-Process -Id $TargetPid -ErrorAction Stop
} else {
  $target = Get-Process -Name "RuntimeHost" -ErrorAction SilentlyContinue |
    Select-Object -First 1
}
if (-not $target) {
  throw "RuntimeHost.exe is not running. Start LensDesk and re-run this check."
}
Write-Host "RuntimeHost PID: $($target.Id)"

$windows = [System.Collections.Generic.List[object]]::new()
$callback = [LensDeskOverlayNative+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [LensDeskOverlayNative]::IsWindowVisible($hWnd)) { return $true }

  [uint32]$windowPid = 0
  [void][LensDeskOverlayNative]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
  if ([int]$windowPid -ne [int]$target.Id) { return $true }

  $className = [System.Text.StringBuilder]::new(256)
  [void][LensDeskOverlayNative]::GetClassNameW($hWnd, $className, $className.Capacity)
  $exStyle = [LensDeskOverlayNative]::GetWindowLongPtrW($hWnd, -20).ToInt64()
  [uint32]$affinity = 0
  $affinityOk = [LensDeskOverlayNative]::GetWindowDisplayAffinity($hWnd, [ref]$affinity)
  $affinityValue = if ($affinityOk) { [int]$affinity } else { -1 }
  [void]$windows.Add([pscustomobject]@{
    Handle = $hWnd
    ClassName = $className.ToString()
    ExStyle = $exStyle
    Affinity = $affinityValue
  })
  return $true
}
[void][LensDeskOverlayNative]::EnumWindows($callback, [IntPtr]::Zero)

if ($windows.Count -ne 1) {
  Fail "expected exactly one visible top-level LensDesk window, found $($windows.Count)"
}

$TOOLWINDOW = 0x00000080
$TOPMOST = 0x00000008
$NOACTIVATE = 0x08000000
foreach ($window in $windows) {
  Write-Host ("Window 0x{0:X} class='{1}' exstyle=0x{2:X} affinity={3}" -f
    $window.Handle.ToInt64(), $window.ClassName, $window.ExStyle, $window.Affinity)
  if ($window.ClassName -ne "LensDesk_Overlay_Host_Class") {
    Fail "unexpected window class '$($window.ClassName)'"
  }
  if (($window.ExStyle -band $TOOLWINDOW) -eq 0) {
    Fail "WS_EX_TOOLWINDOW is missing"
  }
  if (($window.ExStyle -band $TOPMOST) -eq 0) {
    Fail "WS_EX_TOPMOST is missing"
  }
  if ($window.Affinity -ne 17) {
    Fail "GetWindowDisplayAffinity must be WDA_EXCLUDEFROMCAPTURE (17), got $($window.Affinity)"
  }
}

if (-not $BinaryPath) {
  $BinaryPath = @(
    "release/RuntimeHost.exe",
    "build-native/bin/Release/RuntimeHost.exe",
    "build-native/Release/RuntimeHost.exe"
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $BinaryPath -or -not (Test-Path -LiteralPath $BinaryPath)) {
  Fail "RuntimeHost.exe was not found for metadata verification"
} else {
  $vi = (Get-Item -LiteralPath $BinaryPath).VersionInfo
  if ($vi.ProductName -ne "LensDesk 2.0") { Fail "unexpected ProductName '$($vi.ProductName)'" }
  if ($vi.OriginalFilename -ne "RuntimeHost.exe") { Fail "unexpected OriginalFilename '$($vi.OriginalFilename)'" }
  if ($vi.CompanyName -ne "LensDesk Team") { Fail "unexpected CompanyName '$($vi.CompanyName)'" }
  Write-Host "Executable: $BinaryPath"
  Write-Host "Metadata: $($vi.CompanyName) | $($vi.ProductName) | $($vi.OriginalFilename)"
}

if ($script:fail) {
  Write-Host "RESULT: FAIL"
  exit 1
}
Write-Host "RESULT: PASS"
