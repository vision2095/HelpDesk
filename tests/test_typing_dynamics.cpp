// derived: rea/native/windows/src/authority.hpp
#include "../src/native/typing_dynamics.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    TypingDynamics td;

    // 1. Verify Tier A characters and distribution properties
    const auto& tierA = td.GetTierA();
    assert(tierA.chars.find(L',') != std::wstring::npos);
    assert(tierA.chars.find(L':') != std::wstring::npos);
    assert(tierA.chars.find(L'(') != std::wstring::npos);
    assert(tierA.chars.find(L')') != std::wstring::npos);
    assert(tierA.chars.find(L'[') != std::wstring::npos);
    assert(tierA.chars.find(L']') != std::wstring::npos);
    assert(tierA.chars.find(L'.') != std::wstring::npos);

    // 2. Verify Tier B characters and distribution properties
    const auto& tierB = td.GetTierB();
    assert(tierB.chars.find(L';') != std::wstring::npos);
    assert(tierB.chars.find(L'}') != std::wstring::npos);
    assert(tierB.chars.find(L'{') != std::wstring::npos);
    assert(tierB.chars.find(L'\n') != std::wstring::npos);

    // 3. Sample Delays
    double commaDelay = td.CalculateDelayMs(L',');
    assert(commaDelay > 0.0);

    double semicolonDelay = td.CalculateDelayMs(L';');
    assert(semicolonDelay > 0.0);

    // 4. Base key clamping verification
    for (int i = 0; i < 50; ++i) {
        double baseDelay = td.CalculateDelayMs(L'a');
        assert(baseDelay >= 10.0 && baseDelay <= 140.0);
    }

    std::cout << "[PASS] test_typing_dynamics: 14 asserts verified.\n";
    return 0;
}
