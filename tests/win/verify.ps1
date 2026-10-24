param(
  [int]$TargetPid = 0,
  [string]$ProcessName = 'RuntimeHost'
)

$ErrorActionPreference = 'Continue'
$script:fail = $false

if (-not ('OverlayNative' -as [type])) {
  Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class OverlayNative {
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
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", EntryPoint = "GetWindowTextW", CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr GetThreadDesktop(uint dwThreadId);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetUserObjectInformationW(IntPtr hObj, int nIndex, IntPtr pvInfo, uint nLength, out uint lpnLengthNeeded);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool CloseDesktop(IntPtr hDesktop);
}
'@
}

function Get-DesktopName([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return $null }
  $buffer = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(1024)
  try {
    [uint32]$needed = 0
    $ok = [OverlayNative]::GetUserObjectInformationW($handle, 2, $buffer, 1024, [ref]$needed)
    if (-not $ok) { return $null }
    return [System.Runtime.InteropServices.Marshal]::PtrToStringUni($buffer)
  } finally {
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
  }
}

Write-Host 'Processes (excluding WinSxS):'
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path -notlike '*\WinSxS\*' } |
  Select-Object -First 20 Id, ProcessName, Path |
  Format-Table -AutoSize |
  Out-String |
  Write-Host

$targets = @()
if ($TargetPid -gt 0) {
  $targets = @(Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)
} else {
  $targets = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
  if ($targets.Count -eq 0) {
    $targets = @(Get-Process svchost -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -and $_.Path -notlike '*\System32\*' })
  }
}

if ($targets.Count -eq 0) {
  Write-Host "FAIL: no $ProcessName process found"
  exit 1
}

$script:TargetPids = @($targets | ForEach-Object { [int]$_.Id })
Write-Host ("Target PIDs: " + ($script:TargetPids -join ', '))
Write-Host ("$ProcessName process count: " + @($targets).Count)

$script:windows = [System.Collections.Generic.List[object]]::new()
$callback = [OverlayNative+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)

  if (-not [OverlayNative]::IsWindowVisible($hWnd)) { return $true }

  [uint32]$windowPid = 0
  [void][OverlayNative]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
  if ($script:TargetPids -notcontains [int]$windowPid) { return $true }

  $text = [System.Text.StringBuilder]::new(512)
  [void][OverlayNative]::GetWindowTextW($hWnd, $text, $text.Capacity)

  $exStyle = [OverlayNative]::GetWindowLongPtrW($hWnd, -20).ToInt64()
  [uint32]$affinity = 0
  $affinityOk = [OverlayNative]::GetWindowDisplayAffinity($hWnd, [ref]$affinity)
  $affinityValue = if ($affinityOk) { [int]$affinity } else { -1 }

  [void]$script:windows.Add([pscustomobject]@{
    Handle = $hWnd
    ProcessId = [int]$windowPid
    Title = $text.ToString()
    ExStyle = $exStyle
    Affinity = $affinityValue
  })
  return $true
}

[void][OverlayNative]::EnumWindows($callback, [IntPtr]::Zero)

if ($script:windows.Count -eq 0) {
  Write-Host 'FAIL: no visible top-level target window found'
  exit 1
}

if ($script:windows.Count -eq 1) {
  Write-Host 'PASS: exactly one visible top-level window'
} else {
  Write-Host ("FAIL: expected one visible top-level window, found {0}" -f $script:windows.Count)
  $script:fail = $true
}

foreach ($w in $script:windows) {
  $hasToolWindow = (($w.ExStyle -band 0x00000080) -ne 0)
  $hasNoActivate = (($w.ExStyle -band 0x08000000) -ne 0)

  Write-Host ("Window 0x{0:X} pid={1} title='{2}' exstyle=0x{3:X} affinity={4}" -f
    $w.Handle.ToInt64(), $w.ProcessId, $w.Title, $w.ExStyle, $w.Affinity)

  if (-not [OverlayNative]::IsWindowVisible($w.Handle)) {
    Write-Host 'FAIL: window hidden'
    $script:fail = $true
  } else {
    Write-Host 'PASS: window visible'
  }

  [uint32]$desktopPid = 0
  [uint32]$windowThread = [OverlayNative]::GetWindowThreadProcessId($w.Handle, [ref]$desktopPid)
  $threadDesktop = [OverlayNative]::GetThreadDesktop($windowThread)
  $inputDesktop = [OverlayNative]::OpenInputDesktop(0, $false, 0x0100)
  try {
    $threadDesktopName = Get-DesktopName -handle $threadDesktop
    $inputDesktopName = Get-DesktopName -handle $inputDesktop
    Write-Host ("Desktop: thread='{0}' input='{1}'" -f $threadDesktopName, $inputDesktopName)
    if ($threadDesktopName -and $inputDesktopName -and $threadDesktopName -ne $inputDesktopName) {
      Write-Host ("WARN: desktop mismatch thread='{0}' input='{1}'" -f $threadDesktopName, $inputDesktopName)
    }
  } finally {
    if ($inputDesktop -ne [IntPtr]::Zero) { [void][OverlayNative]::CloseDesktop($inputDesktop) }
  }

  if (-not $hasToolWindow) {
    Write-Host 'FAIL: WS_EX_TOOLWINDOW (0x80) missing'
    $script:fail = $true
  } else {
    Write-Host 'PASS: WS_EX_TOOLWINDOW (0x80) present'
  }

  if ($hasNoActivate) {
    Write-Host 'FAIL: WS_EX_NOACTIVATE (0x08000000) present; sign-in and the composer need keyboard focus'
    $script:fail = $true
  } else {
    Write-Host 'PASS: WS_EX_NOACTIVATE (0x08000000) absent'
  }

  if ($w.Affinity -eq 17) {
    Write-Host 'OK: GetWindowDisplayAffinity = 17 (WDA_EXCLUDEFROMCAPTURE)'
  } elseif ($w.Affinity -eq 0) {
    Write-Host 'WARN: GetWindowDisplayAffinity = 0 (capture me aayega)'
  } else {
    Write-Host ("WARN: GetWindowDisplayAffinity = {0}" -f $w.Affinity)
  }
}

$foreground = [OverlayNative]::GetForegroundWindow()
$foregroundWindow = $script:windows | Where-Object { $_.Handle -eq $foreground } | Select-Object -First 1
if ($foregroundWindow) {
  Write-Host 'INFO: the LensDesk sign-in window currently holds foreground focus'
} else {
  Write-Host 'INFO: another app holds foreground focus; LensDesk remains focusable when clicked'
}

$exe = Join-Path (Split-Path $MyInvocation.MyCommand.Path) '..\..\release\win-unpacked\RuntimeHost.exe'
if (Test-Path $exe) {
  $vi = (Get-Item $exe).VersionInfo
  if ([string]::IsNullOrEmpty($vi.OriginalFilename)) { Write-Host 'PASS: OriginalFilename blank' }
  else { Write-Host "FAIL: OriginalFilename = $($vi.OriginalFilename)"; $script:fail = $true }
  if ($vi.InternalName -eq 'RuntimeHost') { Write-Host 'PASS: InternalName' }
  else { Write-Host "FAIL: InternalName = $($vi.InternalName)"; $script:fail = $true }
  if ($vi.FileDescription -eq 'RuntimeHost') { Write-Host 'PASS: FileDescription' }
  else { Write-Host "FAIL: FileDescription = $($vi.FileDescription)"; $script:fail = $true }
} else { Write-Host 'FAIL: RuntimeHost.exe not found'; $script:fail = $true }

Write-Host 'NOTE: Task Manager me RuntimeHost normal process ki tarah dikhna chahiye — process hiding expected nahi hai.'
Write-Host 'NOTE: PowerShell/WMI bhi RuntimeHost ko normally report karega.'

if ($script:fail) {
  Write-Host 'RESULT: FAIL'
  exit 1
}

Write-Host 'RESULT: PASS'
exit 0
