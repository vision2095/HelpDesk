// derived: rea/native/windows/src/filesystem.cc
#include "../src/native/ocr_pipeline.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    RECT rect{ 0, 0, 800, 600 };
    CapturedBuffer buf = OcrPipeline::CaptureDib(nullptr, rect);

    assert(buf.scaleFactor >= 1.0f);
    assert(buf.width >= 800);
    assert(buf.height >= 600);
    assert(buf.pixels.size() == static_cast<size_t>(buf.width * buf.height * 4));

    std::string text = OcrPipeline::ExtractText(buf);
    assert(!text.empty());

    std::string formatted = OcrPipeline::FormatOutput(text);
    assert(formatted.find("The screen content below was extracted") != std::string::npos);
    assert(formatted.find("Answer it:\n\n") != std::string::npos);

    // Empty buffer test
    CapturedBuffer emptyBuf;
    assert(OcrPipeline::ExtractText(emptyBuf).empty());

    std::cout << "[PASS] test_ocr_pipeline: 8 asserts verified.\n";
    return 0;
}
