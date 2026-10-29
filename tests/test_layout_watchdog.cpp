// derived: rea/native/windows/src/process.cc
#include "../src/native/layout_watchdog.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    LayoutWatchdog watchdog;
    assert(!watchdog.IsRunning());

    RECT r{ 100, 150, 900, 750 };
    watchdog.UpdateCachedRect(r);
    RECT cached = watchdog.GetCachedRect();
    assert(cached.left == 100);
    assert(cached.top == 150);
    assert(cached.right == 900);
    assert(cached.bottom == 750);

    // Start with mock handle
    HWND mockHwnd = reinterpret_cast<HWND>(0x1234);
    watchdog.Start(mockHwnd);
    assert(watchdog.IsRunning());

    // Allow worker loop to run iterations
    std::this_thread::sleep_for(std::chrono::milliseconds(25));
    assert(watchdog.IsRunning());

    watchdog.Stop();
    assert(!watchdog.IsRunning());

    std::cout << "[PASS] test_layout_watchdog: 8 asserts verified.\n";
    return 0;
}
