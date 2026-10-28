#pragma once
#include "common.hpp"

namespace LensDesk {

// Native desktop entitlement client.
//
// The hosted LensDesk service is the only authority for desktop access.
// This client never treats a cached snapshot as authorization after the
// offline grace window and never invents an active subscription.
class CloudClient {
public:
    CloudClient();
    ~CloudClient();

    bool Initialize();

    json Login(const json& payload);
    json CompleteMfa(const json& payload);
    json Logout();
    json Validate();
    json EnsureValid();
    json Configure(const std::string& serverUrl);
    json CloudRequest(const std::string& action, const json& payload);

    json GetGateView() const;
    json GetAccountEntitlement() const;
    json GetCloudState() const;

    bool AuthorizedNow() const;
    bool HasSession() const { return !m_token.empty() && !m_refreshToken.empty(); }
    std::string GetServerUrl() const { return m_serverUrl; }
    std::string GetPurchaseUrl() const;

private:
    struct HttpResult {
        int status = 0;
        json body = json::object();
        std::string error;
        bool networkError = false;
    };

    HttpResult Request(
        const std::string& action,
        const json& payload,
        int timeoutMs = 10000,
        const std::string& bearer = ""
    ) const;
    HttpResult Heartbeat();
    HttpResult Refresh();

    void Load();
    void Save();
    void ClearCredentials();
    void ApplyAuthoritativeSnapshot(const json& data);
    void ApplyHeartbeat(const json& data);
    void HandleGateError(const HttpResult& result);
    std::string NormalizeServerUrl(const std::string& value) const;

    std::string EncryptSecret(const std::string& plain) const;
    std::string DecryptSecret(const std::string& encoded) const;

    std::filesystem::path m_configPath;
    std::string m_serverUrl;
    std::string m_token;
    std::string m_refreshToken;
    std::string m_desktopSessionId;
    std::string m_email;
    std::string m_phase = "signed_out";
    std::string m_reason;
    std::string m_purchaseUrl;
    json m_user = nullptr;
    json m_session = nullptr;
    json m_entitlement = nullptr;
    json m_takeover = nullptr;
    int64_t m_serverTimeMs = 0;
    int64_t m_lastVerifiedAtMs = 0;
};

} // namespace LensDesk
