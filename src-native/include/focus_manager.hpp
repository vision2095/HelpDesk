#pragma once
#include "common.hpp"

namespace LensDesk {

class WebView2Host;
class BrowserTabsManager;
class ImGuiOverlay;

enum class FocusState {
    INACTIVE,
    ACTIVATING,
    FOCUSED_ASSISTANT,
    FOCUSED_BROWSER,
    FOCUSED_NATIVE_CONTROL,
    SWITCHING_VIEW,
    FOCUS_LOST,
    RESTORING
};

struct FocusLogEntry {
    uint64_t timestampMs = 0;
    FocusState oldState = FocusState::INACTIVE;
    FocusState newState = FocusState::INACTIVE;
    std::string reason;
    uintptr_t foregroundHwnd = 0;
};

class FocusManager {
public:
    FocusManager();
    ~FocusManager();

    void Initialize(HWND hwnd, WebView2Host* hudHost, BrowserTabsManager* browserMgr, ImGuiOverlay* imguiOverlay);

    FocusState GetState() const { return m_currentState; }
    std::string GetStateString() const;

    void SetFocusTarget(FocusState targetState, const std::string& reason = "explicit");
    void TransitionTo(FocusState newState, const std::string& reason);

    LRESULT RouteMessage(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled);

    void OnWindowActivated(bool activated);
    void OnWindowFocusChanged(bool hasFocus);

    const std::vector<FocusLogEntry>& GetDiagnosticsLog() const { return m_log; }
    json GetDiagnosticsJson() const;

private:
    void LogTransition(FocusState from, FocusState to, const std::string& reason);

    HWND m_hwnd = nullptr;
    WebView2Host* m_hudHost = nullptr;
    BrowserTabsManager* m_browserMgr = nullptr;
    ImGuiOverlay* m_imguiOverlay = nullptr;

    FocusState m_currentState = FocusState::INACTIVE;
    FocusState m_lastActiveTarget = FocusState::FOCUSED_ASSISTANT;
    bool m_windowActive = false;

    std::vector<FocusLogEntry> m_log;
    mutable std::mutex m_mutex;
    static constexpr size_t MAX_LOG_ENTRIES = 200;
};

} // namespace LensDesk
