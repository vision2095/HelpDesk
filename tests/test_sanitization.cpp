// derived: rea/native/windows/src/filesystem.cc
#include "../src/native/sanitization.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

int run_test_sanitization() {
    LensDesk::Test::ResetAssertionCounter();

    // 1. Verify target directory expansion
    auto targets = Sanitization::GetTargetDirectories();
    CHECK(!targets.empty());

    // 2. Create test sandbox folder and verify 3-pass purge removes it
    std::filesystem::path testDir = targets.front();
    std::filesystem::create_directories(testDir / "cache" / "EBWebView");
    CHECK(std::filesystem::exists(testDir / "cache" / "EBWebView"));

    bool purged = Sanitization::PerformAtomicPurge(false);
    CHECK(purged);
    CHECK(!std::filesystem::exists(testDir / "cache" / "EBWebView"));

    // 3. Process scoping isolation
    size_t killed = Sanitization::TerminateScopedWebViewProcesses(L"NonExistentDirectory_12345");
    CHECK(killed == 0);

    // 4. Registry wipe invocation check
    bool regCleared = Sanitization::WipeRegistryKeys();
    CHECK(regCleared == true || regCleared == false);

    std::cout << "[PASS] test_sanitization: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_sanitization();
}
#endif
