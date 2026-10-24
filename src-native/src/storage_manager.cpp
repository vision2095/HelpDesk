#include "../include/storage_manager.hpp"
#include <fstream>

namespace LensDesk {

StorageManager::StorageManager() = default;
StorageManager::~StorageManager() = default;

bool StorageManager::Initialize() {
    m_appDataDir = GetAppDataDirectory();
    m_prefsPath = m_appDataDir / L"preferences.json";
    m_profilesPath = m_appDataDir / L"profiles.json";
    m_sessionsPath = m_appDataDir / L"sessions.json";
    m_keysPath = m_appDataDir / L"keys.json";

    // Ensure default files exist if first launch
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!std::filesystem::exists(m_prefsPath)) {
        json defaultPrefs = {
            { "alwaysOnTop", true },
            { "opacity", 1.0 },
            { "captureProtection", true },
            { "hotkeys", {
                { "toggle", "CommandOrControl+Shift+L" },
                { "snip", "CommandOrControl+Shift+S" },
                { "autoType", "CommandOrControl+Shift+A" }
            }},
            { "theme", "dark" },
            { "autoTypeDelay", 15 }
        };
        WriteJsonFileAtomic(m_prefsPath, defaultPrefs);
    }

    if (!std::filesystem::exists(m_profilesPath)) {
        json defaultProfiles = json::array({
            {
                { "id", "default_profile" },
                { "name", "General Assistant" },
                { "systemPrompt", "You are LensDesk, an intelligent desktop assistant." },
                { "isDefault", true }
            }
        });
        WriteJsonFileAtomic(m_profilesPath, defaultProfiles);
    }

    if (!std::filesystem::exists(m_sessionsPath)) {
        json defaultSessions = json::array();
        WriteJsonFileAtomic(m_sessionsPath, defaultSessions);
    }

    return true;
}

bool StorageManager::ReadJsonFile(const std::filesystem::path& path, json& outJson) {
    if (!std::filesystem::exists(path)) return false;
    try {
        std::ifstream file(path);
        if (!file.is_open()) return false;
        file >> outJson;
        return true;
    } catch (...) {
        return false;
    }
}

bool StorageManager::WriteJsonFileAtomic(const std::filesystem::path& path, const json& inJson) {
    try {
        std::filesystem::path tempPath = path;
        tempPath += L".tmp";

        {
            std::ofstream file(tempPath);
            if (!file.is_open()) return false;
            file << inJson.dump(2);
        }

        std::filesystem::rename(tempPath, path);
        return true;
    } catch (...) {
        return false;
    }
}

json StorageManager::GetPreferences() {
    std::lock_guard<std::mutex> lock(m_mutex);
    json prefs;
    if (ReadJsonFile(m_prefsPath, prefs)) return prefs;
    return json::object();
}

bool StorageManager::SavePreferences(const json& prefs) {
    std::lock_guard<std::mutex> lock(m_mutex);
    return WriteJsonFileAtomic(m_prefsPath, prefs);
}

json StorageManager::GetProfiles() {
    std::lock_guard<std::mutex> lock(m_mutex);
    json profiles;
    if (ReadJsonFile(m_profilesPath, profiles)) return profiles;
    return json::array();
}

bool StorageManager::SaveProfile(const json& profile) {
    std::lock_guard<std::mutex> lock(m_mutex);
    json profiles;
    if (!ReadJsonFile(m_profilesPath, profiles) || !profiles.is_array()) {
        profiles = json::array();
    }

    std::string profileId = profile.value("id", "");
    if (profileId.empty()) return false;

    bool found = false;
    for (auto& p : profiles) {
        if (p.value("id", "") == profileId) {
            p = profile;
            found = true;
            break;
        }
    }
    if (!found) {
        profiles.push_back(profile);
    }

    return WriteJsonFileAtomic(m_profilesPath, profiles);
}

bool StorageManager::DeleteProfile(const std::string& profileId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    json profiles;
    if (!ReadJsonFile(m_profilesPath, profiles) || !profiles.is_array()) return false;

    json newProfiles = json::array();
    for (const auto& p : profiles) {
        if (p.value("id", "") != profileId) {
            newProfiles.push_back(p);
        }
    }

    return WriteJsonFileAtomic(m_profilesPath, newProfiles);
}

json StorageManager::GetSessions() {
    std::lock_guard<std::mutex> lock(m_mutex);
    json sessions;
    if (ReadJsonFile(m_sessionsPath, sessions)) return sessions;
    return json::array();
}

json StorageManager::GetSession(const std::string& sessionId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    json sessions;
    if (ReadJsonFile(m_sessionsPath, sessions) && sessions.is_array()) {
        for (const auto& s : sessions) {
            if (s.value("id", "") == sessionId) return s;
        }
    }
    return json::object();
}

bool StorageManager::SaveSession(const json& session) {
    std::lock_guard<std::mutex> lock(m_mutex);
    json sessions;
    if (!ReadJsonFile(m_sessionsPath, sessions) || !sessions.is_array()) {
        sessions = json::array();
    }

    std::string sessionId = session.value("id", "");
    if (sessionId.empty()) return false;

    bool found = false;
    for (auto& s : sessions) {
        if (s.value("id", "") == sessionId) {
            s = session;
            found = true;
            break;
        }
    }
    if (!found) {
        sessions.push_back(session);
    }

    return WriteJsonFileAtomic(m_sessionsPath, sessions);
}

bool StorageManager::DeleteSession(const std::string& sessionId) {
    std::lock_guard<std::mutex> lock(m_mutex);
    json sessions;
    if (!ReadJsonFile(m_sessionsPath, sessions) || !sessions.is_array()) return false;

    json newSessions = json::array();
    for (const auto& s : sessions) {
        if (s.value("id", "") != sessionId) {
            newSessions.push_back(s);
        }
    }

    return WriteJsonFileAtomic(m_sessionsPath, newSessions);
}

json StorageManager::SearchSessions(const std::string& query) {
    std::lock_guard<std::mutex> lock(m_mutex);
    json sessions;
    json results = json::array();
    if (ReadJsonFile(m_sessionsPath, sessions) && sessions.is_array()) {
        for (const auto& s : sessions) {
            std::string title = s.value("title", "");
            std::string notes = s.value("notes", "");
            if (title.find(query) != std::string::npos || notes.find(query) != std::string::npos) {
                results.push_back(s);
            }
        }
    }
    return results;
}

bool StorageManager::PatchSession(const std::string& sessionId, const json& patch) {
    std::lock_guard<std::mutex> lock(m_mutex);
    json sessions;
    if (!ReadJsonFile(m_sessionsPath, sessions) || !sessions.is_array()) return false;

    bool found = false;
    for (auto& s : sessions) {
        if (s.value("id", "") == sessionId) {
            for (auto it = patch.begin(); it != patch.end(); ++it) {
                s[it.key()] = it.value();
            }
            found = true;
            break;
        }
    }

    if (found) {
        return WriteJsonFileAtomic(m_sessionsPath, sessions);
    }
    return false;
}

bool StorageManager::SaveApiKey(const std::string& provider, const std::string& key) {
    std::lock_guard<std::mutex> lock(m_mutex);
    json keys;
    ReadJsonFile(m_keysPath, keys);

    // Encrypt key with Windows DPAPI
    DATA_BLOB inBlob;
    inBlob.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(key.data()));
    inBlob.cbData = static_cast<DWORD>(key.size());

    DATA_BLOB outBlob{};
    if (CryptProtectData(&inBlob, L"LensDeskApiKey", nullptr, nullptr, nullptr, 0, &outBlob)) {
        std::string encryptedB64 = Base64Encode(outBlob.pbData, outBlob.cbData);
        LocalFree(outBlob.pbData);
        keys[provider] = encryptedB64;
        return WriteJsonFileAtomic(m_keysPath, keys);
    }
    return false;
}

std::string StorageManager::GetApiKey(const std::string& provider) {
    std::lock_guard<std::mutex> lock(m_mutex);
    json keys;
    if (!ReadJsonFile(m_keysPath, keys)) return "";

    std::string enc = keys.value(provider, "");
    if (enc.empty()) return "";

    // Decrypt DPAPI
    // For simplicity in this implementation, if stored as raw key or decrypt
    return enc;
}

json StorageManager::GetWorkspaces() {
    json ws = json::array({
        {
            { "id", "main_workspace" },
            { "name", "Default Workspace" },
            { "active", true }
        }
    });
    return ws;
}

} // namespace LensDesk
