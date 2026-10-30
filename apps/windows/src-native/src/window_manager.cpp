#include "../include/window_manager.hpp"
#include <algorithm>
#include <tlhelp32.h>

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

    // 4. Extended Window Styles: Topmost, ToolWindow (avoids alt-tab clutter if overlay), NoRedirectionBitmap for DirectComposition, Layered, NoActivate (1:1 HintLens parity)
    DWORD exStyle = WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOREDIRECTIONBITMAP | WS_EX_LAYERED | WS_EX_NOACTIVATE;
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

    // Set initial full opacity on layered overlay window (1:1 HintLens parity)
    SetLayeredWindowAttributes(m_hwnd, 0, 255, LWA_ALPHA);

    // 5. Query initial DPI
    m_dpi = GetDpiForWindow(m_hwnd);

    // 6. Apply Capture Protection (WDA_EXCLUDEFROMCAPTURE = 17)
    if (m_captureProtection) {
        SetWindowDisplayAffinity(m_hwnd, WDA_EXCLUDEFROMCAPTURE);
    }

    // 7. Setup system tray icon
    SetupTrayIcon();

    s_instance = this;

    // 8. Foreground and Location Event Hooks for absolute 1:1 HintLens Z-order topmost parity
    m_hForegroundHook = SetWinEventHook(
        EVENT_SYSTEM_FOREGROUND,
        EVENT_SYSTEM_FOREGROUND,
        nullptr,
        StaticWinEventProc,
        0,
        0,
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );

    m_hLocationHook = SetWinEventHook(
        EVENT_OBJECT_LOCATIONCHANGE,
        EVENT_OBJECT_LOCATIONCHANGE,
        nullptr,
        StaticWinEventProc,
        0,
        0,
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );

    // 9. Watchdog heartbeat timer (200ms) to ensure DWM does not bury overlay
    SetTimer(m_hwnd, 1002, 200, nullptr);

    // 10. Start continuous layout protection and proctor watcher background thread
    StartLayoutProtectionWorker();

    int showMode = (nCmdShow <= 0 || nCmdShow == SW_HIDE) ? SW_SHOWNORMAL : nCmdShow;
    ShowWindow(m_hwnd, showMode);
    SetForegroundWindow(m_hwnd);
    SetWindowPos(m_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
    UpdateWindow(m_hwnd);

    return true;
}

void WindowManager::Shutdown() {
    StopLayoutProtectionWorker();
    if (m_hwnd) {
        KillTimer(m_hwnd, 1002);
    }
    if (m_hForegroundHook) {
        UnhookWinEvent(m_hForegroundHook);
        m_hForegroundHook = nullptr;
    }
    if (m_hLocationHook) {
        UnhookWinEvent(m_hLocationHook);
        m_hLocationHook = nullptr;
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
    HWND hwndEvent,
    LONG,
    LONG,
    DWORD,
    DWORD
) {
    if (!s_instance || !s_instance->m_hwnd || !s_instance->m_alwaysOnTop || !s_instance->m_isVisible) {
        return;
    }

    if (hwndEvent == s_instance->m_hwnd) {
        return; // Don't react to our own window
    }

    if (event == EVENT_SYSTEM_FOREGROUND) {
        HWND fg = GetForegroundWindow();
        if (fg && fg != s_instance->m_hwnd) {
            SetWindowPos(
                s_instance->m_hwnd,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING
            );
        }
    } else if (event == EVENT_OBJECT_LOCATIONCHANGE) {
        // HintLens 1:1: Check if any visible window is currently positioned in front of our window in Z-order
        HWND prev = GetWindow(s_instance->m_hwnd, GW_HWNDPREV);
        if (prev != nullptr) {
            SetWindowPos(
                s_instance->m_hwnd,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING
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
                if (pwp) {
                    pwp->hwndInsertAfter = HWND_TOPMOST;
                    pwp->flags &= ~SWP_NOZORDER;
                }
            }
            break;
        }

        case WM_TIMER: {
            if (wParam == 1002 && m_alwaysOnTop && m_isVisible && m_hwnd) {
                HWND fg = GetForegroundWindow();
                HWND prev = GetWindow(m_hwnd, GW_HWNDPREV);
                if ((fg && fg != m_hwnd) || prev != nullptr) {
                    SetWindowPos(
                        m_hwnd,
                        HWND_TOPMOST,
                        0, 0, 0, 0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING
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

void WindowManager::StartLayoutProtectionWorker() {
    StopLayoutProtectionWorker();
    m_stopLayoutWorker = false;
    m_layoutWorkerThread = std::thread(&WindowManager::LayoutProtectionWorkerLoop, this);
}

void WindowManager::StopLayoutProtectionWorker() {
    m_stopLayoutWorker = true;
    if (m_layoutWorkerThread.joinable()) {
        m_layoutWorkerThread.join();
    }
}

void WindowManager::LayoutProtectionWorkerLoop() {
    const wchar_t* const proctorTargets[] = {
        L"LockDownBrowser.exe",
        L"SafeExamBrowser.exe",
        L"Guardian Browser.exe",
        L"PSI Secure Browser.exe",
        L"RespondusLockDown.exe",
        L"Proctorio.exe",
        L"Honorlock.exe",
        L"Examplify.exe"
    };

    while (!m_stopLayoutWorker) {
        // 1. Process Enumeration via Toolhelp32Snapshot
        bool proctorDetected = false;
        HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (hSnapshot != INVALID_HANDLE_VALUE) {
            PROCESSENTRY32W pe{ sizeof(PROCESSENTRY32W) };
            if (Process32FirstW(hSnapshot, &pe)) {
                do {
                    for (const auto* target : proctorTargets) {
                        if (_wcsicmp(pe.szExeFile, target) == 0) {
                            proctorDetected = true;
                            break;
                        }
                    }
                    if (proctorDetected) break;
                } while (Process32NextW(hSnapshot, &pe));
            }
            CloseHandle(hSnapshot);
        }

        m_proctorActive.store(proctorDetected);

        // 2. Enforce absolute topmost priority and capture protection
        if (m_hwnd && IsWindow(m_hwnd)) {
            if (proctorDetected || m_captureProtection) {
                // Ensure display affinity is rigidly locked
                SetWindowDisplayAffinity(m_hwnd, WDA_EXCLUDEFROMCAPTURE);
            }

            if (proctorDetected) {
                // Explicitly detach and reparent to Desktop to prevent layout suppression by kiosk processes
                SetParent(m_hwnd, GetDesktopWindow());

                // Execute aggressive 5ms window constraint loop while proctor is active
                for (int fastPulse = 0; fastPulse < 60 && !m_stopLayoutWorker; ++fastPulse) {
                    if (m_alwaysOnTop && m_isVisible) {
                        SetWindowPos(
                            m_hwnd,
                            HWND_TOPMOST,
                            0, 0, 0, 0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING
                        );
                    }
                    std::this_thread::sleep_for(std::chrono::milliseconds(5));
                }
                continue;
            } else if (m_alwaysOnTop && m_isVisible) {
                HWND fg = GetForegroundWindow();
                HWND prev = GetWindow(m_hwnd, GW_HWNDPREV);
                if ((fg && fg != m_hwnd) || prev != nullptr) {
                    SetWindowPos(
                        m_hwnd,
                        HWND_TOPMOST,
                        0, 0, 0, 0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING
                    );
                }
            }
        }

        // Interruptible sleep interval (~300ms) when no proctor is active
        for (int i = 0; i < 30 && !m_stopLayoutWorker; ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
    }
}

} // namespace LensDesk
