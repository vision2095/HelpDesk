#pragma once
#include "common.hpp"

namespace LensDesk {

class StorageManager {
public:
    StorageManager();
    ~StorageManager();

    bool Initialize();

    // Preferences
    json GetPreferences();
    bool SavePreferences(const json& prefs);

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

    std::mutex m_mutex;
};

} // namespace LensDesk
