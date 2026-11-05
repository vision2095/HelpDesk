#pragma once
#include "common.hpp"
#include "../third_party/imgui/imgui.h"
#include "../third_party/imgui/imgui_impl_win32.h"
#include "../third_party/imgui/imgui_impl_dx11.h"

namespace LensDesk {

class ServiceDispatcher;
class StorageManager;
class BrowserTabsManager;

struct ChatMessage {
    std::string role; // "user", "assistant", "error"
    std::string text;
    std::string timestamp;
    std::string model;
    std::vector<std::string> images;
};

struct OverlayState {
    // Window visibility toggles
    bool showTopStrip = false;
    bool showRadialMenu = false;
    bool showDiagnostics = false;
    bool showChatWindow = false;
    bool showInterviewWorkspace = false;
    bool showSettingsWindow = false;
    bool showBrowserWindow = false;
    bool showAuthGate = false; // Permanently false: React 19 + WebView2 (FloatingGate.tsx) is the sole login UI
    bool showHotkeyCheatSheet = false;
    bool showCompactTeleprompter = false;

    // Theme & Colors (GAP 08)
    std::string theme = "dark"; // "dark" or "light"
    std::string lightTextColor = "#24384c";
    std::string darkTextColor = "#e2eaf5";
    char lightTextBuf[16] = "#24384c";
    char darkTextBuf[16] = "#e2eaf5";
    bool colorInvalidLight = false;
    bool colorInvalidDark = false;
    float opacity = 1.0f;

    // Browser Controls & Settings (GAP 07)
    std::string searchEngine = "google"; // "google", "duckduckgo", "bing"
    int searchEngineIndex = 0; // 0=Google, 1=DuckDuckGo, 2=Bing
    float browserZoom = 1.0f; // 0.5, 0.75, 1.0, 1.25, 1.5
    int browserZoomIndex = 2; // index in [0.5, 0.75, 1.0, 1.25, 1.5]
    std::string browserHomePage = "https://www.google.com/";
    char browserUrlInput[1024] = "https://www.google.com/";
    bool webView2Available = true;
    bool webView2Installing = false;
    std::string webView2InstallStatus = "";

    // Assistant / Chat (GAP 02)
    std::string provider = "openai";
    std::string model = "gpt-4.1-mini";
    int providerIndex = 0;
    int modelIndex = 0;
    std::string chatLayout = "standard";
    std::string interviewLayout = "full";
    float ivOpacity = 0.90f;
    std::vector<ChatMessage> chatMessages;
    char chatInputBuf[4096] = "";
    bool isGeneratingAnswer = false;
    std::string streamingAnswer = "";
    std::string systemPrompt = "You are LensDesk, an intelligent desktop assistant.";
    char systemPromptBuf[2048] = "You are LensDesk, an intelligent desktop assistant.";

    // Interview Workspace (GAP 02)
    bool interviewSessionActive = false;
    bool autoAnswer = true;
    std::string speechLanguage = "en-US";
    std::vector<std::string> interviewTranscriptLines;
    std::vector<std::string> interviewSuggestions;
    std::string compactLineText = "";
    std::vector<std::string> capturedThumbnails;

    // Settings Navigation (0..8, 9 tabs)
    int settingsNavIndex = 0;

    // AutoType Settings
    std::string typingSpeed = "human";
    std::string typingPreset = "normal";
    int typingWpm = 65;
    int typingJitter = 15;
    int typingMistakes = 5;
    int typingPauses = 10;
    bool typingCodeOnly = true;

    // Capture Settings
    bool captureProtectionActive = true;
    bool localOcr = true;
    int captureMonitorIndex = 0;
    bool saveScreenshotsToDisk = true;
    bool saveAnswerHistory = true;

    // Mouse / Radial Settings
    int radialTriggerIndex = 0;
    float radialHoldSeconds = 0.15f;
    int radialStyle = 0;
    int radialSlotCount = 6;

    // Local LLM Settings
    char localHostBuf[256] = "http://127.0.0.1";
    int localPort = 11434;
    char localModelBuf[128] = "llama3.2";
    bool localLlmConnected = false;

    // Account & Auth
    bool isAuthenticated = false;
    bool authValid = false;
    std::string userEmail = "";
    std::string userPlan = "";
    char loginEmailBuf[256] = "";
    char loginPasswordBuf[256] = "";

    // Normal / Elevated Compatibility (UIPI)
    bool isProcessElevated = false;
    bool hasUiAccess = false;
    bool isTargetElevated = false;
    std::string typingStatus = "";

    // Live Interview Session Status & Timer
    std::chrono::steady_clock::time_point interviewStartTime{};
    int interviewElapsedSeconds = 0;
    std::string authError = "";

    // Status & Diagnostics
    bool aiConnected = true;
    std::string statusMessage = "Ready";
    float fps = 60.0f;
    float memoryMb = 48.0f;
    float radialCenterX = -1.0f;
    float radialCenterY = -1.0f;
};

class ImGuiOverlay {
public:
    ImGuiOverlay();
    ~ImGuiOverlay();

    bool Initialize(HWND hwnd, ID3D11Device* device, ID3D11DeviceContext* context);
    void Shutdown();

    void BeginFrame();
    void Render();
    void EndFrame();

    LRESULT HandleMessage(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled);

    bool WantCaptureMouse() const;
    bool WantCaptureKeyboard() const;

    OverlayState& GetState() { return m_state; }
    const OverlayState& GetState() const { return m_state; }

    // Navigation and Window Toggles
    void ToggleRadialMenu() { m_state.showRadialMenu = !m_state.showRadialMenu; }
    void ToggleDiagnostics() { m_state.showDiagnostics = !m_state.showDiagnostics; }
    void ToggleChat() { m_state.showChatWindow = !m_state.showChatWindow; }
    void ToggleInterview() { m_state.showInterviewWorkspace = !m_state.showInterviewWorkspace; }
    void ToggleSettings() { m_state.showSettingsWindow = !m_state.showSettingsWindow; }
    void ToggleBrowser() { m_state.showBrowserWindow = !m_state.showBrowserWindow; }
    void ToggleHotkeyCheatSheet() { m_state.showHotkeyCheatSheet = !m_state.showHotkeyCheatSheet; }
    void ToggleTopStrip() { m_state.showTopStrip = !m_state.showTopStrip; }

    void SetRadialCenter(float x, float y) {
        m_state.radialCenterX = x;
        m_state.radialCenterY = y;
    }

    // Theme & Color Controls (GAP 08)
    void SetTheme(const std::string& theme);
    void SetLightTextColor(const std::string& color);
    void SetDarkTextColor(const std::string& color);
    void ResetColors();

    // Browser Controls (GAP 07)
    void SetSearchEngine(const std::string& engine);
    void SetBrowserZoom(float zoom);

    // Subsystem Wire-up
    void SetServiceDispatcher(ServiceDispatcher* dispatcher) { m_dispatcher = dispatcher; }
    void SetStorageManager(StorageManager* storageMgr);
    void SetBrowserTabsManager(BrowserTabsManager* browserMgr) { m_browserMgr = browserMgr; }

    // External state synchronization
    void AppendChatMessage(const std::string& role, const std::string& text, const std::string& model = "");
    void SetStreamingAnswer(const std::string& text);
    void AppendInterviewTranscript(const std::string& text);
    void AppendInterviewSuggestion(const std::string& text);
    void SetStatusMessage(const std::string& msg);
    void SetTypingStatus(const std::string& status) { m_state.typingStatus = status; }
    void SetCaptureProtection(bool active) { m_state.captureProtectionActive = active; }
    void SetWebView2Available(bool available) { m_state.webView2Available = available; }
    void SetWebSuppressed(bool suppressed) { m_suppressedByWeb = suppressed; }
    bool IsWebSuppressed() const { return m_suppressedByWeb; }

    using ActionCallback = std::function<void(const std::string& action)>;
    void SetActionCallback(ActionCallback callback) { m_actionCallback = callback; }

private:
    void SetupTheme();
    void ApplyTextColors();

    // UI View Renderers
    void RenderTopStrip();
    void RenderChatWindow();
    void RenderInterviewWorkspace();
    void RenderSettingsWindow();
    void RenderModelSettings();
    void RenderAppearanceSettings();
    void RenderCaptureSettings();
    void RenderTypingSettings();
    void RenderHotkeysSettings();
    void RenderMouseSettings();
    void RenderBrowserSettings();
    void RenderLocalLlmSettings();
    void RenderAccountSettings();
    void RenderBrowserWindow();
    void RenderAuthGateWindow();
    void RenderHotkeyCheatSheet();
    void RenderRadialMenu();
    void RenderDiagnostics();
    void RenderMarkdownWithTables(const std::string& text);

    static std::string FormatMarkdownMath(const std::string& input);

    HWND m_hwnd = nullptr;
    bool m_initialized = false;
    bool m_suppressedByWeb = false;
    OverlayState m_state{};
    ActionCallback m_actionCallback = nullptr;
    ServiceDispatcher* m_dispatcher = nullptr;
    StorageManager* m_storageMgr = nullptr;
    BrowserTabsManager* m_browserMgr = nullptr;
};

} // namespace LensDesk
