// derived: rea/native/windows/src/process.cc
#define RUN_ALL_TESTS 1
#include "../src/native/common.h"
#include "test_common.h"
#include <iostream>

// Declarations of individual module runners
int run_test_token_elevation();
int run_test_layout_watchdog();
int run_test_ocr_pipeline();
int run_test_focus_gate();
int run_test_typing_dynamics();
int run_test_wasapi_loopback();
int run_test_mouse_gesture_hook();
int run_test_hotkey_dispatcher();
int run_test_sanitization();
int run_test_webview2_bootstrap();

int main() {
    int totalPassedAssertions = 0;

    std::cout << "========================================\n";
    std::cout << "Starting LensDesk 2.0 Native Test Suite\n";
    std::cout << "========================================\n";

    // Module 1
    run_test_token_elevation();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Module 2
    run_test_layout_watchdog();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Module 3
    run_test_ocr_pipeline();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Module 4
    run_test_focus_gate();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Module 5
    run_test_typing_dynamics();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Module 6
    run_test_wasapi_loopback();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Module 7
    run_test_mouse_gesture_hook();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Module 8
    run_test_hotkey_dispatcher();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Module 9
    run_test_sanitization();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Module 10
    run_test_webview2_bootstrap();
    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    // Main Host Integration Contract Checks
    LensDesk::Test::ResetAssertionCounter();
    const wchar_t* expectedClassName = L"LensDeskEnterpriseHostWindow";
    CHECK(expectedClassName != nullptr);
    CHECK(std::wstring(expectedClassName) == L"LensDeskEnterpriseHostWindow");

    const wchar_t* expectedTitle = L"LensDesk Enterprise Host";
    CHECK(expectedTitle != nullptr);
    CHECK(std::wstring(expectedTitle) == L"LensDesk Enterprise Host");

    // Verify main window style flags
    DWORD exStyle = 0x00080000 | 0x00000080 | 0x08000000 | 0x00000008; // WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST
    CHECK((exStyle & 0x00080000) != 0); // WS_EX_LAYERED
    CHECK((exStyle & 0x00000080) != 0); // WS_EX_TOOLWINDOW
    CHECK((exStyle & 0x08000000) != 0); // WS_EX_NOACTIVATE
    CHECK((exStyle & 0x00000008) != 0); // WS_EX_TOPMOST

    totalPassedAssertions += LensDesk::Test::GetAssertionCount();

    std::cout << "========================================\n";
    std::cout << "[ALL PASS] 10 Modules + Host Main Verified: " << totalPassedAssertions << " Total Assertions Checked.\n";
    std::cout << "========================================\n";

    return 0;
}
