#include "../include/cloud_client.hpp"
#include <winhttp.h>
#include <cctype>
#include <cstdlib>

namespace LensDesk {

namespace {

int64_t NowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
}

std::string TrimString(std::string value) {
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) value.erase(value.begin());
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.pop_back();
    return value;
}

std::string LowerAscii(std::string value) {
    for (char& c : value) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return value;
}

std::string HttpErrorText(const json& body, const std::string& fallback) {
    if (body.is_object()) {
        if (body.contains("error") && body["error"].is_string()) return body["error"].get<std::string>();
        if (body.contains("message") && body["message"].is_string()) return body["message"].get<std::string>();
    }
    return fallback;
}

} // namespace

CloudClient::CloudClient() = default;
CloudClient::~CloudClient() = default;

bool CloudClient::Initialize() {
    m_configPath = GetAppDataDirectory() / L"cloud.json";
    Load();
    return true;
}

std::string CloudClient::NormalizeServerUrl(const std::string& value) const {
    std::string url = TrimString(value);
    while (!url.empty() && url.back() == '/') url.pop_back();
    const std::string lower = LowerAscii(url);
    if (lower.rfind("https://", 0) != 0 && lower.rfind("http://", 0) != 0) {
        throw std::runtime_error("Use an HTTPS server address, or localhost for development.");
    }
    const size_t scheme = url.find("://");
    const std::string rest = url.substr(scheme + 3);
    if (rest.empty() || rest.find('/') != std::string::npos ||
        rest.find('?') != std::string::npos || rest.find('#') != std::string::npos ||
        rest.find('@') != std::string::npos) {
        throw std::runtime_error("Enter only the server origin, without a path or query.");
    }
    if (lower.rfind("http://", 0) == 0) {
        const std::string host = LowerAscii(rest.substr(0, rest.find(':')));
        if (host != "localhost" && host != "127.0.0.1" && host != "[::1]") {
            throw std::runtime_error("Use HTTPS for a remote LensDesk server. HTTP is allowed only for localhost.");
        }
    }
    return url;
}

std::string CloudClient::EncryptSecret(const std::string& plain) const {
    if (plain.empty()) return "";
    DATA_BLOB in{};
    in.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(plain.data()));
    in.cbData = static_cast<DWORD>(plain.size());
    DATA_BLOB out{};
    if (!CryptProtectData(&in, L"LensDesk cloud session", nullptr, nullptr, nullptr,
                          CRYPTPROTECT_UI_FORBIDDEN, &out)) {
        return "";
    }
    std::string encoded = Base64Encode(out.pbData, out.cbData);
    LocalFree(out.pbData);
    return encoded;
}

std::string CloudClient::DecryptSecret(const std::string& encoded) const {
    if (encoded.empty()) return "";
    const auto bytes = Base64Decode(encoded);
    if (bytes.empty()) return "";
    DATA_BLOB in{};
    in.pbData = const_cast<BYTE*>(bytes.data());
    in.cbData = static_cast<DWORD>(bytes.size());
    DATA_BLOB out{};
    if (!CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr,
                            CRYPTPROTECT_UI_FORBIDDEN, &out)) {
        return "";
    }
    std::string plain(reinterpret_cast<char*>(out.pbData), out.cbData);
    LocalFree(out.pbData);
    return plain;
}

void CloudClient::Load() {
    const char* env = std::getenv("LENSDESK_SERVER_URL");
    m_serverUrl = env && *env ? env : "http://127.0.0.1:4319";
    m_phase = "signed_out";
    m_reason.clear();
    m_entitlement = nullptr;
    m_user = nullptr;
    m_session = nullptr;
    m_takeover = nullptr;
    m_lastVerifiedAtMs = 0;
    m_serverTimeMs = 0;

    json saved;
    try {
        std::ifstream file(m_configPath);
        if (!file.is_open()) return;
        file >> saved;
    } catch (...) {
        return;
    }
    if (!saved.is_object()) return;

    try {
        if (saved.contains("url") && saved["url"].is_string()) {
            m_serverUrl = NormalizeServerUrl(saved["url"].get<std::string>());
        }
    } catch (...) {
        m_serverUrl = "http://127.0.0.1:4319";
    }
    m_token = DecryptSecret(saved.value("token", ""));
    m_refreshToken = DecryptSecret(saved.value("refreshToken", ""));
    m_desktopSessionId = saved.value("desktopSessionId", "");
    m_email = saved.value("email", "");
    if (saved.contains("user")) m_user = saved["user"];
    if (saved.contains("session")) m_session = saved["session"];
    if (!m_user.is_null() && m_user.is_object() && m_email.empty()) {
        m_email = m_user.value("email", "");
    }
    if (!HasSession()) {
        m_token.clear();
        m_refreshToken.clear();
    }
}

void CloudClient::Save() {
    json saved;
    saved["url"] = m_serverUrl;
    saved["token"] = EncryptSecret(m_token);
    saved["refreshToken"] = EncryptSecret(m_refreshToken);
    saved["desktopSessionId"] = m_desktopSessionId;
    saved["email"] = m_email;
    saved["user"] = m_user;
    saved["session"] = m_session;

    try {
        std::filesystem::path temp = m_configPath;
        temp += L".tmp";
        {
            std::ofstream file(temp);
            if (!file.is_open()) return;
            file << saved.dump(2);
        }
        MoveFileExW(temp.c_str(), m_configPath.c_str(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
    } catch (...) {
    }
}

void CloudClient::ClearCredentials() {
    m_token.clear();
    m_refreshToken.clear();
    m_desktopSessionId.clear();
    m_entitlement = nullptr;
    m_takeover = nullptr;
    m_lastVerifiedAtMs = 0;
    m_serverTimeMs = 0;
}

CloudClient::HttpResult CloudClient::Request(
    const std::string& action,
    const json& payload,
    int timeoutMs,
    const std::string& bearer
) const {
    HttpResult result;

    std::wstring wideUrl = Utf8ToWide(m_serverUrl);
    URL_COMPONENTS components{};
    components.dwStructSize = sizeof(components);
    components.dwSchemeLength = static_cast<DWORD>(-1);
    components.dwHostNameLength = static_cast<DWORD>(-1);
    components.dwUrlPathLength = static_cast<DWORD>(-1);
    components.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(wideUrl.c_str(), static_cast<DWORD>(wideUrl.size()), 0, &components)) {
        result.networkError = true;
        result.error = "The LensDesk server address is invalid.";
        return result;
    }

    const std::wstring host(components.lpszHostName, components.dwHostNameLength);
    std::wstring path(components.lpszUrlPath, components.dwUrlPathLength);
    if (path.empty()) path = L"/";
    if (path.back() == L'/') path.pop_back();
    path += L"/api/";
    path += Utf8ToWide(action);

    const bool secure = components.nScheme == INTERNET_SCHEME_HTTPS;
    HINTERNET session = WinHttpOpen(
        L"LensDesk/2.0 (Windows Native)",
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0
    );
    if (!session) {
        result.networkError = true;
        result.error = "Could not initialize the network client.";
        return result;
    }
    WinHttpSetTimeouts(session, 4000, 4000, timeoutMs, timeoutMs);

    HINTERNET connection = WinHttpConnect(session, host.c_str(), components.nPort, 0);
    if (!connection) {
        result.networkError = true;
        result.error = "Could not connect to the LensDesk server.";
        WinHttpCloseHandle(session);
        return result;
    }

    HINTERNET request = WinHttpOpenRequest(
        connection,
        L"POST",
        path.c_str(),
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        secure ? WINHTTP_FLAG_SECURE : 0
    );
    if (!request) {
        result.networkError = true;
        result.error = "Could not create the server request.";
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return result;
    }

    std::wstring headers =
        L"Content-Type: application/json\r\n"
        L"Accept: application/json\r\n"
        L"X-LensDesk-Client: desktop\r\n";
    if (!bearer.empty()) {
        headers += L"Authorization: Bearer ";
        headers += Utf8ToWide(bearer);
        headers += L"\r\n";
    }

    const std::string body = payload.dump();
    BOOL sent = WinHttpSendRequest(
        request,
        headers.c_str(),
        static_cast<DWORD>(-1L),
        const_cast<char*>(body.data()),
        static_cast<DWORD>(body.size()),
        static_cast<DWORD>(body.size()),
        0
    );
    if (!sent || !WinHttpReceiveResponse(request, nullptr)) {
        result.networkError = true;
        result.error = "Could not reach the LensDesk server. Check the address and your connection.";
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return result;
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(
        request,
        WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX,
        &status,
        &statusSize,
        WINHTTP_NO_HEADER_INDEX
    );
    result.status = static_cast<int>(status);

    std::string responseBody;
    char buffer[8192];
    DWORD read = 0;
    while (WinHttpReadData(request, buffer, sizeof(buffer), &read) && read > 0) {
        responseBody.append(buffer, read);
        if (responseBody.size() > 8 * 1024 * 1024) break;
    }

    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);

    if (responseBody.empty()) {
        result.body = json::object();
    } else {
        try {
            result.body = json::parse(responseBody);
        } catch (...) {
            result.body = json::object();
            result.error = responseBody.substr(0, 400);
        }
    }
    if (result.status < 200 || result.status >= 300) {
        if (result.error.empty()) {
            result.error = HttpErrorText(result.body, "The LensDesk server rejected the request.");
        }
    }
    return result;
}

void CloudClient::ApplyAuthoritativeSnapshot(const json& data) {
    if (data.contains("user")) m_user = data["user"];
    if (data.contains("session")) m_session = data["session"];
    if (!m_user.is_null() && m_user.is_object()) {
        m_email = m_user.value("email", m_email);
    }
    if (data.contains("serverUrl") && data["serverUrl"].is_string()) {
        try {
            m_serverUrl = NormalizeServerUrl(data["serverUrl"].get<std::string>());
        } catch (...) {
        }
    }
    m_serverTimeMs = data.value("serverTimeMs", static_cast<int64_t>(0));
    m_lastVerifiedAtMs = NowMs();
    m_entitlement = data.contains("entitlement") ? data["entitlement"] : json(nullptr);
    m_purchaseUrl = m_serverUrl + "/dashboard";
    if (!m_entitlement.is_null() && m_entitlement.is_object() &&
        m_entitlement.value("remainingSeconds", static_cast<int64_t>(0)) > 0) {
        m_phase = "active";
        m_reason.clear();
    } else {
        m_phase = "subscription_required";
        m_reason = "expired";
    }
    m_takeover = nullptr;
}

void CloudClient::ApplyHeartbeat(const json& data) {
    m_serverTimeMs = data.value("serverTimeMs", static_cast<int64_t>(0));
    m_lastVerifiedAtMs = NowMs();
    m_entitlement = data.contains("entitlement") ? data["entitlement"] : json(nullptr);
    if (data.contains("session") && !data["session"].is_null()) m_session = data["session"];
    if (data.contains("serverUrl") && data["serverUrl"].is_string()) {
        try {
            m_serverUrl = NormalizeServerUrl(data["serverUrl"].get<std::string>());
        } catch (...) {
        }
    }
    if (!m_entitlement.is_null() && m_entitlement.is_object() &&
        m_entitlement.value("remainingSeconds", static_cast<int64_t>(0)) > 0) {
        m_phase = "active";
        m_reason.clear();
    } else {
        m_phase = "subscription_required";
        m_reason = "expired";
        m_entitlement = nullptr;
    }
}

void CloudClient::HandleGateError(const HttpResult& result) {
    const std::string code = result.body.is_object() ? result.body.value("code", "") : "";
    if (result.body.is_object() && result.body.contains("purchaseUrl") &&
        result.body["purchaseUrl"].is_string()) {
        m_purchaseUrl = result.body["purchaseUrl"].get<std::string>();
    }
    if (result.status == 401) {
        ClearCredentials();
        m_phase = "signed_out";
        m_reason = "revoked";
        return;
    }
    if (result.status == 403 && code == "ACCOUNT_BLOCKED") {
        ClearCredentials();
        m_phase = "signed_out";
        m_reason = "suspended";
        return;
    }
    if (result.status == 403) {
        m_phase = "subscription_required";
        m_reason = "expired";
        m_entitlement = nullptr;
        return;
    }

    // Network or server trouble. The last authoritative snapshot remains
    // usable only inside the 120 second offline grace window.
    const bool grace = m_lastVerifiedAtMs > 0 &&
        NowMs() - m_lastVerifiedAtMs <= 120000 &&
        !m_entitlement.is_null() && m_entitlement.is_object() &&
        m_entitlement.value("remainingSeconds", static_cast<int64_t>(0)) > 0;
    if (!grace) {
        m_phase = "offline";
        m_reason = "network";
        m_entitlement = nullptr;
    }
}

CloudClient::HttpResult CloudClient::Refresh() {
    json payload;
    payload["refreshToken"] = m_refreshToken;
    HttpResult result = Request("desktop.refresh", payload, 10000);
    if (result.status >= 200 && result.status < 300) {
        if (result.body.contains("accessToken") && result.body["accessToken"].is_string()) {
            m_token = result.body["accessToken"].get<std::string>();
        }
        if (result.body.contains("refreshToken") && result.body["refreshToken"].is_string()) {
            m_refreshToken = result.body["refreshToken"].get<std::string>();
        }
        if (result.body.contains("session") && result.body["session"].is_object()) {
            m_session = result.body["session"];
            m_desktopSessionId = m_session.value("id", m_desktopSessionId);
        }
        m_serverTimeMs = result.body.value("serverTimeMs", static_cast<int64_t>(0));
        m_lastVerifiedAtMs = NowMs();
        if (result.body.contains("entitlement")) {
            m_entitlement = result.body["entitlement"];
        }
        Save();
    }
    return result;
}

CloudClient::HttpResult CloudClient::Heartbeat() {
    if (!HasSession()) {
        HttpResult result;
        result.status = 401;
        result.error = "Sign in to continue.";
        return result;
    }
    HttpResult result = Request("desktop.heartbeat", json::object(), 8000, m_token);
    if (result.status == 401 && !m_refreshToken.empty()) {
        HttpResult rotated = Refresh();
        if (rotated.status >= 200 && rotated.status < 300) {
            result = Request("desktop.heartbeat", json::object(), 8000, m_token);
        } else {
            return rotated;
        }
    }
    return result;
}

json CloudClient::Login(const json& payload) {
    json body = payload;
    if (!body.contains("deviceLabel")) body["deviceLabel"] = "LensDesk Native Windows Host";
    if (!body.contains("os")) body["os"] = "Windows";
    if (!body.contains("appVersion")) body["appVersion"] = "2.0.0";

    HttpResult result = Request("desktop.login", body, 15000);
    if (result.networkError) {
        throw std::runtime_error("Could not reach the LensDesk server at " + m_serverUrl +
                                 ". Start the server or configure a reachable address.");
    }
    if (result.status >= 200 && result.status < 300) {
        if (result.body.value("mfaRequired", false)) {
            m_phase = "signed_out";
            m_reason.clear();
            m_takeover = nullptr;
            json reply;
            reply["mfaRequired"] = true;
            reply["challenge"] = result.body.value("challenge", "");
            return reply;
        }
        if (!result.body.contains("accessToken") || !result.body["accessToken"].is_string()) {
            throw std::runtime_error("The LensDesk server did not issue a desktop session. Update the server and try again.");
        }
        m_token = result.body["accessToken"].get<std::string>();
        m_refreshToken = result.body.value("refreshToken", "");
        m_desktopSessionId = result.body.contains("session") && result.body["session"].is_object()
            ? result.body["session"].value("id", "")
            : "";
        ApplyAuthoritativeSnapshot(result.body);
        Save();
        return GetGateView();
    }
    if (result.status == 409 && result.body.value("code", "") == "TAKEOVER_REQUIRED") {
        m_phase = "takeover";
        m_reason.clear();
        m_takeover = result.body.contains("existing") ? result.body["existing"] : result.body["current"];
        json reply;
        reply["takeoverRequired"] = true;
        reply["existing"] = m_takeover;
        return reply;
    }
    if (result.status == 403 && result.body.value("code", "") == "SUBSCRIPTION_REQUIRED") {
        m_phase = "subscription_required";
        m_reason = "missing";
        m_entitlement = nullptr;
        m_takeover = nullptr;
        m_purchaseUrl = result.body.value("purchaseUrl", m_serverUrl + "/dashboard");
        if (result.body.contains("user")) m_user = result.body["user"];
        json reply;
        reply["subscriptionRequired"] = true;
        reply["purchaseUrl"] = m_purchaseUrl;
        return reply;
    }
    if (result.status == 401) {
        ClearCredentials();
        m_phase = "signed_out";
        m_reason = "invalid_credentials";
    }
    throw std::runtime_error(HttpErrorText(result.body, "Sign-in failed. Check your email and password."));
}

json CloudClient::CompleteMfa(const json& payload) {
    json body = payload;
    if (!body.contains("deviceLabel")) body["deviceLabel"] = "LensDesk Native Windows Host";
    if (!body.contains("os")) body["os"] = "Windows";
    if (!body.contains("appVersion")) body["appVersion"] = "2.0.0";

    HttpResult result = Request("desktop.mfa", body, 15000);
    if (result.networkError) {
        throw std::runtime_error("Could not reach the LensDesk server at " + m_serverUrl + ".");
    }
    if (result.status >= 200 && result.status < 300) {
        if (!result.body.contains("accessToken") || !result.body["accessToken"].is_string()) {
            throw std::runtime_error("The LensDesk server did not issue a desktop session. Update the server and try again.");
        }
        m_token = result.body["accessToken"].get<std::string>();
        m_refreshToken = result.body.value("refreshToken", "");
        m_desktopSessionId = result.body.contains("session") && result.body["session"].is_object()
            ? result.body["session"].value("id", "")
            : "";
        ApplyAuthoritativeSnapshot(result.body);
        Save();
        return GetGateView();
    }
    if (result.status == 409 && result.body.value("code", "") == "TAKEOVER_REQUIRED") {
        m_phase = "takeover";
        m_takeover = result.body.contains("existing") ? result.body["existing"] : result.body["current"];
        json reply;
        reply["takeoverRequired"] = true;
        reply["existing"] = m_takeover;
        return reply;
    }
    if (result.status == 403 && result.body.value("code", "") == "SUBSCRIPTION_REQUIRED") {
        m_phase = "subscription_required";
        m_reason = "missing";
        m_entitlement = nullptr;
        m_purchaseUrl = result.body.value("purchaseUrl", m_serverUrl + "/dashboard");
        json reply;
        reply["subscriptionRequired"] = true;
        reply["purchaseUrl"] = m_purchaseUrl;
        return reply;
    }
    throw std::runtime_error(HttpErrorText(result.body, "The verification code was not accepted."));
}

json CloudClient::Logout() {
    if (HasSession()) {
        Request("desktop.logout", json::object(), 5000, m_token);
    }
    ClearCredentials();
    m_phase = "signed_out";
    m_reason.clear();
    m_purchaseUrl.clear();
    m_user = nullptr;
    m_session = nullptr;
    m_email.clear();
    Save();
    return GetGateView();
}

json CloudClient::Validate() {
    if (!HasSession()) {
        m_phase = "signed_out";
        m_reason.clear();
        m_entitlement = nullptr;
        return GetGateView();
    }
    HttpResult result = Heartbeat();
    if (result.status >= 200 && result.status < 300) {
        ApplyHeartbeat(result.body);
        Save();
    } else {
        HandleGateError(result);
        Save();
    }
    return GetGateView();
}

json CloudClient::EnsureValid() {
    if (!HasSession()) {
        m_phase = "signed_out";
        m_entitlement = nullptr;
        return GetGateView();
    }
    if (m_phase == "active" && m_lastVerifiedAtMs > 0 && NowMs() - m_lastVerifiedAtMs < 60000) {
        return GetGateView();
    }
    return Validate();
}

json CloudClient::Configure(const std::string& serverUrl) {
    const std::string normalized = NormalizeServerUrl(serverUrl);
    if (normalized != m_serverUrl) {
        ClearCredentials();
        m_phase = "signed_out";
        m_reason.clear();
        m_user = nullptr;
        m_session = nullptr;
        m_email.clear();
        m_purchaseUrl.clear();
        m_serverUrl = normalized;
        Save();
    }
    json result;
    result["serverUrl"] = m_serverUrl;
    result["user"] = m_user;
    return result;
}

json CloudClient::GetGateView() const {
    json gate;
    gate["phase"] = m_phase;
    gate["reason"] = m_reason;
    gate["authenticated"] = m_phase == "active";
    gate["session"] = m_session;
    gate["entitlement"] = m_entitlement;
    gate["user"] = m_user;
    gate["email"] = m_email;
    gate["purchaseUrl"] = GetPurchaseUrl();
    gate["takeover"] = m_takeover;
    gate["serverUrl"] = m_serverUrl;
    gate["serverTimeMs"] = m_serverTimeMs;
    gate["lastVerifiedAtMs"] = m_lastVerifiedAtMs;
    gate["offlineGrace"] = m_phase == "active" && m_lastVerifiedAtMs > 0 &&
        NowMs() - m_lastVerifiedAtMs <= 120000;
    gate["licenseValid"] = AuthorizedNow();
    gate["tier"] = m_entitlement.is_object() ? m_entitlement.value("planId", "free") : "free";
    return gate;
}

json CloudClient::GetAccountEntitlement() const {
    json result;
    result["entitlement"] = m_entitlement;
    result["horizon"] = m_entitlement.is_object()
        ? m_entitlement.value("expirationTimestamp", static_cast<int64_t>(0))
        : 0;
    result["serverTimeMs"] = m_serverTimeMs;
    result["plans"] = json::array();
    result["history"] = json::array();
    result["desktops"] = json::array();
    result["desktop"] = m_session;
    result["serverUrl"] = m_serverUrl;
    return result;
}

json CloudClient::GetCloudState() const {
    json result;
    result["user"] = m_user;
    result["serverUrl"] = m_serverUrl;
    result["authenticated"] = m_phase == "active";
    return result;
}

bool CloudClient::AuthorizedNow() const {
    if (m_phase != "active" || !m_entitlement.is_object()) return false;
    if (m_lastVerifiedAtMs <= 0 || NowMs() - m_lastVerifiedAtMs > 120000) return false;
    const int64_t remainingMs =
        m_entitlement.value("remainingSeconds", static_cast<int64_t>(0)) * 1000;
    const int64_t elapsedSinceServer = NowMs() - m_serverTimeMs;
    return remainingMs - elapsedSinceServer > 0;
}

std::string CloudClient::GetPurchaseUrl() const {
    if (!m_purchaseUrl.empty()) return m_purchaseUrl;
    if (m_serverUrl.empty()) return "";
    return m_serverUrl + "/dashboard";
}

} // namespace LensDesk
