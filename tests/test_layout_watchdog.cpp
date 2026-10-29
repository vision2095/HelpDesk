// derived: rea/native/windows/src/process.cc
#include "../src/native/layout_watchdog.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

int run_test_layout_watchdog() {
    LensDesk::Test::ResetAssertionCounter();

    LayoutWatchdog watchdog;
    CHECK(!watchdog.IsRunning());

    RECT r{ 100, 150, 900, 750 };
    watchdog.UpdateCachedRect(r);
    RECT cached = watchdog.GetCachedRect();
    CHECK(cached.left == 100);
    CHECK(cached.top == 150);
    CHECK(cached.right == 900);
    CHECK(cached.bottom == 750);

    // Explicit dimensions verification
    int width = cached.right - cached.left;
    int height = cached.bottom - cached.top;
    CHECK(width == 800);
    CHECK(height == 600);

    HWND mockHwnd = reinterpret_cast<HWND>(0x1234);

    // Mutation check against SWP flags: EnforceWindowLayout with correct flags succeeds
    UINT validFlags = LayoutWatchdog::GetRequiredSwpFlags();
    CHECK((validFlags & SWP_NOACTIVATE) != 0);
    CHECK((validFlags & SWP_SHOWWINDOW) != 0);
    CHECK((validFlags & SWP_NOSIZE) == 0);
    CHECK((validFlags & SWP_NOMOVE) == 0);
    CHECK(LayoutWatchdog::EnforceWindowLayout(mockHwnd, r, validFlags));

    // Mutation check: Omitting SWP_NOACTIVATE MUST be rejected
    UINT missingNoActivate = SWP_SHOWWINDOW;
    CHECK(!LayoutWatchdog::EnforceWindowLayout(mockHwnd, r, missingNoActivate));

    // Mutation check: Omitting SWP_SHOWWINDOW MUST be rejected
    UINT missingShowWindow = SWP_NOACTIVATE;
    CHECK(!LayoutWatchdog::EnforceWindowLayout(mockHwnd, r, missingShowWindow));

    // Mutation check: Supplying SWP_NOSIZE or SWP_NOMOVE MUST be rejected (explicit rect enforced)
    CHECK(!LayoutWatchdog::EnforceWindowLayout(mockHwnd, r, validFlags | SWP_NOSIZE));
    CHECK(!LayoutWatchdog::EnforceWindowLayout(mockHwnd, r, validFlags | SWP_NOMOVE));

    // Mutation check: Zero or inverted dimensions MUST be rejected
    RECT invalidRect{ 100, 150, 100, 750 }; // width = 0
    CHECK(!LayoutWatchdog::EnforceWindowLayout(mockHwnd, invalidRect, validFlags));

    // Start with mock handle
    watchdog.Start(mockHwnd);
    CHECK(watchdog.IsRunning());

    // Allow worker loop to run iterations
    std::this_thread::sleep_for(std::chrono::milliseconds(25));
    CHECK(watchdog.IsRunning());

    watchdog.Stop();
    CHECK(!watchdog.IsRunning());

    std::cout << "[PASS] test_layout_watchdog: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_layout_watchdog();
}
#endif
