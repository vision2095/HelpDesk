#pragma once
#include "common.hpp"

namespace LensDesk {

class WebView2Host;
class BrowserTabsManager;
class ImGuiOverlay;

enum class FocusTarget {
    None,
    ImGuiOverlay,
    HUD_Assistant,
    Browser_Web
};

class FocusManager {
public:
    FocusManager();
    ~FocusManager();

    void Initialize(HWND hwnd, WebView2Host* hudHost, BrowserTabsManager* browserMgr, ImGuiOverlay* imguiOverlay);

    FocusTarget GetCurrentFocus() const { return m_currentTarget; }
    void SetFocusTarget(FocusTarget target);

    LRESULT RouteMessage(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled);

    void OnWindowActivated(bool activated);
    void OnWindowFocusChanged(bool hasFocus);

private:
    HWND m_hwnd = nullptr;
    WebView2Host* m_hudHost = nullptr;
    BrowserTabsManager* m_browserMgr = nullptr;
    ImGuiOverlay* m_imguiOverlay = nullptr;

    FocusTarget m_currentTarget = FocusTarget::HUD_Assistant;
    bool m_windowActive = true;
};

} // namespace LensDesk
