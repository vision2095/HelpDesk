#pragma once
#include "common.hpp"

namespace LensDesk {

struct BrowserTab {
    std::string id;
    std::string url;
    std::string title;
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

class BrowserTabsManager {
public:
    BrowserTabsManager();
    ~BrowserTabsManager();

    bool Initialize(HWND hwnd, ICoreWebView2Environment* env, IDCompositionVisual* browserVisual);
    void Shutdown();

    std::string CreateTab(const std::string& initialUrl);
    bool CloseTab(const std::string& id);
    bool SelectTab(const std::string& id);
    bool Navigate(const std::string& id, const std::string& url);
    bool GoBack(const std::string& id);
    bool GoForward(const std::string& id);
    bool Reload(const std::string& id);
    bool Stop(const std::string& id);

    void SetLayout(const BrowserLayout& layout);
    BrowserLayout GetLayout() const { return m_layout; }

    void SetZoom(const std::string& id, float factor);
    void ClearData();

    json GetStateSnapshot() const;

    void SendMouseInput(UINT msg, WPARAM wParam, LPARAM lParam);
    void SendKeyboardInput(UINT msg, WPARAM wParam, LPARAM lParam);
    void MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON reason);

    using StateChangedCallback = std::function<void(const json& state)>;
    void SetStateChangedCallback(StateChangedCallback cb) { m_stateCallback = cb; }

    bool HasActiveTab() const { return !m_activeTabId.empty() && m_layout.visible; }

private:
    void NotifyStateChanged();

    HWND m_hwnd = nullptr;
    ComPtr<ICoreWebView2Environment> m_env;
    ComPtr<IDCompositionVisual> m_browserVisual;
    ComPtr<ICoreWebView2Controller> m_controller;
    ComPtr<ICoreWebView2CompositionController> m_compositionController;
    ComPtr<ICoreWebView2> m_webView;

    std::unordered_map<std::string, BrowserTab> m_tabs;
    std::string m_activeTabId;
    BrowserLayout m_layout{};
    StateChangedCallback m_stateCallback = nullptr;
};

} // namespace LensDesk
