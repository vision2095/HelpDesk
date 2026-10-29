// derived: rea/native/windows/src/authority.hpp
#include "../src/native/mouse_gesture_hook.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

int run_test_mouse_gesture_hook() {
    LensDesk::Test::ResetAssertionCounter();

    HWND mockHwnd = reinterpret_cast<HWND>(0x9999);
    bool installed = MouseGestureHook::Install(mockHwnd);
    CHECK(installed);

    // 1. Mouse button down arms state
    bool fired = MouseGestureHook::ProcessMouseMessage(WM_MBUTTONDOWN, 100, 100, 1000);
    CHECK(!fired);
    CHECK(MouseGestureHook::IsArmed());

    // 2. Micro movement below delta and time threshold does not trigger
    fired = MouseGestureHook::ProcessMouseMessage(WM_MOUSEMOVE, 101, 101, 1020);
    CHECK(!fired);
    CHECK(MouseGestureHook::IsArmed());

    // 3. Movement exceeding 5px delta triggers immediately
    fired = MouseGestureHook::ProcessMouseMessage(WM_MOUSEMOVE, 110, 100, 1030); // dx = 10 > 5
    CHECK(fired);
    CHECK(!MouseGestureHook::IsArmed()); // Reset after firing

    // 4. Test time-based trigger >= 120ms
    MouseGestureHook::ProcessMouseMessage(WM_MBUTTONDOWN, 200, 200, 2000);
    CHECK(MouseGestureHook::IsArmed());

    fired = MouseGestureHook::ProcessMouseMessage(WM_MOUSEMOVE, 201, 201, 2150); // delta < 5, elapsed = 150 >= 120
    CHECK(fired);
    CHECK(!MouseGestureHook::IsArmed());

    // 5. Button up cancels gesture without triggering if threshold not met
    MouseGestureHook::ProcessMouseMessage(WM_MBUTTONDOWN, 300, 300, 3000);
    CHECK(MouseGestureHook::IsArmed());
    fired = MouseGestureHook::ProcessMouseMessage(WM_MBUTTONUP, 301, 301, 3050); // < 120ms and < 5px
    CHECK(!fired);
    CHECK(!MouseGestureHook::IsArmed());

    MouseGestureHook::Uninstall();
    CHECK(!MouseGestureHook::IsArmed());

    std::cout << "[PASS] test_mouse_gesture_hook: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_mouse_gesture_hook();
}
#endif
