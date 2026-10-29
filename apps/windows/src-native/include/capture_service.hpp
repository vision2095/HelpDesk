#pragma once
#include "common.hpp"

namespace LensDesk {

struct CaptureRect {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
};

class CaptureService {
public:
    CaptureService();
    ~CaptureService();

    bool Initialize();
    void Shutdown();

    json GetSources(bool includeWindows = true);
    std::string CaptureScreen(int screenIndex = 0);
    std::string CaptureRegion(const CaptureRect& rect);
    std::string CaptureWindow(HWND targetHwnd);

    // Detached WinRT OCR Pipeline
    std::string PerformOcr(HBITMAP hBitmap, int width, int height);
    std::string PerformOcrOnBase64(const std::string& base64Png);
    bool IsOcrSupported();

private:
    std::string BitmapToPngBase64(HBITMAP hBitmap, HDC hdc, int width, int height);

    ComPtr<IWICImagingFactory> m_wicFactory;
    bool m_initialized = false;
};

} // namespace LensDesk
