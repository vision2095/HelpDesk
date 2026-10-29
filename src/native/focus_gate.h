// derived: rea/native/windows/src/process.cc
#pragma once
#include "common.h"

namespace LensDesk::Native {

struct TypingResult {
    size_t typedChars = 0;
    size_t driftAt = 0;
    bool completed = false;
};

class FocusGate {
public:
    static bool CheckFocus(HWND targetHwnd);
    static TypingResult TypeString(HWND targetHwnd, const std::wstring& text, size_t startIndex = 0);
};

} // namespace LensDesk::Native
