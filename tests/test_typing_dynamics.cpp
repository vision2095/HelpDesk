// derived: rea/native/windows/src/authority.hpp
#include "../src/native/typing_dynamics.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

int run_test_typing_dynamics() {
    LensDesk::Test::ResetAssertionCounter();

    TypingDynamics td;

    // 1. Verify Tier A named struct parameters
    const auto& tierA = td.GetTierA();
    CHECK(tierA.targetMeanMs == 200.0);
    CHECK(tierA.sigma == 0.30);
    CHECK(tierA.characters.find(L',') != std::wstring::npos);
    CHECK(tierA.characters.find(L':') != std::wstring::npos);
    CHECK(tierA.characters.find(L'(') != std::wstring::npos);
    CHECK(tierA.characters.find(L')') != std::wstring::npos);
    CHECK(tierA.characters.find(L'[') != std::wstring::npos);
    CHECK(tierA.characters.find(L']') != std::wstring::npos);
    CHECK(tierA.characters.find(L'.') != std::wstring::npos);

    // 2. Verify Tier B named struct parameters
    const auto& tierB = td.GetTierB();
    CHECK(tierB.targetMeanMs == 420.0);
    CHECK(tierB.sigma == 0.28);
    CHECK(tierB.characters.find(L';') != std::wstring::npos);
    CHECK(tierB.characters.find(L'}') != std::wstring::npos);
    CHECK(tierB.characters.find(L'{') != std::wstring::npos);
    CHECK(tierB.characters.find(L'\n') != std::wstring::npos);

    // 3. Verify Base Tier parameters
    const auto& baseTier = td.GetBaseTier();
    CHECK(baseTier.targetMeanMs == 55.0);
    CHECK(baseTier.sigma == 0.38);

    // 4. Sample and verify non-zero positive delays
    double commaDelay = td.CalculateDelayMs(L',');
    CHECK(commaDelay > 0.0);

    double semicolonDelay = td.CalculateDelayMs(L';');
    CHECK(semicolonDelay > 0.0);

    // 5. Mutation check: Base key clamping MUST strictly satisfy [10.0, 140.0]
    for (int i = 0; i < 100; ++i) {
        double baseDelay = td.CalculateDelayMs(L'x');
        // Mutation assertion: if clamping is omitted or mutated, samples will violate this range
        CHECK(baseDelay >= 10.0 && baseDelay <= 140.0);
    }

    std::cout << "[PASS] test_typing_dynamics: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_typing_dynamics();
}
#endif
