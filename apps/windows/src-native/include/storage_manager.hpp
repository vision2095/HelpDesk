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

    // Theme Color Controls (GAP 08)
    std::string GetLightTextColor();
    bool SetLightTextColor(const std::string& color);
    std::string GetDarkTextColor();
    bool SetDarkTextColor(const std::string& color);
    bool ResetColors();

    // Browser Controls (GAP 07)
    std::string GetSearchEngine();
    bool SetSearchEngine(const std::string& engine);
    float GetBrowserZoom();
    bool SetBrowserZoom(float zoom);
    std::string GetBrowserHomePage();
    bool SetBrowserHomePage(const std::string& homePage);

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

    // Backup & Recovery (Transactional, Rollback-protected, Account-Scoped)
    json CreateBackup();
    bool RestoreBackup(const json& backup, std::string& error);
    json GetSnapshots();
    bool CreateSnapshot(const std::string& reason, std::string& outSnapshotId);
    bool RestoreSnapshot(const std::string& snapshotId, std::string& error);

private:
    bool ReadJsonFile(const std::filesystem::path& path, json& outJson);
    bool WriteJsonFileAtomic(const std::filesystem::path& path, const json& inJson);

    std::filesystem::path m_appDataDir;
    std::filesystem::path m_prefsPath;
    std::filesystem::path m_profilesPath;
    std::filesystem::path m_sessionsPath;
    std::filesystem::path m_keysPath;
    std::filesystem::path m_snapshotsDir;

    std::string m_currentAccountId;
    std::string m_currentAccountEmail;

    std::mutex m_mutex;
};

} // namespace LensDesk
