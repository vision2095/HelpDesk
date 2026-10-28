#pragma once
#include "common.hpp"

namespace LensDesk {

struct WindowBounds {
    int x = 100;
    int y = 100;
    int width = 960;
    int height = 720;
};

class WindowManager {
public:
    WindowManager();
    ~WindowManager();

    bool Initialize(HINSTANCE hInstance, int nCmdShow);
    void Shutdown();

    HWND GetHwnd() const { return m_hwnd; }
    HINSTANCE GetHInstance() const { return m_hInstance; }

    void SetVisible(bool visible);
    bool IsVisible() const { return m_isVisible; }

    void SetAlwaysOnTop(bool alwaysOnTop);
    bool IsAlwaysOnTop() const { return m_alwaysOnTop; }

    void SetClickThrough(bool enable);
    bool IsClickThrough() const { return m_clickThrough; }

    void SetCaptureProtection(bool enable);
    bool IsCaptureProtection() const { return m_captureProtection; }

    void SetOpacity(float opacity);
    float GetOpacity() const { return m_opacity; }

    WindowBounds GetBounds() const;
    void SetBounds(const WindowBounds& bounds);
    void CenterOnPrimaryMonitor(int width, int height);
    void DockToTopCenter(int width, int height);

    void UpdateDpi(UINT dpi);
    UINT GetDpi() const { return m_dpi; }
    float GetDpiScale() const { return static_cast<float>(m_dpi) / 96.0f; }

    void SetupTrayIcon();
    void RemoveTrayIcon();

    // Callbacks
    using MessageCallback = std::function<LRESULT(HWND, UINT, WPARAM, LPARAM, bool&)>;
    void SetMessageCallback(MessageCallback callback) { m_msgCallback = callback; }

private:
    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
    LRESULT HandleMessage(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);

    HWND m_hwnd = nullptr;
    HINSTANCE m_hInstance = nullptr;
    bool m_isVisible = true;
    bool m_alwaysOnTop = true;
    bool m_clickThrough = false;
    bool m_captureProtection = true;
    float m_opacity = 1.0f;
    UINT m_dpi = 96;

    NOTIFYICONDATAW m_trayData{};
    bool m_hasTrayIcon = false;
    MessageCallback m_msgCallback = nullptr;
};

} // namespace LensDesk
