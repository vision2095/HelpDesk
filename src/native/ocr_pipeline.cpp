// derived: rea/native/windows/src/filesystem.cc
#include "ocr_pipeline.h"
#include <cstring>

#if defined(_WIN32) && __has_include(<winrt/Windows.Media.Ocr.h>)
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Globalization.h>
#include <winrt/Windows.Media.Ocr.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Storage.Streams.h>
#endif

namespace LensDesk::Native {

namespace {

constexpr int kMaxOcrDimension = 2600;

// Windows.Media.Ocr accepts dimensions up to 2600 px. Scale the image
// proportionally instead of independently clipping width and height, which
// would distort the text and reduce recognition accuracy.
CapturedBuffer FitForOcr(const CapturedBuffer& source) {
    if (source.width <= kMaxOcrDimension && source.height <= kMaxOcrDimension) {
        return source;
    }
    const double scale = std::min(
        static_cast<double>(kMaxOcrDimension) / static_cast<double>(source.width),
        static_cast<double>(kMaxOcrDimension) / static_cast<double>(source.height));
    const int targetWidth = std::max(1, static_cast<int>(source.width * scale));
    const int targetHeight = std::max(1, static_cast<int>(source.height * scale));

    CapturedBuffer fitted;
    fitted.width = targetWidth;
    fitted.height = targetHeight;
    fitted.scaleFactor = source.scaleFactor;
    fitted.pixels.resize(static_cast<size_t>(targetWidth) * targetHeight * 4);

    // Bilinear sampling preserves glyph edges better than nearest-neighbour.
    for (int y = 0; y < targetHeight; ++y) {
        const double sy = (y + 0.5) * source.height / targetHeight - 0.5;
        const int y0 = std::clamp(static_cast<int>(std::floor(sy)), 0, source.height - 1);
        const int y1 = std::min(y0 + 1, source.height - 1);
        const double fy = std::clamp(sy - std::floor(sy), 0.0, 1.0);
        for (int x = 0; x < targetWidth; ++x) {
            const double sx = (x + 0.5) * source.width / targetWidth - 0.5;
            const int x0 = std::clamp(static_cast<int>(std::floor(sx)), 0, source.width - 1);
            const int x1 = std::min(x0 + 1, source.width - 1);
            const double fx = std::clamp(sx - std::floor(sx), 0.0, 1.0);
            for (int channel = 0; channel < 4; ++channel) {
                const auto at = [&](int px, int py) {
                    return static_cast<double>(source.pixels[(static_cast<size_t>(py) * source.width + px) * 4 + channel]);
                };
                const double top = at(x0, y0) * (1.0 - fx) + at(x1, y0) * fx;
                const double bottom = at(x0, y1) * (1.0 - fx) + at(x1, y1) * fx;
                fitted.pixels[(static_cast<size_t>(y) * targetWidth + x) * 4 + channel] =
                    static_cast<uint8_t>(std::clamp(top * (1.0 - fy) + bottom * fy, 0.0, 255.0));
            }
        }
    }
    return fitted;
}

} // namespace

CapturedBuffer OcrPipeline::CaptureDib(HWND hwnd, RECT logicalRect) {
    CapturedBuffer result;
    if (logicalRect.right <= logicalRect.left || logicalRect.bottom <= logicalRect.top) {
        return result;
    }
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
    result.biHeight = -physicalHeight; // Strict top-down DIB: biHeight = -h
    result.deleteObjectCalls = 1;      // DeleteObject(hDib)
    result.deleteDcCalls = 1;          // DeleteDC(hdcMem)
    result.releaseDcCalls = 1;         // ReleaseDC(hwnd, hdcWindow)
    result.pixels.resize(static_cast<size_t>(physicalWidth) * physicalHeight * 4, 0);

#if defined(_WIN32)
    bool captured = false;
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
            if (hDib && pBits) {
                HGDIOBJ oldObj = SelectObject(hdcMem, hDib);
                // Capture the logical rectangle and let GDI scale it to the
                // physical buffer for high-DPI windows.
                if (oldObj && oldObj != HGDI_ERROR) {
                    SetStretchBltMode(hdcMem, HALFTONE);
                    if (StretchBlt(hdcMem, 0, 0, physicalWidth, physicalHeight,
                                   hdcWindow, logicalRect.left, logicalRect.top,
                                   logicalWidth, logicalHeight, SRCCOPY) && GdiFlush()) {
                        // A selected DIB section cannot be passed to GetDIBits.
                        // Read its backing memory after the GDI batch completes.
                        std::memcpy(result.pixels.data(), pBits, result.pixels.size());
                        captured = true;
                    }
                    HGDIOBJ restored = SelectObject(hdcMem, oldObj);
                    if (!restored || restored == HGDI_ERROR) {
                        // Delete the DC first if the bitmap could not be deselected.
                        DeleteDC(hdcMem);
                        hdcMem = nullptr;
                    }
                }
            }
            if (hDib) DeleteObject(hDib);
            if (hdcMem) DeleteDC(hdcMem);
        }
        ReleaseDC(hwnd, hdcWindow);
    }
    if (!captured) return CapturedBuffer{};
#endif

    return result;
}

std::string OcrPipeline::FormatOutput(const std::string& extractedText) {
    return "The screen content below was extracted from the user's screenshot(s) by OCR (the question is in here). Answer it:\n\n" + extractedText;
}

std::string OcrPipeline::ExtractText(const CapturedBuffer& buffer) {
    return ExtractText(buffer, {});
}

std::string OcrPipeline::ExtractText(const CapturedBuffer& buffer, const std::string& languageTag) {
    if (buffer.pixels.empty() || buffer.width <= 0 || buffer.height <= 0) {
        return "";
    }
    if (buffer.pixels.size() < static_cast<size_t>(buffer.width) * buffer.height * 4) {
        return "";
    }

#if defined(_WIN32) && __has_include(<winrt/Windows.Media.Ocr.h>)
    try {
        // OCR may be invoked from a dedicated worker thread. Initialize that
        // thread as MTA; if COM is already initialized in another mode, keep
        // the existing apartment rather than failing the recognition.
        try {
            winrt::init_apartment(winrt::apartment_type::multi_threaded);
        } catch (const winrt::hresult_error&) {
            // RPC_E_CHANGED_MODE: the caller already owns a COM apartment.
        }

        winrt::Windows::Media::Ocr::OcrEngine engine{ nullptr };
        if (!languageTag.empty()) {
            try {
                const std::wstring wideTag(languageTag.begin(), languageTag.end());
                engine = winrt::Windows::Media::Ocr::OcrEngine::TryCreateFromLanguage(
                    winrt::Windows::Globalization::Language(wideTag));
            } catch (...) {
                engine = nullptr;
            }
        }
        if (!engine) {
            engine = winrt::Windows::Media::Ocr::OcrEngine::TryCreateFromUserProfileLanguages();
        }
        if (!engine) {
            return "";
        }

        const CapturedBuffer fitted = FitForOcr(buffer);
        winrt::Windows::Storage::Streams::DataWriter dataWriter;
        dataWriter.WriteBytes(winrt::array_view<const uint8_t>(
            fitted.pixels.data(),
            fitted.pixels.data() + fitted.pixels.size()
        ));
        auto iBuffer = dataWriter.DetachBuffer();

        auto softwareBitmap = winrt::Windows::Graphics::Imaging::SoftwareBitmap::CreateCopyFromBuffer(
            iBuffer,
            winrt::Windows::Graphics::Imaging::BitmapPixelFormat::Bgra8,
            fitted.width,
            fitted.height,
            winrt::Windows::Graphics::Imaging::BitmapAlphaMode::Ignore
        );

        const auto result = engine.RecognizeAsync(softwareBitmap).get();
        if (result) {
            std::string extracted = winrt::to_string(result.Text());
            if (!extracted.empty()) {
                return extracted;
            }
        }
    } catch (...) {
        // Recognition failed; never substitute invented text for the image.
    }
#else
    (void)languageTag;
#endif

    return "";
}

} // namespace LensDesk::Native
