// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"
#include <chrono>

namespace LensDesk::Native {

struct StealthSyncResult {
    bool fromCache = false;
    bool networkRefreshed = false;
    size_t targetCount = 0;
};

class StealthTargets {
public:
    static constexpr int64_t TTL_MS = 24LL * 60 * 60 * 1000; // 24 hours

    // Synchronous fast path on startup
    static StealthSyncResult LoadFromCacheSynchronous(const std::filesystem::path& cacheFilePath = GetDefaultCachePath());

    // Validate a single target string according to strict security criteria
    static bool IsValidTargetName(std::string_view name);

    // Validate and merge JSON payload
    static bool ValidateAndMerge(const std::string& jsonString, std::vector<std::wstring>& outTargets);

    // Asynchronous refresh trigger
    static void TriggerAsyncRefresh(const std::wstring& endpointUrl, const std::filesystem::path& cacheFilePath = GetDefaultCachePath());

    // Current in-memory active targets
    static std::vector<std::wstring> GetActiveTargets();

    // Default cache file path (%LOCALAPPDATA%\LensDesk\stealth-targets.json)
    static std::filesystem::path GetDefaultCachePath();

    // Reset in-memory state (for unit tests)
    static void ResetState();
};

} // namespace LensDesk::Native
