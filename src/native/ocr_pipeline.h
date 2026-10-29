// derived: rea/native/windows/src/filesystem.cc
#pragma once
#include "common.h"

namespace LensDesk::Native {

struct CapturedBuffer {
    std::vector<uint8_t> pixels;
    int width = 0;
    int height = 0;
    float scaleFactor = 1.0f;
};

class OcrPipeline {
public:
    static CapturedBuffer CaptureDib(HWND hwnd, RECT logicalRect);
    static std::string ExtractText(const CapturedBuffer& buffer);
    static std::string FormatOutput(const std::string& extractedText);
};

} // namespace LensDesk::Native
