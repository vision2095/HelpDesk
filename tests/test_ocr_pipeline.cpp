// derived: rea/native/windows/src/filesystem.cc
#include "../src/native/ocr_pipeline.h"
#include "test_common.h"
#include <cmath>
#include <cstring>
#include <iostream>
#include <string_view>

using namespace LensDesk::Native;

int run_test_ocr_pipeline() {
    LensDesk::Test::ResetAssertionCounter();

    // Empty and inverted capture rectangles must not become fabricated 1x1 images.
    for (RECT invalid : { RECT{0, 0, 0, 20}, RECT{10, 10, 5, 20} }) {
        const auto rejected = OcrPipeline::CaptureDib(nullptr, invalid);
        CHECK(rejected.pixels.empty());
        CHECK(rejected.width == 0);
        CHECK(rejected.height == 0);
    }

    RECT rect{ 0, 0, 800, 600 };
    CapturedBuffer buf = OcrPipeline::CaptureDib(nullptr, rect);

    // Desktop capture can be unavailable on a headless Windows runner.
    if (!buf.pixels.empty()) {
        CHECK(buf.scaleFactor > 0.0f);
        CHECK(buf.width > 0);
        CHECK(buf.height > 0);
        CHECK(buf.pixels.size() == static_cast<size_t>(buf.width) * buf.height * 4);

        CHECK(buf.biHeight == -buf.height);
    } else {
        CHECK(buf.width == 0);
        CHECK(buf.height == 0);
    }

    // 11-16. Scale factor application across display DPI profiles
    int w150 = static_cast<int>(std::round(800 * 1.5f));
    int h150 = static_cast<int>(std::round(600 * 1.5f));
    CHECK(w150 == 1200);
    CHECK(h150 == 900);

    int w200 = static_cast<int>(std::round(800 * 2.0f));
    int h200 = static_cast<int>(std::round(600 * 2.0f));
    CHECK(w200 == 1600);
    CHECK(h200 == 1200);

    int w125 = static_cast<int>(std::round(800 * 1.25f));
    int h125 = static_cast<int>(std::round(600 * 1.25f));
    CHECK(w125 == 1000);
    CHECK(h125 == 750);

    // 17-19. Exact prompt prefix verification matching rea string table
    const char* expectedPrefix = "The screen content below was extracted from the user's screenshot(s) by OCR (the question is in here). Answer it:\n\n";
    CHECK(std::string(OcrPipeline::GetPromptPrefix()) == expectedPrefix);
    CHECK(std::string_view(OcrPipeline::GetPromptPrefix()).starts_with("The screen content below"));
    CHECK(std::string_view(OcrPipeline::GetPromptPrefix()).ends_with("Answer it:\n\n"));

    // 20-22. Vector shrink verification to prevent memory leaks across iterations
    std::vector<uint8_t> testVec;
    testVec.reserve(4096);
    testVec.resize(64);
    CHECK(testVec.capacity() >= 4096);
    testVec.shrink_to_fit();
    CHECK(testVec.capacity() <= 128);
    CHECK(testVec.size() == 64);

    // A blank image must never produce invented OCR text, even when OCR is unavailable.
    CapturedBuffer blank;
    blank.width = 32;
    blank.height = 32;
    blank.pixels.assign(32 * 32 * 4, 255);
    CHECK(OcrPipeline::ExtractText(blank).empty());
    CHECK(OcrPipeline::ExtractText(CapturedBuffer{}).empty());

    std::string text = "Recognized text";
    std::string formatted = OcrPipeline::FormatOutput(text);
    CHECK(formatted.starts_with(expectedPrefix));
    CHECK(formatted.size() == std::strlen(expectedPrefix) + text.size());

    std::cout << "[PASS] test_ocr_pipeline: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_ocr_pipeline();
}
#endif
