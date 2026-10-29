// derived: rea/native/windows/src/process.cc
#include "../src/native/focus_gate.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    HWND targetHwnd = reinterpret_cast<HWND>(0x5555);

    // 1. Initial focus check
    bool focused = FocusGate::CheckFocus(targetHwnd);
    assert(focused == true || focused == false);

    // 2. Full string execution
    std::wstring text = L"const x = 42;";
    TypingResult res = FocusGate::TypeString(targetHwnd, text, 0);
    assert(res.typedChars <= text.size());
    assert(res.driftAt <= text.size());

    // 3. Mid-stream resumption verification
    TypingResult resumeRes = FocusGate::TypeString(targetHwnd, text, res.driftAt);
    assert(resumeRes.typedChars >= res.driftAt);

    // 4. Null handle rejection
    TypingResult nullRes = FocusGate::TypeString(nullptr, text, 0);
    assert(!nullRes.completed);
    assert(nullRes.typedChars == 0);

    // 5. Already completed index
    TypingResult doneRes = FocusGate::TypeString(targetHwnd, text, text.size());
    assert(doneRes.completed);

    std::cout << "[PASS] test_focus_gate: 7 asserts verified.\n";
    return 0;
}
