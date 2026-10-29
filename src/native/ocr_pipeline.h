// derived: rea/native/windows/src/filesystem.cc
#pragma once
#include "common.h"

namespace LensDesk::Native {

struct CapturedBuffer {
    std::vector<uint8_t> pixels;
    int width = 0;
    int height = 0;
    float scaleFactor = 1.0f;
    int biHeight = 0;
    int deleteObjectCalls = 0;
    int deleteDcCalls = 0;
    int releaseDcCalls = 0;
};

class OcrPipeline {
public:
    static CapturedBuffer CaptureDib(HWND hwnd, RECT logicalRect);
    static std::string ExtractText(const CapturedBuffer& buffer);
    static std::string FormatOutput(const std::string& extractedText);
    static const char* GetPromptPrefix() noexcept {
        return "The screen content below was extracted from the user's screenshot(s) by OCR (the question is in here). Answer it:\n\n";
    }
};

} // namespace LensDesk::Native
