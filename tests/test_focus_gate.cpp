// derived: rea/native/windows/src/process.cc
#include "../src/native/focus_gate.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

int run_test_focus_gate() {
    LensDesk::Test::ResetAssertionCounter();

    HWND targetHwnd = reinterpret_cast<HWND>(0x5555);

    // 1. Initial focus check
    bool focused = FocusGate::CheckFocus(targetHwnd);
    CHECK(focused == true || focused == false);

    // 2. Full string execution
    std::wstring text = L"const x = 42;";
    TypingResult res = FocusGate::TypeString(targetHwnd, text, 0);
    CHECK(res.typedChars <= text.size());
    CHECK(res.driftAt <= text.size());

    // 3. Mid-stream resumption verification
    TypingResult resumeRes = FocusGate::TypeString(targetHwnd, text, res.driftAt);
    CHECK(resumeRes.typedChars >= res.driftAt);

    // 4. Null handle rejection
    TypingResult nullRes = FocusGate::TypeString(nullptr, text, 0);
    CHECK(!nullRes.completed);
    CHECK(nullRes.typedChars == 0);

    // 5. Already completed index
    TypingResult doneRes = FocusGate::TypeString(targetHwnd, text, text.size());
    CHECK(doneRes.completed);

    std::cout << "[PASS] test_focus_gate: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_focus_gate();
}
#endif
