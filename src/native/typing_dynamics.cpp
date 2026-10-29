// derived: rea/native/windows/src/authority.hpp
#include "typing_dynamics.h"

namespace LensDesk::Native {

TypingDynamics::TypingDynamics()
    : m_rd()
    , m_rng(m_rd())
    , m_tierA(L",:()[] .", 200.0, 0.30)
    , m_tierB(L";}{\n", 420.0, 0.28)
    , m_baseTier(L"", 55.0, 0.38)
{
}

double TypingDynamics::CalculateDelayMs(wchar_t ch) {
    // 1. Structural Boundaries (Tier B: mean 420ms, sigma 0.28)
    if (m_tierB.characters.find(ch) != std::wstring::npos) {
        return m_tierB.distribution(m_rng);
    }

    // 2. Syntax Delimiters (Tier A: mean 200ms, sigma 0.30)
    if (m_tierA.characters.find(ch) != std::wstring::npos) {
        return m_tierA.distribution(m_rng);
    }

    // 3. Base Keystrokes (mean 55ms, sigma 0.38 clamped [10, 140])
    double sample = m_baseTier.distribution(m_rng);
    return std::clamp(sample, 10.0, 140.0);
}

} // namespace LensDesk::Native
