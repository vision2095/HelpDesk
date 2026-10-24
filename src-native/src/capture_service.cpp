#include "../include/capture_service.hpp"

namespace LensDesk {

CaptureService::CaptureService() = default;

CaptureService::~CaptureService() {
    Shutdown();
}

bool CaptureService::Initialize() {
    HRESULT hr = CoCreateInstance(
        CLSID_WICImagingFactory,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&m_wicFactory)
    );
    m_initialized = SUCCEEDED(hr);
    return m_initialized;
}

void CaptureService::Shutdown() {
    m_wicFactory.Reset();
    m_initialized = false;
}

struct MonitorEnumData {
    std::vector<RECT> monitors;
};

static BOOL CALLBACK MonitorEnumProc(HMONITOR hMon, HDC hdc, LPRECT rc, LPARAM lParam) {
    auto* data = reinterpret_cast<MonitorEnumData*>(lParam);
    data->monitors.push_back(*rc);
    return TRUE;
}

json CaptureService::GetSources(bool includeWindows) {
    json sources = json::array();

    // 1. Screens
    MonitorEnumData monData;
    EnumDisplayMonitors(nullptr, nullptr, MonitorEnumProc, reinterpret_cast<LPARAM>(&monData));

    for (size_t i = 0; i < monData.monitors.size(); ++i) {
        json s;
        s["id"] = "screen:" + std::to_string(i);
        s["name"] = "Screen " + std::to_string(i + 1);
        s["thumbnail"] = "";
        sources.push_back(s);
    }

    // 2. Windows
    if (includeWindows) {
        struct WindowEnumData {
            json* pSources;
            CaptureService* pService;
        } winData{ &sources, this };

        EnumWindows([](HWND hwnd, LPARAM lParam) -> BOOL {
            if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return TRUE;

            wchar_t title[256];
            int len = GetWindowTextW(hwnd, title, 256);
            if (len <= 0) return TRUE;

            RECT rc{};
            GetWindowRect(hwnd, &rc);
            if ((rc.right - rc.left) < 100 || (rc.bottom - rc.top) < 100) return TRUE;

            auto* data = reinterpret_cast<WindowEnumData*>(lParam);
            json w;
            w["id"] = "window:" + std::to_string(reinterpret_cast<uintptr_t>(hwnd));
            w["name"] = WideToUtf8(title);
            w["thumbnail"] = "";
            data->pSources->push_back(w);
            return TRUE;
        }, reinterpret_cast<LPARAM>(&winData));
    }

    return sources;
}

std::string CaptureService::CaptureScreen(int screenIndex) {
    MonitorEnumData monData;
    EnumDisplayMonitors(nullptr, nullptr, MonitorEnumProc, reinterpret_cast<LPARAM>(&monData));

    RECT targetRect{};
    if (screenIndex >= 0 && screenIndex < static_cast<int>(monData.monitors.size())) {
        targetRect = monData.monitors[screenIndex];
    } else {
        targetRect = { 0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN) };
    }

    CaptureRect cr{
        targetRect.left,
        targetRect.top,
        targetRect.right - targetRect.left,
        targetRect.bottom - targetRect.top
    };
    return CaptureRegion(cr);
}

std::string CaptureService::CaptureRegion(const CaptureRect& rect) {
    if (rect.width <= 0 || rect.height <= 0) return "";

    HDC hdcScreen = GetDC(nullptr);
    HDC hdcMem = CreateCompatibleDC(hdcScreen);
    HBITMAP hBitmap = CreateCompatibleBitmap(hdcScreen, rect.width, rect.height);
    HGDIOBJ hOld = SelectObject(hdcMem, hBitmap);

    BitBlt(hdcMem, 0, 0, rect.width, rect.height, hdcScreen, rect.x, rect.y, SRCCOPY | CAPTUREBLT);

    SelectObject(hdcMem, hOld);
    std::string base64Png = BitmapToPngBase64(hBitmap, hdcScreen, rect.width, rect.height);

    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(nullptr, hdcScreen);

    return base64Png;
}

std::string CaptureService::CaptureWindow(HWND targetHwnd) {
    if (!targetHwnd || !IsWindow(targetHwnd)) return "";

    RECT rc{};
    GetWindowRect(targetHwnd, &rc);
    int width = rc.right - rc.left;
    int height = rc.bottom - rc.top;
    if (width <= 0 || height <= 0) return "";

    HDC hdcScreen = GetDC(nullptr);
    HDC hdcMem = CreateCompatibleDC(hdcScreen);
    HBITMAP hBitmap = CreateCompatibleBitmap(hdcScreen, width, height);
    HGDIOBJ hOld = SelectObject(hdcMem, hBitmap);

    // Try PrintWindow with PW_RENDERFULLCONTENT first
    BOOL ok = PrintWindow(targetHwnd, hdcMem, 2 /*PW_RENDERFULLCONTENT*/);
    if (!ok) {
        // Fallback to BitBlt
        BitBlt(hdcMem, 0, 0, width, height, hdcScreen, rc.left, rc.top, SRCCOPY);
    }

    SelectObject(hdcMem, hOld);
    std::string base64Png = BitmapToPngBase64(hBitmap, hdcScreen, width, height);

    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(nullptr, hdcScreen);

    return base64Png;
}

std::string CaptureService::BitmapToPngBase64(HBITMAP hBitmap, HDC hdc, int width, int height) {
    if (!m_wicFactory || !hBitmap) return "";

    ComPtr<IWICBitmap> wicBitmap;
    HRESULT hr = m_wicFactory->CreateBitmapFromHBITMAP(
        hBitmap,
        nullptr,
        WICBitmapUseAlpha,
        &wicBitmap
    );
    if (FAILED(hr)) return "";

    ComPtr<IStream> stream;
    hr = CreateStreamOnHGlobal(nullptr, TRUE, &stream);
    if (FAILED(hr)) return "";

    ComPtr<IWICBitmapEncoder> encoder;
    hr = m_wicFactory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder);
    if (FAILED(hr)) return "";

    hr = encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache);
    if (FAILED(hr)) return "";

    ComPtr<IWICBitmapFrameEncode> frame;
    hr = encoder->CreateNewFrame(&frame, nullptr);
    if (FAILED(hr)) return "";

    hr = frame->Initialize(nullptr);
    if (FAILED(hr)) return "";

    hr = frame->SetSize(width, height);
    if (FAILED(hr)) return "";

    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    hr = frame->SetPixelFormat(&format);
    if (FAILED(hr)) return "";

    hr = frame->WriteSource(wicBitmap.Get(), nullptr);
    if (FAILED(hr)) return "";

    hr = frame->Commit();
    if (FAILED(hr)) return "";

    hr = encoder->Commit();
    if (FAILED(hr)) return "";

    // Read bytes from IStream
    STATSTG stat;
    hr = stream->Stat(&stat, STATFLAG_NONAME);
    if (FAILED(hr)) return "";

    ULONG streamSize = static_cast<ULONG>(stat.cbSize.QuadPart);
    std::vector<unsigned char> buffer(streamSize);

    LARGE_INTEGER liZero{};
    stream->Seek(liZero, STREAM_SEEK_SET, nullptr);

    ULONG bytesRead = 0;
    stream->Read(buffer.data(), streamSize, &bytesRead);

    std::string b64 = Base64Encode(buffer.data(), bytesRead);
    return "data:image/png;base64," + b64;
}

} // namespace LensDesk
