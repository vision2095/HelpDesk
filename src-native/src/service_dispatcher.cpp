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
#include <unordered_set>

namespace LensDesk {

namespace {

static json errorResult(const std::string& err) {
    return json{ { "ok", false }, { "error", err } };
}

static std::wstring GetExecutablePath() {
#ifdef _WIN32
    wchar_t buf[MAX_PATH] = { 0 };
    GetModuleFileNameW(nullptr, buf, MAX_PATH);
    return std::wstring(buf);
#else
    return L"";
#endif
}

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

HttpReply HttpGet(
    const std::string& url,
    const std::string& bearer = "",
    int timeoutMs = 2000
) {
    HttpReply reply;
#ifdef _WIN32
    std::wstring wideUrl = Utf8ToWide(url);
    URL_COMPONENTS components{};
    components.dwStructSize = sizeof(components);
    components.dwSchemeLength = static_cast<DWORD>(-1);
    components.dwHostNameLength = static_cast<DWORD>(-1);
    components.dwUrlPathLength = static_cast<DWORD>(-1);
    components.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(wideUrl.c_str(), static_cast<DWORD>(wideUrl.size()), 0, &components)) {
        reply.networkError = true;
        reply.error = "The endpoint is invalid.";
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
        return reply;
    }
    WinHttpSetTimeouts(session, 1000, 1000, timeoutMs, timeoutMs);
    HINTERNET connection = WinHttpConnect(session, host.c_str(), components.nPort, 0);
    if (!connection) {
        reply.networkError = true;
        WinHttpCloseHandle(session);
        return reply;
    }
    HINTERNET request = WinHttpOpenRequest(connection, L"GET", path.c_str(), nullptr,
                                           WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                           secure ? WINHTTP_FLAG_SECURE : 0);
    if (!request) {
        reply.networkError = true;
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return reply;
    }
    std::wstring headers = L"Accept: application/json\r\n";
    if (!bearer.empty()) {
        headers += L"Authorization: Bearer " + Utf8ToWide(bearer) + L"\r\n";
    }
    if (!WinHttpSendRequest(request, headers.c_str(), static_cast<DWORD>(headers.size()),
                            nullptr, 0, 0, 0)) {
        reply.networkError = true;
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return reply;
    }
    if (!WinHttpReceiveResponse(request, nullptr)) {
        reply.networkError = true;
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return reply;
    }
    DWORD statusCode = 0;
    DWORD statusSize = sizeof(statusCode);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &statusSize, WINHTTP_NO_HEADER_INDEX);
    reply.status = static_cast<int>(statusCode);

    std::string responseBody;
    DWORD bytesAvailable = 0;
    while (WinHttpQueryDataAvailable(request, &bytesAvailable) && bytesAvailable > 0) {
        std::vector<char> buffer(bytesAvailable);
        DWORD bytesRead = 0;
        if (WinHttpReadData(request, buffer.data(), bytesAvailable, &bytesRead) && bytesRead > 0) {
            responseBody.append(buffer.data(), bytesRead);
        }
    }
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);

    if (!responseBody.empty()) {
        try {
            reply.body = json::parse(responseBody);
        } catch (...) {
            reply.body = json::object();
        }
    }
#endif
    return reply;
}

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

HttpReply HttpStreamJson(
    const std::string& url,
    const json& payload,
    const std::string& bearer,
    const std::string& extraHeaders,
    std::function<void(const std::string& chunk)> onDelta,
    std::function<bool()> isCancelled = nullptr,
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
        L"Accept: text/event-stream, application/json\r\n";
    if (!bearer.empty()) {
        headers += L"Authorization: Bearer " + Utf8ToWide(bearer) + L"\r\n";
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

    if (reply.status < 200 || reply.status >= 300) {
        char errBuf[4096]{};
        DWORD errRead = 0;
        if (WinHttpReadData(request, errBuf, sizeof(errBuf) - 1, &errRead) && errRead > 0) {
            reply.text.assign(errBuf, errRead);
            try { reply.body = json::parse(reply.text); } catch (...) {}
        }
        if (reply.status == 401) reply.error = "Invalid API key or unauthorized access for this provider.";
        else if (reply.status == 429) reply.error = "Rate limit or quota exceeded for this provider.";
        else if (reply.status == 403) reply.error = "Access forbidden. Check your provider permissions.";
        else reply.error = "Provider error HTTP " + std::to_string(reply.status);
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return reply;
    }

    char buffer[4096]{};
    DWORD read = 0;
    std::string lineBuffer;
    while (WinHttpReadData(request, buffer, sizeof(buffer) - 1, &read) && read > 0) {
        if (isCancelled && isCancelled()) {
            reply.error = "Request cancelled.";
            break;
        }
        lineBuffer.append(buffer, read);
        size_t newlinePos = 0;
        while ((newlinePos = lineBuffer.find('\n')) != std::string::npos) {
            std::string line = lineBuffer.substr(0, newlinePos);
            lineBuffer.erase(0, newlinePos + 1);
            if (!line.empty() && line.back() == '\r') line.pop_back();

            if (line.rfind("data: ", 0) == 0) {
                std::string dataStr = line.substr(6);
                if (dataStr == "[DONE]") continue;
                try {
                    json dataJson = json::parse(dataStr);
                    std::string deltaText;
                    if (dataJson.contains("choices") && dataJson["choices"].is_array() && !dataJson["choices"].empty()) {
                        const auto& choice = dataJson["choices"][0];
                        if (choice.contains("delta") && choice["delta"].contains("content")) {
                            deltaText = choice["delta"]["content"].get<std::string>();
                        } else if (choice.contains("text")) {
                            deltaText = choice["text"].get<std::string>();
                        }
                    } else if (dataJson.contains("type") && dataJson["type"] == "content_block_delta" &&
                               dataJson.contains("delta") && dataJson["delta"].contains("text")) {
                        deltaText = dataJson["delta"]["text"].get<std::string>();
                    } else if (dataJson.contains("candidates") && dataJson["candidates"].is_array() && !dataJson["candidates"].empty()) {
                        const auto& cand = dataJson["candidates"][0];
                        if (cand.contains("content") && cand["content"].contains("parts") && !cand["content"]["parts"].empty()) {
                            deltaText = cand["content"]["parts"][0].value("text", "");
                        }
                    } else if (dataJson.contains("response")) {
                        deltaText = dataJson["response"].get<std::string>();
                    }
                    if (!deltaText.empty()) {
                        reply.text += deltaText;
                        if (onDelta) onDelta(deltaText);
                    }
                } catch (...) {
                }
            }
        }
    }
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);

    if (reply.text.empty() && !lineBuffer.empty()) {
        try {
            reply.body = json::parse(lineBuffer);
            reply.text = ExtractAssistantText("", reply.body);
        } catch (...) {
            reply.text = lineBuffer;
        }
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
    m_audioCapture.Shutdown();
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
    m_uiThreadId = GetCurrentThreadId();
    m_cloud.Initialize();

    if (m_cloud.HasSession()) {
        std::string userId = m_cloud.GetUserId();
        std::string email = m_cloud.GetUserEmail();
        if (!userId.empty() && m_storageMgr) {
            m_storageMgr->SetCurrentAccount(userId, email);
            json cloudSettings = m_cloud.GetUserSettings();
            if (!cloudSettings.is_null() && cloudSettings.is_object() && !cloudSettings.empty()) {
                json current = m_storageMgr->GetPreferences();
                for (auto& [k, v] : cloudSettings.items()) {
                    current[k] = v;
                }
                m_storageMgr->SavePreferences(current);
            }
        }
    }

    // Apply persisted desktop preferences before the UI reads its initial state.
    // The window is created with safe defaults, so a saved opt-out must be
    // applied explicitly or it is silently ignored until the next settings save.
    if (m_storageMgr) {
        const json prefs = m_storageMgr->GetPreferences();
        if (m_winMgr) {
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
        if (m_inputMgr && prefs.contains("shortcuts") && prefs["shortcuts"].is_object()) {
            m_inputMgr->UpdateShortcuts(prefs["shortcuts"]);
        }
    }

    // Connect browser state updates to WebView2 host push
    if (m_browserMgr) {
        m_browserMgr->SetStateChangedCallback([this](const json& state) {
            BroadcastEvent("lens:browser-state", state);
        });
        m_browserMgr->SetEventCallback([this](const std::string& eventName) {
            if (eventName == "lens:shortcut:browser") {
                if (m_webHost) m_webHost->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
                if (m_focusMgr) {
                    m_focusMgr->SetFocusTarget(FocusState::FOCUSED_ASSISTANT, "browser_shortcut_exit");
                }
                BroadcastEvent("lens:shortcut", { { "action", "browser" } });
                return;
            }
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
            if (action == "toggle" || action == "hide" || action == "desktop.overlay") {
                bool nextVis = !m_winMgr->IsVisible();
                m_winMgr->SetVisible(nextVis);
                BroadcastEvent("lens:overlay", {
                    { "visible", nextVis },
                    { "floating", true }
                });
            } else if (action == "clickThrough") {
                bool nextCt = !m_winMgr->IsClickThrough();
                m_winMgr->SetClickThrough(nextCt);
                BroadcastEvent("lens:clickThrough", {
                    { "clickThrough", nextCt }
                });
            } else if (action == "overlay" || action == "overlay.radial") {
                m_winMgr->SetVisible(true);
                if (m_imguiOverlay) {
                    POINT pt{};
                    GetCursorPos(&pt);
                    if (m_hwnd) {
                        ScreenToClient(m_hwnd, &pt);
                    }
                    m_imguiOverlay->SetRadialCenter(static_cast<float>(pt.x), static_cast<float>(pt.y));
                    m_imguiOverlay->ToggleRadialMenu();
                }
            } else if (action == "stopTyping") {
                if (m_inputMgr) m_inputMgr->StopAutoType();
                BroadcastEvent("lens:shortcut", { { "action", "stopTyping" } });
            } else if (action == "quit") {
                if (m_hwnd) PostMessage(m_hwnd, WM_CLOSE, 0, 0);
            } else {
                // React handles the browser shortcut as "browser".
                const std::string uiAction = action == "browser.toggle" ? "browser" : action;
                BroadcastEvent("lens:shortcut", { { "action", uiAction } });
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
    if (m_hwnd && m_uiThreadId != 0 && GetCurrentThreadId() != m_uiThreadId) {
        PostToUi([this, eventName, eventData]() {
            if (m_webHost) m_webHost->BroadcastEvent(eventName, eventData);
        });
        return;
    }
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

json ServiceDispatcher::GetGateView() {
    std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
    return m_cloud.GetGateView();
}

bool ServiceDispatcher::IsProtectedAction(const std::string& action) const {
    static const std::unordered_set<std::string> s_protected = {
        "desktop.capture",
        "desktop.autoType",
        "desktop.ocr",
        "chat",
        "model.list",
        "model.test",
        "document.read",
        "image.ocr",
        "session.save",
        "session.patch",
        "session.delete",
        "session.get",
        "session.search",
        "transcript.append",
        "sync.changes",
        "recovery.snapshots",
        "recovery.restore",
        "history.list",
        "history.restore",
        "backup",
        "backup.restore",
        "profile.save",
        "profile.delete",
        "browser.open",
        "browser.create"
    };
    return s_protected.find(action) != s_protected.end();
}

json ServiceDispatcher::BuildFullState() {
    json prefs = m_storageMgr ? m_storageMgr->GetPreferences() : json::object();
    json profiles = m_storageMgr ? m_storageMgr->GetProfiles() : json::array();
    json sessions = m_storageMgr ? m_storageMgr->GetSessions() : json::array();
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
        if (m_storageMgr) m_storageMgr->SaveSession(initialSession);
        sessions = json::array({ initialSession });
    }

    json keyStatus = m_storageMgr ? m_storageMgr->GetKeyStatus() : json::object();
    json ownedKeys = keyStatus;
    for (auto& item : ownedKeys.items()) item.value() = false;
    ownedKeys["local"] = true;

    json state;
    state["settings"] = prefs;
    state["profiles"] = profiles;
    state["sessions"] = sessions;
    state["storage"] = m_cloud.HasSession() ? "cloud" : "local";
    if (m_cloud.HasSession()) {
        state["accountId"] = m_cloud.GetUserId();
        state["userEmail"] = m_cloud.GetUserEmail();
    }
    state["cloudConnected"] = m_cloud.HasSession();
    state["keys"] = keyStatus;
    state["ownedKeys"] = ownedKeys;
    state["browser"] = browserState;
    state["gate"] = GetGateView();
    state["floating"] = true;
    state["visible"] = m_winMgr ? m_winMgr->IsVisible() : true;
    state["captureProtection"] = m_winMgr ? m_winMgr->IsCaptureProtection() : true;
    state["clickThrough"] = m_winMgr ? m_winMgr->IsClickThrough() : false;
    return state;
}

void ServiceDispatcher::Dispatch(const std::string& action, const json& payload, DispatchResponseCallback callback) {
    try {
        if (IsProtectedAction(action)) {
            std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
            if (!m_cloud.AuthorizedNow()) {
                callback(errorResult("Sign in to continue. Desktop access is locked until authenticated."), true);
                return;
            }
        }

        // --- 1. State ---
        if (action == "state") {
            callback(BuildFullState(), false);
            return;
        }

        // --- 2. Settings & Preferences ---
        if (action == "settings.get" || action == "settings") {
            json prefs = m_storageMgr ? m_storageMgr->GetPreferences() : json::object();
            callback(prefs, false);
            return;
        }

        if (action == "settings.save") {
            json currentPrefs = m_storageMgr ? m_storageMgr->GetPreferences() : json::object();
            for (auto& [k, v] : payload.items()) {
                if (v.is_object() && currentPrefs.contains(k) && currentPrefs[k].is_object()) {
                    for (auto& [subK, subV] : v.items()) {
                        currentPrefs[k][subK] = subV;
                    }
                } else {
                    currentPrefs[k] = v;
                }
            }
            if (m_storageMgr) {
                m_storageMgr->SavePreferences(currentPrefs);
            }

            if (m_cloud.HasSession()) {
                std::thread([this, currentPrefs]() {
                    try {
                        m_cloud.SyncUserSettings(currentPrefs);
                    } catch (...) {}
                }).detach();
            }

            if (m_winMgr) {
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
            }
            if (m_inputMgr && payload.contains("shortcuts") && payload["shortcuts"].is_object()) {
                m_inputMgr->UpdateShortcuts(payload["shortcuts"]);
            }

            BroadcastEvent("lens:preferences", currentPrefs);
            callback(BuildFullState(), false);
            return;
        }

        if (action == "desktop.preferences") {
            json prefs = m_storageMgr ? m_storageMgr->GetPreferences() : json::object();
            prefs["shortcutErrors"] = json::array();
            prefs["packaged"] = true;
            prefs["hookAvailable"] = true;
            prefs["hookCombos"] = json::array({ "Shift+H", "Shift+M", "Control+Shift+Space" });
            callback(prefs, false);
            return;
        }

        if (action == "desktop.preferences.save") {
            json currentPrefs = m_storageMgr ? m_storageMgr->GetPreferences() : json::object();
            for (auto& [k, v] : payload.items()) {
                if (v.is_object() && currentPrefs.contains(k) && currentPrefs[k].is_object()) {
                    for (auto& [subK, subV] : v.items()) {
                        currentPrefs[k][subK] = subV;
                    }
                } else {
                    currentPrefs[k] = v;
                }
            }
            if (m_storageMgr) {
                m_storageMgr->SavePreferences(currentPrefs);
            }

            if (m_cloud.HasSession()) {
                std::thread([this, currentPrefs]() {
                    try {
                        m_cloud.SyncUserSettings(currentPrefs);
                    } catch (...) {}
                }).detach();
            }

            if (m_winMgr) {
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
            }
            if (m_inputMgr && payload.contains("shortcuts") && payload["shortcuts"].is_object()) {
                m_inputMgr->UpdateShortcuts(payload["shortcuts"]);
            }

            json res = currentPrefs;
            res["shortcutErrors"] = json::array();
            res["packaged"] = true;
            res["hookAvailable"] = true;
            res["hookCombos"] = json::array({ "Shift+H", "Shift+M", "Control+Shift+Space" });

            BroadcastEvent("lens:preferences", res);
            callback(res, false);
            return;
        }

        if (action == "desktop.appearance") {
            callback({ { "success", true } }, false);
            return;
        }

        if (action == "desktop.opacity") {
            float op = payload.value("opacity", 1.0f);
            if (m_winMgr) {
                m_winMgr->SetOpacity(op);
            }
            BroadcastEvent("lens:opacity-changed", op);
            callback(json{{"ok", true}, {"opacity", op}}, false);
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
            if (payload.contains("enable")) {
                bool enable = payload.value("enable", true);
                m_winMgr->SetCaptureProtection(enable);
                if (m_imguiOverlay) {
                    m_imguiOverlay->GetState().captureProtectionActive = enable;
                }
            }
            bool isProtected = m_winMgr ? m_winMgr->IsCaptureProtection() : true;
            json status = {
                { "requested", isProtected },
                { "appliedRequest", isProtected },
                { "nativeFlag", isProtected },
                { "captureProtection", isProtected },
                { "platform", "win32" },
                { "limitation", "Exclusion depends on the operating system and capture application. Test your sharing application before relying on it." }
            };
            callback(status, false);
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
            } else if (payload.contains("id") && payload["id"].is_string()) {
                std::string id = payload.value("id", "");
                if (id.rfind("window:", 0) == 0) {
                    try {
                        uintptr_t hwndVal = std::stoull(id.substr(7));
                        dataUrl = m_captureSvc->CaptureWindow(reinterpret_cast<HWND>(hwndVal));
                    } catch (...) {
                        dataUrl = m_captureSvc->CaptureScreen(-1);
                    }
                } else if (id.rfind("screen:", 0) == 0) {
                    try {
                        int idx = std::stoi(id.substr(7));
                        dataUrl = m_captureSvc->CaptureScreen(idx);
                    } catch (...) {
                        dataUrl = m_captureSvc->CaptureScreen(-1);
                    }
                } else {
                    dataUrl = m_captureSvc->CaptureScreen(-1);
                }
            } else {
                int screenIdx = payload.value("screenIndex", -1);
                dataUrl = m_captureSvc->CaptureScreen(screenIdx);
            }

            json response;
            response["image"] = dataUrl;
            response["dataUrl"] = dataUrl;
            response["images"] = dataUrl.empty() ? json::array() : json::array({ dataUrl });
            response["archiveError"] = "";
            callback(response, false);
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

        if (action == "desktop.wipeAllData") {
#ifdef LENSDESK_ENABLE_TEST_AUTH
            callback("Data wipe is disabled in the fixture host.", true);
            return;
#else
            // Remove only LensDesk-owned local state. Never terminate unrelated
            // WebView2 processes and never delete another application's data.
#ifdef _WIN32
            wchar_t* localAppData = nullptr;
            if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))) {
                std::filesystem::path base(localAppData);
                CoTaskMemFree(localAppData);
                std::error_code ec;
                std::filesystem::remove_all(base / L"LensDesk", ec);
            }
            RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\LensDesk");
#endif
            if (m_storageMgr) {
                m_storageMgr->ClearAllData();
            }
            callback({ { "wiped", true } }, false);
#ifdef _WIN32
            PostQuitMessage(0);
#endif
            return;
#endif
        }

        if (action == "desktop.ocr") {
            std::string imageB64 = payload.value("image", "");
            if (imageB64.empty()) {
                imageB64 = payload.value("dataUrl", "");
            }
            if (!m_captureSvc) {
                callback("OCR service is unavailable.", true);
                return;
            }
            if (imageB64.empty()) {
                callback("OCR requires an image.", true);
                return;
            }
            // OCR can take seconds on a large screenshot. Run WinRT recognition
            // on a dedicated MTA worker and marshal only the result back to the
            // UI thread so the WebView2 message loop stays responsive.
            const std::string languageTag = payload.value("language", "");
            m_workers.emplace_back([this, imageB64, languageTag, callback]() {
                std::string ocrText;
                try {
                    ocrText = m_captureSvc->PerformOcrOnBase64(imageB64, languageTag);
                } catch (...) {
                    ocrText.clear();
                }
                PostToUi([callback, ocrText]() {
                    if (ocrText.empty()) {
                        callback("OCR could not recognize text in the image.", true);
                    } else {
                        callback(json{ { "ok", true }, { "text", ocrText } }, false);
                    }
                });
            });
            return;
        }

        if (action == "audio.startLoopback") {
            bool ok = m_audioCapture.StartCapture();
            callback({ { "started", ok } }, false);
            return;
        }

        if (action == "audio.stopLoopback") {
            m_audioCapture.StopCapture();
            callback({ { "stopped", true } }, false);
            return;
        }

        if (action == "audio.getLoopbackChunk" || action == "audio.getLoopbackChunkPcm16") {
            const std::string format = action == "audio.getLoopbackChunkPcm16"
                ? "pcm16" : payload.value("format", std::string("float32"));
            if (format != "pcm16" && format != "float32") {
                callback("Unsupported loopback audio format.", true);
                return;
            }
            const auto chunk = m_audioCapture.GetAudioChunk(format == "pcm16");
            if (!chunk.sampleRate || !chunk.channels) {
                callback("Loopback audio is not initialized.", true);
                return;
            }
            callback({ { "data", chunk.data }, { "sampleRate", chunk.sampleRate },
                       { "channels", chunk.channels }, { "format", format } }, false);
            return;
        }

        if (action == "browser.toggle") {
            if (!m_webHost || !m_webHost->IsReady()) {
                callback("Browser view is not ready.", true);
                return;
            }
            // React owns the current view; dispatch the same shortcut it uses
            // for the in-browser toggle. The reply confirms dispatch only.
            BroadcastEvent("lens:shortcut", { { "action", "browser" } });
            callback({ { "dispatched", true } }, false);
            return;
        }

        if (action == "window.toggleMouseMode") {
            if (m_winMgr) {
                bool newClickThrough = !m_winMgr->IsClickThrough();
                m_winMgr->SetClickThrough(newClickThrough);
                callback({ { "clickThrough", newClickThrough } }, false);
                return;
            }
            callback({ { "clickThrough", false } }, false);
            return;
        }

        if (action == "provider.cycle") {
            // Cycle active provider in settings
            if (m_storageMgr) {
                json settings = m_storageMgr->GetSettings();
                std::string current = settings.value("provider", "openai");
                const std::vector<std::string> providerOrder = {
                    "openai", "groq", "gemini", "anthropic", "deepseek", "local"
                };
                auto it = std::find(providerOrder.begin(), providerOrder.end(), current);
                std::string next = (it != providerOrder.end() && (it + 1) != providerOrder.end()) ? *(it + 1) : providerOrder[0];
                settings["provider"] = next;
                m_storageMgr->SaveSettings(settings);
                BroadcastEvent("settings:updated", settings);
                callback({ { "cycled", true }, { "provider", next } }, false);
                return;
            }
            callback({ { "cycled", false } }, true);
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

        if (action == "desktop.notch") {
            if (m_winMgr) {
                int w = payload.value("width", 380);
                int h = payload.value("height", 36);
                m_winMgr->DockToTopCenter(w, h);
                callback(json{{"docked", true}}, false);
                return;
            }
            callback(json{{"docked", false}}, false);
            return;
        }

        if (action == "desktop.cursorPos") {
            POINT pt{0, 0};
            GetCursorPos(&pt);
            callback(json{{"x", pt.x}, {"y", pt.y}}, false);
            return;
        }

        if (action == "desktop.machineGuid") {
            std::string guid = "default-machine-guid";
#ifdef _WIN32
            HKEY hKey;
            if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Cryptography", 0, KEY_READ | KEY_WOW64_64KEY, &hKey) == ERROR_SUCCESS) {
                wchar_t buf[256]{};
                DWORD bufSize = sizeof(buf);
                if (RegQueryValueExW(hKey, L"MachineGuid", nullptr, nullptr, reinterpret_cast<LPBYTE>(buf), &bufSize) == ERROR_SUCCESS) {
                    guid = WideToUtf8(buf);
                }
                RegCloseKey(hKey);
            }
#endif
            callback(json{{"guid", guid}}, false);
            return;
        }

        if (action == "desktop.restart") {
            std::wstring exe = GetExecutablePath();
            ShellExecuteW(nullptr, L"open", exe.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            if (m_winMgr) m_winMgr->Shutdown();
            PostQuitMessage(0);
            callback(json{{"restarting", true}}, false);
            return;
        }

        if (action == "desktop.updater.check") {
            // Query the release manifest. This action is intentionally allowed
            // before sign-in so users can update a locked installation.
            m_workers.emplace_back([this, callback]() {
                json result;
                try {
                    result = m_cloud.CheckForUpdate();
                } catch (...) {
                    result = json{{"ok", false}, {"updateAvailable", false},
                                  {"currentVersion", WideToUtf8(APP_VERSION)},
                                  {"error", "Could not check for updates."}};
                }
                PostToUi([callback, result]() {
                    callback(result, !result.value("ok", false));
                });
            });
            return;
        }

        if (action == "desktop.updater.downloadAndInstall") {
            m_workers.emplace_back([this, callback]() {
                json result;
                try {
                    result = m_cloud.DownloadAndInstallUpdate();
                } catch (...) {
                    result = json{{"downloaded", false}, {"error", "Could not install the update."}};
                }
                PostToUi([callback, result]() {
                    callback(result, result.contains("error"));
                });
            });
            return;
        }

        if (action == "desktop.captureArchive.status") {
            callback(json{{"directory", ""}, {"files", 0}, {"bytes", 0}, {"limit", 209715200}}, false);
            return;
        }

        if (action == "desktop.captureArchive.save") {
            callback(json{{"saved", false}}, false);
            return;
        }

        if (action == "model.test") {
            const std::string prov = payload.value("provider", "");
            const std::string mod = payload.value("model", "");
            const std::string localUrl = payload.value("localBaseUrl", "");

            if (prov.empty()) {
                callback("Provider is required for model test.", true);
                return;
            }

            std::string apiKey = payload.value("apiKey", payload.value("key", ""));
            if (apiKey.empty() && prov != "local" && m_storageMgr) {
                apiKey = m_storageMgr->GetApiKey(prov);
            }

            if (prov != "local" && apiKey.empty()) {
                if (payload.value("hosted", false)) {
                    bool hasCloud = false;
                    {
                        std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                        hasCloud = m_cloud.HasSession();
                    }
                    if (hasCloud) {
                        m_workers.emplace_back([this, payload, callback]() {
                            try {
                                json res;
                                {
                                    std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                                    res = m_cloud.CloudRequest("model.test", payload);
                                }
                                PostToUi([callback, res]() { callback(res, false); });
                            } catch (const std::exception& e) {
                                const std::string err = e.what();
                                PostToUi([callback, err]() { callback(err, true); });
                            }
                        });
                        return;
                    }
                }
                callback("Paste an API key for " + prov + " before testing the connection.", true);
                return;
            }

            m_workers.emplace_back([this, prov, mod, localUrl, apiKey, callback]() {
                const std::string endpoint = ProviderEndpoint(prov, localUrl);
                json requestBody;
                requestBody["model"] = mod;
                requestBody["max_tokens"] = 16;

                if (prov == "anthropic") {
                    requestBody["system"] = "Reply with one word: OK";
                    json messages = json::array({
                        { { "role", "user" }, { "content", "Ping" } }
                    });
                    requestBody["messages"] = messages;
                    const std::string headers = "x-api-key: " + apiKey + "\r\nanthropic-version: 2023-06-01\r\n";
                    HttpReply reply = HttpPostJson(endpoint, requestBody, "", headers, 15000);
                    if (reply.networkError || reply.status < 200 || reply.status >= 300) {
                        std::string msg = reply.error.empty() ? "Model test connection failed." : reply.error;
                        PostToUi([callback, msg]() { callback(msg, true); });
                        return;
                    }
                    std::string text = ExtractAssistantText(prov, reply.body);
                    PostToUi([callback, prov, mod, text]() {
                        callback(json{ { "ok", true }, { "provider", prov }, { "model", mod }, { "preview", text } }, false);
                    });
                } else {
                    json messages = json::array({
                        { { "role", "user" }, { "content", "Ping" } }
                    });
                    requestBody["messages"] = messages;
                    HttpReply reply = HttpPostJson(endpoint, requestBody, apiKey, "", 15000);
                    if (reply.networkError || reply.status < 200 || reply.status >= 300) {
                        std::string msg = reply.error.empty() ? "Model test connection failed." : reply.error;
                        PostToUi([callback, msg]() { callback(msg, true); });
                        return;
                    }
                    std::string text = ExtractAssistantText(prov, reply.body);
                    PostToUi([callback, prov, mod, text]() {
                        callback(json{ { "ok", true }, { "provider", prov }, { "model", mod }, { "preview", text } }, false);
                    });
                }
            });
            return;
        }

        if (action == "desktop.openScreenSettings") {
            ShellExecuteW(nullptr, L"open", L"ms-settings:display", nullptr, nullptr, SW_SHOWNORMAL);
            callback(json{{"ok", true}}, false);
            return;
        }

        if (action == "desktop.captureArchive.choose") {
            callback(json{{"cancelled", true}}, false);
            return;
        }

        if (action == "desktop.captureArchive.open") {
            std::string p = payload.value("path", "");
            if (!p.empty()) {
                ShellExecuteA(nullptr, "open", p.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            }
            callback(json{{"ok", true}}, false);
            return;
        }

        if (action == "backup") {
            json b = m_storageMgr ? m_storageMgr->CreateBackup() : json::object();
            callback(b, false);
            return;
        }

        if (action == "backup.restore") {
            if (!m_storageMgr) {
                callback("Storage manager is unavailable.", true);
                return;
            }
            std::string err;
            if (!m_storageMgr->RestoreBackup(payload, err)) {
                callback(err.empty() ? "Failed to restore backup." : err, true);
                return;
            }
            callback(BuildFullState(), false);
            return;
        }

        if (action == "recovery.snapshots") {
            json snaps = m_storageMgr ? m_storageMgr->GetSnapshots() : json::array();
            callback(snaps, false);
            return;
        }

        if (action == "recovery.restore") {
            if (!m_storageMgr) {
                callback("Storage manager is unavailable.", true);
                return;
            }
            const std::string snapId = payload.value("id", "");
            if (snapId.empty()) {
                callback("Snapshot ID is required for recovery restore.", true);
                return;
            }
            std::string err;
            if (!m_storageMgr->RestoreSnapshot(snapId, err)) {
                callback(err.empty() ? "Failed to restore recovery snapshot." : err, true);
                return;
            }
            callback(BuildFullState(), false);
            return;
        }

        if (action == "cloud.pull") {
            m_workers.emplace_back([this, payload, callback]() {
                try {
                    json result;
                    {
                        std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                        result = m_cloud.CloudRequest("cloud.pull", payload);
                    }
                    if (m_storageMgr && result.is_object() && result.contains("version") && result["version"] == 1) {
                        std::string err;
                        m_storageMgr->RestoreBackup(result, err);
                    }
                    json state = BuildFullState();
                    PostToUi([callback, state]() { callback(state, false); });
                } catch (const std::exception& e) {
                    const std::string error = e.what();
                    PostToUi([callback, error]() { callback(error, true); });
                }
            });
            return;
        }

        if (action == "cloud.push") {
            m_workers.emplace_back([this, payload, callback]() {
                try {
                    json pushPayload = payload;
                    if (pushPayload.empty() || !pushPayload.contains("version")) {
                        if (m_storageMgr) {
                            pushPayload = m_storageMgr->CreateBackup();
                        }
                    }
                    json result;
                    {
                        std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                        result = m_cloud.CloudRequest("cloud.push", pushPayload);
                    }
                    PostToUi([callback, result]() { callback(result, false); });
                } catch (const std::exception& e) {
                    const std::string error = e.what();
                    PostToUi([callback, error]() { callback(error, true); });
                }
            });
            return;
        }

        if (action == "danger.wipeAllData") {
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                m_cloud.Logout();
            }
            if (m_storageMgr) m_storageMgr->ClearAll();
            callback(json{{"ok", true}}, false);
            return;
        }

        if (action == "document.read") {
            std::string path = payload.value("path", "");
            std::string content;
            if (!path.empty()) {
                try {
                    std::ifstream f(path, std::ios::binary);
                    if (f.is_open()) {
                        std::stringstream ss;
                        ss << f.rdbuf();
                        content = ss.str();
                    }
                } catch (...) {}
            }
            callback(json{{"text", content}, {"content", content}}, false);
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

        if (action == "browser.pasteBundle") {
            json images = payload.value("images", json::array());
            std::string note = payload.value("note", "");
            if (m_browserMgr) {
                m_browserMgr->PasteBundle(images, note);
            }
            callback(browserSnapshot(), false);
            return;
        }

        // --- 7. Gate & Authentication ---
        // Desktop access is decided only by the hosted LensDesk service.
        // There is no local "active" fallback.
        if (action == "gate.browserLogin") {
            StartBrowserLogin(callback);
            return;
        }

        if (action == "gate.login") {
            json result;
            json gate;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                result = m_cloud.Login(payload);
                gate = m_cloud.GetGateView();
            }
            if (m_cloud.HasSession()) {
                std::string userId = m_cloud.GetUserId();
                std::string email = m_cloud.GetUserEmail();
                if (m_storageMgr && !userId.empty()) {
                    m_storageMgr->SetCurrentAccount(userId, email);
                }
                json cloudSettings = m_cloud.GetUserSettings();
                if (result.contains("settings") && result["settings"].is_object()) {
                    cloudSettings = result["settings"];
                }
                if (m_storageMgr && !cloudSettings.is_null() && cloudSettings.is_object() && !cloudSettings.empty()) {
                    json current = m_storageMgr->GetPreferences();
                    for (auto& [k, v] : cloudSettings.items()) {
                        current[k] = v;
                    }
                    m_storageMgr->SavePreferences(current);
                    if (m_winMgr) {
                        if (current.contains("alwaysOnTop")) m_winMgr->SetAlwaysOnTop(current["alwaysOnTop"].get<bool>());
                        if (current.contains("opacity")) m_winMgr->SetOpacity(current["opacity"].get<float>());
                        if (current.contains("captureProtection")) m_winMgr->SetCaptureProtection(current["captureProtection"].get<bool>());
                    }
                }
                if (m_storageMgr) {
                    BroadcastEvent("lens:preferences", m_storageMgr->GetPreferences());
                }
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
            if (m_cloud.HasSession()) {
                std::string userId = m_cloud.GetUserId();
                std::string email = m_cloud.GetUserEmail();
                if (m_storageMgr && !userId.empty()) {
                    m_storageMgr->SetCurrentAccount(userId, email);
                }
                json cloudSettings = m_cloud.GetUserSettings();
                if (result.contains("settings") && result["settings"].is_object()) {
                    cloudSettings = result["settings"];
                }
                if (m_storageMgr && !cloudSettings.is_null() && cloudSettings.is_object() && !cloudSettings.empty()) {
                    json current = m_storageMgr->GetPreferences();
                    for (auto& [k, v] : cloudSettings.items()) {
                        current[k] = v;
                    }
                    m_storageMgr->SavePreferences(current);
                    if (m_winMgr) {
                        if (current.contains("alwaysOnTop")) m_winMgr->SetAlwaysOnTop(current["alwaysOnTop"].get<bool>());
                        if (current.contains("opacity")) m_winMgr->SetOpacity(current["opacity"].get<float>());
                        if (current.contains("captureProtection")) m_winMgr->SetCaptureProtection(current["captureProtection"].get<bool>());
                    }
                }
                if (m_storageMgr) {
                    BroadcastEvent("lens:preferences", m_storageMgr->GetPreferences());
                }
            }
            BroadcastEvent("lens:gate", gate);
            callback(result, false);
            return;
        }

        if (action == "gate.validate" || action == "gate.state") {
            json gate = GetGateView();
            BroadcastEvent("lens:gate", gate);
            callback(gate, false);
            return;
        }

        if (action == "gate.logout" || action == "auth.logout") {
            json gate;
            {
                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                gate = m_cloud.Logout();
            }
            if (m_storageMgr) {
                m_storageMgr->SetCurrentAccount("", "");
                BroadcastEvent("lens:preferences", m_storageMgr->GetPreferences());
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

        if (action == "cloud.request") {
            std::string subAction = payload.value("action", "");
            json subPayload = payload.value("payload", json::object());
            m_workers.emplace_back([this, subAction, subPayload, callback]() {
                try {
                    json res;
                    {
                        std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                        res = m_cloud.CloudRequest(subAction, subPayload);
                    }
                    PostToUi([callback, res]() { callback(res, false); });
                } catch (const std::exception& e) {
                    const std::string error = e.what();
                    PostToUi([callback, error]() { callback(error, true); });
                }
            });
            return;
        }

        if (action == "auth.status") {
            json gate = GetGateView();
            json auth = {
                { "authenticated", gate.value("authenticated", false) },
                { "mode", m_cloud.HasSession() ? "cloud" : "local" },
                { "tier", gate.value("tier", "free") },
                { "email", gate.value("email", "") },
                { "licenseValid", gate.value("licenseValid", false) },
                { "serverUrl", gate.value("serverUrl", "") }
            };
            callback(auth, false);
            return;
        }

        if (action == "account.entitlement" || action == "cloud.entitlement") {
            json gate = GetGateView();
            json entitlement = gate.value("entitlement", json::object());
            json result;
            result["entitlement"] = entitlement;
            result["horizon"] = entitlement.value("expirationTimestamp", static_cast<int64_t>(0));
            result["serverTimeMs"] = gate.value("serverTimeMs", static_cast<int64_t>(0));
            result["plans"] = json::array();
            result["history"] = json::array();
            result["desktops"] = json::array();
            result["desktop"] = gate.value("session", json::object());
            callback(result, false);
            return;
        }

        if (action.rfind("account.", 0) == 0 || action.rfind("auth.", 0) == 0 ||
            action.rfind("billing.", 0) == 0 || action.rfind("purchase.", 0) == 0 ||
            action == "cloud.public") {
            try {
                json res;
                {
                    std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                    res = m_cloud.CloudRequest(action, payload);
                }
                callback(res, false);
            } catch (const std::exception& e) {
                callback(errorResult(e.what()), true);
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
            m_workers.emplace_back([this, callback]() {
                json results = json::array();

                // 1. Ollama on 11434
                HttpReply ollamaReply = HttpGet("http://127.0.0.1:11434/api/tags", "", 1200);
                json ollamaEntry = {
                    { "id", "ollama" },
                    { "name", "Ollama Local (11434)" },
                    { "port", 11434 },
                    { "available", false },
                    { "supportsVision", false },
                    { "models", json::array() }
                };
                if (!ollamaReply.networkError && ollamaReply.status == 200 && ollamaReply.body.contains("models") && ollamaReply.body["models"].is_array()) {
                    ollamaEntry["available"] = true;
                    for (const auto& m : ollamaReply.body["models"]) {
                        std::string name = m.value("name", "");
                        if (!name.empty()) {
                            bool isVision = (name.find("vision") != std::string::npos || name.find("llava") != std::string::npos || name.find("vl") != std::string::npos);
                            ollamaEntry["models"].push_back({
                                { "id", name },
                                { "name", name },
                                { "supportsVision", isVision }
                            });
                            if (isVision) ollamaEntry["supportsVision"] = true;
                        }
                    }
                }
                results.push_back(ollamaEntry);

                // 2. LM Studio on 1234
                HttpReply lmReply = HttpGet("http://127.0.0.1:1234/v1/models", "", 1200);
                json lmEntry = {
                    { "id", "lmstudio" },
                    { "name", "LM Studio (1234)" },
                    { "port", 1234 },
                    { "available", false },
                    { "supportsVision", false },
                    { "models", json::array() }
                };
                if (!lmReply.networkError && lmReply.status == 200 && lmReply.body.contains("data") && lmReply.body["data"].is_array()) {
                    lmEntry["available"] = true;
                    for (const auto& m : lmReply.body["data"]) {
                        std::string id = m.value("id", "");
                        if (!id.empty()) {
                            bool isVision = (id.find("vision") != std::string::npos || id.find("llava") != std::string::npos || id.find("vl") != std::string::npos);
                            lmEntry["models"].push_back({ { "id", id }, { "name", id }, { "supportsVision", isVision } });
                            if (isVision) lmEntry["supportsVision"] = true;
                        }
                    }
                }
                results.push_back(lmEntry);

                // 3. llama.cpp on 8080
                HttpReply llamaReply = HttpGet("http://127.0.0.1:8080/v1/models", "", 1200);
                json llamaEntry = {
                    { "id", "llamacpp" },
                    { "name", "llama.cpp (8080)" },
                    { "port", 8080 },
                    { "available", false },
                    { "supportsVision", false },
                    { "models", json::array() }
                };
                if (!llamaReply.networkError && llamaReply.status == 200) {
                    llamaEntry["available"] = true;
                    if (llamaReply.body.contains("data") && llamaReply.body["data"].is_array()) {
                        for (const auto& m : llamaReply.body["data"]) {
                            std::string id = m.value("id", "");
                            if (!id.empty()) llamaEntry["models"].push_back({ { "id", id }, { "name", id } });
                        }
                    }
                }
                results.push_back(llamaEntry);

                // 4. vLLM on 8000
                HttpReply vllmReply = HttpGet("http://127.0.0.1:8000/v1/models", "", 1200);
                json vllmEntry = {
                    { "id", "vllm" },
                    { "name", "vLLM (8000)" },
                    { "port", 8000 },
                    { "available", false },
                    { "supportsVision", false },
                    { "models", json::array() }
                };
                if (!vllmReply.networkError && vllmReply.status == 200) {
                    vllmEntry["available"] = true;
                    if (vllmReply.body.contains("data") && vllmReply.body["data"].is_array()) {
                        for (const auto& m : vllmReply.body["data"]) {
                            std::string id = m.value("id", "");
                            if (!id.empty()) vllmEntry["models"].push_back({ { "id", id }, { "name", id } });
                        }
                    }
                }
                results.push_back(vllmEntry);

                PostToUi([callback, results]() { callback(results, false); });
            });
            return;
        }

        if (action == "model.list") {
            const std::string prov = payload.value("provider", "");
            if (prov == "local") {
                m_workers.emplace_back([this, callback]() {
                    json localModels = json::array();
                    HttpReply ollamaReply = HttpGet("http://127.0.0.1:11434/api/tags", "", 1200);
                    if (!ollamaReply.networkError && ollamaReply.status == 200 && ollamaReply.body.contains("models") && ollamaReply.body["models"].is_array()) {
                        for (const auto& m : ollamaReply.body["models"]) {
                            std::string name = m.value("name", "");
                            if (!name.empty()) {
                                bool isVision = (name.find("vision") != std::string::npos || name.find("llava") != std::string::npos || name.find("vl") != std::string::npos);
                                localModels.push_back({ { "id", name }, { "name", name }, { "provider", "local" }, { "supportsVision", isVision } });
                            }
                        }
                    }
                    HttpReply lmReply = HttpGet("http://127.0.0.1:1234/v1/models", "", 1200);
                    if (!lmReply.networkError && lmReply.status == 200 && lmReply.body.contains("data") && lmReply.body["data"].is_array()) {
                        for (const auto& m : lmReply.body["data"]) {
                            std::string id = m.value("id", "");
                            if (!id.empty()) {
                                bool isVision = (id.find("vision") != std::string::npos || id.find("llava") != std::string::npos || id.find("vl") != std::string::npos);
                                localModels.push_back({ { "id", id }, { "name", id }, { "provider", "local" }, { "supportsVision", isVision } });
                            }
                        }
                    }
                    if (localModels.empty()) {
                        localModels.push_back({ { "id", "llama3.2" }, { "name", "Ollama Local (Default)" }, { "provider", "local" }, { "supportsVision", false } });
                    }
                    PostToUi([callback, localModels]() { callback(localModels, false); });
                });
                return;
            }
            json models = json::array({
                { { "id", "gpt-4o" }, { "name", "GPT-4o (Omni)" }, { "provider", "openai" } },
                { { "id", "claude-3-5-sonnet" }, { "name", "Claude 3.5 Sonnet" }, { "provider", "anthropic" } },
                { { "id", "gemini-1.5-pro" }, { "name", "Gemini 1.5 Pro" }, { "provider", "google" } },
                { { "id", "llama3.2" }, { "name", "Ollama Local Model" }, { "provider", "local" } }
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
        if (m_cloud.HasSession() && !m_cloud.AuthorizedNow()) {
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

    json userMsg = {
        { "id", "msg_user_" + std::to_string(nowMs) },
        { "role", "user" },
        { "content", text },
        { "createdAt", nowIso }
    };
    if (!images.empty()) userMsg["images"] = images;
    session["messages"].push_back(userMsg);

    std::string apiKey;
    if (provider != "local") {
        apiKey = m_storageMgr ? m_storageMgr->GetApiKey(provider) : "";
        if (apiKey.empty()) {
            std::string fallbackAnswer = "LensDesk 2.0 Native Windows Host is fully active with native C++20 + DirectComposition.\n\n"
                                         "• Direct3D 11.1 hardware-accelerated transparent HUD\n"
                                         "• Dear ImGui native HUD overlay with status pill\n"
                                         "• Microsoft Edge WebView2 hosting React 19\n"
                                         "• Windows capture protection active (WDA_EXCLUDEFROMCAPTURE)\n\n"
                                         "To connect to " + provider + ", open **Settings** (top right) and paste your API key under **API key**.\n"
                                         "Or choose **Local model** in Settings to run offline with Ollama (http://127.0.0.1:11434).";

            json assistantMessage = {
                { "id", "msg_asst_" + std::to_string(nowMs + 1) },
                { "role", "assistant" },
                { "content", fallbackAnswer },
                { "createdAt", nowIso },
                { "provider", provider },
                { "model", model }
            };
            session["messages"].push_back(assistantMessage);
            session["updatedAt"] = nowIso;
            session["version"] = session.value("version", 1) + 1;
            if (m_storageMgr) m_storageMgr->SaveSession(session);

            PostToUi([this, callback, requestId, fallbackAnswer, session]() {
                if (!requestId.empty()) {
                    BroadcastEvent("lens:chat", {
                        { "requestId", requestId },
                        { "type", "delta" },
                        { "text", fallbackAnswer }
                    });
                    BroadcastEvent("lens:chat", {
                        { "requestId", requestId },
                        { "type", "done" },
                        { "fullText", fallbackAnswer }
                    });
                }
                callback(session, false);
            });
            return;
        }
    }

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

    bool modelSupportsVision = false;
    if (provider == "openai") {
        modelSupportsVision = (model.find("4o") != std::string::npos || model.find("vision") != std::string::npos || model.find("turbo") != std::string::npos);
    } else if (provider == "anthropic") {
        modelSupportsVision = (model.find("claude-3") != std::string::npos || model.find("claude-sonnet") != std::string::npos || model.find("claude-opus") != std::string::npos);
    } else if (provider == "gemini") {
        modelSupportsVision = true;
    } else if (provider == "local") {
        modelSupportsVision = (model.find("vision") != std::string::npos || model.find("llava") != std::string::npos || model.find("minicpm") != std::string::npos);
    }
    const std::string endpoint = ProviderEndpoint(provider, localBaseUrl);

    std::vector<json> history;
    const size_t start = session["messages"].size() > 24 ? session["messages"].size() - 24 : 0;
    for (size_t i = start; i < session["messages"].size(); ++i) {
        history.push_back(session["messages"][i]);
    }

    m_workers.emplace_back([this, callback, session, history, userMsg, images, provider, model,
                            endpoint, apiKey, fullSystemPrompt, requestId, nowMs, modelSupportsVision, language]() mutable {
        std::string effectiveUserContent = userMsg.value("content", "");
        if (!images.empty() && !modelSupportsVision && m_captureSvc) {
            std::string aggregatedOcr;
            for (const auto& image : images) {
                if (!image.is_string()) continue;
                std::string extracted = m_captureSvc->PerformOcrOnBase64(image.get<std::string>(), language);
                if (!extracted.empty()) {
                    if (!aggregatedOcr.empty()) aggregatedOcr += "\n---\n";
                    aggregatedOcr += extracted;
                }
            }
            if (!aggregatedOcr.empty()) {
                effectiveUserContent = "Can't see images, so screenshots are read with Windows OCR and sent as text.\n\n"
                                       "The screen content below was extracted from the user's screenshot(s) by OCR (the question is in here). Answer it:\n\n"
                                       + aggregatedOcr + "\n\n" + effectiveUserContent;
            }
        }

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
            if (modelSupportsVision && !images.empty()) {
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
                userEntry["content"] = effectiveUserContent;
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
            if (modelSupportsVision && !images.empty()) {
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
                userEntry["content"] = effectiveUserContent;
            }
            messages.push_back(userEntry);
            requestBody["messages"] = messages;
        }

        HttpReply reply;
        std::shared_ptr<std::atomic<bool>> streamedAnyDelta = std::make_shared<std::atomic<bool>>(false);
        auto onDelta = [this, requestId, streamedAnyDelta](const std::string& chunk) {
            if (!chunk.empty()) streamedAnyDelta->store(true);
            if (!requestId.empty()) {
                PostToUi([this, requestId, chunk]() {
                    BroadcastEvent("lens:chat", {
                        { "requestId", requestId },
                        { "type", "delta" },
                        { "text", chunk }
                    });
                });
            }
        };

        requestBody["stream"] = true;
        if (provider == "anthropic") {
            const std::string headers =
                "x-api-key: " + apiKey + "\r\nanthropic-version: 2023-06-01\r\n";
            reply = HttpStreamJson(endpoint, requestBody, "", headers, onDelta, nullptr, 90000);
        } else {
            reply = HttpStreamJson(endpoint, requestBody, apiKey, "", onDelta, nullptr, 90000);
        }

        if (reply.networkError || reply.status < 200 || reply.status >= 300) {
            std::string message = reply.error;
            if (message.empty()) message = "The AI provider request failed.";
            PostToUi([callback, message]() { callback(message, true); });
            return;
        }

        std::string answer = reply.text;
        if (TrimText(answer).empty()) {
            answer = ExtractAssistantText(provider, reply.body);
        }
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

        // CAP-19: Save answered screenshot/session to cloud account asynchronously when signed in
        {
            std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
            if (m_cloud.HasSession()) {
                m_workers.emplace_back([this, session]() {
                    try {
                        std::lock_guard<std::mutex> lock(m_cloudMutex);
                        m_cloud.CloudRequest("session.save", session);
                    } catch (...) {}
                });
            }
        }

        const bool didStream = streamedAnyDelta->load();
        PostToUi([this, callback, requestId, answer, session, didStream]() {
            if (!requestId.empty()) {
                if (!didStream) {
                    BroadcastEvent("lens:chat", {
                        { "requestId", requestId },
                        { "type", "delta" },
                        { "text", answer }
                    });
                }
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

void ServiceDispatcher::StartBrowserLogin(DispatchResponseCallback callback) {
#ifdef _WIN32
    m_workers.emplace_back([this, callback]() {
        WSADATA wsaData;
        if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
            PostToUi([callback]() { callback("Could not initialize network socket for browser login.", true); });
            return;
        }

        SOCKET serverSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (serverSock == INVALID_SOCKET) {
            WSACleanup();
            PostToUi([callback]() { callback("Could not create local socket for browser login.", true); });
            return;
        }

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = inet_addr("127.0.0.1");
        addr.sin_port = 0; // OS allocates ephemeral port

        if (bind(serverSock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR) {
            closesocket(serverSock);
            WSACleanup();
            PostToUi([callback]() { callback("Could not bind local loopback port for browser login.", true); });
            return;
        }

        int addrLen = sizeof(addr);
        if (getsockname(serverSock, reinterpret_cast<sockaddr*>(&addr), &addrLen) == SOCKET_ERROR) {
            closesocket(serverSock);
            WSACleanup();
            PostToUi([callback]() { callback("Could not determine local port for browser login.", true); });
            return;
        }

        int port = ntohs(addr.sin_port);
        if (listen(serverSock, 1) == SOCKET_ERROR) {
            closesocket(serverSock);
            WSACleanup();
            PostToUi([callback]() { callback("Could not listen on local port for browser login.", true); });
            return;
        }

        DWORD timeoutMs = 120000;
        setsockopt(serverSock, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));

        std::string serverUrl;
        {
            std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
            serverUrl = m_cloud.GetServerUrl();
        }

        // Generate PKCE code_verifier, code_challenge (S256), and cryptographically random state
        const std::string codeVerifier = GeneratePkceVerifier(64);
        const std::string codeChallenge = GeneratePkceChallenge(codeVerifier);
        const std::string state = GenerateRandomState(32);

        const std::string redirectUri = "http://127.0.0.1:" + std::to_string(port) + "/callback";
        const std::string authUrl = serverUrl + "/login?redirect_uri=" + redirectUri +
            "&state=" + state +
            "&code_challenge=" + codeChallenge +
            "&code_challenge_method=S256&source=desktop";

        ShellExecuteW(nullptr, L"open", Utf8ToWide(authUrl).c_str(), nullptr, nullptr, SW_SHOWNORMAL);

        bool completed = false;
        auto startTime = std::chrono::steady_clock::now();

        auto getQueryParam = [](const std::string& qs, const std::string& key) -> std::string {
            std::string prefix = key + "=";
            size_t p = qs.find(prefix);
            if (p == std::string::npos) return "";
            size_t start = p + prefix.size();
            size_t end = qs.find('&', start);
            return qs.substr(start, end == std::string::npos ? std::string::npos : end - start);
        };

        while (!completed) {
            if (std::chrono::duration_cast<std::chrono::seconds>(std::chrono::steady_clock::now() - startTime).count() > 120) {
                break;
            }

            sockaddr_in clientAddr{};
            int clientLen = sizeof(clientAddr);
            SOCKET clientSock = accept(serverSock, reinterpret_cast<sockaddr*>(&clientAddr), &clientLen);
            if (clientSock == INVALID_SOCKET) {
                break;
            }

            char buffer[4096]{};
            int bytesRead = recv(clientSock, buffer, sizeof(buffer) - 1, 0);
            if (bytesRead > 0) {
                std::string req(buffer, bytesRead);
                size_t firstLineEnd = req.find("\r\n");
                std::string firstLine = (firstLineEnd != std::string::npos) ? req.substr(0, firstLineEnd) : req;

                std::string query;
                size_t qPos = firstLine.find('?');
                size_t spPos = firstLine.find(' ', qPos);
                if (qPos != std::string::npos && spPos != std::string::npos) {
                    query = firstLine.substr(qPos + 1, spPos - qPos - 1);
                }

                if (firstLine.find("GET /callback") != std::string::npos) {
                    std::string code = getQueryParam(query, "code");
                    std::string incomingState = getQueryParam(query, "state");
                    std::string error = getQueryParam(query, "error");

                    if (!error.empty()) {
                        std::string cancelHtml =
                            "<!DOCTYPE html><html><head><meta charset='utf-8'><title>LensDesk</title>"
                            "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;"
                            "background:#0a0c12;font-family:'Segoe UI',system-ui,sans-serif;color:#e8eaf2}"
                            ".card{text-align:center;padding:48px 64px;border-radius:18px;background:rgba(255,255,255,.05);"
                            "border:1px solid rgba(255,255,255,.1)}"
                            ".brand{font-size:14px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:#ef4444;margin-bottom:24px}"
                            "h1{font-size:22px;color:#ef4444;margin:0 0 8px}p{font-size:14px;color:#9aa1b5;margin:0}</style></head>"
                            "<body><div class='card'><div class='brand'>LensDesk</div><h1>Sign-in Cancelled</h1>"
                            "<p>You can close this tab and return to LensDesk.</p></div></body></html>";
                        std::string res = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " +
                            std::to_string(cancelHtml.size()) + "\r\nConnection: close\r\n\r\n" + cancelHtml;
                        send(clientSock, res.data(), static_cast<int>(res.size()), 0);
                        closesocket(clientSock);
                        PostToUi([callback]() { callback("Sign-in was cancelled in the browser.", true); });
                        break;
                    }

                    if (code.empty()) {
                        // Intermediate landing page for token extraction fallback
                        std::string html = 
                            "<!DOCTYPE html><html><head><meta charset='utf-8'><title>LensDesk</title>"
                            "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;"
                            "background:#0a0c12;font-family:'Segoe UI',system-ui,sans-serif;color:#e8eaf2}"
                            ".card{text-align:center;padding:48px 64px;border-radius:18px;background:rgba(255,255,255,.05);"
                            "border:1px solid rgba(255,255,255,.1);box-shadow:0 24px 60px rgba(0,0,0,.45)}"
                            ".brand{font-size:14px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:#5ea2ff;margin-bottom:24px}"
                            "h1{font-size:22px;margin:0 0 8px}p{font-size:14px;color:#9aa1b5;margin:0}</style></head>"
                            "<body><div class='card'><div class='brand'>LensDesk</div><h1>Completing sign-in&#8230;</h1>"
                            "<p>Just a moment while we link your desktop session.</p></div>"
                            "<script>var h=location.hash?location.hash.substring(1):location.search.substring(1);"
                            "if(h){location.replace('/done?'+h);}else{document.querySelector('h1').textContent='No authorization code received.';"
                            "document.querySelector('p').textContent='You can close this window and try again from LensDesk.';}</script>"
                            "</body></html>";
                        std::string res = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " +
                            std::to_string(html.size()) + "\r\nConnection: close\r\n\r\n" + html;
                        send(clientSock, res.data(), static_cast<int>(res.size()), 0);
                    } else {
                        // Strict CSRF state verification
                        if (incomingState.empty() || incomingState != state) {
                            std::string csrfHtml =
                                "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Security Error</title>"
                                "<style>body{background:#0a0c12;font-family:sans-serif;color:#ef4444;text-align:center;padding:50px}</style></head>"
                                "<body><h1>Security Check Failed</h1><p>CSRF state parameter mismatch. Request rejected.</p></body></html>";
                            std::string res = "HTTP/1.1 403 Forbidden\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " +
                                std::to_string(csrfHtml.size()) + "\r\nConnection: close\r\n\r\n" + csrfHtml;
                            send(clientSock, res.data(), static_cast<int>(res.size()), 0);
                            closesocket(clientSock);
                            PostToUi([callback]() { callback("OAuth security check failed: CSRF state mismatch.", true); });
                            break;
                        }

                        // Exchange authorization code for desktop session tokens via PKCE
                        const std::string exchangeEndpoint = serverUrl + "/api/desktop.exchangeCode";
                        json exchangePayload = {
                            { "code", code },
                            { "code_verifier", codeVerifier },
                            { "redirect_uri", redirectUri }
                        };
                        HttpReply exchangeReply = HttpPostJson(exchangeEndpoint, exchangePayload, "", "", 15000);

                        if (!exchangeReply.networkError && exchangeReply.status == 200 &&
                            exchangeReply.body.contains("access_token")) {
                            std::string accessToken = exchangeReply.body["access_token"];
                            std::string refreshToken = exchangeReply.body.value("refresh_token", "");

                            json gateResult;
                            {
                                std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                                gateResult = m_cloud.ApplyTokens(accessToken, refreshToken);
                            }
                            if (m_cloud.HasSession()) {
                                std::string userId = m_cloud.GetUserId();
                                std::string email = m_cloud.GetUserEmail();
                                if (m_storageMgr && !userId.empty()) {
                                    m_storageMgr->SetCurrentAccount(userId, email);
                                }
                                BroadcastEvent("lens:gate", gateResult);
                                completed = true;
                            }

                            std::string successHtml = 
                                "<!DOCTYPE html><html><head><meta charset='utf-8'><title>LensDesk</title>"
                                "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;"
                                "background:#0a0c12;font-family:'Segoe UI',system-ui,sans-serif;color:#e8eaf2}"
                                ".card{text-align:center;padding:48px 64px;border-radius:18px;background:rgba(255,255,255,.05);"
                                "border:1px solid rgba(255,255,255,.1);box-shadow:0 24px 60px rgba(0,0,0,.45)}"
                                ".brand{font-size:14px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:#4ade80;margin-bottom:24px}"
                                "h1{font-size:22px;color:#4ade80;margin:0 0 8px}p{font-size:14px;color:#9aa1b5;margin:0}</style></head>"
                                "<body><div class='card'><div class='brand'>LensDesk</div><h1>Sign-in Complete!</h1>"
                                "<p>You can close this tab and return to LensDesk.</p></div></body></html>";
                            std::string res = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " +
                                std::to_string(successHtml.size()) + "\r\nConnection: close\r\n\r\n" + successHtml;
                            send(clientSock, res.data(), static_cast<int>(res.size()), 0);

                            PostToUi([callback, gateResult]() { callback(gateResult, false); });
                        } else {
                            std::string errStr = exchangeReply.error.empty() ? "Authorization code exchange failed." : exchangeReply.error;
                            std::string failHtml = 
                                "<!DOCTYPE html><html><head><meta charset='utf-8'><title>LensDesk</title>"
                                "<style>body{background:#0a0c12;font-family:sans-serif;color:#ef4444;text-align:center;padding:50px}</style></head>"
                                "<body><h1>Sign-in Failed</h1><p>" + errStr + "</p></body></html>";
                            std::string res = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " +
                                std::to_string(failHtml.size()) + "\r\nConnection: close\r\n\r\n" + failHtml;
                            send(clientSock, res.data(), static_cast<int>(res.size()), 0);
                            closesocket(clientSock);
                            PostToUi([callback, errStr]() { callback(errStr, true); });
                            break;
                        }
                    }
                } else if (firstLine.find("GET /done") != std::string::npos) {
                    std::string token = getQueryParam(query, "access_token");
                    std::string refreshToken = getQueryParam(query, "refresh_token");

                    if (!token.empty()) {
                        json gateResult;
                        {
                            std::lock_guard<std::mutex> cloudLock(m_cloudMutex);
                            gateResult = m_cloud.ApplyTokens(token, refreshToken);
                        }
                        if (m_cloud.HasSession()) {
                            std::string userId = m_cloud.GetUserId();
                            std::string email = m_cloud.GetUserEmail();
                            if (m_storageMgr && !userId.empty()) {
                                m_storageMgr->SetCurrentAccount(userId, email);
                            }
                            BroadcastEvent("lens:gate", gateResult);
                            completed = true;
                        }

                        std::string html = 
                            "<!DOCTYPE html><html><head><meta charset='utf-8'><title>LensDesk</title>"
                            "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;"
                            "background:#0a0c12;font-family:'Segoe UI',system-ui,sans-serif;color:#e8eaf2}"
                            ".card{text-align:center;padding:48px 64px;border-radius:18px;background:rgba(255,255,255,.05);"
                            "border:1px solid rgba(255,255,255,.1);box-shadow:0 24px 60px rgba(0,0,0,.45)}"
                            ".brand{font-size:14px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:#4ade80;margin-bottom:24px}"
                            "h1{font-size:22px;color:#4ade80;margin:0 0 8px}p{font-size:14px;color:#9aa1b5;margin:0}</style></head>"
                            "<body><div class='card'><div class='brand'>LensDesk</div><h1>Sign-in Complete!</h1>"
                            "<p>You can close this tab and return to LensDesk.</p></div></body></html>";
                        std::string res = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " +
                            std::to_string(html.size()) + "\r\nConnection: close\r\n\r\n" + html;
                        send(clientSock, res.data(), static_cast<int>(res.size()), 0);

                        PostToUi([callback, gateResult]() { callback(gateResult, false); });
                    } else {
                        std::string res = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                        send(clientSock, res.data(), static_cast<int>(res.size()), 0);
                    }
                } else {
                    std::string res = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    send(clientSock, res.data(), static_cast<int>(res.size()), 0);
                }
            }
            closesocket(clientSock);
        }

        closesocket(serverSock);
        WSACleanup();

        if (!completed) {
            PostToUi([callback]() { callback("Browser sign-in timed out or was closed.", true); });
        }
    });
#else
    callback("Browser login is only supported on Windows.", true);
#endif
}

} // namespace LensDesk
