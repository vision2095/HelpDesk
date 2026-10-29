// derived: rea/native/windows/src/process.cc
#include "focus_gate.h"

namespace LensDesk::Native {

bool FocusGate::CheckFocus(HWND targetHwnd) {
#if defined(_WIN32)
    return GetForegroundWindow() == targetHwnd;
#else
    return targetHwnd != nullptr;
#endif
}

TypingResult FocusGate::TypeString(HWND targetHwnd, const std::wstring& text, size_t startIndex) {
    TypingResult result;
    result.typedChars = startIndex;
    result.driftAt = startIndex;
    result.completed = false;

    if (!targetHwnd || startIndex >= text.size()) {
        if (startIndex >= text.size()) {
            result.completed = true;
        }
        return result;
    }

    for (size_t i = startIndex; i < text.size(); ++i) {
        // Per-character focus gate check
        if (!CheckFocus(targetHwnd)) {
            result.driftAt = i;
            result.completed = false;
            return result;
        }

#if defined(_WIN32)
        // BlockInput(TRUE) immediately before SendInput batch
        BlockInput(TRUE);

        wchar_t ch = text[i];
        INPUT inputs[2]{};
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wScan = ch;
        inputs[0].ki.dwFlags = KEYEVENTF_UNICODE;

        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wScan = ch;
        inputs[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

        SendInput(2, inputs, sizeof(INPUT));

        // BlockInput(FALSE) immediately after - never held across sleeps
        BlockInput(FALSE);
#endif

        result.typedChars = i + 1;
        result.driftAt = i + 1;

        // Bounded delay between characters without holding BlockInput
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    result.completed = true;
    return result;
}

} // namespace LensDesk::Native
