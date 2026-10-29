// derived: rea/native/windows/src/authority.hpp
#include "../src/native/mouse_gesture_hook.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    HWND mockHwnd = reinterpret_cast<HWND>(0x9999);
    bool installed = MouseGestureHook::Install(mockHwnd);
    assert(installed);

    // 1. Mouse button down arms state
    bool fired = MouseGestureHook::ProcessMouseMessage(WM_MBUTTONDOWN, 100, 100, 1000);
    assert(!fired);
    assert(MouseGestureHook::IsArmed());

    // 2. Micro movement below delta and time threshold does not trigger
    fired = MouseGestureHook::ProcessMouseMessage(WM_MOUSEMOVE, 101, 101, 1020);
    assert(!fired);
    assert(MouseGestureHook::IsArmed());

    // 3. Movement exceeding 5px delta triggers immediately
    fired = MouseGestureHook::ProcessMouseMessage(WM_MOUSEMOVE, 110, 100, 1030); // dx = 10 > 5
    assert(fired);
    assert(!MouseGestureHook::IsArmed());
    assert(MouseGestureHook::GetLastTriggerPoint().x == 110);
    assert(MouseGestureHook::GetLastTriggerPoint().y == 100);

    // 4. Time threshold >= 120ms triggers
    MouseGestureHook::ProcessMouseMessage(WM_MBUTTONDOWN, 200, 200, 2000);
    assert(MouseGestureHook::IsArmed());
    fired = MouseGestureHook::ProcessMouseMessage(WM_MOUSEMOVE, 201, 201, 2130); // 130ms elapsed >= 120ms
    assert(fired);
    assert(!MouseGestureHook::IsArmed());

    // 5. Radial Overlay creation
    HWND overlayHwnd = MouseGestureHook::CreateRadialOverlayWindow(mockHwnd, 150, 150);
    assert(overlayHwnd != nullptr);

    MouseGestureHook::Uninstall();
    assert(!MouseGestureHook::IsArmed());

    std::cout << "[PASS] test_mouse_gesture_hook: 14 asserts verified.\n";
    return 0;
}
