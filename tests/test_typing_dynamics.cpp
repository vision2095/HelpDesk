// derived: rea/native/windows/src/authority.hpp
#include "../src/native/typing_dynamics.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    TypingDynamics td;

    // 1. Verify Tier A named struct parameters
    const auto& tierA = td.GetTierA();
    assert(tierA.targetMeanMs == 200.0);
    assert(tierA.sigma == 0.30);
    assert(tierA.characters.find(L',') != std::wstring::npos);
    assert(tierA.characters.find(L':') != std::wstring::npos);
    assert(tierA.characters.find(L'(') != std::wstring::npos);
    assert(tierA.characters.find(L')') != std::wstring::npos);
    assert(tierA.characters.find(L'[') != std::wstring::npos);
    assert(tierA.characters.find(L']') != std::wstring::npos);
    assert(tierA.characters.find(L'.') != std::wstring::npos);

    // 2. Verify Tier B named struct parameters
    const auto& tierB = td.GetTierB();
    assert(tierB.targetMeanMs == 420.0);
    assert(tierB.sigma == 0.28);
    assert(tierB.characters.find(L';') != std::wstring::npos);
    assert(tierB.characters.find(L'}') != std::wstring::npos);
    assert(tierB.characters.find(L'{') != std::wstring::npos);
    assert(tierB.characters.find(L'\n') != std::wstring::npos);

    // 3. Verify Base Tier parameters
    const auto& baseTier = td.GetBaseTier();
    assert(baseTier.targetMeanMs == 55.0);
    assert(baseTier.sigma == 0.38);

    // 4. Sample and verify non-zero positive delays
    double commaDelay = td.CalculateDelayMs(L',');
    assert(commaDelay > 0.0);

    double semicolonDelay = td.CalculateDelayMs(L';');
    assert(semicolonDelay > 0.0);

    // 5. Mutation check: Base key clamping MUST strictly satisfy [10.0, 140.0]
    for (int i = 0; i < 100; ++i) {
        double baseDelay = td.CalculateDelayMs(L'x');
        // Mutation assertion: if clamping is omitted or mutated, samples will violate this range
        assert(baseDelay >= 10.0 && baseDelay <= 140.0);
    }

    std::cout << "[PASS] test_typing_dynamics: 20 asserts verified.\n";
    return 0;
}
