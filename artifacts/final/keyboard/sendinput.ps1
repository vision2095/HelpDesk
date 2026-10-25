param(
  [Parameter(Mandatory=$true)][string]$Action,
  [int]$X = 0,
  [int]$Y = 0,
  [string]$Text = "",
  [string]$Key = "",
  [int]$DelayMs = 40,
  [long]$Hwnd = 0
)

Add-Type -AssemblyName System.Windows.Forms

$sig = @'
using System;
using System.Runtime.InteropServices;
public class NativeInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public MOUSEINPUT mi;
    [FieldOffset(8)] public KEYBDINPUT ki;
    [FieldOffset(8)] public HARDWAREINPUT hi;
  }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetPhysicalCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  public static string WindowRect(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    return r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom;
  }
  public static void ClickAbsolute(int x, int y) {
    int sw = GetSystemMetrics(0);
    int sh = GetSystemMetrics(1);
    INPUT[] inputs = new INPUT[3];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].mi.dx = (int)((long)x * 65535 / (sw - 1));
    inputs[0].mi.dy = (int)((long)y * 65535 / (sh - 1));
    inputs[0].mi.dwFlags = 0x0001 | 0x8000; // MOVE | ABSOLUTE
    inputs[1].type = INPUT_MOUSE;
    inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    inputs[2].type = INPUT_MOUSE;
    inputs[2].mi.dwFlags = MOUSEEVENTF_LEFTUP;
    SendInput(3, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
  public static string DescribePoint(int x, int y) {
    POINT p; p.X=x; p.Y=y;
    IntPtr h = WindowFromPoint(p);
    var cls = new System.Text.StringBuilder(256);
    var title = new System.Text.StringBuilder(256);
    GetClassName(h, cls, 256);
    GetWindowText(h, title, 256);
    return "hwnd=" + h + " class=" + cls + " title=" + title;
  }
  public static void MakeDpiAware() {
    SetThreadDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2
  }
  public static void ForceForeground(IntPtr hwnd) {
    ShowWindow(hwnd, 9);
    SetWindowPos(hwnd, new IntPtr(-1), 0,0,0,0, 0x0001 | 0x0002 | 0x0040);
    IntPtr fg = GetForegroundWindow();
    uint fgPid;
    uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
    uint myThread = GetCurrentThreadId();
    AttachThreadInput(myThread, fgThread, true);
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
    AttachThreadInput(myThread, fgThread, false);
    System.Threading.Thread.Sleep(150);
  }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public const uint INPUT_MOUSE = 0;
  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;
  public const uint KEYEVENTF_SCANCODE = 0x0008;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public static void ClickHere() {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = INPUT_MOUSE;
    inputs[0].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    inputs[1].type = INPUT_MOUSE;
    inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTUP;
    SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(150);
    ClickHere();
  }
  public static void UnicodeChar(char c) {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = 0;
    inputs[0].ki.wScan = (ushort)c;
    inputs[0].ki.dwFlags = KEYEVENTF_UNICODE;
    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].ki.wVk = 0;
    inputs[1].ki.wScan = (ushort)c;
    inputs[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void KeyVk(ushort vk, bool up) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = vk;
    inputs[0].ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@
Add-Type -TypeDefinition $sig
[NativeInput]::MakeDpiAware()

# Resolve the LensDesk top-level window (unless explicitly supplied).
if ($Hwnd -eq 0) {
  $proc = Get-Process RuntimeHost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($proc) { $Hwnd = $proc.MainWindowHandle.ToInt64() }
}
if ($Hwnd -eq 0) { throw "LensDesk window not found" }

# Bring the LensDesk window to the foreground before any simulated input.
if ($Action -ne "none") {
  [NativeInput]::ForceForeground([IntPtr]$Hwnd)
}

switch ($Action) {
  "focus" {
    $fg = [NativeInput]::GetForegroundWindow()
    "forced foreground; fg=$fg target=$Hwnd inputSize=$([System.Runtime.InteropServices.Marshal]::SizeOf([type][NativeInput+INPUT]))"
  }
  "click" {
    $rectBefore = [NativeInput]::WindowRect([IntPtr]$Hwnd)
    $pre = [NativeInput]::DescribePoint($X, $Y)
    [NativeInput]::ClickAbsolute($X, $Y)
    Start-Sleep -Milliseconds 250
    $p = New-Object NativeInput+POINT
    [NativeInput]::GetCursorPos([ref]$p) | Out-Null
    $pp = New-Object NativeInput+POINT
    [NativeInput]::GetPhysicalCursorPos([ref]$pp) | Out-Null
    "clicked $X,$Y rect=$rectBefore screen=$([NativeInput]::GetSystemMetrics(0))x$([NativeInput]::GetSystemMetrics(1)) pre=$pre cursor=$($p.X),$($p.Y) physCursor=$($pp.X),$($pp.Y) atTarget=$([NativeInput]::DescribePoint($X,$Y)) fg=$([NativeInput]::GetForegroundWindow())"
  }
  "move" {
    [NativeInput]::SetCursorPos($X, $Y) | Out-Null
    "moved $X,$Y"
  }
  "type" {
    foreach ($ch in $Text.ToCharArray()) {
      [NativeInput]::UnicodeChar($ch)
      Start-Sleep -Milliseconds $DelayMs
    }
    "typed $($Text.Length) chars"
  }
  "key" {
    $map = @{ "ENTER"=0x0D; "TAB"=0x09; "ESC"=0x1B; "BACKSPACE"=0x08; "DELETE"=0x2E; "HOME"=0x24; "END"=0x23; "CTRL"=0x11; "SHIFT"=0x10; "ALT"=0x12; "A"=0x41; "C"=0x43; "F"=0x46; "L"=0x4C; "V"=0x56; "X"=0x58; "T"=0x54; "S"=0x53; "W"=0x57; "R"=0x52; "M"=0x4D; "N"=0x4E }
    $vk = [uint16]$map[$Key.ToUpper()]
    if ($Key.ToUpper() -in @("CTRL","SHIFT","ALT")) {
      [NativeInput]::KeyVk($vk, $false)
      "keydown $Key"
    } else {
      [NativeInput]::KeyVk($vk, $false)
      Start-Sleep -Milliseconds 30
      [NativeInput]::KeyVk($vk, $true)
      "pressed $Key"
    }
  }
  "keydown" {
    $map = @{ "CTRL"=0x11; "SHIFT"=0x10; "ALT"=0x12; "ENTER"=0x0D; "TAB"=0x09; "ESC"=0x1B; "A"=0x41; "C"=0x43; "F"=0x46; "L"=0x4C; "V"=0x56; "X"=0x58; "T"=0x54; "S"=0x53; "W"=0x57; "R"=0x52; "M"=0x4D; "N"=0x4E }
    [NativeInput]::KeyVk([uint16]$map[$Key.ToUpper()], $false)
    "keydown $Key"
  }
  "keyup" {
    $map = @{ "CTRL"=0x11; "SHIFT"=0x10; "ALT"=0x12; "ENTER"=0x0D; "TAB"=0x09; "ESC"=0x1B; "A"=0x41; "C"=0x43; "F"=0x46; "L"=0x4C; "V"=0x56; "X"=0x58; "T"=0x54; "S"=0x53; "W"=0x57; "R"=0x52; "M"=0x4D; "N"=0x4E }
    [NativeInput]::KeyVk([uint16]$map[$Key.ToUpper()], $true)
    "keyup $Key"
  }
  default { "unknown action" }
}
