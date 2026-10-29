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

    // 2. Register Window Class
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
    int initW = std::min(1040, screenW - 100);
    int initH = std::min(740, screenH - 100);
    int initX = mi.rcWork.left + (screenW - initW) / 2;
    int initY = mi.rcWork.top + (screenH - initH) / 2;

    // 4. Extended Window Styles: Topmost, ToolWindow (avoids alt-tab clutter if overlay), NoRedirectionBitmap for DirectComposition
    DWORD exStyle = WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOREDIRECTIONBITMAP;
    DWORD style = WS_POPUP | WS_VISIBLE;

    m_hwnd = CreateWindowExW(
        exStyle,
        WINDOW_CLASS_NAME,
        APP_NAME,
        style,
        initX, initY, initW, initH,
        nullptr,
        nullptr,
        hInstance,
        this
    );

    if (!m_hwnd) {
        return false;
    }

    // 5. Query initial DPI
    m_dpi = GetDpiForWindow(m_hwnd);

    // 6. Apply Capture Protection (WDA_EXCLUDEFROMCAPTURE = 17)
    if (m_captureProtection) {
        SetWindowDisplayAffinity(m_hwnd, WDA_EXCLUDEFROMCAPTURE);
    }

    // 7. Setup system tray icon
    SetupTrayIcon();

    s_instance = this;

    // 8. Foreground Event Hook for absolute 1:1 HintLens Z-order topmost parity
    m_hForegroundHook = SetWinEventHook(
        EVENT_SYSTEM_FOREGROUND,
        EVENT_SYSTEM_FOREGROUND,
        nullptr,
        StaticWinEventProc,
        0,
        0,
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );

    // 9. Watchdog heartbeat timer (200ms) to ensure DWM does not bury overlay
    SetTimer(m_hwnd, 1002, 200, nullptr);

    ShowWindow(m_hwnd, nCmdShow);
    UpdateWindow(m_hwnd);

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
    if (s_instance == this) {
        s_instance = nullptr;
    }
    RemoveTrayIcon();
    if (m_hwnd) {
        DestroyWindow(m_hwnd);
        m_hwnd = nullptr;
    }
    if (m_hInstance) {
        UnregisterClassW(WINDOW_CLASS_NAME, m_hInstance);
        m_hInstance = nullptr;
    }
}

void CALLBACK WindowManager::StaticWinEventProc(
    HWINEVENTHOOK,
    DWORD event,
    HWND,
    LONG,
    LONG,
    DWORD,
    DWORD
) {
    if (event == EVENT_SYSTEM_FOREGROUND && s_instance) {
        HWND fg = GetForegroundWindow();
        if (fg && fg != s_instance->m_hwnd && s_instance->m_hwnd && s_instance->m_alwaysOnTop && s_instance->m_isVisible) {
            SetWindowPos(
                s_instance->m_hwnd,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
            );
        }
    }
}

void WindowManager::SetVisible(bool visible) {
    m_isVisible = visible;
    if (m_hwnd) {
        ShowWindow(m_hwnd, visible ? SW_SHOW : SW_HIDE);
        if (visible) {
            SetForegroundWindow(m_hwnd);
        }
    }
}

void WindowManager::SetAlwaysOnTop(bool alwaysOnTop) {
    m_alwaysOnTop = alwaysOnTop;
    if (m_hwnd) {
        SetWindowPos(
            m_hwnd,
            alwaysOnTop ? HWND_TOPMOST : HWND_NOTOPMOST,
            0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
        );
    }
}

void WindowManager::SetClickThrough(bool enable) {
    m_clickThrough = enable;
    if (m_hwnd) {
        LONG_PTR exStyle = GetWindowLongPtrW(m_hwnd, GWL_EXSTYLE);
        if (enable) {
            exStyle |= WS_EX_TRANSPARENT;
        } else {
            exStyle &= ~WS_EX_TRANSPARENT;
        }
        SetWindowLongPtrW(m_hwnd, GWL_EXSTYLE, exStyle);
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
    if (m_hwnd) {
        LONG_PTR exStyle = GetWindowLongPtrW(m_hwnd, GWL_EXSTYLE);
        if (!(exStyle & WS_EX_LAYERED)) {
            SetWindowLongPtrW(m_hwnd, GWL_EXSTYLE, exStyle | WS_EX_LAYERED);
        }
        BYTE alpha = static_cast<BYTE>(m_opacity * 255.0f);
        SetLayeredWindowAttributes(m_hwnd, 0, alpha, LWA_ALPHA);
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
        case WM_WINDOWPOSCHANGING: {
            if (m_alwaysOnTop && m_isVisible) {
                auto* pwp = reinterpret_cast<WINDOWPOS*>(lParam);
                if (pwp && pwp->hwndInsertAfter != HWND_TOPMOST && !(pwp->flags & SWP_NOZORDER)) {
                    pwp->hwndInsertAfter = HWND_TOPMOST;
                }
            }
            break;
        }

        case WM_TIMER: {
            if (wParam == 1002 && m_alwaysOnTop && m_isVisible && m_hwnd) {
                HWND fg = GetForegroundWindow();
                if (fg != m_hwnd) {
                    SetWindowPos(
                        m_hwnd,
                        HWND_TOPMOST,
                        0, 0, 0, 0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
                    );
                }
            }
            return 0;
        }

        case WM_ACTIVATEAPP:
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
