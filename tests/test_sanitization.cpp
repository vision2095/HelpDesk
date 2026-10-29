// derived: rea/native/windows/src/filesystem.cc
#include "../src/native/sanitization.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    // 1. Verify target directory expansion
    auto targets = Sanitization::GetTargetDirectories();
    assert(!targets.empty());

    // 2. Create test sandbox folder and verify 3-pass purge removes it
    std::filesystem::path testDir = targets.front();
    std::filesystem::create_directories(testDir / "cache" / "EBWebView");
    assert(std::filesystem::exists(testDir / "cache" / "EBWebView"));

    bool purged = Sanitization::PerformAtomicPurge(false);
    assert(purged);
    assert(!std::filesystem::exists(testDir / "cache" / "EBWebView"));

    // 3. Process scoping isolation
    size_t killed = Sanitization::TerminateScopedWebViewProcesses(L"NonExistentDirectory_12345");
    assert(killed == 0);

    std::cout << "[PASS] test_sanitization: 5 asserts verified.\n";
    return 0;
}
