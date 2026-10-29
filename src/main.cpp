// derived: rea/native/windows/src/process.cc
#include "native/common.h"
#include "native/token_elevation.h"
#include "native/layout_watchdog.h"
#include "native/ocr_pipeline.h"
#include "native/focus_gate.h"
#include "native/typing_dynamics.h"
#include "native/wasapi_loopback.h"
#include "native/mouse_gesture_hook.h"
#include "native/hotkey_dispatcher.h"
#include "native/sanitization.h"
#include "native/webview2_bootstrap.h"

using namespace LensDesk::Native;

#if defined(_WIN32)
namespace {
    HotkeyDispatcher* g_hotkeyDispatcher = nullptr;
    LayoutWatchdog* g_layoutWatchdog = nullptr;
    HWND g_hostHwnd = nullptr;

    LRESULT CALLBACK MainWndProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
        switch (uMsg) {
            case WM_HOTKEY: {
                if (g_hotkeyDispatcher) {
                    g_hotkeyDispatcher->OnHotKey(static_cast<int>(wParam));
                    return 0;
                }
                break;
            }
            case WM_USER + 109: { // Trigger from mouse gesture hook
                int x = static_cast<short>(LOWORD(lParam));
                int y = static_cast<short>(HIWORD(lParam));
                MouseGestureHook::CreateRadialOverlayWindow(hwnd, x, y);
                return 0;
            }
            case WM_DESTROY: {
                if (g_layoutWatchdog) {
                    g_layoutWatchdog->Stop();
                }
                MouseGestureHook::Uninstall();
                if (g_hotkeyDispatcher) {
                    g_hotkeyDispatcher->OnDestroy(hwnd);
                }
                PostQuitMessage(0);
                return 0;
            }
            default:
                break;
        }
        return DefWindowProcW(hwnd, uMsg, wParam, lParam);
    }
}
#endif

#if defined(_WIN32)
int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR, int nCmdShow) {
    // 1. Mandatory UI Access Token Elevation check and self-relaunch
    TokenElevation::ElevateAndRelaunchSelf();

    // 2. Register Host Window Class
    const wchar_t* CLASS_NAME = L"LensDeskEnterpriseHostWindow";
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = MainWndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = CLASS_NAME;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    if (!RegisterClassExW(&wc)) {
        return 1;
    }

    // 3. Create Overlay Host HWND with layered presentation priority
    HWND hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
        CLASS_NAME,
        L"LensDesk Enterprise Host",
        WS_POPUP,
        0, 0, 100, 100,
        nullptr,
        nullptr,
        hInstance,
        nullptr
    );
    if (!hwnd) {
        UnregisterClassW(CLASS_NAME, hInstance);
        return 1;
    }
    g_hostHwnd = hwnd;

    // 4. Ordered RAII Subsystem Initialization
    HotkeyDispatcher hotkeyDispatcher;
    g_hotkeyDispatcher = &hotkeyDispatcher;
    hotkeyDispatcher.RegisterGlobalHotkeys(hwnd);

    LayoutWatchdog layoutWatchdog;
    g_layoutWatchdog = &layoutWatchdog;
    layoutWatchdog.Start(hwnd);

    MouseGestureHook::Install(hwnd);

    ShowWindow(hwnd, nCmdShow);
    UpdateWindow(hwnd);

    // 5. Native Message Pump
    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    // 6. Ordered Subsystem Teardown
    g_layoutWatchdog = nullptr;
    g_hotkeyDispatcher = nullptr;
    g_hostHwnd = nullptr;
    UnregisterClassW(CLASS_NAME, hInstance);

    return static_cast<int>(msg.wParam);
}
#endif

namespace LensDesk::Native {
bool VerifyMainHostContracts() {
    return true;
}
}

#if !defined(_WIN32)
#ifndef RUN_ALL_TESTS
int main() {
    return 0;
}
#endif
#endif
