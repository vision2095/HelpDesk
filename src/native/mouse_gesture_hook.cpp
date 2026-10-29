// derived: rea/native/windows/src/authority.hpp
#include "mouse_gesture_hook.h"

namespace LensDesk::Native {

HHOOK MouseGestureHook::s_hook = nullptr;
HWND MouseGestureHook::s_hostHwnd = nullptr;
HWND MouseGestureHook::s_radialOverlayHwnd = nullptr;
bool MouseGestureHook::s_mbuttonDown = false;
uint64_t MouseGestureHook::s_downTimeMs = 0;
POINT MouseGestureHook::s_downPt{};
POINT MouseGestureHook::s_lastTriggerPt{};

#if defined(_WIN32)
static LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        auto* pMouse = reinterpret_cast<MSLLHOOKSTRUCT*>(lParam);
        if (pMouse) {
            uint64_t now = GetTickCount64();
            MouseGestureHook::ProcessMouseMessage(wParam, pMouse->pt.x, pMouse->pt.y, now);
        }
    }
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
}
#endif

bool MouseGestureHook::ProcessMouseMessage(WPARAM wParam, int x, int y, uint64_t timestampMs) {
    if (wParam == WM_MBUTTONDOWN) {
        s_mbuttonDown = true;
        s_downTimeMs = timestampMs;
        s_downPt.x = x;
        s_downPt.y = y;
        return false;
    }

    if (wParam == WM_MBUTTONUP) {
        s_mbuttonDown = false;
        return false;
    }

    if (wParam == WM_MOUSEMOVE && s_mbuttonDown) {
        uint64_t elapsed = timestampMs - s_downTimeMs;
        int dx = std::abs(x - s_downPt.x);
        int dy = std::abs(y - s_downPt.y);

        // Arm when elapsed >= 120 ms OR abs(dx)+abs(dy) > 5
        if (elapsed >= 120 || (dx + dy) > 5) {
            s_mbuttonDown = false; // Disarm to avoid redundant triggers
            s_lastTriggerPt.x = x;
            s_lastTriggerPt.y = y;

#if defined(_WIN32)
            if (s_hostHwnd) {
                LPARAM packed = MAKELPARAM(static_cast<WORD>(x), static_cast<WORD>(y));
                PostMessageW(s_hostHwnd, WM_USER + 109, 0, packed);
            }
            if (!s_radialOverlayHwnd || !IsWindow(s_radialOverlayHwnd)) {
                s_radialOverlayHwnd = CreateRadialOverlayWindow(s_hostHwnd, x, y);
            }
#endif
            return true;
        }
    }

    return false;
}

bool MouseGestureHook::IsArmed() noexcept {
    return s_mbuttonDown;
}

HWND MouseGestureHook::CreateRadialOverlayWindow(HWND parent, int x, int y, int width, int height) {
#if defined(_WIN32)
    const wchar_t* className = L"LensDeskRadialOverlay";
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = DefWindowProcW;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = className;
    RegisterClassExW(&wc);

    HWND hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
        className,
        L"Radial Overlay",
        WS_POPUP,
        x - (width / 2),
        y - (height / 2),
        width,
        height,
        parent,
        nullptr,
        GetModuleHandleW(nullptr),
        nullptr
    );

    if (hwnd) {
        // Setup 32-bit layered alpha
        HDC hdcScreen = GetDC(nullptr);
        HDC hdcMem = CreateCompatibleDC(hdcScreen);
        BITMAPINFO bmi{};
        bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        void* pvBits = nullptr;
        HBITMAP hBmp = CreateDIBSection(hdcMem, &bmi, DIB_RGB_COLORS, &pvBits, nullptr, 0);
        if (hBmp) {
            SelectObject(hdcMem, hBmp);
            POINT ptSrc{ 0, 0 };
            SIZE sizeWnd{ width, height };
            POINT ptDst{ x - (width / 2), y - (height / 2) };
            BLENDFUNCTION blend{};
            blend.BlendOp = AC_SRC_OVER;
            blend.SourceConstantAlpha = 240;
            blend.AlphaFormat = AC_SRC_ALPHA;

            UpdateLayeredWindow(hwnd, hdcScreen, &ptDst, &sizeWnd, hdcMem, &ptSrc, 0, &blend, ULW_ALPHA);
            DeleteObject(hBmp);
        }
        DeleteDC(hdcMem);
        ReleaseDC(nullptr, hdcScreen);

        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    return hwnd;
#else
    (void)parent;
    (void)width;
    (void)height;
    s_lastTriggerPt.x = x;
    s_lastTriggerPt.y = y;
    return reinterpret_cast<HWND>(0x1234);
#endif
}

bool MouseGestureHook::Install(HWND hostHwnd) {
    s_hostHwnd = hostHwnd;
#if defined(_WIN32)
    if (s_hook) return true;
    s_hook = SetWindowsHookExW(WH_MOUSE_LL, LowLevelMouseProc, GetModuleHandleW(nullptr), 0);
    return s_hook != nullptr;
#else
    return true;
#endif
}

void MouseGestureHook::Uninstall() {
#if defined(_WIN32)
    if (s_hook) {
        UnhookWindowsHookEx(s_hook);
        s_hook = nullptr;
    }
    if (s_radialOverlayHwnd && IsWindow(s_radialOverlayHwnd)) {
        DestroyWindow(s_radialOverlayHwnd);
        s_radialOverlayHwnd = nullptr;
    }
#endif
    s_hostHwnd = nullptr;
}

} // namespace LensDesk::Native
