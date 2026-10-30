#pragma once
#include "common.hpp"

namespace LensDesk {

class StorageManager {
public:
    StorageManager();
    ~StorageManager();

    bool Initialize();

    // Preferences
    static json GetDefaultPreferences();
    json GetPreferences();
    bool SavePreferences(const json& prefs);

    // Settings aliases for IPC parity
    json GetSettings() { return GetPreferences(); }
    bool SaveSettings(const json& settings) { return SavePreferences(settings); }
    bool ClearAllData();
    bool ClearAll() { return ClearAllData(); }

    // Account-bound data scoping
    bool SetCurrentAccount(const std::string& userId, const std::string& email = "");
    std::string GetCurrentAccountId() const { return m_currentAccountId; }
    std::string GetCurrentAccountEmail() const { return m_currentAccountEmail; }

    // Profiles
    json GetProfiles();
    bool SaveProfile(const json& profile);
    bool DeleteProfile(const std::string& profileId);

    // Sessions & History
    json GetSessions();
    json GetSession(const std::string& sessionId);
    bool SaveSession(const json& session);
    bool DeleteSession(const std::string& sessionId);
    json SearchSessions(const std::string& query);
    bool PatchSession(const std::string& sessionId, const json& patch);

    // API Keys (Encrypted with Windows DPAPI)
    bool SaveApiKey(const std::string& provider, const std::string& key);
    std::string GetApiKey(const std::string& provider);
    bool HasApiKey(const std::string& provider);
    json GetKeyStatus();

    // Workspaces
    json GetWorkspaces();

private:
    bool ReadJsonFile(const std::filesystem::path& path, json& outJson);
    bool WriteJsonFileAtomic(const std::filesystem::path& path, const json& inJson);

    std::filesystem::path m_appDataDir;
    std::filesystem::path m_prefsPath;
    std::filesystem::path m_profilesPath;
    std::filesystem::path m_sessionsPath;
    std::filesystem::path m_keysPath;

    std::string m_currentAccountId;
    std::string m_currentAccountEmail;

    std::mutex m_mutex;
};

} // namespace LensDesk
