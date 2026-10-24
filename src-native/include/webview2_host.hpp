#pragma once
#include "common.hpp"

namespace LensDesk {

class ServiceDispatcher;

class WebView2Host {
public:
    WebView2Host();
    ~WebView2Host();

    bool Initialize(
        HWND hwnd,
        IDCompositionVisual* hudVisual,
        const std::filesystem::path& distPath,
        ServiceDispatcher* dispatcher,
        std::function<void(ICoreWebView2Environment*)> onReady = nullptr
    );
    void Shutdown();

    void Resize(int width, int height);
    void SetBounds(int x, int y, int width, int height);
    void SetVisible(bool visible);

    void SendMouseInput(UINT msg, WPARAM wParam, LPARAM lParam);
    void MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON reason);

    void PostWebMessage(const json& message);
    void BroadcastEvent(const std::string& eventName, const json& eventData);

    bool IsReady() const { return m_isReady; }
    bool HasFocus() const { return m_hasFocus; }
    ICoreWebView2* GetWebView() const { return m_webView.Get(); }
    ICoreWebView2Controller* GetController() const { return m_controller.Get(); }
    ICoreWebView2CompositionController* GetCompositionController() const { return m_compositionController.Get(); }
    ICoreWebView2Environment* GetEnvironment() const { return m_environment.Get(); }

    using FocusChangedCallback = std::function<void(bool hasFocus)>;
    void SetFocusChangedCallback(FocusChangedCallback cb) { m_focusCallback = cb; }

    using MoveFocusRequestedCallback = std::function<void(COREWEBVIEW2_MOVE_FOCUS_REASON reason)>;
    void SetMoveFocusRequestedCallback(MoveFocusRequestedCallback cb) { m_moveFocusRequestedCallback = cb; }

private:
    void InjectLensDeskBridge();
    void SetupWebMessageHandling();
    void SetupFocusAndAcceleratorHandling();

    HWND m_hwnd = nullptr;
    std::filesystem::path m_distPath;
    ServiceDispatcher* m_dispatcher = nullptr;

    ComPtr<ICoreWebView2Environment> m_environment;
    ComPtr<ICoreWebView2Controller> m_controller;
    ComPtr<ICoreWebView2CompositionController> m_compositionController;
    ComPtr<ICoreWebView2> m_webView;

    bool m_isReady = false;
    bool m_hasFocus = false;

    EventRegistrationToken m_webMessageToken{};
    EventRegistrationToken m_gotFocusToken{};
    EventRegistrationToken m_lostFocusToken{};
    EventRegistrationToken m_moveFocusRequestedToken{};
    EventRegistrationToken m_acceleratorToken{};

    FocusChangedCallback m_focusCallback = nullptr;
    MoveFocusRequestedCallback m_moveFocusRequestedCallback = nullptr;
};

} // namespace LensDesk
