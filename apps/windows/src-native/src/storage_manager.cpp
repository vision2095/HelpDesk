#include "../include/storage_manager.hpp"
#include <fstream>
#include <chrono>
#include <algorithm>
#include <vector>

namespace LensDesk {

StorageManager::StorageManager() = default;
StorageManager::~StorageManager() = default;

bool StorageManager::Initialize() {
    m_appDataDir = GetAppDataDirectory();
    m_prefsPath = m_appDataDir / L"preferences.json";
    m_profilesPath = m_appDataDir / L"profiles.json";
    m_sessionsPath = m_appDataDir / L"sessions.json";
    m_keysPath = m_appDataDir / L"keys.json";
    m_snapshotsDir = m_appDataDir / L"snapshots";
    std::error_code ecSnap;
    std::filesystem::create_directories(m_snapshotsDir, ecSnap);

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
        json defaultSessions = json::array({
            {
                { "id", "session_initial" },
                { "title", "New Thinking Session" },
                { "mode", "general" },
                { "profileId", "default_profile" },
                { "createdAt", GetIsoTimestamp() },
                { "updatedAt", GetIsoTimestamp() },
                { "notes", "" },
                { "transcript", "" },
                { "messages", json::array() }
            }
        });
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

bool StorageManager::SetCurrentAccount(const std::string& userId, const std::string& email) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_currentAccountId = userId;
    m_currentAccountEmail = email;

    if (!userId.empty()) {
        std::string safeId;
        for (char c : userId) {
            if (std::isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '_') {
                safeId += c;
            } else {
                safeId += '_';
            }
        }
        std::filesystem::path userDir = m_appDataDir / Utf8ToWide("account_" + safeId);
        std::error_code ec;
        std::filesystem::create_directories(userDir, ec);

        m_prefsPath = userDir / L"preferences.json";
        m_profilesPath = userDir / L"profiles.json";
        m_sessionsPath = userDir / L"sessions.json";
        m_keysPath = userDir / L"keys.json";
        m_snapshotsDir = userDir / L"snapshots";
        std::filesystem::create_directories(m_snapshotsDir, ec);
    } else {
        m_prefsPath = m_appDataDir / L"preferences.json";
        m_profilesPath = m_appDataDir / L"profiles.json";
        m_sessionsPath = m_appDataDir / L"sessions.json";
        m_keysPath = m_appDataDir / L"keys.json";
        m_snapshotsDir = m_appDataDir / L"snapshots";
        std::error_code ecDir;
        std::filesystem::create_directories(m_snapshotsDir, ecDir);
    }

    if (!std::filesystem::exists(m_prefsPath)) {
        json defaultPrefs = GetDefaultPreferences();
        json globalPrefs;
        std::filesystem::path globalPrefsPath = m_appDataDir / L"preferences.json";
        if (m_prefsPath != globalPrefsPath && ReadJsonFile(globalPrefsPath, globalPrefs) && globalPrefs.is_object()) {
            for (auto& [k, v] : globalPrefs.items()) {
                defaultPrefs[k] = v;
            }
        }
        WriteJsonFileAtomic(m_prefsPath, defaultPrefs);
    }
    return true;
}

json StorageManager::GetDefaultPreferences() {
    return {
        { "launchAtLogin", false },
        { "closeToTray", false },
        { "stealthDock", false },
        { "alwaysOnTop", true },
        { "captureProtection", true },
        { "opacity", 1.0 },
        { "chatLayout", "standard" },
        { "interviewLayout", "full" },
        { "lightTextColor", "#24384c" },
        { "darkTextColor", "#e2eaf5" },
        { "restrictedNetwork", false },
        { "localOcr", true },
        { "saveHistory", true },
        { "cloudHistory", true },
        { "cloudScreenshotSync", true },
        { "provider", "openai" },
        { "model", "gpt-4.1-mini" },
        { "localBaseUrl", "http://127.0.0.1:11434/v1" },
        { "language", "en" },
        { "systemPrompt", "You are LensDesk, an intelligent desktop assistant." },
        { "transcriptionProvider", "openai" },
        { "transcriptionModel", "whisper-1" },
        { "captureArchive", {
            { "enabled", false },
            { "directory", "" }
        }},
        { "capture", {
            { "mode", "active" },
            { "displayId", "" }
        }},
        { "mouse", {
            { "enabled", false },
            { "trigger", "middle" },
            { "size", 100 },
            { "opacity", 85 },
            { "holdMs", 0 },
            { "style", "wheel" },
            { "slots", 6 },
            { "mappings", {
                { "1", "getAnswer" },
                { "2", "capture" },
                { "3", "autoType" },
                { "4", "undo" },
                { "5", "hide" },
                { "6", "snip" },
                { "7", "browser" },
                { "8", "settings" }
            }}
        }},
        { "shortcuts", {
            { "toggle", "CommandOrControl+Shift+L" },
            { "hide", "Shift+H" },
            { "capture", "CommandOrControl+Shift+S" },
            { "overlay", "CommandOrControl+Shift+O" },
            { "hideAnswer", "CommandOrControl+Shift+A" },
            { "autoType", "CommandOrControl+Shift+T" },
            { "stopTyping", "CommandOrControl+Alt+Escape" },
            { "clickThrough", "Shift+M" },
            { "browser", "" },
            { "theme", "" },
            { "opacityUp", "" },
            { "opacityDown", "" },
            { "clearLastCapture", "" },
            { "clearCaptures", "" },
            { "cancelAnswer", "" },
            { "shortcuts", "" },
            { "scrollUp", "" },
            { "scrollDown", "" },
            { "moveUp", "" },
            { "moveDown", "" },
            { "moveLeft", "" },
            { "moveRight", "" },
            { "getAnswer", "" },
            { "regionSnip", "" },
            { "undo", "" },
            { "clearBundle", "" },
            { "clearChat", "" },
            { "cycleProvider", "" },
            { "cycleModel", "" },
            { "mouseMode", "" },
            { "stealth", "" },
            { "restart", "" },
            { "quit", "" }
        }},
        { "autoType", {
            { "speed", "human" },
            { "codeOnly", true },
            { "delaySeconds", 1 },
            { "wpm", 65 },
            { "jitter", 0 },
            { "mistakes", 0 },
            { "pauses", 0 }
        }},
        { "browser", {
            { "homePage", "https://www.google.com/" },
            { "searchEngine", "google" },
            { "zoom", 1.0 }
        }}
    };
}

json StorageManager::GetPreferences() {
    std::lock_guard<std::mutex> lock(m_mutex);
    json defaults = GetDefaultPreferences();
    json saved;
    if (ReadJsonFile(m_prefsPath, saved) && saved.is_object()) {
        for (auto& [k, v] : saved.items()) {
            if (v.is_object() && defaults.contains(k) && defaults[k].is_object()) {
                for (auto& [subK, subV] : v.items()) {
                    defaults[k][subK] = subV;
                }
            } else {
                defaults[k] = v;
            }
        }
    }
    return defaults;
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

    if (key.empty()) {
        keys.erase(provider);
        return WriteJsonFileAtomic(m_keysPath, keys);
    }

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

    // Keys are stored as base64(DATA_BLOB) protected with the current
    // Windows user's DPAPI key. Empty or malformed values are treated as
    // "no key" rather than leaking ciphertext to a provider.
    const auto bytes = Base64Decode(enc);
    if (bytes.empty()) return "";
    DATA_BLOB inBlob{};
    inBlob.pbData = const_cast<BYTE*>(bytes.data());
    inBlob.cbData = static_cast<DWORD>(bytes.size());
    DATA_BLOB outBlob{};
    if (!CryptUnprotectData(&inBlob, nullptr, nullptr, nullptr, nullptr,
                            CRYPTPROTECT_UI_FORBIDDEN, &outBlob)) {
        return "";
    }
    std::string plain(reinterpret_cast<char*>(outBlob.pbData), outBlob.cbData);
    LocalFree(outBlob.pbData);
    return plain;
}

bool StorageManager::HasApiKey(const std::string& provider) {
    return !GetApiKey(provider).empty();
}

json StorageManager::GetKeyStatus() {
    json status = {
        { "openai", HasApiKey("openai") },
        { "groq", HasApiKey("groq") },
        { "gemini", HasApiKey("gemini") },
        { "anthropic", HasApiKey("anthropic") },
        { "deepseek", HasApiKey("deepseek") },
        { "local", true }
    };
    return status;
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

bool StorageManager::ClearAllData() {
    std::lock_guard<std::mutex> lock(m_mutex);
    std::error_code ec;
    std::filesystem::remove_all(m_appDataDir, ec);
    return !ec;
}

json StorageManager::CreateBackup() {
    json backup;
    backup["version"] = 1;
    backup["settings"] = GetPreferences();
    backup["profiles"] = GetProfiles();
    backup["sessions"] = GetSessions();
    return backup;
}

bool StorageManager::CreateSnapshot(const std::string& reason, std::string& outSnapshotId) {
    try {
        std::error_code ec;
        std::filesystem::create_directories(m_snapshotsDir, ec);

        const int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        const std::string id = "snap_" + std::to_string(nowMs);
        const std::string nowIso = GetIsoTimestamp();

        json snap = {
            { "id", id },
            { "createdAt", nowIso },
            { "reason", reason },
            { "settings", GetPreferences() },
            { "profiles", GetProfiles() },
            { "sessions", GetSessions() }
        };

        std::filesystem::path snapPath = m_snapshotsDir / Utf8ToWide(id + ".json");
        if (!WriteJsonFileAtomic(snapPath, snap)) {
            return false;
        }
        outSnapshotId = id;

        // Bounded retention: keep at most 10 recovery snapshots
        std::vector<std::pair<std::filesystem::file_time_type, std::filesystem::path>> files;
        for (const auto& entry : std::filesystem::directory_iterator(m_snapshotsDir, ec)) {
            if (entry.is_regular_file() && entry.path().extension() == L".json") {
                files.emplace_back(entry.last_write_time(), entry.path());
            }
        }
        if (files.size() > 10) {
            std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) {
                return a.first > b.first;
            });
            for (size_t i = 10; i < files.size(); ++i) {
                std::filesystem::remove(files[i].second, ec);
            }
        }
        return true;
    } catch (...) {
        return false;
    }
}

json StorageManager::GetSnapshots() {
    std::lock_guard<std::mutex> lock(m_mutex);
    json result = json::array();
    try {
        std::error_code ec;
        if (!std::filesystem::exists(m_snapshotsDir)) return result;

        struct SnapItem {
            std::string id;
            std::string createdAt;
            std::filesystem::file_time_type mtime;
        };
        std::vector<SnapItem> items;

        for (const auto& entry : std::filesystem::directory_iterator(m_snapshotsDir, ec)) {
            if (entry.is_regular_file() && entry.path().extension() == L".json") {
                json snap;
                if (ReadJsonFile(entry.path(), snap) && snap.is_object() && snap.contains("id")) {
                    items.push_back({
                        snap.value("id", ""),
                        snap.value("createdAt", ""),
                        entry.last_write_time()
                    });
                }
            }
        }

        std::sort(items.begin(), items.end(), [](const auto& a, const auto& b) {
            if (!a.createdAt.empty() && !b.createdAt.empty()) {
                return a.createdAt > b.createdAt;
            }
            return a.mtime > b.mtime;
        });

        for (const auto& item : items) {
            result.push_back({
                { "id", item.id },
                { "createdAt", item.createdAt }
            });
        }
    } catch (...) {}
    return result;
}

bool StorageManager::RestoreBackup(const json& backup, std::string& error) {
    if (!backup.is_object()) {
        error = "Backup data must be a JSON object.";
        return false;
    }
    if (backup.value("version", 0) != 1) {
        error = "Unsupported backup version. Expected version 1.";
        return false;
    }
    if (!backup.contains("sessions") || !backup["sessions"].is_array()) {
        error = "Backup missing sessions array.";
        return false;
    }
    if (!backup.contains("profiles") || !backup["profiles"].is_array()) {
        error = "Backup missing profiles array.";
        return false;
    }
    if (!backup.contains("settings") || !backup["settings"].is_object()) {
        error = "Backup missing settings object.";
        return false;
    }

    // 1. Transactional safety: capture pre-restore recovery snapshot
    std::string preSnapshotId;
    if (!CreateSnapshot("Automatic snapshot before backup restore", preSnapshotId)) {
        error = "Failed to create pre-restore recovery snapshot.";
        return false;
    }

    std::lock_guard<std::mutex> lock(m_mutex);
    try {
        // 2. Prepare atomic temporary writes for all target files
        std::filesystem::path tmpPrefs = m_prefsPath; tmpPrefs += L".restore.tmp";
        std::filesystem::path tmpProfiles = m_profilesPath; tmpProfiles += L".restore.tmp";
        std::filesystem::path tmpSessions = m_sessionsPath; tmpSessions += L".restore.tmp";

        bool ok = true;
        {
            std::ofstream f(tmpPrefs);
            if (f.is_open()) f << backup["settings"].dump(2);
            else ok = false;
        }
        {
            std::ofstream f(tmpProfiles);
            if (f.is_open()) f << backup["profiles"].dump(2);
            else ok = false;
        }
        {
            std::ofstream f(tmpSessions);
            if (f.is_open()) f << backup["sessions"].dump(2);
            else ok = false;
        }

        if (!ok) {
            std::error_code ec;
            std::filesystem::remove(tmpPrefs, ec);
            std::filesystem::remove(tmpProfiles, ec);
            std::filesystem::remove(tmpSessions, ec);
            error = "Failed to write temporary restore files.";
            return false;
        }

        // 3. Atomically rename into place
        std::filesystem::rename(tmpPrefs, m_prefsPath);
        std::filesystem::rename(tmpProfiles, m_profilesPath);
        std::filesystem::rename(tmpSessions, m_sessionsPath);

        return true;
    } catch (const std::exception& e) {
        // Rollback protection
        error = std::string("Restore failed: ") + e.what();
        std::string rollbackErr;
        RestoreSnapshot(preSnapshotId, rollbackErr);
        return false;
    }
}

bool StorageManager::RestoreSnapshot(const std::string& snapshotId, std::string& error) {
    if (snapshotId.empty()) {
        error = "Snapshot ID cannot be empty.";
        return false;
    }

    std::filesystem::path snapPath;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        snapPath = m_snapshotsDir / Utf8ToWide(snapshotId + ".json");
    }

    if (!std::filesystem::exists(snapPath)) {
        error = "Recovery snapshot not found.";
        return false;
    }

    json snap;
    if (!ReadJsonFile(snapPath, snap) || !snap.is_object()) {
        error = "Recovery snapshot file is corrupt or invalid.";
        return false;
    }

    if (!snap.contains("settings") || !snap.contains("profiles") || !snap.contains("sessions")) {
        error = "Recovery snapshot missing required workspace data.";
        return false;
    }

    // Capture safety snapshot of current state before replacing
    std::string safetySnapId;
    CreateSnapshot("Pre-snapshot restore safety snapshot", safetySnapId);

    std::lock_guard<std::mutex> lock(m_mutex);
    try {
        std::filesystem::path tmpPrefs = m_prefsPath; tmpPrefs += L".restore.tmp";
        std::filesystem::path tmpProfiles = m_profilesPath; tmpProfiles += L".restore.tmp";
        std::filesystem::path tmpSessions = m_sessionsPath; tmpSessions += L".restore.tmp";

        {
            std::ofstream f(tmpPrefs);
            if (f.is_open()) f << snap["settings"].dump(2);
        }
        {
            std::ofstream f(tmpProfiles);
            if (f.is_open()) f << snap["profiles"].dump(2);
        }
        {
            std::ofstream f(tmpSessions);
            if (f.is_open()) f << snap["sessions"].dump(2);
        }

        std::filesystem::rename(tmpPrefs, m_prefsPath);
        std::filesystem::rename(tmpProfiles, m_profilesPath);
        std::filesystem::rename(tmpSessions, m_sessionsPath);

        return true;
    } catch (const std::exception& e) {
        error = std::string("Failed to restore snapshot: ") + e.what();
        return false;
    }
}

} // namespace LensDesk
