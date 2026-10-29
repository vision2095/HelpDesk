// derived: rea/native/windows/src/filesystem.cc
#include "../src/native/ocr_pipeline.h"
#include "test_common.h"
#include <cmath>
#include <iostream>

using namespace LensDesk::Native;

int run_test_ocr_pipeline() {
    LensDesk::Test::ResetAssertionCounter();

    RECT rect{ 0, 0, 800, 600 };
    CapturedBuffer buf = OcrPipeline::CaptureDib(nullptr, rect);

    CHECK(buf.scaleFactor >= 1.0f);
    CHECK(buf.width >= 800);
    CHECK(buf.height >= 600);
    CHECK(buf.pixels.size() == static_cast<size_t>(buf.width * buf.height * 4));

    // Mutation check: Physical buffer MUST strictly equal logical * scaleFactor
    int expectedWidth = static_cast<int>(std::round(800 * buf.scaleFactor));
    int expectedHeight = static_cast<int>(std::round(600 * buf.scaleFactor));
    CHECK(buf.width == expectedWidth);
    CHECK(buf.height == expectedHeight);

    std::string text = OcrPipeline::ExtractText(buf);
    CHECK(!text.empty());

    // Prompt prefix check: Exact HintLens prompt string from rea string table
    std::string prefix = OcrPipeline::GetPromptPrefix();
    CHECK(prefix.find("The screen content below was extracted from the user's screenshot(s) by OCR") != std::string::npos);

    std::cout << "[PASS] test_ocr_pipeline: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_ocr_pipeline();
}
#endif
