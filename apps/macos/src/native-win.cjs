'use strict';

let ready = false, loadFailed = false, K = null, U = null, KL = null;
const F = {};

// Try to use native C++ Node-API addon first
let nativeAddon = null;
try {
  nativeAddon = require('../native/index.cjs');
} catch {}

const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x00000020n;
const WS_EX_TOOLWINDOW = 0x00000080n;
const WS_EX_NOACTIVATE = 0x08000000n;
const WS_EX_TOPMOST    = 0x00000008n;
const HWND_TOPMOST     = -1n;
const HWND_NOTOPMOST   = -2n;
const SWP_NOSIZE       = 0x0001;
const SWP_NOMOVE       = 0x0002;
const SWP_NOZORDER     = 0x0004;
const SWP_NOACTIVATE   = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW   = 0x0040;
const SWP_NOOWNERZORDER = 0x0200;
const UOI_NAME = 2;
const DESKTOP_SWITCHDESKTOP = 0x0100;
const SW_SHOW = 5;
const SW_SHOWNOACTIVATE = 4;
const SW_SHOWNA = 8;
const WDA_NONE         = 0;
const WDA_EXCLUDEFROMCAPTURE = 17;

function load() {
  if (process.platform !== 'win32') return false;
  if (ready) return true;
  if (loadFailed) return false;
  try {
    K = require('koffi');
    U = K.load('user32.dll');
    KL = K.load('kernel32.dll');

    F.SetWindowPos = U.func('__stdcall', 'SetWindowPos', 'bool',
      ['intptr_t', 'intptr_t', 'int', 'int', 'int', 'int', 'uint']);
    F.GetWindowLongPtrW = U.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int']);
    F.SetWindowLongPtrW = U.func('__stdcall', 'SetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int', 'intptr_t']);
    F.SetWindowDisplayAffinity = U.func('__stdcall', 'SetWindowDisplayAffinity', 'bool', ['intptr_t', 'uint']);
    F.GetWindowDisplayAffinity = U.func('__stdcall', 'GetWindowDisplayAffinity', 'bool', ['intptr_t', K.out('uint *')]);
    F.GetForegroundWindow = U.func('__stdcall', 'GetForegroundWindow', 'intptr_t', []);
    F.SetForegroundWindow = U.func('__stdcall', 'SetForegroundWindow', 'bool', ['intptr_t']);
    F.BringWindowToTop = U.func('__stdcall', 'BringWindowToTop', 'bool', ['intptr_t']);
    F.SetActiveWindow = U.func('__stdcall', 'SetActiveWindow', 'intptr_t', ['intptr_t']);
    F.SetFocus = U.func('__stdcall', 'SetFocus', 'intptr_t', ['intptr_t']);
    F.GetWindowThreadProcessId = U.func('__stdcall', 'GetWindowThreadProcessId', 'uint', ['intptr_t', K.out('uint *')]);
    F.IsWindowVisible = U.func('__stdcall', 'IsWindowVisible', 'bool', ['intptr_t']);
    F.GetLastError = KL.func('__stdcall', 'GetLastError', 'uint', []);
    F.GetCurrentThreadId = KL.func('__stdcall', 'GetCurrentThreadId', 'uint', []);
    F.AttachThreadInput = U.func('__stdcall', 'AttachThreadInput', 'bool', ['uint', 'uint', 'bool']);
    F.GetThreadDesktop = U.func('__stdcall', 'GetThreadDesktop', 'intptr_t', ['uint']);
    F.OpenInputDesktop = U.func('__stdcall', 'OpenInputDesktop', 'intptr_t', ['uint', 'bool', 'uint']);
    F.GetUserObjectInformationW = U.func('__stdcall', 'GetUserObjectInformationW', 'bool',
      ['intptr_t', 'int', 'void *', 'uint', 'uint *']);
    F.ShowWindow = U.func('__stdcall', 'ShowWindow', 'bool', ['intptr_t', 'int']);
    F.GetAsyncKeyState = U.func('__stdcall', 'GetAsyncKeyState', 'short', ['int']);
    F.SendInput = U.func('__stdcall', 'SendInput', 'uint', ['uint', 'void *', 'int']);
    F.MapVirtualKeyW = U.func('__stdcall', 'MapVirtualKeyW', 'uint', ['uint', 'uint']);

    ready = true;
    return true;
  } catch (e) {
    loadFailed = true;
    console.warn('[native-win] koffi load fail:', e.message);
    return false;
  }
}

function hwndOf(win) {
  if (!win || typeof win.getNativeWindowHandle !== 'function') return 0n;
  const buf = win.getNativeWindowHandle();
  return buf.length === 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0));
}

function isFocused(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    if (typeof win.isFocused === 'function' && win.isFocused()) return true;
    if (nativeAddon?.available) {
      const diag = nativeAddon.getFocusDiagnostics(hwndOf(win).toString());
      if (diag.isTargetForeground || diag.isTargetActive || diag.isTargetFocused) return true;
    }
    if (load()) {
      const fg = F.GetForegroundWindow();
      const h = hwndOf(win);
      return fg === h;
    }
  } catch {}
  return false;
}

function activate(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    const h = hwndOf(win);
    if (nativeAddon?.available) {
      nativeAddon.activateWindow(h.toString());
    }
    if (load()) {
      const curThread = F.GetCurrentThreadId();
      const outPid = [0];
      const fgThread = F.GetWindowThreadProcessId(F.GetForegroundWindow(), outPid);
      if (fgThread && fgThread !== curThread) {
        try { F.AttachThreadInput(curThread, fgThread, true); } catch {}
      }

      F.SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
      F.BringWindowToTop(h);
      F.SetForegroundWindow(h);
      F.SetActiveWindow(h);
      F.SetFocus(h);

      if (fgThread && fgThread !== curThread) {
        try { F.AttachThreadInput(curThread, fgThread, false); } catch {}
      }
    }
    if (typeof win.focus === 'function') win.focus();
    return true;
  } catch {
    return false;
  }
}

function assertStyles(win) {
  if (!win || win.isDestroyed()) return null;
  const h = hwndOf(win);

  if (nativeAddon?.available) {
    const res = nativeAddon.setWindowStyles(
      h.toString(),
      Number(WS_EX_NOACTIVATE),
      Number(WS_EX_TOOLWINDOW | WS_EX_TOPMOST)
    );
    if (res) {
      return {
        toolwindow: res.hasToolWindow,
        noactivate: res.hasNoActivate,
        topmost: res.hasTopmost,
      };
    }
  }

  if (!load()) return null;
  try {
    const ex = BigInt(F.GetWindowLongPtrW(h, GWL_EXSTYLE));
    // Single-window LensDesk needs activation for sign-in and text entry.
    // Keep the tool-window and topmost flags, but NEVER force NOACTIVATE.
    const want = (ex | WS_EX_TOOLWINDOW | WS_EX_TOPMOST) & ~WS_EX_NOACTIVATE;
    if (want !== ex) {
      F.SetWindowLongPtrW(h, GWL_EXSTYLE, want);
      F.SetWindowPos(h, 0n, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE);
    }
    const now = BigInt(F.GetWindowLongPtrW(h, GWL_EXSTYLE));
    return {
      toolwindow: (now & WS_EX_TOOLWINDOW) !== 0n,
      noactivate: (now & WS_EX_NOACTIVATE) !== 0n,
      topmost:    (now & WS_EX_TOPMOST)    !== 0n,
    };
  } catch { return null; }
}

function forceTopmost(win, opts = {}) {
  if (!win || win.isDestroyed()) return false;
  const h = hwndOf(win);
  const focused = isFocused(win);

  if (nativeAddon?.available && !opts.show) {
    return nativeAddon.setAlwaysOnTop(h.toString(), true);
  }

  if (!load()) return false;
  try {
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER;
    if (!focused) flags |= SWP_NOACTIVATE;
    if (opts.show !== false && !F.IsWindowVisible(h)) flags |= SWP_SHOWWINDOW;
    return !!F.SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, flags);
  } catch { return false; }
}

function ensureTopmost(win, show = true) {
  if (!win || win.isDestroyed()) return false;
  if (process.platform === 'darwin') {
    try {
      win.setAlwaysOnTop(true, 'screen-saver', 1);
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      if (show && !win.isVisible()) win.showInactive();
      return true;
    } catch { return false; }
  }
  const h = hwndOf(win);
  const focused = isFocused(win);

  if (!load()) return false;
  try {
    const isVisible = F.IsWindowVisible(h);
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER;
    if (!focused) flags |= SWP_NOACTIVATE;
    if (show && !isVisible) flags |= SWP_SHOWWINDOW;

    const ok = !!F.SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, flags);
    // Crucial: Only call ShowWindow if window is NOT yet visible.
    // Calling ShowWindow(SW_SHOWNA) on an already visible active window steals focus!
    if (show && !isVisible) {
      F.ShowWindow(h, focused ? SW_SHOW : SW_SHOWNA);
    }
    return ok;
  } catch { return false; }
}

function ShowWindow(win, cmd) {
  if (!load() || !win || win.isDestroyed()) return false;
  try { return !!F.ShowWindow(hwndOf(win), cmd); } catch { return false; }
}

function foregroundWindow() {
  if (nativeAddon?.available) {
    const info = nativeAddon.getForegroundInfo();
    return BigInt(info.hwnd || 0);
  }
  if (!load()) return null;
  try { return F.GetForegroundWindow(); } catch { return null; }
}

function foregroundPid(handle) {
  if (nativeAddon?.available) {
    const info = nativeAddon.getForegroundInfo();
    if (info && typeof info.pid === 'number' && info.pid > 0) return info.pid;
  }
  if (!load() || handle == null) return 0;
  try {
    const out = [0];
    F.GetWindowThreadProcessId(handle, out);
    return out[0];
  } catch { return 0; }
}

function reShow(win) {
  if (!load() || !win || win.isDestroyed()) return false;
  try {
    // If window is currently focused, do NOT call SW_SHOWNOACTIVATE as it will lose focus!
    if (isFocused(win)) return true;
    return !!F.ShowWindow(hwndOf(win), SW_SHOWNOACTIVATE);
  } catch { return false; }
}

function desktopName(handle) {
  if (!handle) return null;
  try {
    const buf = Buffer.alloc(512);
    const out = [0];
    if (!F.GetUserObjectInformationW(handle, UOI_NAME, buf, buf.length, out)) return null;
    return buf.subarray(0, Math.max(0, out[0] - 2)).toString('utf16le');
  } catch { return null; }
}

function desktopProbe() {
  if (!load()) return null;
  try {
    const thread = desktopName(F.GetThreadDesktop(F.GetCurrentThreadId()));
    const input = desktopName(F.OpenInputDesktop(0, false, DESKTOP_SWITCHDESKTOP));
    return { thread, input, same: !!thread && thread === input };
  } catch { return null; }
}

function excludeFromCapture(win, on) {
  if (!win || win.isDestroyed()) return { ok: false, err: -1 };
  const h = hwndOf(win);

  if (nativeAddon?.available) {
    const ok = nativeAddon.setCaptureAffinity(h.toString(), Boolean(on));
    return { ok: Boolean(ok), err: ok ? 0 : -1 };
  }

  if (!load()) return { ok: false, err: -1 };
  try {
    const ok = F.SetWindowDisplayAffinity(h, on ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE);
    return { ok: !!ok, err: ok ? 0 : F.GetLastError() };
  } catch { return { ok: false, err: -1 }; }
}

function captureAffinity(win) {
  if (!win || win.isDestroyed()) return null;
  const h = hwndOf(win);

  if (nativeAddon?.available) {
    const res = nativeAddon.getCaptureAffinity(h.toString());
    if (res && res.ok) return { ok: true, affinity: res.affinity };
  }

  if (!load()) return null;
  try {
    const out = [0];
    const ok = F.GetWindowDisplayAffinity(h, out);
    return { ok: !!ok, affinity: out[0] };
  } catch { return null; }
}

function isAnyModifierDown() {
  if (nativeAddon?.available && typeof nativeAddon.isAnyModifierDown === 'function') {
    return nativeAddon.isAnyModifierDown();
  }
  if (!load() || !F.GetAsyncKeyState) return false;
  // VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_LWIN = 0x5B, VK_RWIN = 0x5C
  const modifiers = [0x10, 0x11, 0x12, 0x5B, 0x5C];
  for (const vk of modifiers) {
    try {
      const state = F.GetAsyncKeyState(vk);
      if ((state & 0x8000) !== 0) return true;
    } catch {}
  }
  return false;
}

function sendNativePaste() {
  if (nativeAddon?.available && typeof nativeAddon.sendNativePaste === 'function') {
    return nativeAddon.sendNativePaste();
  }
  return false;
}

function sendUnicodeChar(char, holdMs = 20) {
  if (!load() || !F.SendInput) return false;
  const code = typeof char === 'string' ? char.charCodeAt(0) : char;

  const bufDown = Buffer.alloc(40);
  bufDown.writeUInt32LE(1, 0); // INPUT_KEYBOARD = 1
  bufDown.writeUInt16LE(0, 8); // wVk = 0
  bufDown.writeUInt16LE(code, 10); // wScan = code
  bufDown.writeUInt32LE(0x0004, 12); // KEYEVENTF_UNICODE = 0x0004

  const bufUp = Buffer.alloc(40);
  bufUp.writeUInt32LE(1, 0); // INPUT_KEYBOARD = 1
  bufUp.writeUInt16LE(0, 8); // wVk = 0
  bufUp.writeUInt16LE(code, 10); // wScan = code
  bufUp.writeUInt32LE(0x0004 | 0x0002, 12); // KEYEVENTF_UNICODE | KEYEVENTF_KEYUP = 0x0006

  F.SendInput(1, bufDown, 40);
  if (holdMs > 0) {
    const end = Date.now() + holdMs;
    while (Date.now() < end) {}
  }
  F.SendInput(1, bufUp, 40);
  return true;
}

function sendVirtualKey(vk, holdMs = 20) {
  if (!load() || !F.SendInput) return false;
  const scan = F.MapVirtualKeyW ? F.MapVirtualKeyW(vk, 0) : 0;

  const bufDown = Buffer.alloc(40);
  bufDown.writeUInt32LE(1, 0); // INPUT_KEYBOARD
  bufDown.writeUInt16LE(vk, 8); // wVk
  bufDown.writeUInt16LE(scan, 10); // wScan
  bufDown.writeUInt32LE(0, 12); // dwFlags = 0 (KeyDown)

  const bufUp = Buffer.alloc(40);
  bufUp.writeUInt32LE(1, 0); // INPUT_KEYBOARD
  bufUp.writeUInt16LE(vk, 8); // wVk
  bufUp.writeUInt16LE(scan, 10); // wScan
  bufUp.writeUInt32LE(0x0002, 12); // dwFlags = KEYEVENTF_KEYUP (0x0002)

  F.SendInput(1, bufDown, 40);
  if (holdMs > 0) {
    const end = Date.now() + holdMs;
    while (Date.now() < end) {}
  }
  F.SendInput(1, bufUp, 40);
  return true;
}

function sendCaretNudge() {
  if (nativeAddon?.available && typeof nativeAddon.sendCaretNudge === 'function') {
    return nativeAddon.sendCaretNudge();
  }
  sendVirtualKey(0x25, 10); // VK_LEFT
  sendVirtualKey(0x27, 10); // VK_RIGHT
}

function setClickThrough(win, enable) {
  if (!win || win.isDestroyed()) return false;
  const h = hwndOf(win);
  if (nativeAddon?.available && typeof nativeAddon.setOverlayClickThrough === 'function') {
    return nativeAddon.setOverlayClickThrough(h.toString(), Boolean(enable));
  }
  if (!load()) return false;
  try {
    const ex = BigInt(F.GetWindowLongPtrW(h, GWL_EXSTYLE));
    const want = enable ? (ex | WS_EX_TRANSPARENT) : (ex & ~WS_EX_TRANSPARENT);
    if (want !== ex) {
      F.SetWindowLongPtrW(h, GWL_EXSTYLE, want);
      F.SetWindowPos(h, 0n, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE);
    }
    return true;
  } catch { return false; }
}

function optimizeWorkingSet() {
  if (nativeAddon?.available && typeof nativeAddon.optimizeWorkingSet === 'function') {
    return nativeAddon.optimizeWorkingSet();
  }
  return { ok: true };
}

function isElevatedAdmin() {
  if (nativeAddon?.available && typeof nativeAddon.isElevatedAdmin === 'function') {
    return nativeAddon.isElevatedAdmin();
  }
  return { isElevated: false, integrityLevel: 0 };
}

function configureUIPI(win) {
  if (!win || win.isDestroyed()) return false;
  const h = hwndOf(win);
  if (nativeAddon?.available && typeof nativeAddon.configureUIPIFilters === 'function') {
    return nativeAddon.configureUIPIFilters(h.toString());
  }
  return true;
}

function sendHardwareScancode(vk, holdMs = 20) {
  if (nativeAddon?.available && typeof nativeAddon.sendHardwareScancode === 'function') {
    return nativeAddon.sendHardwareScancode(vk, holdMs);
  }
  return sendVirtualKey(vk, holdMs);
}

function postBackgroundChar(hwnd, char) {
  if (!hwnd) return false;
  const code = typeof char === 'string' ? char.charCodeAt(0) : char;
  if (nativeAddon?.available && typeof nativeAddon.postBackgroundMessage === 'function') {
    const hStr = typeof hwnd === 'bigint' ? hwnd.toString() : String(hwnd);
    return nativeAddon.postBackgroundMessage(hStr, 0x0102 /* WM_CHAR */, code, 1);
  }
  return false;
}

function postBackgroundKey(hwnd, vk) {
  if (!hwnd) return false;
  if (nativeAddon?.available && typeof nativeAddon.postBackgroundMessage === 'function') {
    const hStr = typeof hwnd === 'bigint' ? hwnd.toString() : String(hwnd);
    nativeAddon.postBackgroundMessage(hStr, 0x0100 /* WM_KEYDOWN */, vk, 1);
    nativeAddon.postBackgroundMessage(hStr, 0x0101 /* WM_KEYUP */, vk, 1);
    return true;
  }
  return false;
}

function synchronizeFocus(targetHwnd) {
  if (!targetHwnd) return false;
  if (!load()) return false;
  try {
    const curThread = F.GetCurrentThreadId();
    const outPid = [0];
    const targetThread = F.GetWindowThreadProcessId(targetHwnd, outPid);
    if (targetThread && targetThread !== curThread) {
      try { F.AttachThreadInput(curThread, targetThread, true); } catch {}
    }
    F.SetWindowPos(targetHwnd, 0n, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    F.BringWindowToTop(targetHwnd);
    F.SetForegroundWindow(targetHwnd);
    F.SetActiveWindow(targetHwnd);
    F.SetFocus(targetHwnd);
    if (targetThread && targetThread !== curThread) {
      try { F.AttachThreadInput(curThread, targetThread, false); } catch {}
    }
    return true;
  } catch { return false; }
}

function isDefaultDesktopActive() {
  if (nativeAddon?.available) {
    const info = nativeAddon.getInputDesktopInfo();
    return Boolean(info?.isDefault);
  }
  const probe = desktopProbe();
  return probe ? probe.input === 'Default' : true;
}

function getInputDesktopInfo() {
  if (nativeAddon?.available) {
    return nativeAddon.getInputDesktopInfo();
  }
  const probe = desktopProbe();
  return { ok: !!probe, desktop: probe?.input || 'Default', isDefault: (probe?.input === 'Default') };
}

function isWindowFullscreen(winOrHwnd) {
  const h = (typeof winOrHwnd === 'object' && winOrHwnd && typeof winOrHwnd.getNativeWindowHandle === 'function')
    ? hwndOf(winOrHwnd)
    : winOrHwnd;
  if (!h) return false;
  if (nativeAddon?.available) {
    const res = nativeAddon.isWindowFullscreen(h.toString());
    return Boolean(res?.isFullscreen);
  }
  return false;
}

function initDpiAwareness() {
  if (nativeAddon?.available) {
    return nativeAddon.initDpiAwareness();
  }
  return false;
}

function startForegroundHook() {
  if (nativeAddon?.available) {
    return nativeAddon.startForegroundHook();
  }
  return false;
}

function stopForegroundHook() {
  if (nativeAddon?.available) {
    return nativeAddon.stopForegroundHook();
  }
  return false;
}

function lastForegroundWindow() {
  if (nativeAddon?.available) {
    const hStr = nativeAddon.getLastForegroundHwnd();
    return hStr && hStr !== '0' ? BigInt(hStr) : foregroundWindow();
  }
  return foregroundWindow();
}

module.exports = {
  load,
  hwndOf,
  assertStyles,
  forceTopmost,
  ensureTopmost,
  ShowWindow,
  foregroundWindow,
  foregroundPid,
  reShow,
  desktopProbe,
  excludeFromCapture,
  captureAffinity,
  activate,
  isFocused,
  isAnyModifierDown,
  sendUnicodeChar,
  sendVirtualKey,
  sendCaretNudge,
  setClickThrough,
  optimizeWorkingSet,
  isElevatedAdmin,
  configureUIPI,
  sendHardwareScancode,
  postBackgroundChar,
  postBackgroundKey,
  synchronizeFocus,
  isDefaultDesktopActive,
  getInputDesktopInfo,
  isWindowFullscreen,
  initDpiAwareness,
  startForegroundHook,
  stopForegroundHook,
  lastForegroundWindow,
  sendNativePaste,
};
