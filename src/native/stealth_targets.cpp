// derived: rea/native/windows/src/authority.hpp
#include "stealth_targets.h"
#include "layout_watchdog.h"
#include <fstream>
#include <sstream>
#include <set>

namespace LensDesk::Native {

namespace {
    std::mutex g_targetsSyncMutex;
    std::vector<std::wstring> g_cachedActiveTargets;
    int64_t g_lastFetchedAt = 0;

    int64_t CurrentTimeMs() {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count();
    }
}

std::filesystem::path StealthTargets::GetDefaultCachePath() {
#if defined(_WIN32)
    wchar_t* localAppData = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))) {
        std::filesystem::path p = std::filesystem::path(localAppData) / L"LensDesk" / L"stealth-targets.json";
        CoTaskMemFree(localAppData);
        return p;
    }
    return L"C:\\ProgramData\\LensDesk\\stealth-targets.json";
#else
    const char* home = std::getenv("HOME");
    return std::filesystem::path(home ? home : "/tmp") / ".lensdesk_test" / "stealth-targets.json";
#endif
}

void StealthTargets::ResetState() {
    std::lock_guard<std::mutex> lk(g_targetsSyncMutex);
    g_cachedActiveTargets.clear();
    g_lastFetchedAt = 0;
    LayoutWatchdog::SetDynamicTargets({});
}

std::vector<std::wstring> StealthTargets::GetActiveTargets() {
    std::lock_guard<std::mutex> lk(g_targetsSyncMutex);
    if (!g_cachedActiveTargets.empty()) {
        return g_cachedActiveTargets;
    }
    return LayoutWatchdog::GetConstrainedProctorList();
}

bool StealthTargets::IsValidTargetName(std::string_view name) {
    if (name.size() < 5 || name.size() > 64) {
        return false;
    }
    // Reject directory traversal or path separators
    if (name.find('/') != std::string_view::npos ||
        name.find('\\') != std::string_view::npos ||
        name.find(':') != std::string_view::npos) {
        return false;
    }

    // Must end in .exe (case-insensitive)
    std::string lowerName;
    lowerName.reserve(name.size());
    for (char c : name) {
        lowerName.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }

    if (lowerName.size() < 4 || lowerName.substr(lowerName.size() - 4) != ".exe") {
        return false;
    }

    return true;
}

bool StealthTargets::ValidateAndMerge(const std::string& jsonString, std::vector<std::wstring>& outTargets) {
    if (jsonString.empty()) return false;

    // Lightweight streaming JSON parser for "targets": ["...", "..."]
    size_t targetsPos = jsonString.find("\"targets\"");
    if (targetsPos == std::string::npos) return false;

    size_t openBracket = jsonString.find('[', targetsPos);
    size_t closeBracket = jsonString.find(']', openBracket);
    if (openBracket == std::string::npos || closeBracket == std::string::npos || closeBracket <= openBracket) {
        return false;
    }

    std::string arrayContent = jsonString.substr(openBracket + 1, closeBracket - openBracket - 1);
    std::vector<std::wstring> parsedList;
    std::set<std::wstring> dedupeSet;

    std::stringstream ss(arrayContent);
    std::string token;
    while (std::getline(ss, token, ',')) {
        size_t firstQuote = token.find('"');
        size_t lastQuote = token.rfind('"');
        if (firstQuote != std::string::npos && lastQuote != std::string::npos && lastQuote > firstQuote) {
            std::string item = token.substr(firstQuote + 1, lastQuote - firstQuote - 1);
            if (IsValidTargetName(item)) {
                std::wstring witem;
                for (char c : item) {
                    witem.push_back(static_cast<wchar_t>(std::tolower(static_cast<unsigned char>(c))));
                }
                if (dedupeSet.insert(witem).second) {
                    parsedList.push_back(witem);
                    if (parsedList.size() >= 64) {
                        break; // Cap 64 entries
                    }
                }
            }
        }
    }

    if (parsedList.empty()) {
        return false; // Bad payload keeps existing list
    }

    outTargets = std::move(parsedList);
    return true;
}

StealthSyncResult StealthTargets::LoadFromCacheSynchronous(const std::filesystem::path& cacheFilePath) {
    StealthSyncResult res;

    std::lock_guard<std::mutex> lk(g_targetsSyncMutex);
    std::error_code ec;
    if (!std::filesystem::exists(cacheFilePath, ec)) {
        res.fromCache = false;
        res.targetCount = LayoutWatchdog::GetConstrainedProctorList().size();
        return res;
    }

    std::ifstream inFile(cacheFilePath);
    if (!inFile.is_open()) {
        res.fromCache = false;
        return res;
    }

    std::stringstream buf;
    buf << inFile.rdbuf();
    std::string content = buf.str();

    // Parse fetchedAt
    int64_t fetchedAt = 0;
    size_t fetchPos = content.find("\"fetchedAt\"");
    if (fetchPos != std::string::npos) {
        size_t colon = content.find(':', fetchPos);
        if (colon != std::string::npos) {
            fetchedAt = std::strtoll(content.c_str() + colon + 1, nullptr, 10);
        }
    }

    int64_t now = CurrentTimeMs();
    if (fetchedAt > 0 && (now - fetchedAt) >= 0 && (now - fetchedAt) < TTL_MS) {
        // Cache hit (TTL 24h valid) - does NOT hit network
        std::vector<std::wstring> validTargets;
        if (ValidateAndMerge(content, validTargets)) {
            g_cachedActiveTargets = validTargets;
            g_lastFetchedAt = fetchedAt;
            LayoutWatchdog::SetDynamicTargets(validTargets);
            res.fromCache = true;
            res.networkRefreshed = false;
            res.targetCount = validTargets.size();
            return res;
        }
    }

    // Expired or invalid cache
    res.fromCache = false;
    res.networkRefreshed = false;
    res.targetCount = LayoutWatchdog::GetConstrainedProctorList().size();
    return res;
}

void StealthTargets::TriggerAsyncRefresh(const std::wstring& /*endpointUrl*/, const std::filesystem::path& cacheFilePath) {
    std::thread([cacheFilePath]() {
        // Mock / worker async fetch implementation
        int64_t now = CurrentTimeMs();
        std::string mockPayload = "{\"version\":1,\"fetchedAt\":" + std::to_string(now) + ",\"targets\":[\"ProProctor.exe\",\"Proctortrack.exe\",\"ProctorU.exe\",\"LockDownBrowser.exe\"]}";

        std::vector<std::wstring> merged;
        if (ValidateAndMerge(mockPayload, merged)) {
            std::lock_guard<std::mutex> lk(g_targetsSyncMutex);
            g_cachedActiveTargets = merged;
            g_lastFetchedAt = now;
            LayoutWatchdog::SetDynamicTargets(merged);

            std::error_code ec;
            std::filesystem::create_directories(cacheFilePath.parent_path(), ec);
            std::ofstream outFile(cacheFilePath);
            if (outFile.is_open()) {
                outFile << mockPayload;
            }
        }
    }).detach();
}

} // namespace LensDesk::Native
