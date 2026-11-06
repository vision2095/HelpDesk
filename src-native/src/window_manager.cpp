#include "../include/window_manager.hpp"
#include <algorithm>

namespace LensDesk {

WindowManager* WindowManager::s_instance = nullptr;

WindowManager::WindowManager() = default;

WindowManager::~WindowManager() {
    Shutdown();
}

bool WindowManager::Initialize(HINSTANCE hInstance, int nCmdShow) {
    m_hInstance = hInstance;

    // 1. Enable Per-Monitor V2 DPI awareness
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    // 2a. Register Owner Window Class (1:1 HintLens Parity at 0x140036518 - 0x140036571)
    WNDCLASSEXW owc{};
    owc.cbSize = sizeof(WNDCLASSEXW);
    owc.lpfnWndProc = DefWindowProcW;
    owc.hInstance = hInstance;
    owc.lpszClassName = WINDOW_CLASS_NAME_OWNER;
    RegisterClassExW(&owc);

    // 2b. Create Owner Tool Window (1:1 HintLens Parity at 0x14003657e - 0x1400365c7)
    // dwExStyle = WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOOLWINDOW (0x8000080)
    // dwStyle = WS_POPUP (0x80000000), 0x0 size, unowned (hWndParent = nullptr)
    m_hOwnerWnd = CreateWindowExW(
        WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOOLWINDOW,
        WINDOW_CLASS_NAME_OWNER,
        L"",
        WS_POPUP,
        0, 0, 0, 0,
        nullptr,
        nullptr,
        hInstance,
        nullptr
    );
    if (m_hOwnerWnd && m_captureProtection) {
        SetWindowDisplayAffinity(m_hOwnerWnd, WDA_EXCLUDEFROMCAPTURE);
    }

    // 2c. Register Main Overlay Window Class (1:1 HintLens Parity at 0x1400364c6 - 0x1400364db)
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(WNDCLASSEXW);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = nullptr; // DirectX / DirectComposition draws everything
    wc.lpszClassName = WINDOW_CLASS_NAME;
    wc.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wc.hIconSm = LoadIconW(nullptr, IDI_APPLICATION);

    if (!RegisterClassExW(&wc)) {
        DWORD err = GetLastError();
        if (err != ERROR_CLASS_ALREADY_EXISTS) {
            return false;
        }
    }

    // 3. Compute initial size and position centered on primary monitor
    HMONITOR hMon = MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO mi{ sizeof(MONITORINFO) };
    GetMonitorInfoW(hMon, &mi);

    int screenW = mi.rcWork.right - mi.rcWork.left;
    int screenH = mi.rcWork.bottom - mi.rcWork.top;
    int initW = std::min(1240, std::max(960, screenW - 140));
    int initH = std::min(840, std::max(680, screenH - 120));
    int initX = mi.rcWork.left + (screenW - initW) / 2;
    int initY = mi.rcWork.top + (screenH - initH) / 2;

    // 4. Extended Window Styles (1:1 HintLens Parity at 0x1400364ef - 0x140036500)
    // Stealth / Click-through: 0x080800a8 (WS_EX_NOREDIRECTIONBITMAP | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_TOPMOST)
    // Interactive: 0x082800a8 (0x080800a8 | WS_EX_APPWINDOW)
    DWORD exStyle = m_clickThrough ? 0x080800a8 : 0x082800a8;
    DWORD style = WS_POPUP;

    // 4a. Create Active Overlay Window owned by m_hOwnerWnd (1:1 HintLens Parity at 0x14003663d)
    m_hwnd = CreateWindowExW(
        exStyle,
        WINDOW_CLASS_NAME,
        L"", // Blank window caption for native overlay presentation (1:1 HintLens stealth parity)
        style,
        initX, initY, initW, initH,
        m_hOwnerWnd, // Owned by Tool Window -> Pinned in DWM Topmost Toolband!
        nullptr,
        hInstance,
        this
    );

    if (!m_hwnd) {
        return false;
    }

    // 4b. Set layered window attributes (1:1 HintLens Parity at 0x140036675)
    SetLayeredWindowAttributes(m_hwnd, 0, 255, LWA_ALPHA);

    // 4c. Extend DWM desktop composition frame across entire client area (1:1 HintLens Parity at 0x1400366a0)
    MARGINS margins = { -1, -1, -1, -1 };
    DwmExtendFrameIntoClientArea(m_hwnd, &margins);

    // 5. Query initial DPI
    m_dpi = GetDpiForWindow(m_hwnd);

    // 6. Apply Capture Protection (WDA_EXCLUDEFROMCAPTURE = 17, 1:1 HintLens Parity at 0x1400366c8)
    if (m_captureProtection) {
        SetWindowDisplayAffinity(m_hwnd, WDA_EXCLUDEFROMCAPTURE);
    }

    // 7. Setup system tray icon
    SetupTrayIcon();

    s_instance = this;

    // 8. Foreground and Reorder Event Hooks for 1:1 HintLens Z-order topmost parity
    // Uses WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS (0x2) exactly like HintLens native architecture (0x14000cf87 and 0x1400111b9)
    m_hForegroundHook = SetWinEventHook(
        EVENT_SYSTEM_FOREGROUND,
        EVENT_SYSTEM_FOREGROUND,
        nullptr,
        StaticWinEventProc,
        0,
        0,
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );

    m_hReorderHook = SetWinEventHook(
        EVENT_OBJECT_REORDER,
        EVENT_OBJECT_REORDER,
        nullptr,
        StaticWinEventProc,
        0,
        0,
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );

    // 9. Watchdog heartbeat timer (250ms, 4Hz - matching 0xFA in HintLens native architecture)
    SetTimer(m_hwnd, 1002, 250, nullptr);

    int showMode = (nCmdShow <= 0 || nCmdShow == SW_HIDE) ? SW_SHOWNOACTIVATE : nCmdShow;
    ShowWindow(m_hwnd, showMode);
    UpdateWindow(m_hwnd);
    EnforceTopmost();

    return true;
}

void WindowManager::Shutdown() {
    if (m_hwnd) {
        KillTimer(m_hwnd, 1002);
    }
    if (m_hForegroundHook) {
        UnhookWinEvent(m_hForegroundHook);
        m_hForegroundHook = nullptr;
    }
    if (m_hReorderHook) {
        UnhookWinEvent(m_hReorderHook);
        m_hReorderHook = nullptr;
    }
    if (s_instance == this) {
        s_instance = nullptr;
    }
    RemoveTrayIcon();
    if (m_hwnd) {
        DestroyWindow(m_hwnd);
        m_hwnd = nullptr;
    }
    if (m_hOwnerWnd) {
        DestroyWindow(m_hOwnerWnd);
        m_hOwnerWnd = nullptr;
    }
    if (m_hInstance) {
        UnregisterClassW(WINDOW_CLASS_NAME, m_hInstance);
        UnregisterClassW(WINDOW_CLASS_NAME_OWNER, m_hInstance);
        m_hInstance = nullptr;
    }
}

bool WindowManager::IsCoveredByAnotherWindow() const {
    if (!m_hwnd) return false;
    RECT rcMy{};
    if (!GetWindowRect(m_hwnd, &rcMy) || IsRectEmpty(&rcMy)) {
        return false;
    }

    HWND prev = GetWindow(m_hwnd, GW_HWNDPREV);
    int depth = 0;
    while (prev != nullptr && ++depth < 64) {
        if (prev != m_hwnd && prev != m_hOwnerWnd && IsWindowVisible(prev) && !IsChild(m_hwnd, prev)) {
            RECT rcPrev{};
            if (GetWindowRect(prev, &rcPrev) && !IsRectEmpty(&rcPrev)) {
                int pw = rcPrev.right - rcPrev.left;
                int ph = rcPrev.bottom - rcPrev.top;
                if (pw >= 10 || ph >= 10) {
                    RECT rcIntersect{};
                    if (IntersectRect(&rcIntersect, &rcMy, &rcPrev)) {
                        int iw = rcIntersect.right - rcIntersect.left;
                        int ih = rcIntersect.bottom - rcIntersect.top;
                        if (iw > 8 && ih > 8) {
                            return true;
                        }
                    }
                }
            }
        }
        prev = GetWindow(prev, GW_HWNDPREV);
    }
    return false;
}

void WindowManager::EnforceTopmost() {
    if (!m_hwnd || !m_alwaysOnTop || !m_isVisible) {
        return;
    }

    // Atomic re-entrancy and throttling guard (prevents DWM message storms and thread starvation)
    static std::atomic<bool> s_inEnforce{false};
    static std::atomic<ULONGLONG> s_lastEnforceTick{0};

    ULONGLONG now = GetTickCount64();
    if (now - s_lastEnforceTick.load() < 100) {
        return;
    }
    if (s_inEnforce.exchange(true)) {
        return;
    }
    s_lastEnforceTick.store(now);

    // 1. Ensure WS_EX_TOPMOST style bit is always explicitly present in extended style
    LONG_PTR exStyle = GetWindowLongPtrW(m_hwnd, GWL_EXSTYLE);
    if (!(exStyle & WS_EX_TOPMOST)) {
        SetWindowLongPtrW(m_hwnd, GWL_EXSTYLE, exStyle | WS_EX_TOPMOST);
    }

    // 2. Unconditionally position m_hwnd at the absolute head of the HWND_TOPMOST band (1:1 HintLens parity at 0x140010b70)
    // SWP_ASYNCWINDOWPOS (0x400) | SWP_NOACTIVATE (0x010) | SWP_NOMOVE (0x002) | SWP_NOSIZE (0x001) = 0x413
    SetWindowPos(
        m_hwnd,
        HWND_TOPMOST,
        0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS
    );

    s_inEnforce.store(false);
}

void CALLBACK WindowManager::StaticWinEventProc(
    HWINEVENTHOOK,
    DWORD event,
    HWND hwndEvent,
    LONG idObject,
    LONG,
    DWORD,
    DWORD
) {
    if (!s_instance || !s_instance->m_hwnd || !s_instance->m_alwaysOnTop || !s_instance->m_isVisible) {
        return;
    }

    // 1:1 HintLens parity at 0x140011104: idObject must be OBJID_WINDOW (0)
    if (idObject != 0) {
        return;
    }

    // Ignore events generated by our own overlay or owner window
    if (hwndEvent == s_instance->m_hwnd || hwndEvent == s_instance->m_hOwnerWnd) {
        return;
    }

    if (!IsWindowVisible(s_instance->m_hwnd)) {
        return;
    }

    if (event == EVENT_SYSTEM_FOREGROUND) {
        // In HintLens native architecture:
        // When foreground window changes, check if it covers our overlay
        if (s_instance->IsCoveredByAnotherWindow()) {
            s_instance->EnforceTopmost();
        }
    } else if (event == EVENT_OBJECT_REORDER) {
        // 1:1 HintLens Parity at 0x140011138 - 0x140011149:
        // GetWindow(m_hwnd, GW_HWNDPREV == 3)
        HWND prev = GetWindow(s_instance->m_hwnd, GW_HWNDPREV);
        if (prev != nullptr && prev != s_instance->m_hOwnerWnd && prev != s_instance->m_hwnd) {
            s_instance->EnforceTopmost();
        }
    }
}

void WindowManager::SetVisible(bool visible) {
    m_isVisible = visible;
    if (m_hwnd) {
        ShowWindow(m_hwnd, visible ? SW_SHOWNOACTIVATE : SW_HIDE);
        if (visible) {
            EnforceTopmost();
        }
    }
}

void WindowManager::SetAlwaysOnTop(bool alwaysOnTop) {
    m_alwaysOnTop = alwaysOnTop;
    if (m_hwnd) {
        if (alwaysOnTop) {
            EnforceTopmost();
        } else {
            SetWindowPos(
                m_hwnd,
                HWND_NOTOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
            );
        }
    }
}

void WindowManager::SetClickThrough(bool enable) {
    m_clickThrough = enable;
    if (m_hwnd) {
        // 1:1 HintLens Parity: 0x080800a8 (Stealth) vs 0x082800a8 (Interactive)
        DWORD exStyle = enable ? 0x080800a8 : 0x082800a8;
        SetWindowLongPtrW(m_hwnd, GWL_EXSTYLE, exStyle);
        SetWindowPos(
            m_hwnd,
            nullptr,
            0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE
        );
    }
}

void WindowManager::SetCaptureProtection(bool enable) {
    m_captureProtection = enable;
    if (m_hwnd) {
        SetWindowDisplayAffinity(m_hwnd, enable ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE);
    }
}

void WindowManager::SetOpacity(float opacity) {
    m_opacity = std::max(0.1f, std::min(1.0f, opacity));
    if (m_opacityCallback) {
        m_opacityCallback(m_opacity);
    }
}

WindowBounds WindowManager::GetBounds() const {
    WindowBounds bounds{};
    if (m_hwnd) {
        RECT rc{};
        GetWindowRect(m_hwnd, &rc);
        bounds.x = rc.left;
        bounds.y = rc.top;
        bounds.width = rc.right - rc.left;
        bounds.height = rc.bottom - rc.top;
    }
    return bounds;
}

void WindowManager::SetBounds(const WindowBounds& bounds) {
    if (m_hwnd) {
        SetWindowPos(
            m_hwnd,
            nullptr,
            bounds.x, bounds.y, bounds.width, bounds.height,
            SWP_NOZORDER | SWP_NOACTIVATE
        );
    }
}

void WindowManager::CenterOnPrimaryMonitor(int width, int height) {
    HMONITOR hMon = MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO mi{ sizeof(MONITORINFO) };
    GetMonitorInfoW(hMon, &mi);

    int screenW = mi.rcWork.right - mi.rcWork.left;
    int screenH = mi.rcWork.bottom - mi.rcWork.top;
    int x = mi.rcWork.left + (screenW - width) / 2;
    int y = mi.rcWork.top + (screenH - height) / 2;

    SetBounds({ x, y, width, height });
}

void WindowManager::DockToTopCenter(int width, int height) {
    HMONITOR hMon = MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO mi{ sizeof(MONITORINFO) };
    GetMonitorInfoW(hMon, &mi);

    int screenW = mi.rcWork.right - mi.rcWork.left;
    int x = mi.rcWork.left + (screenW - width) / 2;
    int y = mi.rcWork.top;

    SetBounds({ x, y, width, height });
}

void WindowManager::UpdateDpi(UINT dpi) {
    m_dpi = dpi;
}

void WindowManager::SetupTrayIcon() {
    if (m_hasTrayIcon || !m_hwnd) return;

    ZeroMemory(&m_trayData, sizeof(NOTIFYICONDATAW));
    m_trayData.cbSize = sizeof(NOTIFYICONDATAW);
    m_trayData.hWnd = m_hwnd;
    m_trayData.uID = 1001;
    m_trayData.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    m_trayData.uCallbackMessage = WM_LENSDESK_TRAY;
    m_trayData.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wcscpy_s(m_trayData.szTip, L"LensDesk 2.0 (Active)");

    Shell_NotifyIconW(NIM_ADD, &m_trayData);
    m_hasTrayIcon = true;
}

void WindowManager::RemoveTrayIcon() {
    if (m_hasTrayIcon) {
        Shell_NotifyIconW(NIM_DELETE, &m_trayData);
        m_hasTrayIcon = false;
    }
}

LRESULT CALLBACK WindowManager::StaticWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    WindowManager* pThis = nullptr;
    if (msg == WM_NCCREATE) {
        auto* cs = reinterpret_cast<CREATESTRUCTW*>(lParam);
        pThis = reinterpret_cast<WindowManager*>(cs->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(pThis));
    } else {
        pThis = reinterpret_cast<WindowManager*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    }

    if (pThis) {
        return pThis->HandleMessage(hwnd, msg, wParam, lParam);
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

LRESULT WindowManager::HandleMessage(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    // Give external callback (DirectX/ImGui/Focus router) first priority
    if (m_msgCallback) {
        bool handled = false;
        LRESULT res = m_msgCallback(hwnd, msg, wParam, lParam, handled);
        if (handled) return res;
    }

    switch (msg) {
        case WM_GETMINMAXINFO: {
            auto* mmi = reinterpret_cast<MINMAXINFO*>(lParam);
            if (mmi) {
                mmi->ptMinTrackSize.x = 480;
                mmi->ptMinTrackSize.y = 320;
            }
            return 0;
        }

        case WM_NCHITTEST: {
            POINT pt = { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
            RECT rc{};
            GetWindowRect(hwnd, &rc);

            const int border = 8;
            bool left   = (pt.x >= rc.left && pt.x < rc.left + border);
            bool right  = (pt.x >= rc.right - border && pt.x < rc.right);
            bool top    = (pt.y >= rc.top && pt.y < rc.top + border);
            bool bottom = (pt.y >= rc.bottom - border && pt.y < rc.bottom);

            if (top && left)     return HTTOPLEFT;
            if (top && right)    return HTTOPRIGHT;
            if (bottom && left)  return HTBOTTOMLEFT;
            if (bottom && right) return HTBOTTOMRIGHT;
            if (left)            return HTLEFT;
            if (right)           return HTRIGHT;
            if (top)             return HTTOP;
            if (bottom)          return HTBOTTOM;

            break;
        }

        case WM_CLOSE: {
            DestroyWindow(hwnd);
            return 0;
        }

        case WM_TIMER: {
            if (wParam == 1002 && m_alwaysOnTop && m_isVisible && m_hwnd) {
                if (IsCoveredByAnotherWindow()) {
                    EnforceTopmost();
                }
            }
            return 0;
        }

        case WM_ACTIVATEAPP:
        case WM_ACTIVATE: {
            if (m_alwaysOnTop && m_isVisible && m_hwnd) {
                EnforceTopmost();
            }
            break;
        }
        case WM_NCACTIVATE: {
            break;
        }

        case WM_DPICHANGED: {
            m_dpi = HIWORD(wParam);
            auto* prc = reinterpret_cast<RECT*>(lParam);
            SetWindowPos(
                hwnd,
                nullptr,
                prc->left, prc->top,
                prc->right - prc->left, prc->bottom - prc->top,
                SWP_NOZORDER | SWP_NOACTIVATE
            );
            return 0;
        }

        case WM_LENSDESK_TRAY: {
            if (LOWORD(lParam) == WM_LBUTTONUP || LOWORD(lParam) == WM_RBUTTONUP) {
                SetVisible(!m_isVisible);
            }
            return 0;
        }

        case WM_DESTROY: {
            PostQuitMessage(0);
            return 0;
        }
    }

    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

} // namespace LensDesk
