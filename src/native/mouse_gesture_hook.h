// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"

namespace LensDesk::Native {

class MouseGestureHook {
public:
    static bool Install(HWND hostHwnd);
    static void Uninstall();
    static bool IsArmed() noexcept;
    static HWND CreateRadialOverlayWindow(HWND parent, int x, int y, int width = 300, int height = 300);

    // Testing and evaluation entry point for simulated mouse inputs
    static bool ProcessMouseMessage(WPARAM wParam, int x, int y, uint64_t timestampMs);
    static POINT GetLastTriggerPoint() noexcept { return s_lastTriggerPt; }

private:
    static HHOOK s_hook;
    static HWND s_hostHwnd;
    static HWND s_radialOverlayHwnd;
    static bool s_mbuttonDown;
    static uint64_t s_downTimeMs;
    static POINT s_downPt;
    static POINT s_lastTriggerPt;
};

} // namespace LensDesk::Native
