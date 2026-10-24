#pragma once
#include "common.hpp"

namespace LensDesk {

class ServiceDispatcher;

class WebView2Host {
public:
    WebView2Host();
    ~WebView2Host();

    bool Initialize(HWND hwnd, IDCompositionVisual* hudVisual, const std::filesystem::path& distPath, ServiceDispatcher* dispatcher);
    void Shutdown();

    void Resize(int width, int height);
    void SetBounds(int x, int y, int width, int height);
    void SetVisible(bool visible);

    void SendMouseInput(UINT msg, WPARAM wParam, LPARAM lParam);
    void SendKeyboardInput(UINT msg, WPARAM wParam, LPARAM lParam);
    void MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON reason);

    void PostWebMessage(const json& message);
    void BroadcastEvent(const std::string& eventName, const json& eventData);

    bool IsReady() const { return m_isReady; }
    ICoreWebView2* GetWebView() const { return m_webView.Get(); }
    ICoreWebView2Controller* GetController() const { return m_controller.Get(); }
    ICoreWebView2CompositionController* GetCompositionController() const { return m_compositionController.Get(); }

private:
    void InjectLensDeskBridge();
    void SetupWebMessageHandling();

    HWND m_hwnd = nullptr;
    std::filesystem::path m_distPath;
    ServiceDispatcher* m_dispatcher = nullptr;

    ComPtr<ICoreWebView2Environment> m_environment;
    ComPtr<ICoreWebView2Controller> m_controller;
    ComPtr<ICoreWebView2CompositionController> m_compositionController;
    ComPtr<ICoreWebView2> m_webView;

    bool m_isReady = false;
    EventRegistrationToken m_webMessageToken{};
};

} // namespace LensDesk
