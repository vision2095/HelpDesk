#pragma once
#include "common.hpp"

namespace LensDesk {

class DCompEngine;
class FocusManager;

struct BrowserTab {
    std::string id;
    std::string url;
    std::string title;
    std::string error;
    bool canGoBack = false;
    bool canGoForward = false;
    bool isLoading = false;
    float zoomLevel = 1.0f;
};

struct BrowserLayout {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    bool visible = false;
};

struct BrowserDownload {
    std::string id;
    std::string name;
    std::string state = "progressing";
    int64_t received = 0;
    int64_t total = 0;
    ComPtr<ICoreWebView2DownloadOperation> operation;
    EventRegistrationToken bytesToken{};
    EventRegistrationToken stateToken{};
};

class BrowserTabsManager {
public:
    BrowserTabsManager();
    ~BrowserTabsManager();

    bool Initialize(
        HWND hwnd,
        ICoreWebView2Environment* env,
        IDCompositionVisual* browserVisual,
        DCompEngine* dcompEngine = nullptr,
        FocusManager* focusMgr = nullptr
    );
    void Shutdown();

    std::string CreateTab(const std::string& initialUrl);
    bool CloseTab(const std::string& id);
    bool SelectTab(const std::string& id);
    bool Navigate(const std::string& id, const std::string& url);
    bool GoBack(const std::string& id);
    bool GoForward(const std::string& id);
    bool Reload(const std::string& id);
    bool Stop(const std::string& id);
    bool Home(const std::string& homeUrl);
    bool Find(const std::string& text, bool forward, bool findNext);
    bool CancelDownload(const std::string& id);

    void SetLayout(const BrowserLayout& layout, float dpiScale = 0.0f);
    void SetDpiScale(float scale);
    BrowserLayout GetLayout() const { return m_layout; }
    float GetDpiScale() const { return m_dpiScale; }

    void SetZoom(const std::string& id, float factor);
    void ClearData();
    bool PasteBundle(const json& images, const std::string& note);

    json GetStateSnapshot() const;
    std::string GetActiveTabId() const { return m_activeTabId; }

    void SendMouseInput(UINT msg, WPARAM wParam, LPARAM lParam);
    void MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON reason);
    void FocusAddressBar();
    void FocusFind();

    using StateChangedCallback = std::function<void(const json& state)>;
    void SetStateChangedCallback(StateChangedCallback cb) { m_stateCallback = cb; }

    using FocusChangedCallback = std::function<void(bool hasFocus)>;
    void SetFocusChangedCallback(FocusChangedCallback cb) { m_focusCallback = cb; }

    using EventCallback = std::function<void(const std::string& eventName)>;
    void SetEventCallback(EventCallback cb) { m_eventCallback = cb; }

    bool HasActiveTab() const { return !m_activeTabId.empty() && m_layout.visible; }
    bool HasFocus() const { return m_hasFocus; }

private:
    void NotifyStateChanged();
    void SetupFocusAndAcceleratorHandling();
    void SetupDownloadHandling();
    void ApplyLayout();
    void UpdateDownload(const std::string& id);

    HWND m_hwnd = nullptr;
    DCompEngine* m_dcompEngine = nullptr;
    FocusManager* m_focusMgr = nullptr;
    ComPtr<ICoreWebView2Environment> m_env;
    ComPtr<IDCompositionVisual> m_browserVisual;
    ComPtr<ICoreWebView2Controller> m_controller;
    ComPtr<ICoreWebView2CompositionController> m_compositionController;
    ComPtr<ICoreWebView2> m_webView;

    std::unordered_map<std::string, BrowserTab> m_tabs;
    std::vector<std::string> m_tabOrder;
    std::string m_activeTabId;
    BrowserLayout m_layout{};
    float m_dpiScale = 1.0f;
    bool m_hasFocus = false;
    bool m_ready = false;
    UINT64 m_latestNavigationId = 0;
    int m_tabSequence = 0;
    int m_downloadSequence = 0;
    std::vector<BrowserDownload> m_downloads;

    EventRegistrationToken m_gotFocusToken{};
    EventRegistrationToken m_lostFocusToken{};
    EventRegistrationToken m_moveFocusRequestedToken{};
    EventRegistrationToken m_acceleratorToken{};

    StateChangedCallback m_stateCallback = nullptr;
    FocusChangedCallback m_focusCallback = nullptr;
    EventCallback m_eventCallback = nullptr;
};

} // namespace LensDesk
