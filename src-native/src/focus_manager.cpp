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
    m_currentState = FocusState::INACTIVE;
    m_lastActiveTarget = FocusState::FOCUSED_ASSISTANT;

    // Listen to HUD focus callbacks
    if (m_hudHost) {
        m_hudHost->SetFocusChangedCallback([this](bool hasFocus) {
            if (hasFocus && m_currentState != FocusState::FOCUSED_ASSISTANT) {
                TransitionTo(FocusState::FOCUSED_ASSISTANT, "hud_got_focus_event");
            }
        });

        m_hudHost->SetMoveFocusRequestedCallback([this](COREWEBVIEW2_MOVE_FOCUS_REASON reason) {
            // Tab cycled out of assistant, move to browser if active
            if (m_browserMgr && m_browserMgr->HasActiveTab()) {
                SetFocusTarget(FocusState::FOCUSED_BROWSER, "tab_traversal_to_browser");
            }
        });
    }

    // Listen to Browser focus callbacks
    if (m_browserMgr) {
        m_browserMgr->SetFocusChangedCallback([this](bool hasFocus) {
            if (hasFocus && m_currentState != FocusState::FOCUSED_BROWSER) {
                TransitionTo(FocusState::FOCUSED_BROWSER, "browser_got_focus_event");
            }
        });
    }
}

std::string FocusManager::GetStateString() const {
    switch (m_currentState) {
        case FocusState::INACTIVE:               return "INACTIVE";
        case FocusState::ACTIVATING:             return "ACTIVATING";
        case FocusState::FOCUSED_ASSISTANT:      return "FOCUSED_ASSISTANT";
        case FocusState::FOCUSED_BROWSER:        return "FOCUSED_BROWSER";
        case FocusState::FOCUSED_NATIVE_CONTROL: return "FOCUSED_NATIVE_CONTROL";
        case FocusState::SWITCHING_VIEW:         return "SWITCHING_VIEW";
        case FocusState::FOCUS_LOST:             return "FOCUS_LOST";
        case FocusState::RESTORING:              return "RESTORING";
    }
    return "UNKNOWN";
}

void FocusManager::LogTransition(FocusState from, FocusState to, const std::string& reason) {
    std::lock_guard<std::mutex> lock(m_mutex);
    uint64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();

    HWND fg = GetForegroundWindow();
    FocusLogEntry entry{ now, from, to, reason, reinterpret_cast<uintptr_t>(fg) };
    m_log.push_back(entry);
    if (m_log.size() > MAX_LOG_ENTRIES) {
        m_log.erase(m_log.begin(), m_log.begin() + (m_log.size() - MAX_LOG_ENTRIES));
    }
}

void FocusManager::TransitionTo(FocusState newState, const std::string& reason) {
    if (m_currentState == newState) return;
    FocusState old = m_currentState;
    m_currentState = newState;
    LogTransition(old, newState, reason);
}

void FocusManager::SetFocusTarget(FocusState targetState, const std::string& reason) {
    if (m_currentState == targetState) return;

    TransitionTo(FocusState::SWITCHING_VIEW, reason + "_start");

    switch (targetState) {
        case FocusState::FOCUSED_ASSISTANT:
            if (m_hudHost) {
                m_hudHost->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            }
            m_lastActiveTarget = FocusState::FOCUSED_ASSISTANT;
            TransitionTo(FocusState::FOCUSED_ASSISTANT, reason + "_complete");
            break;

        case FocusState::FOCUSED_BROWSER:
            if (m_browserMgr) {
                m_browserMgr->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            }
            m_lastActiveTarget = FocusState::FOCUSED_BROWSER;
            TransitionTo(FocusState::FOCUSED_BROWSER, reason + "_complete");
            break;

        case FocusState::FOCUSED_NATIVE_CONTROL:
            TransitionTo(FocusState::FOCUSED_NATIVE_CONTROL, reason + "_complete");
            break;

        default:
            TransitionTo(targetState, reason + "_complete");
            break;
    }
}

void FocusManager::OnWindowActivated(bool activated) {
    m_windowActive = activated;
    if (activated) {
        TransitionTo(FocusState::ACTIVATING, "wm_activate_true");
        TransitionTo(FocusState::RESTORING, "restoring_active_target");
        SetFocusTarget(m_lastActiveTarget, "window_activated_restore");
    } else {
        TransitionTo(FocusState::FOCUS_LOST, "wm_activate_false");
        TransitionTo(FocusState::INACTIVE, "inactive_after_deactivation");
    }
}

void FocusManager::OnWindowFocusChanged(bool hasFocus) {
    if (hasFocus) {
        if (!m_windowActive) {
            OnWindowActivated(true);
        }
    } else {
        TransitionTo(FocusState::FOCUS_LOST, "wm_killfocus");
    }
}

LRESULT FocusManager::RouteMessage(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled) {
    // 1. Explicit window activation on click (prevents focus loss and activation loops)
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

    // 2. Dear ImGui handles input first if it wants it
    if (m_imguiOverlay) {
        LRESULT imguiRes = m_imguiOverlay->HandleMessage(hwnd, msg, wParam, lParam, handled);
        if (handled) {
            if (m_currentState != FocusState::FOCUSED_NATIVE_CONTROL) {
                TransitionTo(FocusState::FOCUSED_NATIVE_CONTROL, "imgui_captured_input");
            }
            return imguiRes;
        }
    }

    // 3. Mouse input routing and deterministic focus selection
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

        // On mouse-down, switch focus target deterministically
        if (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN) {
            if (inBrowser) {
                SetFocusTarget(FocusState::FOCUSED_BROWSER, "mouse_click_browser");
            } else {
                SetFocusTarget(FocusState::FOCUSED_ASSISTANT, "mouse_click_assistant");
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

    // 4. Keyboard events
    // In DirectComposition hosting with MoveFocus active, standard keyboard events
    // are translated and dispatched cleanly through the message loop.
    // If ImGui is active, it has already processed it in step 2.

    handled = false;
    return 0;
}

json FocusManager::GetDiagnosticsJson() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    json arr = json::array();
    for (const auto& e : m_log) {
        json j;
        j["timestamp"] = e.timestampMs;
        j["reason"] = e.reason;
        j["fgHwnd"] = "0x" + std::to_string(e.foregroundHwnd);
        arr.push_back(j);
    }

    json result;
    result["currentState"] = GetStateString();
    result["windowActive"] = m_windowActive;
    result["history"] = arr;
    return result;
}

} // namespace LensDesk
