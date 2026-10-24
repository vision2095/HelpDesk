#include "../include/focus_manager.hpp"
#include "../include/webview2_host.hpp"
#include "../include/browser_tabs.hpp"
#include "../include/imgui_overlay.hpp"

namespace LensDesk {

FocusManager::FocusManager() = default;
FocusManager::~FocusManager() = default;

void FocusManager::Initialize(HWND hwnd, WebView2Host* hudHost, BrowserTabsManager* browserMgr, ImGuiOverlay* imguiOverlay) {
    m_hwnd = hwnd;
    m_hudHost = hudHost;
    m_browserMgr = browserMgr;
    m_imguiOverlay = imguiOverlay;
    m_currentTarget = FocusTarget::HUD_Assistant;
}

void FocusManager::SetFocusTarget(FocusTarget target) {
    if (m_currentTarget == target) return;
    m_currentTarget = target;

    switch (target) {
        case FocusTarget::HUD_Assistant:
            if (m_hudHost) {
                m_hudHost->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            }
            break;
        case FocusTarget::Browser_Web:
            if (m_browserMgr) {
                m_browserMgr->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            }
            break;
        default:
            break;
    }
}

void FocusManager::OnWindowActivated(bool activated) {
    m_windowActive = activated;
    if (activated) {
        SetFocusTarget(m_currentTarget);
    }
}

void FocusManager::OnWindowFocusChanged(bool hasFocus) {
    if (hasFocus) {
        SetFocusTarget(m_currentTarget);
    }
}

LRESULT FocusManager::RouteMessage(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled) {
    // 1. Explicit window activation on click
    if (msg == WM_MOUSEACTIVATE) {
        handled = true;
        return MA_ACTIVATE;
    }

    if (msg == WM_ACTIVATE) {
        OnWindowActivated(LOWORD(wParam) != WA_INACTIVE);
    } else if (msg == WM_SETFOCUS) {
        OnWindowFocusChanged(true);
    } else if (msg == WM_KILLFOCUS) {
        OnWindowFocusChanged(false);
    }

    // 2. Dear ImGui gets first evaluation
    if (m_imguiOverlay) {
        LRESULT imguiRes = m_imguiOverlay->HandleMessage(hwnd, msg, wParam, lParam, handled);
        if (handled) return imguiRes;
    }

    // 3. Mouse input routing
    if (msg >= WM_MOUSEFIRST && msg <= WM_MOUSELAST) {
        int x = GET_X_LPARAM(lParam);
        int y = GET_Y_LPARAM(lParam);

        bool inBrowser = false;
        if (m_browserMgr && m_browserMgr->HasActiveTab()) {
            BrowserLayout bl = m_browserMgr->GetLayout();
            if (x >= bl.x && x < (bl.x + bl.width) && y >= bl.y && y < (bl.y + bl.height)) {
                inBrowser = true;
            }
        }

        if (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN) {
            if (inBrowser) {
                SetFocusTarget(FocusTarget::Browser_Web);
            } else {
                SetFocusTarget(FocusTarget::HUD_Assistant);
            }
        }

        if (inBrowser && m_browserMgr) {
            m_browserMgr->SendMouseInput(msg, wParam, lParam);
            handled = true;
            return 0;
        } else if (m_hudHost) {
            m_hudHost->SendMouseInput(msg, wParam, lParam);
            handled = true;
            return 0;
        }
    }

    // 4. Keyboard input routing (deterministic forwarding)
    if ((msg >= WM_KEYFIRST && msg <= WM_KEYLAST) || msg == WM_IME_CHAR || msg == WM_IME_COMPOSITION) {
        if (m_currentTarget == FocusTarget::Browser_Web && m_browserMgr && m_browserMgr->HasActiveTab()) {
            m_browserMgr->SendKeyboardInput(msg, wParam, lParam);
            handled = true;
            return 0;
        } else if (m_hudHost) {
            m_hudHost->SendKeyboardInput(msg, wParam, lParam);
            handled = true;
            return 0;
        }
    }

    handled = false;
    return 0;
}

} // namespace LensDesk
