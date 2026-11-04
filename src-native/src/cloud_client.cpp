#include "../include/cloud_client.hpp"
#include <winhttp.h>
#include <bcrypt.h>
#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>

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

namespace {

constexpr uint64_t kMaxUpdateBytes = 1024ull * 1024ull * 1024ull;

int CompareVersions(const std::string& left, const std::string& right) {
    auto parse = [](const std::string& value) {
        std::vector<int> parts;
        size_t start = 0;
        while (start < value.size() && parts.size() < 4) {
            while (start < value.size() && !std::isdigit(static_cast<unsigned char>(value[start]))) ++start;
            if (start >= value.size()) break;
            size_t end = start;
            while (end < value.size() && std::isdigit(static_cast<unsigned char>(value[end]))) ++end;
            parts.push_back(std::atoi(value.substr(start, end - start).c_str()));
            start = end;
        }
        return parts;
    };
    auto a = parse(left);
    auto b = parse(right);
    for (size_t i = 0; i < std::max(a.size(), b.size()); ++i) {
        const int av = i < a.size() ? a[i] : 0;
        const int bv = i < b.size() ? b[i] : 0;
        if (av != bv) return av < bv ? -1 : 1;
    }
    return 0;
}

bool IsValidSha256(const std::string& value) {
    if (value.size() != 64) return false;
    return std::all_of(value.begin(), value.end(), [](unsigned char c) {
        return std::isxdigit(c) != 0;
    });
}

std::string Sha256File(const std::filesystem::path& path) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::vector<uint8_t> hashObject;
    std::vector<uint8_t> digest;
    std::string result;
    DWORD objectSize = 0;
    DWORD digestSize = 0;
    DWORD written = 0;
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) return result;
    if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
                          reinterpret_cast<PUCHAR>(&objectSize), sizeof(objectSize), &written, 0) < 0 ||
        BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH,
                          reinterpret_cast<PUCHAR>(&digestSize), sizeof(digestSize), &written, 0) < 0) {
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return result;
    }
    hashObject.resize(objectSize);
    digest.resize(digestSize);
    if (BCryptCreateHash(algorithm, &hash, hashObject.data(), objectSize, nullptr, 0, 0) < 0) {
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return result;
    }
    std::ifstream file(path, std::ios::binary);
    std::vector<char> buffer(64 * 1024);
    while (file.good()) {
        file.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const std::streamsize count = file.gcount();
        if (count > 0 && BCryptHashData(hash, reinterpret_cast<PUCHAR>(buffer.data()),
                                        static_cast<ULONG>(count), 0) < 0) {
            BCryptDestroyHash(hash);
            BCryptCloseAlgorithmProvider(algorithm, 0);
            return result;
        }
    }
    if (BCryptFinishHash(hash, digest.data(), digestSize, 0) < 0) {
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return result;
    }
    BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    static const char* hex = "0123456789abcdef";
    result.reserve(digest.size() * 2);
    for (uint8_t byte : digest) {
        result.push_back(hex[byte >> 4]);
        result.push_back(hex[byte & 0x0f]);
    }
    return result;
}

bool DownloadUrlToFile(const std::string& url, const std::filesystem::path& target, std::string& error) {
    std::wstring wideUrl = Utf8ToWide(url);
    URL_COMPONENTS components{};
    components.dwStructSize = sizeof(components);
    components.dwSchemeLength = static_cast<DWORD>(-1);
    components.dwHostNameLength = static_cast<DWORD>(-1);
    components.dwUrlPathLength = static_cast<DWORD>(-1);
    components.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(wideUrl.c_str(), static_cast<DWORD>(wideUrl.size()), 0, &components)) {
        error = "The update URL is invalid.";
        return false;
    }
    if (components.nScheme != INTERNET_SCHEME_HTTPS) {
        error = "Updates must use HTTPS.";
        return false;
    }
    const std::wstring host(components.lpszHostName, components.dwHostNameLength);
    std::wstring path(components.lpszUrlPath, components.dwUrlPathLength);
    if (path.empty()) path = L"/";
    if (components.dwExtraInfoLength > 0) path.append(components.lpszExtraInfo, components.dwExtraInfoLength);

    HINTERNET session = WinHttpOpen(L"LensDesk/2.0 (Windows Native Update)",
                                    WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) { error = "Could not initialize the update client."; return false; }
    DWORD protocols = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3;
    WinHttpSetOption(session, WINHTTP_OPTION_SECURE_PROTOCOLS, &protocols, sizeof(protocols));
    WinHttpSetTimeouts(session, 30000, 45000, 120000, 120000);
    HINTERNET connection = WinHttpConnect(session, host.c_str(), components.nPort, 0);
    if (!connection) {
        WinHttpCloseHandle(session);
        error = "Could not connect to the update server.";
        return false;
    }
    HINTERNET request = WinHttpOpenRequest(connection, L"GET", path.c_str(), nullptr,
                                           WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                           WINHTTP_FLAG_SECURE);
    if (request) {
        // Keep the update download on HTTPS even if the release host redirects.
        DWORD redirectPolicy = WINHTTP_OPTION_REDIRECT_POLICY_DISALLOW_HTTPS_TO_HTTP;
        WinHttpSetOption(request, WINHTTP_OPTION_REDIRECT_POLICY, &redirectPolicy, sizeof(redirectPolicy));
    }
    if (!request || !WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                        WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(request, nullptr)) {
        if (request) WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        error = "Could not download the update.";
        return false;
    }
    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX);
    if (status != 200) {
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        error = "The update server returned HTTP " + std::to_string(status) + ".";
        return false;
    }
    std::ofstream output(target, std::ios::binary | std::ios::trunc);
    if (!output.is_open()) {
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        error = "Could not create the update file.";
        return false;
    }
    std::vector<char> buffer(64 * 1024);
    uint64_t totalWritten = 0;
    while (true) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request, &available)) {
            error = "The update download was interrupted.";
            break;
        }
        if (available == 0) {
            error.clear();
            break;
        }
        const DWORD chunk = std::min<DWORD>(available, static_cast<DWORD>(buffer.size()));
        DWORD read = 0;
        if (!WinHttpReadData(request, buffer.data(), chunk, &read)) {
            error = "The update download was interrupted.";
            break;
        }
        if (read > 0) {
            totalWritten += read;
            if (totalWritten > kMaxUpdateBytes) {
                error = "The update file is larger than the supported limit.";
                break;
            }
            output.write(buffer.data(), static_cast<std::streamsize>(read));
        }
    }
    output.close();
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);
    if (!error.empty()) {
        std::error_code ec;
        std::filesystem::remove(target, ec);
        return false;
    }
    return true;
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
    const std::string defaultServer = "https://helpdesk-h44x.onrender.com";
    if (env && *env && std::string(env).find("example") == std::string::npos) {
        m_serverUrl = env;
    } else {
        m_serverUrl = defaultServer;
    }
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
            std::string u = NormalizeServerUrl(saved["url"].get<std::string>());
            bool isInvalidOrDummy = (u.empty() ||
                                    u.find("example.com") != std::string::npos ||
                                    u.find("example.org") != std::string::npos ||
                                    u.find("127.0.0.1") != std::string::npos ||
                                    u.find("localhost") != std::string::npos);
            if (isInvalidOrDummy && (!env || !*env || std::string(env).find("example") != std::string::npos)) {
                m_serverUrl = defaultServer;
            } else {
                m_serverUrl = u;
            }
        }
    } catch (...) {
        m_serverUrl = defaultServer;
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
    if (saved.contains("settings") && saved["settings"].is_object()) {
        m_userSettings = saved["settings"];
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
    saved["settings"] = m_userSettings;

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
    m_userSettings = nullptr;
    m_lastVerifiedAtMs = 0;
    m_serverTimeMs = 0;
}

CloudClient::HttpResult CloudClient::Request(
    const std::string& action,
    const json& payload,
    int timeoutMs,
    const std::string& bearer,
    const std::wstring& verb,
    const std::wstring& customPath
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
    if (!customPath.empty()) {
        path = customPath;
    } else {
        if (path.empty()) path = L"/";
        if (path.back() == L'/') path.pop_back();
        path += L"/api/";
        path += Utf8ToWide(action);
    }

    const bool secure = components.nScheme == INTERNET_SCHEME_HTTPS;
    const int effectiveTimeout = std::max(timeoutMs, 45000);

    for (int attempt = 0; attempt < 2; ++attempt) {
        result = HttpResult{};

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

        if (secure) {
            DWORD secProtocols = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3;
            WinHttpSetOption(session, WINHTTP_OPTION_SECURE_PROTOCOLS, &secProtocols, sizeof(secProtocols));
        }

        WinHttpSetTimeouts(session, 30000, 45000, effectiveTimeout, effectiveTimeout);

        HINTERNET connection = WinHttpConnect(session, host.c_str(), components.nPort, 0);
        if (!connection) {
            result.networkError = true;
            result.error = "Could not connect to the LensDesk server.";
            WinHttpCloseHandle(session);
            if (attempt == 0 && action != "desktop.logout" && action != "auth.logout") {
                std::this_thread::sleep_for(std::chrono::milliseconds(1500));
                continue;
            }
            return result;
        }

        HINTERNET request = WinHttpOpenRequest(
            connection,
            verb.c_str(),
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

        const std::string body = (verb == L"GET" || verb == L"HEAD") ? "" : payload.dump();
        BOOL sent = WinHttpSendRequest(
            request,
            headers.c_str(),
            static_cast<DWORD>(-1L),
            body.empty() ? nullptr : const_cast<char*>(body.data()),
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
            if (attempt == 0 && action != "desktop.logout" && action != "auth.logout") {
                std::this_thread::sleep_for(std::chrono::milliseconds(1500));
                continue;
            }
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
        break;
    }
    return result;
}

void CloudClient::ApplyAuthoritativeSnapshot(const json& data) {
    if (data.contains("user")) m_user = data["user"];
    if (data.contains("session")) m_session = data["session"];
    if (data.contains("settings") && data["settings"].is_object()) {
        m_userSettings = data["settings"];
    }
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

#ifdef LENSDESK_ENABLE_TEST_AUTH
    const char* testAuth = std::getenv("LENSDESK_TEST_AUTH");
    if (testAuth && std::string(testAuth) == "1" && body.value("test", false)) {
        json testData;
        testData["serverTimeMs"] = NowMs();
        testData["user"] = { { "id", "test-user-id" }, { "email", "test@lensdesk.local" }, { "name", "Test User" } };
        testData["email"] = "test@lensdesk.local";
        testData["session"] = { { "id", "test-session-id" }, { "deviceLabel", "CI Test Host" } };
        testData["accessToken"] = "test-ci-access-token";
        testData["refreshToken"] = "test-ci-refresh-token";
        testData["entitlement"] = {
            { "planId", "pro" },
            { "activationTimestamp", NowMs() },
            { "expirationTimestamp", NowMs() + 86400000000LL },
            { "subscriptionStatus", "active" },
            { "remainingSeconds", 8640000 },
            { "serverTimeMs", NowMs() }
        };
        m_token = "test-ci-access-token";
        m_refreshToken = "test-ci-refresh-token";
        m_desktopSessionId = "test-session-id";
        ApplyAuthoritativeSnapshot(testData);
        Save();
        return GetGateView();
    }
#endif

    HttpResult result = Request("desktop.login", body, 15000);
    const std::string defaultServer = "https://helpdesk-h44x.onrender.com";
    if (result.networkError && m_serverUrl != defaultServer) {
        m_serverUrl = defaultServer;
        Save();
        result = Request("desktop.login", body, 15000);
    }
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
    const std::string defaultServer = "https://helpdesk-h44x.onrender.com";
    if (result.networkError && m_serverUrl != defaultServer) {
        m_serverUrl = defaultServer;
        Save();
        result = Request("desktop.mfa", body, 15000);
    }
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

json CloudClient::ApplyTokens(const std::string& accessToken, const std::string& refreshToken) {
    m_token = accessToken;
    m_refreshToken = refreshToken;
    m_lastVerifiedAtMs = NowMs();
    m_phase = "active";
    m_reason.clear();
    Save();
    return Validate();
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

json CloudClient::CheckForUpdate() const {
    const std::string versionUtf8 = WideToUtf8(APP_VERSION);
    const std::wstring query =
        L"/api/v1/updates/check?platform=windows&v=" + std::wstring(APP_VERSION);
    HttpResult res = Request("updates.check", json::object(), 20000, "", L"GET", query);
    if (res.networkError || res.status < 200 || res.status >= 300 || !res.body.is_object()) {
        return json{
            {"ok", false},
            {"updateAvailable", false},
            {"currentVersion", versionUtf8},
            {"error", res.error.empty() ? "Could not check for updates." : res.error}
        };
    }
    json result = res.body;
    result["ok"] = result.value("ok", true);
    result["currentVersion"] = versionUtf8;
    const std::string latest = result.value("latestVersion", versionUtf8);
    result["updateAvailable"] = CompareVersions(latest, versionUtf8) > 0;
    return result;
}

json CloudClient::DownloadAndInstallUpdate() {
    json check = CheckForUpdate();
    if (!check.value("ok", false)) {
        return json{{"downloaded", false}, {"error", check.value("error", "Update check failed.")}};
    }
    if (!check.value("updateAvailable", false)) {
        return json{{"downloaded", false}, {"error", "Already on latest version"}};
    }
    const json artifact = check.value("artifact", json::object());
    if (!artifact.is_object()) {
        return json{{"downloaded", false}, {"error", "The update manifest has no installer artifact."}};
    }
    const std::string url = artifact.value("url", check.value("downloadUrl", std::string()));
    const std::string sha256 = artifact.value("sha256", std::string());
    std::string name = artifact.value("name", std::string("LensDesk-update.exe"));
    // Never let a manifest choose a path. Keep only the final path component
    // and restrict the updater to artifact types it knows how to launch.
    name = WideToUtf8(std::filesystem::path(Utf8ToWide(name)).filename().wstring());
    std::string lower = name;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const bool supportedArtifact =
        (lower.size() >= 4 && lower.substr(lower.size() - 4) == ".exe") ||
        (lower.size() >= 4 && lower.substr(lower.size() - 4) == ".msi") ||
        (lower.size() >= 4 && lower.substr(lower.size() - 4) == ".zip");
    if (url.empty() || !IsValidSha256(sha256) || !supportedArtifact) {
        return json{{"downloaded", false}, {"error", "The update manifest is missing a verified HTTPS artifact."}};
    }
    wchar_t tempPath[MAX_PATH]{};
    if (!GetTempPathW(MAX_PATH, tempPath)) {
        return json{{"downloaded", false}, {"error", "Could not locate the temporary directory."}};
    }
    std::filesystem::path target = std::filesystem::path(tempPath) / Utf8ToWide(name);
    std::string downloadError;
    if (!DownloadUrlToFile(url, target, downloadError)) {
        return json{{"downloaded", false}, {"error", downloadError}};
    }
    const std::string actual = Sha256File(target);
    if (actual.empty() || actual != sha256) {
        std::error_code ec;
        std::filesystem::remove(target, ec);
        return json{{"downloaded", false}, {"error", "The downloaded update failed SHA-256 verification."}};
    }
    if (lower.size() >= 4 && lower.substr(lower.size() - 4) == ".zip") {
        // Portable ZIP updates are staged and opened for manual replacement;
        // silently overwriting a running executable is not safe.
        std::wstring parameters = L"/select,\"" + target.wstring() + L"\"";
        ShellExecuteW(nullptr, L"open", L"explorer.exe", parameters.c_str(), nullptr, SW_SHOWNORMAL);
        return json{{"downloaded", true},
                    {"requiresManualInstall", true},
                    {"path", WideToUtf8(target.wstring())},
                    {"latestVersion", check.value("latestVersion", std::string())}};
    }
    if (lower.size() >= 4 && lower.substr(lower.size() - 4) == ".msi") {
        std::wstring parameters = L"/i \"" + target.wstring() + L"\" /qn /norestart";
        HINSTANCE launched = ShellExecuteW(nullptr, L"open", L"msiexec.exe", parameters.c_str(), nullptr, SW_SHOWNORMAL);
        if (reinterpret_cast<INT_PTR>(launched) <= 32) {
            return json{{"downloaded", true}, {"requiresManualInstall", true}, {"path", WideToUtf8(target.wstring())}};
        }
        return json{{"downloaded", true}, {"installerLaunched", true}, {"latestVersion", check.value("latestVersion", std::string())}};
    }
    if (lower.size() >= 4 && lower.substr(lower.size() - 4) == ".exe") {
        std::wstring parameters = L"/S";
        HINSTANCE launched = ShellExecuteW(nullptr, L"open", target.c_str(), parameters.c_str(), nullptr, SW_SHOWNORMAL);
        if (reinterpret_cast<INT_PTR>(launched) <= 32) {
            return json{{"downloaded", true}, {"requiresManualInstall", true}, {"path", WideToUtf8(target.wstring())}};
        }
        return json{{"downloaded", true}, {"installerLaunched", true}, {"latestVersion", check.value("latestVersion", std::string())}};
    }
    return json{{"downloaded", true}, {"requiresManualInstall", true}, {"path", WideToUtf8(target.wstring())}};
}

json CloudClient::CloudRequest(const std::string& action, const json& payload) {
    HttpResult res = Request(action, payload, 25000, m_token);
    if (res.status == 401 && HasSession()) {
        HttpResult ref = Refresh();
        if (ref.status == 200) {
            res = Request(action, payload, 25000, m_token);
        }
    }
    if (res.networkError) {
        throw std::runtime_error(res.error.empty() ? "Could not reach your cloud server. Check the server address and your connection." : res.error);
    }
    if (res.status >= 400) {
        throw std::runtime_error(HttpErrorText(res.body, "Cloud request failed."));
    }
    return res.body;
}

json CloudClient::FetchUserSettings() {
    if (!HasSession()) return json::object();

    HttpResult res = Request("settings", json::object(), 15000, m_token, L"GET", L"/api/v1/settings");
    if (res.status == 401) {
        HttpResult ref = Refresh();
        if (ref.status == 200) {
            res = Request("settings", json::object(), 15000, m_token, L"GET", L"/api/v1/settings");
        }
    }
    if (res.status == 200 && res.body.is_object() && res.body.contains("settings") && res.body["settings"].is_object()) {
        m_userSettings = res.body["settings"];
        Save();
        return m_userSettings;
    }

    try {
        json state = CloudRequest("state", json::object());
        if (state.contains("settings") && state["settings"].is_object()) {
            m_userSettings = state["settings"];
            Save();
            return m_userSettings;
        }
    } catch (...) {}

    return m_userSettings.is_object() ? m_userSettings : json::object();
}

json CloudClient::SyncUserSettings(const json& settings) {
    if (!HasSession()) return json::object();

    m_userSettings = settings;
    Save();

    json payload;
    payload["settings"] = settings;
    HttpResult res = Request("settings", payload, 15000, m_token, L"PUT", L"/api/v1/settings");
    if (res.status == 401) {
        HttpResult ref = Refresh();
        if (ref.status == 200) {
            res = Request("settings", payload, 15000, m_token, L"PUT", L"/api/v1/settings");
        }
    }
    if (res.status >= 200 && res.status < 300) {
        return res.body;
    }

    try {
        return CloudRequest("settings.save", settings);
    } catch (...) {}

    return json::object();
}

} // namespace LensDesk
