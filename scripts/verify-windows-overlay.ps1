# Verifies that LensDesk's floating overlay does not disturb the focused
# application on Windows. Run it while the floating overlay is open:
#
#   npm run test:overlay-windows
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows-overlay.ps1
#
# Checks:
#   1. Every visible top-level window of the process carries WS_EX_TOOLWINDOW,
#      so the floating HUD is excluded from Alt+Tab (Electron applies this
#      style when setSkipTaskbar(true) runs in toggleOverlay).
#   2. WS_EX_NOACTIVATE absence is reported as a warning. Electron cannot set
#      that flag and still keep the HUD typeable; clicking the HUD will
#      activate it on Windows.
#   3. The foreground window is unchanged over the stability window while the
#      HUD idles above other applications (no activation/blur side effect).
#
# Keep your hands off the keyboard during the stability window, or the
# foreground check reacts to whatever you focus yourself.
# Unpackaged dev builds run under the process name "electron":
#   powershell -File scripts/verify-windows-overlay.ps1 -ProcessName electron

param(
  [string]$ProcessName = "LensDesk",
  [int]$StabilitySeconds = 4
)

$ErrorActionPreference = "Stop"

Add-Type @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern long GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static List<IntPtr> ForPid(uint pid) {
    var l = new List<IntPtr>();
    EnumWindows((h,x)=>{ uint p; GetWindowThreadProcessId(h, out p); if(p==pid) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
}
'@

$p = Get-Process -Name $ProcessName -ErrorAction Stop | Select-Object -First 1
$TOOL = 0x80; $NOACT = 0x08000000
$fgBefore = [W]::GetForegroundWindow()
$fail = 0; $warn = 0
$windows = 0
foreach ($h in [W]::ForPid([uint32]$p.Id)) {
  if (-not [W]::IsWindowVisible($h)) { continue }
  $windows++
  $ex = [W]::GetWindowLongPtr($h, -20)
  Write-Host ("window 0x{0:X} WS_EX=0x{1:X}" -f $h.ToInt64(), $ex)
  if (($ex -band $TOOL) -eq 0) {
    Write-Host "FAIL: WS_EX_TOOLWINDOW missing (HUD shows up in Alt+Tab; run with the floating overlay open - the normal window legitimately appears in Alt+Tab)"; $fail++
  }
  if (($ex -band $NOACT) -eq 0) {
    Write-Host "WARN: WS_EX_NOACTIVATE not set (Windows activates the HUD on click; Electron keeps the HUD typeable instead)"; $warn++
  }
}
if ($windows -eq 0) { Write-Host "FAIL: no visible windows for process '$ProcessName' (is the app running with the floating overlay open?)"; $fail++ }

# Identity: report the app's own binary metadata.
$vi = $p.MainModule.FileVersionInfo
Write-Host "Executable : $($p.MainModule.FileName)"
Write-Host "Company    : $($vi.CompanyName)"
Write-Host "Description: $($vi.FileDescription)"

Start-Sleep -Seconds $StabilitySeconds
if ($fgBefore -ne [W]::GetForegroundWindow()) {
  Write-Host "FAIL: foreground changed during the stability window (the overlay stole focus)"; $fail++
}
if ($fail -eq 0) {
  Write-Host "`nPASS: floating overlay stays above the work area without stealing focus ($warn warning(s))"
} else {
  Write-Host "`n$fail FAILURE(S), $warn warning(s)"; exit 1
}
