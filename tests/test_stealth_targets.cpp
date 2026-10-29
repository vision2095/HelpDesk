// derived: rea/native/windows/src/authority.hpp
#include "../src/native/stealth_targets.h"
#include "../src/native/layout_watchdog.h"
#include "test_common.h"
#include <fstream>
#include <iostream>

using namespace LensDesk::Native;

int run_test_stealth_targets() {
    LensDesk::Test::ResetAssertionCounter();

    StealthTargets::ResetState();

    // 1. Validation security checks: Basename, .exe extension, traversal rejection
    CHECK(StealthTargets::IsValidTargetName("ProProctor.exe"));
    CHECK(StealthTargets::IsValidTargetName("proctoru.exe"));
    CHECK(StealthTargets::IsValidTargetName("LockDownBrowserOEM.exe"));

    // Traversal or path separators MUST be rejected
    CHECK(!StealthTargets::IsValidTargetName("..\\evil.exe"));
    CHECK(!StealthTargets::IsValidTargetName("../evil.exe"));
    CHECK(!StealthTargets::IsValidTargetName("C:\\evil.exe"));
    CHECK(!StealthTargets::IsValidTargetName("subdir/test.exe"));
    CHECK(!StealthTargets::IsValidTargetName("test.dll"));
    CHECK(!StealthTargets::IsValidTargetName("toolong_toolong_toolong_toolong_toolong_toolong_toolong_toolong_toolong.exe")); // > 64 chars

    // 2. ValidateAndMerge tests: Malformed JSON leaves list unchanged
    std::vector<std::wstring> initialTargets = { L"default.exe" };
    std::vector<std::wstring> workingList = initialTargets;

    // Malformed JSON (syntax error, missing brackets)
    CHECK(!StealthTargets::ValidateAndMerge("INVALID_JSON", workingList));
    CHECK(workingList == initialTargets); // Unchanged

    CHECK(!StealthTargets::ValidateAndMerge("{\"targets\": \"not-an-array\"}", workingList));
    CHECK(workingList == initialTargets); // Unchanged

    // Payload containing traversal `..\evil.exe` should reject the evil item
    std::string traversalPayload = "{\"version\":1,\"targets\":[\"Safe.exe\",\"..\\\\evil.exe\",\"/bad/path.exe\"]}";
    CHECK(StealthTargets::ValidateAndMerge(traversalPayload, workingList));
    CHECK(workingList.size() == 1);
    CHECK(workingList[0] == L"safe.exe");

    // Deduplication and capping at 64 entries
    std::string bigPayload = "{\"version\":1,\"targets\":[";
    for (int i = 0; i < 100; ++i) {
        if (i > 0) bigPayload += ",";
        bigPayload += "\"app" + std::to_string(i) + ".exe\"";
    }
    bigPayload += "]}";

    std::vector<std::wstring> cappedList;
    CHECK(StealthTargets::ValidateAndMerge(bigPayload, cappedList));
    CHECK(cappedList.size() == 64); // Strict 64 cap

    // 3. Cache-hit path vs Expired cache
    std::filesystem::path testCachePath = std::filesystem::temp_directory_path() / "test_stealth_targets_cache.json";
    std::error_code ec;
    std::filesystem::remove(testCachePath, ec);

    int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();

    // Write fresh cache file (age = 1 hour < 24h TTL)
    {
        std::ofstream out(testCachePath);
        out << "{\"version\":1,\"fetchedAt\":" << (now - 3600000)
            << ",\"targets\":[\"cachedproctor.exe\",\"cachedexam.exe\"]}";
    }

    auto cacheHitResult = StealthTargets::LoadFromCacheSynchronous(testCachePath);
    CHECK(cacheHitResult.fromCache); // Fast path: cache hit
    CHECK(!cacheHitResult.networkRefreshed);
    CHECK(cacheHitResult.targetCount == 2);
    CHECK(LayoutWatchdog::IsConstrainedProctorProcess(L"cachedproctor.exe"));

    // Write expired cache file (age = 25 hours > 24h TTL)
    {
        std::ofstream out(testCachePath);
        out << "{\"version\":1,\"fetchedAt\":" << (now - 25LL * 3600 * 1000)
            << ",\"targets\":[\"expiredproctor.exe\"]}";
    }

    StealthTargets::ResetState();
    auto expiredResult = StealthTargets::LoadFromCacheSynchronous(testCachePath);
    CHECK(!expiredResult.fromCache); // Expired cache does not take fast path

    // Cleanup test file
    std::filesystem::remove(testCachePath, ec);

    std::cout << "[PASS] test_stealth_targets: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_stealth_targets();
}
#endif
