#include "../include/service_dispatcher.hpp"
#include "../include/window_manager.hpp"
#include "../include/webview2_host.hpp"
#include "../include/browser_tabs.hpp"
#include "../include/input_manager.hpp"
#include "../include/capture_service.hpp"
#include "../include/storage_manager.hpp"
#include "../include/imgui_overlay.hpp"
#include "../include/focus_manager.hpp"
#include <winhttp.h>
#include <cmath>
#include <cctype>

namespace LensDesk {

namespace {

std::string TrimText(std::string value) {
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) value.erase(value.begin());
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.pop_back();
    return value;
}

std::string ProviderEndpoint(const std::string& provider, const std::string& localBaseUrl) {
    if (provider == "openai") return "https://api.openai.com/v1/chat/completions";
    if (provider == "groq") return "https://api.groq.com/openai/v1/chat/completions";
    if (provider == "deepseek") return "https://api.deepseek.com/chat/completions";
    if (provider == "gemini") return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    if (provider == "anthropic") return "https://api.anthropic.com/v1/messages";
    std::string base = TrimText(localBaseUrl);
    while (!base.empty() && base.back() == '/') base.pop_back();
    if (base.empty()) base = "http://127.0.0.1:11434/v1";
    return base + "/chat/completions";
}

struct HttpReply {
    int status = 0;
    json body = json::object();
    std::string text;
    std::string error;
    bool networkError = false;
};

HttpReply HttpPostJson(
    const std::string& url,
    const json& payload,
    const std::string& bearer,
    const std::string& extraHeaders = "",
    int timeoutMs = 90000
) {
    HttpReply reply;
    std::wstring wideUrl = Utf8ToWide(url);
    URL_COMPONENTS components{};
    components.dwStructSize = sizeof(components);
    components.dwSchemeLength = static_cast<DWORD>(-1);
    components.dwHostNameLength = static_cast<DWORD>(-1);
    components.dwUrlPathLength = static_cast<DWORD>(-1);
    components.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(wideUrl.c_str(), static_cast<DWORD>(wideUrl.size()), 0, &components)) {
        reply.networkError = true;
        reply.error = "The provider endpoint is invalid.";
        return reply;
    }
    const std::wstring host(components.lpszHostName, components.dwHostNameLength);
    std::wstring path(components.lpszUrlPath, components.dwUrlPathLength);
    if (path.empty()) path = L"/";
    if (components.dwExtraInfoLength > 0) {
        path.append(components.lpszExtraInfo, components.dwExtraInfoLength);
    }
    const bool secure = components.nScheme == INTERNET_SCHEME_HTTPS;

    HINTERNET session = WinHttpOpen(L"LensDesk/2.0 (Windows Native)", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) {
        reply.networkError = true;
        reply.error = "Could not initialize the network client.";
        return reply;
    }
    WinHttpSetTimeouts(session, 5000, 5000, timeoutMs, timeoutMs);
    HINTERNET connection = WinHttpConnect(session, host.c_str(), components.nPort, 0);
    if (!connection) {
        reply.networkError = true;
        reply.error = "Could not connect to the provider.";
        WinHttpCloseHandle(session);
        return reply;
    }
    HINTERNET request = WinHttpOpenRequest(connection, L"POST", path.c_str(), nullptr,
                                           WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                           secure ? WINHTTP_FLAG_SECURE : 0);
    if (!request) {
        reply.networkError = true;
        reply.error = "Could not create the provider request.";
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return reply;
    }
    std::wstring headers =
        L"Content-Type: application/json\r\n"
        L"Accept: application/json\r\n";
    if (!bearer.empty()) {
        headers += L"Authorization: Bearer ";
        headers += Utf8ToWide(bearer);
        headers += L"\r\n";
    }
    if (!extraHeaders.empty()) {
        headers += Utf8ToWide(extraHeaders);
    }
    const std::string body = payload.dump();
    BOOL sent = WinHttpSendRequest(request, headers.c_str(), static_cast<DWORD>(-1L),
                                   const_cast<char*>(body.data()), static_cast<DWORD>(body.size()),
                                   static_cast<DWORD>(body.size()), 0);
    if (!sent || !WinHttpReceiveResponse(request, nullptr)) {
        reply.networkError = true;
        reply.error = "Could not reach the AI provider. Check your connection.";
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return reply;
    }
    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX);
    reply.status = static_cast<int>(status);
    char buffer[8192];
    DWORD read = 0;
    while (WinHttpReadData(request, buffer, sizeof(buffer), &read) && read > 0) {
        reply.text.append(buffer, read);
        if (reply.text.size() > 16 * 1024 * 1024) break;
    }
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);

    if (!reply.text.empty()) {
        try {
            reply.body = json::parse(reply.text);
        } catch (...) {
            reply.body = json::object();
        }
    }
    if (reply.status < 200 || reply.status >= 300) {
        if (reply.body.is_object() && reply.body.contains("error")) {
            const json& error = reply.body["error"];
            if (error.is_string()) reply.error = error.get<std::string>();
            else if (error.is_object() && error.contains("message") && error["message"].is_string())
                reply.error = error["message"].get<std::string>();
        }
        if (reply.error.empty()) reply.error = "The AI provider rejected the request.";
    }
    return reply;
}

std::string ExtractAssistantText(const std::string& provider, const json& body) {
    if (provider == "anthropic") {
        if (body.contains("content") && body["content"].is_array()) {
            std::string text;
            for (const auto& block : body["content"]) {
                if (block.is_object() && block.value("type", "") == "text" && block.contains("text")) {
                    text += block["text"].get<std::string>();
                }
            }
            return text;
        }
        return "";
    }
    if (body.contains("choices") && body["choices"].is_array() && !body["choices"].empty()) {
        const json& choice = body["choices"][0];
        if (choice.contains("message") && choice["message"].is_object()) {
            const json& message = choice["message"];
            if (message.contains("content")) {
                if (message["content"].is_string()) return message["content"].get<std::string>();
                if (message["content"].is_array()) {
                    std::string text;
                    for (const auto& part : message["content"]) {
                        if (part.is_object() && part.contains("text") && part["text"].is_string())
                            text += part["text"].get<std::string>();
                    }
                    return text;
                }
            }
        }
    }
    return "";
}

} // namespace

ServiceDispatcher::ServiceDispatcher() = default;

ServiceDispatcher::~ServiceDispatcher() {
    Shutdown();
    for (auto& worker : m_workers) {
        if (worker.joinable()) worker.join();
    }
}

void ServiceDispatcher::Shutdown() {
    {
        std::lock_guard<std::mutex> lock(m_heartbeatMutex);
        m_heartbeatStop = true;
    }
    m_heartbeatCv.notify_all();
    if (m_heartbeatThread.joinable()) {
        m_heartbeatThread.join();
    }
}

void ServiceDispatcher::HeartbeatLoop() {
    std::unique_lock<std::mutex> waitLock(m_heartbeatMutex);
    while (!m_heartbeatStop) {
        // A 45 second cadence keeps the 120 second offline-grace window
        // fresh while the hosted service is reachable. The renderer calls
        // gate.state on mount as well, so a restored session is validated
        // before the workspace becomes interactive.
        if (m_heartbeatCv.wait_for(waitLock, std::chrono::seconds(45),
                                   [this] { return m_heartbeatStop; })) {
            break;
        }
        waitLock.unlock();

        json gate;
        bool broadcast = false;
        {
            std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
            if (m_cloud.HasSession()) {
                gate = m_cloud.Validate();
                broadcast = true;
            }
        }
        if (broadcast) {
            PostToUi([this, gate]() {
                BroadcastEvent("lens:gate", gate);
            });
        }

        waitLock.lock();
    }
}

void ServiceDispatcher::Initialize(
    WindowManager* winMgr,
    WebView2Host* webHost,
    BrowserTabsManager* browserMgr,
    InputManager* inputMgr,
    CaptureService* captureSvc,
    StorageManager* storageMgr,
    ImGuiOverlay* imguiOverlay,
    FocusManager* focusMgr
) {
    m_winMgr = winMgr;
    m_webHost = webHost;
    m_browserMgr = browserMgr;
    m_inputMgr = inputMgr;
    m_captureSvc = captureSvc;
    m_storageMgr = storageMgr;
    m_imguiOverlay = imguiOverlay;
    m_focusMgr = focusMgr;
    m_hwnd = winMgr ? winMgr->GetHwnd() : nullptr;
    m_cloud.Initialize();

    // Apply persisted desktop preferences before the UI reads its initial state.
    // The window is created with safe defaults, so a saved opt-out must be
    // applied explicitly or it is silently ignored until the next settings save.
    if (m_storageMgr && m_winMgr) {
        const json prefs = m_storageMgr->GetPreferences();
        if (prefs.contains("alwaysOnTop")) {
            m_winMgr->SetAlwaysOnTop(prefs["alwaysOnTop"].get<bool>());
        }
        if (prefs.contains("captureProtection")) {
            const bool captureProtection = prefs["captureProtection"].get<bool>();
            m_winMgr->SetCaptureProtection(captureProtection);
            if (m_imguiOverlay) {
                m_imguiOverlay->GetState().captureProtectionActive = captureProtection;
            }
        }
        if (prefs.contains("opacity")) {
            m_winMgr->SetOpacity(prefs["opacity"].get<float>());
        }
    }

    // Connect browser state updates to WebView2 host push
    if (m_browserMgr) {
        m_browserMgr->SetStateChangedCallback([this](const json& state) {
            BroadcastEvent("lens:browser-state", state);
        });
        m_browserMgr->SetEventCallback([this](const std::string& eventName) {
            // Ctrl+L / Ctrl+F originate inside the embedded page. Move OS
            // keyboard focus back to the HUD before asking React to focus
            // the address bar or find field.
            if (eventName == "lens:browser-focus-address" || eventName == "lens:browser-focus-find") {
                if (m_webHost) m_webHost->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
                if (m_focusMgr) {
                    m_focusMgr->SetFocusTarget(FocusState::FOCUSED_ASSISTANT, eventName);
                }
            }
            BroadcastEvent(eventName, json::object());
        });
        if (m_winMgr) {
            m_browserMgr->SetDpiScale(m_winMgr->GetDpiScale());
        }
    }

    // Connect hotkeys to actions
    if (m_inputMgr) {
        m_inputMgr->SetHotkeyCallback([this](const std::string& action) {
            if (action == "desktop.overlay") {
                bool nextVis = !m_winMgr->IsVisible();
                m_winMgr->SetVisible(nextVis);
                BroadcastEvent("lens:overlay", {
                    { "visible", nextVis },
                    { "floating", true }
                });
            } else if (action == "overlay.radial") {
                if (m_imguiOverlay) {
                    m_imguiOverlay->ToggleRadialMenu();
                }
            } else {
                BroadcastEvent("lens:shortcut", { { "action", action } });
            }
        });
    }

    // Connect ImGui actions
    if (m_imguiOverlay) {
        m_imguiOverlay->SetActionCallback([this](const std::string& action) {
            if (action == "action.hide") {
                m_winMgr->SetVisible(false);
                BroadcastEvent("lens:overlay", { { "visible", false }, { "floating", true } });
            } else {
                BroadcastEvent("lens:shortcut", { { "action", action } });
            }
        });
    }

    // Keep the entitlement lease verified while the app is running. The
    // worker never touches WebView2 directly; gate snapshots are marshalled
    // back to the UI thread through PostToUi.
    {
        std::lock_guard<std::mutex> lock(m_heartbeatMutex);
        m_heartbeatStop = false;
    }
    m_heartbeatThread = std::thread([this] { HeartbeatLoop(); });
}

void ServiceDispatcher::BroadcastEvent(const std::string& eventName, const json& eventData) {
    if (m_webHost) {
        m_webHost->BroadcastEvent(eventName, eventData);
    }
}

void ServiceDispatcher::PostToUi(std::function<void()> work) {
    if (!work) return;
    {
        std::lock_guard<std::mutex> lock(m_uiMutex);
        m_uiQueue.push_back(std::move(work));
    }
    if (m_hwnd) {
        PostMessageW(m_hwnd, WM_LENSDESK_IPC_DISPATCH, 0, 0);
    }
}

void ServiceDispatcher::ProcessPendingUi() {
    std::vector<std::function<void()>> pending;
    {
        std::lock_guard<std::mutex> lock(m_uiMutex);
        pending.swap(m_uiQueue);
    }
    for (auto& work : pending) {
        try {
            work();
        } catch (...) {
        }
    }
}

void ServiceDispatcher::Dispatch(const std::string& action, const json& payload, DispatchResponseCallback callback) {
    try {
        // --- 1. State ---
        if (action == "state") {
            std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
            json prefs = m_storageMgr->GetPreferences();
            json profiles = m_storageMgr->GetProfiles();
            json sessions = m_storageMgr->GetSessions();
            json browserState = m_browserMgr ? m_browserMgr->GetStateSnapshot() : json::object();

            if (sessions.empty() || !sessions.is_array()) {
                json initialSession = {
                    { "id", "session_initial" },
                    { "title", "New Thinking Session" },
                    { "mode", "general" },
                    { "profileId", "default_profile" },
                    { "createdAt", GetIsoTimestamp() },
                    { "updatedAt", GetIsoTimestamp() },
                    { "notes", "" },
                    { "transcript", "" },
                    { "messages", json::array() }
                };
                m_storageMgr->SaveSession(initialSession);
                sessions = json::array({ initialSession });
            }

            json settings = prefs;
            if (!settings.contains("provider")) settings["provider"] = "openai";
            if (!settings.contains("model")) settings["model"] = "gpt-4.1-mini";
            if (!settings.contains("localBaseUrl")) settings["localBaseUrl"] = "http://127.0.0.1:11434/v1";
            if (!settings.contains("language")) settings["language"] = "English";
            if (!settings.contains("systemPrompt")) settings["systemPrompt"] = "You are LensDesk, an intelligent desktop assistant.";
            if (!settings.contains("transcriptionProvider")) settings["transcriptionProvider"] = "openai";
            if (!settings.contains("transcriptionModel")) settings["transcriptionModel"] = "whisper-1";
            if (!settings.contains("opacity")) settings["opacity"] = 1.0;
            if (!settings.contains("alwaysOnTop")) settings["alwaysOnTop"] = true;
            if (!settings.contains("captureProtection")) settings["captureProtection"] = true;

            json state;
            state["settings"] = settings;
            state["profiles"] = profiles;
            state["sessions"] = sessions;
            state["storage"] = "local";
            state["cloudConnected"] = m_cloud.HasSession();
            json keyStatus = m_storageMgr->GetKeyStatus();
            state["keys"] = keyStatus;
            json ownedKeys = keyStatus;
            for (auto& item : ownedKeys.items()) item.value() = false;
            ownedKeys["local"] = true;
            state["ownedKeys"] = ownedKeys;
            state["browser"] = browserState;
            state["gate"] = m_cloud.GetGateView();
            state["floating"] = true;
            state["visible"] = m_winMgr->IsVisible();
            state["captureProtection"] = m_winMgr->IsCaptureProtection();
            state["clickThrough"] = m_winMgr->IsClickThrough();

            callback(state, false);
            return;
        }

        // --- 2. Settings & Preferences ---
        if (action == "settings.get" || action == "settings") {
            json prefs = m_storageMgr->GetPreferences();
            if (!prefs.contains("provider")) prefs["provider"] = "openai";
            if (!prefs.contains("model")) prefs["model"] = "gpt-4.1-mini";
            if (!prefs.contains("localBaseUrl")) prefs["localBaseUrl"] = "http://127.0.0.1:11434/v1";
            callback(prefs, false);
            return;
        }

        if (action == "settings.save" || action == "desktop.preferences.save") {
            m_storageMgr->SavePreferences(payload);

            if (payload.contains("alwaysOnTop")) {
                m_winMgr->SetAlwaysOnTop(payload["alwaysOnTop"].get<bool>());
            }
            if (payload.contains("opacity")) {
                m_winMgr->SetOpacity(payload["opacity"].get<float>());
            }
            if (payload.contains("captureProtection")) {
                bool cap = payload["captureProtection"].get<bool>();
                m_winMgr->SetCaptureProtection(cap);
                if (m_imguiOverlay) {
                    m_imguiOverlay->GetState().captureProtectionActive = cap;
                }
            }

            BroadcastEvent("lens:preferences", payload);
            callback({ { "success", true } }, false);
            return;
        }

        if (action == "desktop.preferences") {
            callback(m_storageMgr->GetPreferences(), false);
            return;
        }

        // --- 3. Profiles ---
        if (action == "profile.save") {
            bool ok = m_storageMgr->SaveProfile(payload);
            callback(payload, !ok);
            return;
        }

        if (action == "profile.delete") {
            std::string id = payload.value("id", "");
            bool ok = m_storageMgr->DeleteProfile(id);
            callback({ { "success", ok } }, !ok);
            return;
        }

        // --- 4. Sessions & History ---
        if (action == "session.save") {
            bool ok = m_storageMgr->SaveSession(payload);
            callback(payload, !ok);
            return;
        }

        if (action == "session.get") {
            std::string id = payload.value("id", "");
            callback(m_storageMgr->GetSession(id), false);
            return;
        }

        if (action == "session.delete") {
            std::string id = payload.value("id", "");
            bool ok = m_storageMgr->DeleteSession(id);
            callback({ { "success", ok } }, !ok);
            return;
        }

        if (action == "session.search") {
            std::string q = payload.value("query", "");
            callback(m_storageMgr->SearchSessions(q), false);
            return;
        }

        if (action == "session.patch") {
            std::string id = payload.value("id", "");
            json patch = payload.value("patch", json::object());
            bool ok = m_storageMgr->PatchSession(id, patch);
            json updated = m_storageMgr->GetSession(id);
            callback(updated.empty() ? payload : updated, !ok);
            return;
        }

        if (action == "history.list" || action == "storage.history") {
            callback(m_storageMgr->GetSessions(), false);
            return;
        }

        if (action == "workspace.list") {
            callback(m_storageMgr->GetWorkspaces(), false);
            return;
        }

        if (action == "key.save") {
            std::string provider = payload.value("provider", "");
            std::string key = payload.value("key", "");
            bool ok = m_storageMgr->SaveApiKey(provider, key);
            callback({ { "success", ok } }, !ok);
            return;
        }

        // --- 5. Desktop & Window Controls ---
        if (action == "desktop.overlay") {
            bool current = m_winMgr->IsVisible();
            bool target = payload.value("visible", !current);
            m_winMgr->SetVisible(target);

            json ret = {
                { "visible", target },
                { "floating", true }
            };
            BroadcastEvent("lens:overlay", ret);
            callback(ret, false);
            return;
        }

        if (action == "desktop.overlayState") {
            callback({
                { "visible", m_winMgr->IsVisible() },
                { "floating", true }
            }, false);
            return;
        }

        if (action == "desktop.hide") {
            m_winMgr->SetVisible(false);
            BroadcastEvent("lens:overlay", { { "visible", false }, { "floating", true } });
            callback({ { "success", true } }, false);
            return;
        }

        if (action == "desktop.clickThrough") {
            bool enable = payload.value("enable", !m_winMgr->IsClickThrough());
            m_winMgr->SetClickThrough(enable);
            BroadcastEvent("lens:clickThrough", { { "clickThrough", enable } });
            callback({ { "clickThrough", enable } }, false);
            return;
        }

        if (action == "desktop.clickThroughState") {
            callback({ { "clickThrough", m_winMgr->IsClickThrough() } }, false);
            return;
        }

        if (action == "desktop.focusWindow") {
            SetForegroundWindow(m_winMgr->GetHwnd());
            callback({ { "success", true } }, false);
            return;
        }

        if (action == "desktop.captureProtection") {
            bool enable = payload.value("enable", true);
            m_winMgr->SetCaptureProtection(enable);
            if (m_imguiOverlay) {
                m_imguiOverlay->GetState().captureProtectionActive = enable;
            }
            callback({ { "captureProtection", enable } }, false);
            return;
        }

        if (action == "desktop.sources") {
            callback(m_captureSvc->GetSources(true), false);
            return;
        }

        if (action == "desktop.capture") {
            std::string dataUrl;
            if (payload.contains("rect")) {
                CaptureRect cr{
                    payload["rect"].value("x", 0),
                    payload["rect"].value("y", 0),
                    payload["rect"].value("width", 0),
                    payload["rect"].value("height", 0)
                };
                dataUrl = m_captureSvc->CaptureRegion(cr);
            } else {
                int screenIdx = payload.value("screenIndex", 0);
                dataUrl = m_captureSvc->CaptureScreen(screenIdx);
            }
            callback({ { "dataUrl", dataUrl } }, false);
            return;
        }

        if (action == "desktop.autoType") {
            std::string text = payload.value("text", "");
            int delay = payload.value("delayMs", 15);
            bool ok = m_inputMgr->StartAutoType(text, delay);
            callback({ { "started", ok } }, !ok);
            return;
        }

        if (action == "desktop.autoType.stop") {
            m_inputMgr->StopAutoType();
            callback({ { "stopped", true } }, false);
            return;
        }

        if (action == "desktop.openExternal") {
            std::string url = payload.value("url", "");
            if (!url.empty()) {
                std::wstring wideUrl = Utf8ToWide(url);
                ShellExecuteW(nullptr, L"open", wideUrl.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            }
            callback({ { "success", true } }, false);
            return;
        }

        if (action == "desktop.quit") {
            PostQuitMessage(0);
            callback({ { "success", true } }, false);
            return;
        }

        if (action == "desktop.diagnostics") {
            json diag = m_focusMgr ? m_focusMgr->GetDiagnosticsJson() : json::object();
            callback(diag, false);
            return;
        }

        if (action == "desktop.info") {
            json info = {
                { "name", "LensDesk" },
                { "version", "2.0.0" },
                { "platform", "win32" },
                { "arch", "x64" },
                { "runtime", "Native C++20 Win32 + DirectComposition + WebView2" },
                { "electron", false }
            };
            callback(info, false);
            return;
        }

        // --- 6. Embedded Browser Controls ---
        // The React browser page expects every browser action to return the
        // complete browser snapshot. It accepts either { id } or { tabId },
        // and layout bounds arrive as CSS pixels inside a nested "bounds"
        // object. Convert those bounds to the physical pixels used by
        // WebView2 composition hosting.
        auto browserSnapshot = [this]() -> json {
            return m_browserMgr ? m_browserMgr->GetStateSnapshot() : json::object();
        };
        auto resolveTabId = [this](const json& p) -> std::string {
            std::string id;
            if (p.contains("tabId") && p["tabId"].is_string()) id = p["tabId"].get<std::string>();
            if (id.empty() && p.contains("id") && p["id"].is_string()) id = p["id"].get<std::string>();
            if (id.empty() && m_browserMgr) id = m_browserMgr->GetActiveTabId();
            return id;
        };
        auto browserResult = [&](bool ok) -> json {
            json result = browserSnapshot();
            result["success"] = ok;
            return result;
        };

        if (action == "browser.state") {
            callback(browserSnapshot(), false);
            return;
        }

        if (action == "browser.open" || action == "browser.create") {
            std::string url;
            if (payload.contains("url") && payload["url"].is_string()) url = payload["url"].get<std::string>();
            std::string tabId = m_browserMgr ? m_browserMgr->CreateTab(url) : "";
            json result = browserSnapshot();
            result["tabId"] = tabId;
            callback(result, false);
            return;
        }

        if (action == "browser.navigate") {
            std::string url;
            if (payload.contains("url") && payload["url"].is_string()) url = payload["url"].get<std::string>();
            std::string tabId = resolveTabId(payload);
            bool ok = false;
            if (m_browserMgr) {
                if (tabId.empty() && !url.empty()) {
                    tabId = m_browserMgr->CreateTab(url);
                    ok = !tabId.empty();
                } else {
                    ok = m_browserMgr->Navigate(tabId, url);
                }
            }
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.select") {
            std::string tabId = resolveTabId(payload);
            bool ok = m_browserMgr ? m_browserMgr->SelectTab(tabId) : false;
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.close") {
            std::string tabId = resolveTabId(payload);
            bool ok = m_browserMgr ? m_browserMgr->CloseTab(tabId) : false;
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.back") {
            std::string tabId = resolveTabId(payload);
            bool ok = m_browserMgr ? m_browserMgr->GoBack(tabId) : false;
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.forward") {
            std::string tabId = resolveTabId(payload);
            bool ok = m_browserMgr ? m_browserMgr->GoForward(tabId) : false;
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.reload") {
            std::string tabId = resolveTabId(payload);
            bool ok = m_browserMgr ? m_browserMgr->Reload(tabId) : false;
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.stop") {
            std::string tabId = resolveTabId(payload);
            bool ok = m_browserMgr ? m_browserMgr->Stop(tabId) : false;
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.home") {
            std::string homeUrl = "https://www.google.com";
            if (m_storageMgr) {
                json prefs = m_storageMgr->GetPreferences();
                if (prefs.contains("browser") && prefs["browser"].is_object()) {
                    const json& browserPrefs = prefs["browser"];
                    if (browserPrefs.contains("homePage") && browserPrefs["homePage"].is_string()) {
                        const std::string configured = browserPrefs["homePage"].get<std::string>();
                        if (!configured.empty()) homeUrl = configured;
                    }
                }
            }
            bool ok = m_browserMgr ? m_browserMgr->Home(homeUrl) : false;
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.focus") {
            if (m_winMgr) SetForegroundWindow(m_winMgr->GetHwnd());
            if (m_browserMgr) m_browserMgr->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            callback(browserResult(true), false);
            return;
        }

        if (action == "browser.find") {
            std::string text;
            if (payload.contains("text") && payload["text"].is_string()) text = payload["text"].get<std::string>();
            bool forward = payload.value("forward", true);
            bool next = payload.value("next", false);
            bool ok = m_browserMgr ? m_browserMgr->Find(text, forward, next) : false;
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.layout") {
            json bounds = payload;
            if (payload.contains("bounds") && payload["bounds"].is_object()) {
                bounds = payload["bounds"];
            }
            float scale = 0.0f;
            if (payload.contains("dpr") && payload["dpr"].is_number()) {
                scale = payload["dpr"].get<float>();
            }
            if (scale <= 0.0f && m_winMgr) scale = m_winMgr->GetDpiScale();
            if (scale <= 0.0f) scale = 1.0f;

            auto scaled = [scale, &bounds](const char* key) -> int {
                double value = bounds.value(key, 0.0);
                return static_cast<int>(std::lround(value * scale));
            };
            BrowserLayout bl{
                scaled("x"),
                scaled("y"),
                scaled("width"),
                scaled("height"),
                payload.value("visible", bounds.value("visible", false))
            };
            if (m_browserMgr) {
                m_browserMgr->SetLayout(bl, scale);
            }
            callback(browserSnapshot(), false);
            return;
        }

        if (action == "browser.zoom") {
            std::string tabId = resolveTabId(payload);
            float zoom = payload.value("factor", 1.0f);
            if (m_browserMgr) {
                m_browserMgr->SetZoom(tabId, zoom);
            }
            callback(browserSnapshot(), false);
            return;
        }

        if (action == "browser.download.cancel") {
            std::string id;
            if (payload.contains("id") && payload["id"].is_string()) id = payload["id"].get<std::string>();
            bool ok = m_browserMgr ? m_browserMgr->CancelDownload(id) : false;
            callback(browserResult(ok), false);
            return;
        }

        if (action == "browser.clearData") {
            if (m_browserMgr) {
                m_browserMgr->ClearData();
            }
            callback(browserSnapshot(), false);
            return;
        }

        // --- 7. Gate & Authentication ---
        // Desktop access is decided only by the hosted LensDesk service.
        // There is no local "active" fallback.
        if (action == "gate.login") {
            json result;
            json gate;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                result = m_cloud.Login(payload);
                gate = m_cloud.GetGateView();
            }
            BroadcastEvent("lens:gate", gate);
            callback(result, false);
            return;
        }

        if (action == "gate.mfa") {
            json result;
            json gate;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                result = m_cloud.CompleteMfa(payload);
                gate = m_cloud.GetGateView();
            }
            BroadcastEvent("lens:gate", gate);
            callback(result, false);
            return;
        }

        if (action == "gate.validate" || action == "gate.state") {
            json gate;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                gate = m_cloud.EnsureValid();
            }
            BroadcastEvent("lens:gate", gate);
            callback(gate, false);
            return;
        }

        if (action == "gate.logout") {
            json gate;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                gate = m_cloud.Logout();
            }
            BroadcastEvent("lens:gate", gate);
            callback(gate, false);
            return;
        }

        if (action == "gate.purchase") {
            std::string url;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                url = m_cloud.GetPurchaseUrl();
            }
            callback({ { "url", url } }, false);
            return;
        }

        if (action == "cloud.configure") {
            std::string url = payload.value("url", "");
            json result;
            json gate;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                result = m_cloud.Configure(url);
                gate = m_cloud.GetGateView();
            }
            BroadcastEvent("lens:gate", gate);
            callback(result, false);
            return;
        }

        if (action == "cloud.state") {
            json cloud;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                cloud = m_cloud.GetCloudState();
            }
            callback(cloud, false);
            return;
        }

        if (action == "auth.status") {
            json gate;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                gate = m_cloud.GetGateView();
            }
            json auth = {
                { "authenticated", gate.value("authenticated", false) },
                { "mode", "cloud" },
                { "tier", gate.value("tier", "free") },
                { "email", gate.value("email", "") },
                { "licenseValid", gate.value("licenseValid", false) },
                { "serverUrl", gate.value("serverUrl", "") }
            };
            callback(auth, false);
            return;
        }

        if (action == "account.entitlement" || action == "cloud.entitlement") {
            json gate;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                if (!m_cloud.AuthorizedNow()) {
                    gate = m_cloud.EnsureValid();
                }
                if (!gate.is_null() && !gate.value("authenticated", false)) {
                    callback({ { "entitlement", nullptr },
                               { "plans", json::array() },
                               { "history", json::array() },
                               { "desktops", json::array() },
                               { "serverUrl", gate.value("serverUrl", "") } }, false);
                    return;
                }
                json entitlement = m_cloud.GetAccountEntitlement();
                callback(entitlement, false);
            }
            return;
        }

        // --- 8. AI & Chat ---
        if (action == "chat") {
            HandleChat(payload, callback);
            return;
        }

        if (action == "transcript.append") {
            std::string sessionId = payload.value("sessionId", "");
            std::string text = payload.value("text", "");
            if (!sessionId.empty() && !text.empty() && m_storageMgr) {
                json session = m_storageMgr->GetSession(sessionId);
                if (!session.empty() && session.contains("id")) {
                    std::string currentNotes = session.value("notes", "");
                    if (!currentNotes.empty()) currentNotes += "\n";
                    currentNotes += text;
                    session["notes"] = currentNotes;
                    session["updatedAt"] = GetIsoTimestamp();
                    m_storageMgr->SaveSession(session);
                }
            }
            callback({ { "success", true } }, false);
            return;
        }

        if (action == "desktop.displays") {
            json sources = m_captureSvc ? m_captureSvc->GetSources(false) : json::array();
            callback(sources, false);
            return;
        }

        if (action == "desktop.models.detect") {
            json models = json::array({
                { { "id", "local" }, { "name", "Ollama Local Endpoint" }, { "available", true } }
            });
            callback(models, false);
            return;
        }

        if (action == "model.list") {
            json models = json::array({
                { { "id", "gpt-4o" }, { "name", "GPT-4o (Omni)" }, { "provider", "openai" } },
                { { "id", "claude-3-5-sonnet" }, { "name", "Claude 3.5 Sonnet" }, { "provider", "anthropic" } },
                { { "id", "gemini-1.5-pro" }, { "name", "Gemini 1.5 Pro" }, { "provider", "google" } },
                { { "id", "ollama-local" }, { "name", "Ollama Local Model" }, { "provider", "local" } }
            });
            callback(models, false);
            return;
        }

        if (action == "chat.cancel") {
            callback({ { "cancelled", true } }, false);
            return;
        }

        if (action == "desktop.export") {
            callback({ { "success", true }, { "path", "LensDesk-Export.pdf" } }, false);
            return;
        }

        // Fallback for any other valid actions
        callback({ { "status", "ok" }, { "action", action } }, false);

    } catch (const std::exception& ex) {
        callback(json(ex.what()), true);
    }
}

void ServiceDispatcher::HandleChat(const json& payload, DispatchResponseCallback callback) {
    {
        std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
        if (!m_cloud.AuthorizedNow()) {
            json gate = m_cloud.EnsureValid();
            if (!gate.value("licenseValid", false)) {
                callback("Desktop access is not active. Sign in with an active LensDesk plan, or renew it on the website.", true);
                return;
            }
        }
    }

    const std::string text = payload.value("text", payload.value("prompt", ""));
    if (TrimText(text).empty()) {
        callback("Enter a question before sending.", true);
        return;
    }
    const std::string sessionId = payload.value("sessionId", "");
    const std::string requestId = payload.value("requestId", "");
    const std::string mode = payload.value("mode", "general");
    json images = json::array();
    if (payload.contains("images") && payload["images"].is_array()) images = payload["images"];

    json prefs = m_storageMgr ? m_storageMgr->GetPreferences() : json::object();
    const std::string provider = prefs.value("provider", "openai");
    std::string model = prefs.value("model", "");
    if (model.empty()) {
        if (provider == "openai") model = "gpt-4.1-mini";
        else if (provider == "groq") model = "llama-3.3-70b-versatile";
        else if (provider == "gemini") model = "gemini-3.8-flash";
        else if (provider == "anthropic") model = "claude-sonnet-4-5";
        else if (provider == "deepseek") model = "deepseek-chat";
        else model = "llama3.2";
    }
    const std::string systemPrompt = prefs.value("systemPrompt", "You are LensDesk, an intelligent desktop assistant.");
    const std::string language = prefs.value("language", "en");
    const std::string localBaseUrl = prefs.value("localBaseUrl", "http://127.0.0.1:11434/v1");

    std::string apiKey;
    if (provider != "local") {
        apiKey = m_storageMgr ? m_storageMgr->GetApiKey(provider) : "";
        if (apiKey.empty()) {
            callback("No API key is saved for " + provider + ". Open Settings and add a provider key.", true);
            return;
        }
    }

    const int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    const std::string nowIso = GetIsoTimestamp();

    // 1. Get or create the session and add the user's message before
    // building provider context.
    json session = m_storageMgr ? m_storageMgr->GetSession(sessionId) : json::object();
    if (session.empty() || !session.contains("id")) {
        session["id"] = sessionId.empty() ? ("sess_" + std::to_string(nowMs)) : sessionId;
        session["title"] = text.substr(0, std::min<size_t>(text.length(), 40));
        session["mode"] = mode;
        session["profileId"] = "default";
        session["createdAt"] = nowIso;
        session["updatedAt"] = nowIso;
        session["version"] = 1;
        session["messages"] = json::array();
    }
    if (!session.contains("messages") || !session["messages"].is_array()) {
        session["messages"] = json::array();
    }

    std::vector<json> history;
    const size_t start = session["messages"].size() > 24 ? session["messages"].size() - 24 : 0;
    for (size_t i = start; i < session["messages"].size(); ++i) {
        history.push_back(session["messages"][i]);
    }

    json userMsg = {
        { "id", "msg_user_" + std::to_string(nowMs) },
        { "role", "user" },
        { "content", text },
        { "createdAt", nowIso }
    };
    if (!images.empty()) userMsg["images"] = images;
    session["messages"].push_back(userMsg);

    std::string profileContext;
    const std::string profileId = session.value("profileId", "");
    if (!profileId.empty() && m_storageMgr) {
        for (const auto& profile : m_storageMgr->GetProfiles()) {
            if (profile.value("id", "") != profileId) continue;
            if (profile.contains("resume") && profile["resume"].is_string() && !profile["resume"].get<std::string>().empty()) {
                profileContext += "\n\nCandidate background:\n" + profile["resume"].get<std::string>();
            }
            if (profile.contains("jobDescription") && profile["jobDescription"].is_string() && !profile["jobDescription"].get<std::string>().empty()) {
                profileContext += "\n\nTarget role:\n" + profile["jobDescription"].get<std::string>();
            }
            break;
        }
    }
    const std::string fullSystemPrompt = systemPrompt + profileContext +
        (language.empty() ? "" : "\n\nRespond in " + language + ".");

    const bool visionProvider = provider == "openai" || provider == "gemini" ||
        provider == "anthropic" || provider == "local";
    const std::string endpoint = ProviderEndpoint(provider, localBaseUrl);

    m_workers.emplace_back([this, callback, session, history, userMsg, images, provider, model,
                            endpoint, apiKey, fullSystemPrompt, requestId, nowMs, visionProvider]() mutable {
        json requestBody;
        requestBody["model"] = model;
        requestBody["max_tokens"] = 4096;

        if (provider == "anthropic") {
            requestBody["system"] = fullSystemPrompt;
            json messages = json::array();
            for (const auto& message : history) {
                const std::string role = message.value("role", "user");
                if (role != "user" && role != "assistant") continue;
                json entry;
                entry["role"] = role;
                entry["content"] = message.value("content", "");
                messages.push_back(entry);
            }
            json userEntry;
            userEntry["role"] = "user";
            if (visionProvider && !images.empty()) {
                json content = json::array();
                content.push_back({ { "type", "text" }, { "text", userMsg.value("content", "") } });
                for (const auto& image : images) {
                    if (!image.is_string()) continue;
                    const std::string dataUrl = image.get<std::string>();
                    const size_t comma = dataUrl.find(',');
                    if (comma == std::string::npos) continue;
                    const std::string meta = dataUrl.substr(0, comma);
                    std::string mediaType = "image/png";
                    const size_t colon = meta.find(':');
                    const size_t semi = meta.find(';');
                    if (colon != std::string::npos && semi != std::string::npos)
                        mediaType = meta.substr(colon + 1, semi - colon - 1);
                    content.push_back({
                        { "type", "image" },
                        { "source", {
                            { "type", "base64" },
                            { "media_type", mediaType },
                            { "data", dataUrl.substr(comma + 1) }
                        }}
                    });
                }
                userEntry["content"] = content;
            } else {
                userEntry["content"] = userMsg.value("content", "");
            }
            messages.push_back(userEntry);
            requestBody["messages"] = messages;
        } else {
            json messages = json::array();
            messages.push_back({ { "role", "system" }, { "content", fullSystemPrompt } });
            for (const auto& message : history) {
                const std::string role = message.value("role", "user");
                if (role != "user" && role != "assistant") continue;
                json entry;
                entry["role"] = role;
                entry["content"] = message.value("content", "");
                messages.push_back(entry);
            }
            json userEntry;
            userEntry["role"] = "user";
            if (visionProvider && !images.empty()) {
                json content = json::array();
                content.push_back({ { "type", "text" }, { "text", userMsg.value("content", "") } });
                for (const auto& image : images) {
                    if (!image.is_string()) continue;
                    content.push_back({
                        { "type", "image_url" },
                        { "image_url", { { "url", image.get<std::string>() } } }
                    });
                }
                userEntry["content"] = content;
            } else {
                userEntry["content"] = userMsg.value("content", "");
            }
            messages.push_back(userEntry);
            requestBody["messages"] = messages;
        }

        HttpReply reply;
        if (provider == "anthropic") {
            const std::string headers =
                "x-api-key: " + apiKey + "\r\nanthropic-version: 2023-06-01\r\n";
            reply = HttpPostJson(endpoint, requestBody, "", headers, 90000);
        } else {
            reply = HttpPostJson(endpoint, requestBody, apiKey, "", 90000);
        }

        if (reply.networkError || reply.status < 200 || reply.status >= 300) {
            std::string message = reply.error;
            if (message.empty()) message = "The AI provider request failed.";
            PostToUi([callback, message]() { callback(message, true); });
            return;
        }

        std::string answer = ExtractAssistantText(provider, reply.body);
        if (TrimText(answer).empty()) {
            PostToUi([callback]() { callback("The AI provider returned an empty response.", true); });
            return;
        }

        json assistantMessage = {
            { "id", "msg_asst_" + std::to_string(nowMs + 1) },
            { "role", "assistant" },
            { "content", answer },
            { "createdAt", GetIsoTimestamp() },
            { "provider", provider },
            { "model", model }
        };
        session["messages"].push_back(assistantMessage);
        session["updatedAt"] = GetIsoTimestamp();
        session["version"] = session.value("version", 1) + 1;

        if (m_storageMgr) m_storageMgr->SaveSession(session);

        PostToUi([this, callback, requestId, answer, session]() {
            if (!requestId.empty()) {
                BroadcastEvent("lens:chat", {
                    { "requestId", requestId },
                    { "type", "delta" },
                    { "text", answer }
                });
                BroadcastEvent("lens:chat", {
                    { "requestId", requestId },
                    { "type", "done" },
                    { "fullText", answer }
                });
            }
            callback(session, false);
        });
    });
}

} // namespace LensDesk
