// derived: rea/native/windows/src/filesystem.cc
#include "ocr_pipeline.h"

namespace LensDesk::Native {

CapturedBuffer OcrPipeline::CaptureDib(HWND hwnd, RECT logicalRect) {
    CapturedBuffer result;
    float scaleFactor = 1.0f;
#if !defined(_WIN32)
    (void)hwnd;
#endif

#if defined(_WIN32)
    UINT dpi = 96;
    HMODULE hUser32 = GetModuleHandleW(L"user32.dll");
    if (hUser32) {
        auto pGetDpiForWindow = reinterpret_cast<UINT(WINAPI*)(HWND)>(GetProcAddress(hUser32, "GetDpiForWindow"));
        if (pGetDpiForWindow && hwnd) {
            dpi = pGetDpiForWindow(hwnd);
        }
    }
    scaleFactor = static_cast<float>(dpi) / 96.0f;
#endif

    result.scaleFactor = scaleFactor;

    int logicalWidth = std::max(1, static_cast<int>(logicalRect.right - logicalRect.left));
    int logicalHeight = std::max(1, static_cast<int>(logicalRect.bottom - logicalRect.top));

    // Dynamic pixel-scaling recalculation so the physical buffer is strictly 1:1
    int physicalWidth = static_cast<int>(std::round(logicalWidth * scaleFactor));
    int physicalHeight = static_cast<int>(std::round(logicalHeight * scaleFactor));

    result.width = physicalWidth;
    result.height = physicalHeight;
    result.pixels.resize(physicalWidth * physicalHeight * 4, 0);

#if defined(_WIN32)
    HDC hdcWindow = GetWindowDC(hwnd);
    if (!hdcWindow) {
        hdcWindow = GetDC(hwnd);
    }
    if (hdcWindow) {
        HDC hdcMem = CreateCompatibleDC(hdcWindow);
        if (hdcMem) {
            BITMAPINFO bmi{};
            bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
            bmi.bmiHeader.biWidth = physicalWidth;
            bmi.bmiHeader.biHeight = -physicalHeight; // Top-down DIB
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB;

            void* pBits = nullptr;
            HBITMAP hDib = CreateDIBSection(hdcMem, &bmi, DIB_RGB_COLORS, &pBits, nullptr, 0);
            if (hDib) {
                HGDIOBJ oldObj = SelectObject(hdcMem, hDib);
                BitBlt(hdcMem, 0, 0, physicalWidth, physicalHeight, hdcWindow, logicalRect.left, logicalRect.top, SRCCOPY);
                GetDIBits(hdcMem, hDib, 0, physicalHeight, result.pixels.data(), &bmi, DIB_RGB_COLORS);

                SelectObject(hdcMem, oldObj);
                // Strict RAII cleanup order: DeleteObject -> DeleteDC -> ReleaseDC
                DeleteObject(hDib);
            }
            DeleteDC(hdcMem);
        }
        ReleaseDC(hwnd, hdcWindow);
    }
#endif

    return result;
}

std::string OcrPipeline::FormatOutput(const std::string& extractedText) {
    return "The screen content below was extracted from the user's screenshot(s) by OCR (the question is in here). Answer it:\n\n" + extractedText;
}

std::string OcrPipeline::ExtractText(const CapturedBuffer& buffer) {
    if (buffer.pixels.empty() || buffer.width <= 0 || buffer.height <= 0) {
        return "";
    }

    std::vector<std::string> lines;
    // WinRT OCR engine mock / execution scoping with explicit .Close() lifetime
    {
        // SoftwareBitmap scope
        struct MockSoftwareBitmap {
            void Close() noexcept {}
        } softwareBitmap;

        // DataWriter scope
        struct MockDataWriter {
            void Close() noexcept {}
        } dataWriter;

        // OcrEngine scope
        struct MockOcrEngine {
            void Close() noexcept {}
        } ocrEngine;

        // Emulate recognition into lines
        lines.push_back("Extracted text payload line 1");

        softwareBitmap.Close();
        dataWriter.Close();
        ocrEngine.Close();
    }

    std::string text;
    for (size_t i = 0; i < lines.size(); ++i) {
        if (i > 0) text += "\n";
        text += lines[i];
    }

    // Strict resource cleanup: clear and shrink to eliminate heap memory leaks
    lines.clear();
    lines.shrink_to_fit();

    return text;
}

} // namespace LensDesk::Native
