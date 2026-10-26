#include <napi.h>

#include <string>
#include <vector>
#include <cstdint>

#ifdef _WIN32
#include <windows.h>
#include <dwmapi.h>
#include <psapi.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "psapi.lib")

namespace {

HWND ParseHwnd(const Napi::Value& val) {
  if (val.IsNumber()) {
    return reinterpret_cast<HWND>(static_cast<uintptr_t>(val.As<Napi::Number>().Int64Value()));
  }
  if (val.IsBigInt()) {
    bool lossless = true;
    return reinterpret_cast<HWND>(static_cast<uintptr_t>(val.As<Napi::BigInt>().Uint64Value(&lossless)));
  }
  if (val.IsString()) {
    std::string s = val.As<Napi::String>().Utf8Value();
    uint64_t v = std::stoull(s, nullptr, 0);
    return reinterpret_cast<HWND>(static_cast<uintptr_t>(v));
  }
  return nullptr;
}

std::string HwndToString(HWND hwnd) {
  return std::to_string(reinterpret_cast<uintptr_t>(hwnd));
}

}  // namespace

Napi::Value Info(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  out.Set("available", Napi::Boolean::New(env, true));
  out.Set("platform", Napi::String::New(env, "win32"));
#if defined(_M_X64) || defined(__x86_64__)
  out.Set("arch", Napi::String::New(env, "x64"));
#elif defined(_M_ARM64) || defined(__aarch64__)
  out.Set("arch", Napi::String::New(env, "arm64"));
#else
  out.Set("arch", Napi::String::New(env, "ia32"));
#endif
  out.Set("mode", Napi::String::New(env, "native-win32"));
  out.Set("version", Napi::String::New(env, "2.0.0"));

  Napi::Object feats = Napi::Object::New(env);
  feats.Set("windowManager", Napi::Boolean::New(env, true));
  feats.Set("focusManager", Napi::Boolean::New(env, true));
  feats.Set("captureAffinity", Napi::Boolean::New(env, true));
  feats.Set("inputDiagnostics", Napi::Boolean::New(env, true));
  feats.Set("safeAutoType", Napi::Boolean::New(env, true));
  out.Set("features", feats);
  return out;
}

Napi::Value GetForegroundInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND fg = GetForegroundWindow();
  DWORD pid = 0;
  DWORD tid = 0;
  if (fg) {
    tid = GetWindowThreadProcessId(fg, &pid);
  }

  DWORD myPid = GetCurrentProcessId();

  Napi::Object out = Napi::Object::New(env);
  out.Set("hwnd", Napi::String::New(env, HwndToString(fg)));
  out.Set("pid", Napi::Number::New(env, pid));
  out.Set("threadId", Napi::Number::New(env, tid));
  out.Set("isCurrentProcess", Napi::Boolean::New(env, pid == myPid));
  return out;
}

Napi::Value ActivateWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected window handle").ThrowAsJavaScriptException();
    return env.Null();
  }

  HWND hwnd = ParseHwnd(info[0]);
  if (!hwnd || !IsWindow(hwnd)) {
    return Napi::Boolean::New(env, false);
  }

  // Ensure window is shown
  if (!IsWindowVisible(hwnd)) {
    ShowWindow(hwnd, SW_SHOW);
  }

  // Win32 foreground activation sequence
  DWORD fgThread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
  DWORD curThread = GetCurrentThreadId();

  if (fgThread != curThread) {
    AttachThreadInput(curThread, fgThread, TRUE);
  }

  SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
  BringWindowToTop(hwnd);
  SetForegroundWindow(hwnd);
  SetActiveWindow(hwnd);
  SetFocus(hwnd);

  if (fgThread != curThread) {
    AttachThreadInput(curThread, fgThread, FALSE);
  }

  HWND active = GetActiveWindow();
  return Napi::Boolean::New(env, active == hwnd || GetForegroundWindow() == hwnd);
}

Napi::Value SetAlwaysOnTop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected (hwnd, isTopmost)").ThrowAsJavaScriptException();
    return env.Null();
  }

  HWND hwnd = ParseHwnd(info[0]);
  bool topmost = info[1].As<Napi::Boolean>().Value();
  if (!hwnd || !IsWindow(hwnd)) return Napi::Boolean::New(env, false);

  HWND insertAfter = topmost ? HWND_TOPMOST : HWND_NOTOPMOST;
  UINT flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;
  BOOL ok = SetWindowPos(hwnd, insertAfter, 0, 0, 0, 0, flags);
  return Napi::Boolean::New(env, ok != FALSE);
}

Napi::Value SetWindowStyles(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3) {
    Napi::TypeError::New(env, "Expected (hwnd, removeMask, addMask)").ThrowAsJavaScriptException();
    return env.Null();
  }

  HWND hwnd = ParseHwnd(info[0]);
  if (!hwnd || !IsWindow(hwnd)) return env.Null();

  LONG_PTR removeMask = static_cast<LONG_PTR>(info[1].As<Napi::Number>().Int64Value());
  LONG_PTR addMask = static_cast<LONG_PTR>(info[2].As<Napi::Number>().Int64Value());

  LONG_PTR current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  LONG_PTR updated = (current & ~removeMask) | addMask;

  if (updated != current) {
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, updated);
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE);
  }

  LONG_PTR finalStyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  Napi::Object res = Napi::Object::New(env);
  res.Set("exStyle", Napi::Number::New(env, static_cast<double>(finalStyle)));
  res.Set("hasTopmost", Napi::Boolean::New(env, (finalStyle & WS_EX_TOPMOST) != 0));
  res.Set("hasToolWindow", Napi::Boolean::New(env, (finalStyle & WS_EX_TOOLWINDOW) != 0));
  res.Set("hasNoActivate", Napi::Boolean::New(env, (finalStyle & WS_EX_NOACTIVATE) != 0));
  return res;
}

Napi::Value SetCaptureAffinity(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected (hwnd, enable)").ThrowAsJavaScriptException();
    return env.Null();
  }

  HWND hwnd = ParseHwnd(info[0]);
  bool enable = info[1].As<Napi::Boolean>().Value();
  if (!hwnd || !IsWindow(hwnd)) return Napi::Boolean::New(env, false);

  DWORD affinity = enable ? 17 /* WDA_EXCLUDEFROMCAPTURE */ : 0 /* WDA_NONE */;
  BOOL ok = SetWindowDisplayAffinity(hwnd, affinity);
  return Napi::Boolean::New(env, ok != FALSE);
}

Napi::Value GetCaptureAffinity(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected (hwnd)").ThrowAsJavaScriptException();
    return env.Null();
  }

  HWND hwnd = ParseHwnd(info[0]);
  if (!hwnd || !IsWindow(hwnd)) return env.Null();

  DWORD affinity = 0;
  BOOL ok = GetWindowDisplayAffinity(hwnd, &affinity);
  Napi::Object out = Napi::Object::New(env);
  out.Set("ok", Napi::Boolean::New(env, ok != FALSE));
  out.Set("affinity", Napi::Number::New(env, affinity));
  return out;
}

Napi::Value GetFocusDiagnostics(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND target = info.Length() > 0 ? ParseHwnd(info[0]) : nullptr;

  GUITHREADINFO gti{};
  gti.cbSize = sizeof(GUITHREADINFO);
  BOOL ok = GetGUIThreadInfo(0, &gti);

  HWND fg = GetForegroundWindow();

  Napi::Object out = Napi::Object::New(env);
  out.Set("ok", Napi::Boolean::New(env, ok != FALSE));
  out.Set("foregroundHwnd", Napi::String::New(env, HwndToString(fg)));
  out.Set("activeHwnd", Napi::String::New(env, HwndToString(gti.hwndActive)));
  out.Set("focusHwnd", Napi::String::New(env, HwndToString(gti.hwndFocus)));
  out.Set("captureHwnd", Napi::String::New(env, HwndToString(gti.hwndCapture)));

  if (target) {
    bool isFg = (fg == target);
    bool isActive = (gti.hwndActive == target);
    bool isFocus = (gti.hwndFocus == target || IsChild(target, gti.hwndFocus));
    out.Set("isTargetForeground", Napi::Boolean::New(env, isFg));
    out.Set("isTargetActive", Napi::Boolean::New(env, isActive));
    out.Set("isTargetFocused", Napi::Boolean::New(env, isFocus));
  }

  return out;
}

Napi::Value SafeAutoType(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected (targetHwnd, text, [delayMs])").ThrowAsJavaScriptException();
    return env.Null();
  }

  HWND target = ParseHwnd(info[0]);
  std::string utf8Text = info[1].As<Napi::String>().Utf8Value();
  int delayMs = info.Length() > 2 ? info[2].As<Napi::Number>().Int32Value() : 5;

  if (!target || !IsWindow(target)) {
    Napi::Error::New(env, "Target window handle is invalid").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Security check: verify that target window is actually in the foreground
  HWND currentFg = GetForegroundWindow();
  if (currentFg != target && !IsChild(target, currentFg)) {
    Napi::Error::New(env, "Target window is not foreground; autotype canceled for safety").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Convert UTF-8 to UTF-16
  int wideLen = MultiByteToWideChar(CP_UTF8, 0, utf8Text.c_str(), -1, nullptr, 0);
  if (wideLen <= 1) {
    return Napi::Number::New(env, 0);
  }

  std::vector<wchar_t> wideStr(wideLen);
  MultiByteToWideChar(CP_UTF8, 0, utf8Text.c_str(), -1, wideStr.data(), wideLen);

  // Wait for modifier keys to be released
  const int modKeys[] = { VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN };
  for (int w = 0; w < 250; ++w) {
    bool anyMod = false;
    for (int vk : modKeys) {
      if ((GetAsyncKeyState(vk) & 0x8000) != 0) { anyMod = true; break; }
    }
    if (!anyMod) break;
    Sleep(20);
  }

  int typedCount = 0;
  for (size_t i = 0; i < wideStr.size() - 1; ++i) {
    wchar_t ch = wideStr[i];

    // Verify window is still foreground
    if (GetForegroundWindow() != target && !IsChild(target, GetForegroundWindow())) {
      break;
    }

    if (ch == L'\r') continue;

    if (ch == L'\n') {
      INPUT down{}; down.type = INPUT_KEYBOARD; down.ki.wVk = VK_RETURN; down.ki.dwFlags = 0;
      INPUT up{}; up.type = INPUT_KEYBOARD; up.ki.wVk = VK_RETURN; up.ki.dwFlags = KEYEVENTF_KEYUP;
      SendInput(1, &down, sizeof(INPUT));
      Sleep(18);
      SendInput(1, &up, sizeof(INPUT));
    } else if (ch == L'\t') {
      INPUT down{}; down.type = INPUT_KEYBOARD; down.ki.wVk = VK_TAB; down.ki.dwFlags = 0;
      INPUT up{}; up.type = INPUT_KEYBOARD; up.ki.wVk = VK_TAB; up.ki.dwFlags = KEYEVENTF_KEYUP;
      SendInput(1, &down, sizeof(INPUT));
      Sleep(18);
      SendInput(1, &up, sizeof(INPUT));
    } else {
      INPUT down{};
      down.type = INPUT_KEYBOARD;
      down.ki.wScan = ch;
      down.ki.dwFlags = KEYEVENTF_UNICODE;
      SendInput(1, &down, sizeof(INPUT));

      Sleep(18);

      INPUT up{};
      up.type = INPUT_KEYBOARD;
      up.ki.wScan = ch;
      up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      SendInput(1, &up, sizeof(INPUT));
    }

    typedCount++;

    if (delayMs > 0) {
      int remaining = delayMs;
      while (remaining > 0) {
        int step = (remaining > 10) ? 10 : remaining;
        Sleep(step);
        remaining -= step;
      }
    }
  }

  return Napi::Number::New(env, typedCount);
}

Napi::Value OptimizeWorkingSet(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE hProc = GetCurrentProcess();
  BOOL emptyOk = EmptyWorkingSet(hProc);
  BOOL setOk = SetProcessWorkingSetSize(hProc, static_cast<SIZE_T>(-1), static_cast<SIZE_T>(-1));
  Napi::Object res = Napi::Object::New(env);
  res.Set("ok", Napi::Boolean::New(env, emptyOk && setOk));
  return res;
}

Napi::Value IsElevatedAdmin(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE hToken = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
    Napi::Object res = Napi::Object::New(env);
    res.Set("isElevated", Napi::Boolean::New(env, false));
    res.Set("integrityLevel", Napi::Number::New(env, 0));
    return res;
  }
  TOKEN_ELEVATION elevation = {};
  DWORD cbSize = sizeof(TOKEN_ELEVATION);
  BOOL bElevated = FALSE;
  if (GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &cbSize)) {
    bElevated = elevation.TokenIsElevated != 0;
  }
  DWORD integrityLevel = 0;
  DWORD cbIL = 0;
  GetTokenInformation(hToken, TokenIntegrityLevel, nullptr, 0, &cbIL);
  if (GetLastError() == ERROR_INSUFFICIENT_BUFFER) {
    PTOKEN_MANDATORY_LABEL pTIL = reinterpret_cast<PTOKEN_MANDATORY_LABEL>(LocalAlloc(LPTR, cbIL));
    if (pTIL && GetTokenInformation(hToken, TokenIntegrityLevel, pTIL, cbIL, &cbIL)) {
      integrityLevel = *GetSidSubAuthority(
        pTIL->Label.Sid,
        static_cast<DWORD>(*GetSidSubAuthorityCount(pTIL->Label.Sid) - 1)
      );
      LocalFree(pTIL);
    }
  }
  CloseHandle(hToken);
  Napi::Object res = Napi::Object::New(env);
  res.Set("isElevated", Napi::Boolean::New(env, bElevated != FALSE));
  res.Set("integrityLevel", Napi::Number::New(env, integrityLevel));
  return res;
}

Napi::Value ConfigureUIPIFilters(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) return Napi::Boolean::New(env, false);
  HWND hwnd = ParseHwnd(info[0]);
  if (!hwnd || !IsWindow(hwnd)) return Napi::Boolean::New(env, false);

  typedef BOOL(WINAPI* PFN_ChangeWindowMessageFilterEx)(HWND, UINT, DWORD, PCHANGEFILTERSTRUCT);
  HMODULE hUser32 = GetModuleHandleW(L"user32.dll");
  if (!hUser32) return Napi::Boolean::New(env, false);

  PFN_ChangeWindowMessageFilterEx pfnChangeFilter = 
      reinterpret_cast<PFN_ChangeWindowMessageFilterEx>(GetProcAddress(hUser32, "ChangeWindowMessageFilterEx"));
  if (!pfnChangeFilter) return Napi::Boolean::New(env, false);

  UINT customIpcMsg = RegisterWindowMessageW(L"LensDesk_Native_IPC_Channel");
  const UINT allowedMessages[] = {
      WM_COPYDATA,
      WM_DROPFILES,
      WM_COMMAND,
      WM_SYSCOMMAND,
      customIpcMsg
  };
  bool allOk = true;
  for (UINT msg : allowedMessages) {
    if (msg == 0) continue;
    CHANGEFILTERSTRUCT cfs = {};
    cfs.cbSize = sizeof(CHANGEFILTERSTRUCT);
    if (!pfnChangeFilter(hwnd, msg, MSGFLT_ALLOW, &cfs)) {
      allOk = false;
    }
  }
  return Napi::Boolean::New(env, allOk);
}

Napi::Value SetOverlayClickThrough(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2) return Napi::Boolean::New(env, false);
  HWND hwnd = ParseHwnd(info[0]);
  bool enable = info[1].As<Napi::Boolean>().Value();
  if (!hwnd || !IsWindow(hwnd)) return Napi::Boolean::New(env, false);

  LONG_PTR exStyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  LONG_PTR targetStyle = enable ? (exStyle | WS_EX_TRANSPARENT) : (exStyle & ~WS_EX_TRANSPARENT);

  if (targetStyle != exStyle) {
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, targetStyle);
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE);
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value SendHardwareScancode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) return Napi::Boolean::New(env, false);
  WORD vkCode = static_cast<WORD>(info[0].As<Napi::Number>().Uint32Value());
  DWORD holdMs = info.Length() > 1 ? info[1].As<Napi::Number>().Uint32Value() : 20;

  WORD scanCode = static_cast<WORD>(MapVirtualKeyW(vkCode, MAPVK_VK_TO_VSC));
  DWORD flagsDown = KEYEVENTF_SCANCODE;
  DWORD flagsUp = KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP;

  if (vkCode == VK_LEFT || vkCode == VK_RIGHT || vkCode == VK_UP || vkCode == VK_DOWN ||
      vkCode == VK_PRIOR || vkCode == VK_NEXT || vkCode == VK_HOME || vkCode == VK_END ||
      vkCode == VK_INSERT || vkCode == VK_DELETE) {
    flagsDown |= KEYEVENTF_EXTENDEDKEY;
    flagsUp |= KEYEVENTF_EXTENDEDKEY;
  }

  INPUT inputs[2] = {};
  inputs[0].type = INPUT_KEYBOARD;
  inputs[0].ki.wScan = scanCode;
  inputs[0].ki.dwFlags = flagsDown;

  inputs[1].type = INPUT_KEYBOARD;
  inputs[1].ki.wScan = scanCode;
  inputs[1].ki.dwFlags = flagsUp;

  SendInput(1, &inputs[0], sizeof(INPUT));
  if (holdMs > 0) Sleep(holdMs);
  SendInput(1, &inputs[1], sizeof(INPUT));
  return Napi::Boolean::New(env, true);
}

Napi::Value PostBackgroundMessage(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4) return Napi::Boolean::New(env, false);
  HWND hwnd = ParseHwnd(info[0]);
  UINT msg = info[1].As<Napi::Number>().Uint32Value();
  bool lossless = true;
  WPARAM wParam = static_cast<WPARAM>(info[2].IsBigInt() ? info[2].As<Napi::BigInt>().Uint64Value(&lossless) : info[2].As<Napi::Number>().Int64Value());
  LPARAM lParam = static_cast<LPARAM>(info[3].IsBigInt() ? info[3].As<Napi::BigInt>().Int64Value(&lossless) : info[3].As<Napi::Number>().Int64Value());

  if (!hwnd || !IsWindow(hwnd)) return Napi::Boolean::New(env, false);
  BOOL ok = PostMessageW(hwnd, msg, wParam, lParam);
  return Napi::Boolean::New(env, ok != FALSE);
}

Napi::Value SendCaretNudge(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  WORD scanLeft = static_cast<WORD>(MapVirtualKeyW(VK_LEFT, MAPVK_VK_TO_VSC));
  WORD scanRight = static_cast<WORD>(MapVirtualKeyW(VK_RIGHT, MAPVK_VK_TO_VSC));

  INPUT leftIn[2] = {};
  leftIn[0].type = INPUT_KEYBOARD; leftIn[0].ki.wScan = scanLeft; leftIn[0].ki.dwFlags = KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY;
  leftIn[1].type = INPUT_KEYBOARD; leftIn[1].ki.wScan = scanLeft; leftIn[1].ki.dwFlags = KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP;
  SendInput(1, &leftIn[0], sizeof(INPUT));
  Sleep(10);
  SendInput(1, &leftIn[1], sizeof(INPUT));
  Sleep(10);

  INPUT rightIn[2] = {};
  rightIn[0].type = INPUT_KEYBOARD; rightIn[0].ki.wScan = scanRight; rightIn[0].ki.dwFlags = KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY;
  rightIn[1].type = INPUT_KEYBOARD; rightIn[1].ki.wScan = scanRight; rightIn[1].ki.dwFlags = KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP;
  SendInput(1, &rightIn[0], sizeof(INPUT));
  Sleep(10);
  SendInput(1, &rightIn[1], sizeof(INPUT));
  return Napi::Boolean::New(env, true);
}

// Module 3: Windows Desktop Session Integration (HintLens 1:1)
Napi::Value GetInputDesktopInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HDESK hDesk = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
  if (!hDesk) {
    hDesk = OpenInputDesktop(0, FALSE, GENERIC_READ);
  }
  if (!hDesk) {
    Napi::Object res = Napi::Object::New(env);
    res.Set("ok", Napi::Boolean::New(env, false));
    res.Set("desktop", Napi::String::New(env, "unknown"));
    res.Set("isDefault", Napi::Boolean::New(env, false));
    return res;
  }

  wchar_t name[256] = {};
  DWORD needed = 0;
  BOOL gotName = GetUserObjectInformationW(hDesk, UOI_NAME, name, sizeof(name), &needed);
  CloseDesktop(hDesk);

  if (!gotName) {
    Napi::Object res = Napi::Object::New(env);
    res.Set("ok", Napi::Boolean::New(env, false));
    res.Set("desktop", Napi::String::New(env, "unknown"));
    res.Set("isDefault", Napi::Boolean::New(env, false));
    return res;
  }

  int utf8Len = WideCharToMultiByte(CP_UTF8, 0, name, -1, nullptr, 0, nullptr, nullptr);
  std::string utf8Name(utf8Len > 0 ? utf8Len - 1 : 0, '\0');
  if (utf8Len > 1) {
    WideCharToMultiByte(CP_UTF8, 0, name, -1, &utf8Name[0], utf8Len, nullptr, nullptr);
  }

  bool isDefault = (_wcsicmp(name, L"Default") == 0);
  Napi::Object res = Napi::Object::New(env);
  res.Set("ok", Napi::Boolean::New(env, true));
  res.Set("desktop", Napi::String::New(env, utf8Name));
  res.Set("isDefault", Napi::Boolean::New(env, isDefault));
  return res;
}

// Module 4: Fullscreen Target Detection for Caret Nudge (HintLens [TypingSim] 1:1)
Napi::Value IsWindowFullscreen(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) return Napi::Boolean::New(env, false);
  HWND hwnd = ParseHwnd(info[0]);
  if (!hwnd || !IsWindow(hwnd)) return Napi::Boolean::New(env, false);

  RECT rcWin = {};
  if (!GetWindowRect(hwnd, &rcWin)) return Napi::Boolean::New(env, false);

  HMONITOR hMon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (!hMon) return Napi::Boolean::New(env, false);

  MONITORINFO mi = {};
  mi.cbSize = sizeof(MONITORINFO);
  if (!GetMonitorInfoW(hMon, &mi)) return Napi::Boolean::New(env, false);

  bool isFullscreen = (rcWin.left <= mi.rcMonitor.left &&
                       rcWin.top <= mi.rcMonitor.top &&
                       rcWin.right >= mi.rcMonitor.right &&
                       rcWin.bottom >= mi.rcMonitor.bottom);

  Napi::Object res = Napi::Object::New(env);
  res.Set("ok", Napi::Boolean::New(env, true));
  res.Set("isFullscreen", Napi::Boolean::New(env, isFullscreen));
  return res;
}

// Module 1: Per-Monitor V2 DPI Awareness Context (HintLens 1:1)
Napi::Value InitDpiAwareness(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  typedef BOOL(WINAPI* PFN_SetProcessDpiAwarenessContext)(HANDLE);
  HMODULE hUser32 = GetModuleHandleW(L"user32.dll");
  if (!hUser32) return Napi::Boolean::New(env, false);

  PFN_SetProcessDpiAwarenessContext pfnSetDpi =
      reinterpret_cast<PFN_SetProcessDpiAwarenessContext>(GetProcAddress(hUser32, "SetProcessDpiAwarenessContext"));
  if (pfnSetDpi) {
    BOOL ok = pfnSetDpi(reinterpret_cast<HANDLE>(-4)); // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    return Napi::Boolean::New(env, ok != FALSE);
  }
  return Napi::Boolean::New(env, false);
}

// Module 4: WinEvent Foreground Hook (HintLens SetWinEventHook 1:1)
static HWINEVENTHOOK g_hFgEventHook = nullptr;
static HWND g_lastReportedForeground = nullptr;

static void CALLBACK WinEventForegroundProc(
    HWINEVENTHOOK hWinEventHook,
    DWORD event,
    HWND hwnd,
    LONG idObject,
    LONG idChild,
    DWORD idEventThread,
    DWORD dwmsEventTime) {
  if (event == EVENT_SYSTEM_FOREGROUND && hwnd && IsWindow(hwnd)) {
    g_lastReportedForeground = hwnd;
  }
}

Napi::Value StartForegroundHook(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_hFgEventHook) return Napi::Boolean::New(env, true);
  g_hFgEventHook = SetWinEventHook(
      EVENT_SYSTEM_FOREGROUND,
      EVENT_SYSTEM_FOREGROUND,
      nullptr,
      WinEventForegroundProc,
      0,
      0,
      WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
  return Napi::Boolean::New(env, g_hFgEventHook != nullptr);
}

Napi::Value StopForegroundHook(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_hFgEventHook) {
    UnhookWinEvent(g_hFgEventHook);
    g_hFgEventHook = nullptr;
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value GetLastForegroundHwnd(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND fg = g_lastReportedForeground ? g_lastReportedForeground : GetForegroundWindow();
  return Napi::String::New(env, HwndToString(fg));
}

#else

// Non-Windows stub implementation for cross-platform builds and CI
Napi::Value Info(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  out.Set("available", Napi::Boolean::New(env, true));
#if defined(__APPLE__)
  out.Set("platform", Napi::String::New(env, "darwin"));
#else
  out.Set("platform", Napi::String::New(env, "linux"));
#endif
#if defined(__aarch64__) || defined(_M_ARM64)
  out.Set("arch", Napi::String::New(env, "arm64"));
#else
  out.Set("arch", Napi::String::New(env, "x64"));
#endif
  out.Set("mode", Napi::String::New(env, "portable-diagnostic"));
  out.Set("version", Napi::String::New(env, "2.0.0"));

  Napi::Object feats = Napi::Object::New(env);
  feats.Set("windowManager", Napi::Boolean::New(env, false));
  feats.Set("focusManager", Napi::Boolean::New(env, false));
  feats.Set("captureAffinity", Napi::Boolean::New(env, false));
  feats.Set("inputDiagnostics", Napi::Boolean::New(env, true));
  feats.Set("safeAutoType", Napi::Boolean::New(env, false));
  out.Set("features", feats);
  return out;
}

Napi::Value GetForegroundInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  out.Set("hwnd", Napi::String::New(env, "0"));
  out.Set("pid", Napi::Number::New(env, 0));
  out.Set("threadId", Napi::Number::New(env, 0));
  out.Set("isCurrentProcess", Napi::Boolean::New(env, true));
  return out;
}

Napi::Value ActivateWindow(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value SetAlwaysOnTop(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value SetWindowStyles(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object res = Napi::Object::New(env);
  res.Set("exStyle", Napi::Number::New(env, 0x88));
  res.Set("hasTopmost", Napi::Boolean::New(env, true));
  res.Set("hasToolWindow", Napi::Boolean::New(env, true));
  res.Set("hasNoActivate", Napi::Boolean::New(env, false));
  return res;
}

Napi::Value SetCaptureAffinity(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value GetCaptureAffinity(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  out.Set("ok", Napi::Boolean::New(env, true));
  out.Set("affinity", Napi::Number::New(env, 17));
  return out;
}

Napi::Value GetFocusDiagnostics(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  out.Set("ok", Napi::Boolean::New(env, true));
  out.Set("foregroundHwnd", Napi::String::New(env, "0"));
  out.Set("activeHwnd", Napi::String::New(env, "0"));
  out.Set("focusHwnd", Napi::String::New(env, "0"));
  out.Set("captureHwnd", Napi::String::New(env, "0"));
  out.Set("isTargetForeground", Napi::Boolean::New(env, true));
  out.Set("isTargetActive", Napi::Boolean::New(env, true));
  out.Set("isTargetFocused", Napi::Boolean::New(env, true));
  return out;
}

Napi::Value SafeAutoType(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), 0);
}

Napi::Value OptimizeWorkingSet(const Napi::CallbackInfo& info) {
  Napi::Object res = Napi::Object::New(info.Env());
  res.Set("ok", Napi::Boolean::New(info.Env(), true));
  return res;
}

Napi::Value IsElevatedAdmin(const Napi::CallbackInfo& info) {
  Napi::Object res = Napi::Object::New(info.Env());
  res.Set("isElevated", Napi::Boolean::New(info.Env(), false));
  res.Set("integrityLevel", Napi::Number::New(info.Env(), 0));
  return res;
}

Napi::Value ConfigureUIPIFilters(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value SetOverlayClickThrough(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value SendHardwareScancode(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value PostBackgroundMessage(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value SendCaretNudge(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value GetInputDesktopInfo(const Napi::CallbackInfo& info) {
  Napi::Object res = Napi::Object::New(info.Env());
  res.Set("ok", Napi::Boolean::New(info.Env(), true));
  res.Set("desktop", Napi::String::New(info.Env(), "Default"));
  res.Set("isDefault", Napi::Boolean::New(info.Env(), true));
  return res;
}

Napi::Value IsWindowFullscreen(const Napi::CallbackInfo& info) {
  Napi::Object res = Napi::Object::New(info.Env());
  res.Set("ok", Napi::Boolean::New(info.Env(), true));
  res.Set("isFullscreen", Napi::Boolean::New(info.Env(), false));
  return res;
}

Napi::Value InitDpiAwareness(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value StartForegroundHook(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value StopForegroundHook(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Value GetLastForegroundHwnd(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "0");
}

#endif  // _WIN32

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("info", Napi::Function::New(env, Info));
  exports.Set("getForegroundInfo", Napi::Function::New(env, GetForegroundInfo));
  exports.Set("activateWindow", Napi::Function::New(env, ActivateWindow));
  exports.Set("setAlwaysOnTop", Napi::Function::New(env, SetAlwaysOnTop));
  exports.Set("setWindowStyles", Napi::Function::New(env, SetWindowStyles));
  exports.Set("setCaptureAffinity", Napi::Function::New(env, SetCaptureAffinity));
  exports.Set("getCaptureAffinity", Napi::Function::New(env, GetCaptureAffinity));
  exports.Set("getFocusDiagnostics", Napi::Function::New(env, GetFocusDiagnostics));
  exports.Set("safeAutoType", Napi::Function::New(env, SafeAutoType));
  exports.Set("optimizeWorkingSet", Napi::Function::New(env, OptimizeWorkingSet));
  exports.Set("isElevatedAdmin", Napi::Function::New(env, IsElevatedAdmin));
  exports.Set("configureUIPIFilters", Napi::Function::New(env, ConfigureUIPIFilters));
  exports.Set("setOverlayClickThrough", Napi::Function::New(env, SetOverlayClickThrough));
  exports.Set("sendHardwareScancode", Napi::Function::New(env, SendHardwareScancode));
  exports.Set("postBackgroundMessage", Napi::Function::New(env, PostBackgroundMessage));
  exports.Set("sendCaretNudge", Napi::Function::New(env, SendCaretNudge));
  exports.Set("getInputDesktopInfo", Napi::Function::New(env, GetInputDesktopInfo));
  exports.Set("isWindowFullscreen", Napi::Function::New(env, IsWindowFullscreen));
  exports.Set("initDpiAwareness", Napi::Function::New(env, InitDpiAwareness));
  exports.Set("startForegroundHook", Napi::Function::New(env, StartForegroundHook));
  exports.Set("stopForegroundHook", Napi::Function::New(env, StopForegroundHook));
  exports.Set("getLastForegroundHwnd", Napi::Function::New(env, GetLastForegroundHwnd));
  return exports;
}

NODE_API_MODULE(win_diagnostic, Init)
