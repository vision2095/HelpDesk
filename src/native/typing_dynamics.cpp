// derived: rea/native/windows/src/authority.hpp
#include "typing_dynamics.h"

namespace LensDesk::Native {

TypingDynamics::TypingDynamics()
    : m_rng(1337)
    // Tier A: mean 200ms, sigma 0.30 -> mu = ln(200) - (0.30^2 / 2) = 5.2533
    , m_tierA{ L",:()[] .", std::lognormal_distribution<double>(std::log(200.0) - (0.30 * 0.30 / 2.0), 0.30) }
    // Tier B: mean 420ms, sigma 0.28 -> mu = ln(420) - (0.28^2 / 2) = 6.0010
    , m_tierB{ L";}{\n", std::lognormal_distribution<double>(std::log(420.0) - (0.28 * 0.28 / 2.0), 0.28) }
    // Base keys: mean 55ms, sigma 0.38 -> mu = ln(55) - (0.38^2 / 2) = 3.9351
    , m_baseDist(std::log(55.0) - (0.38 * 0.38 / 2.0), 0.38)
{
    std::random_device rd;
    m_rng.seed(rd());
}

double TypingDynamics::CalculateDelayMs(wchar_t ch) {
    // Check Tier B (structural boundaries) first
    if (m_tierB.chars.find(ch) != std::wstring::npos) {
        return m_tierB.dist(m_rng);
    }

    // Check Tier A (syntax delimiters)
    if (m_tierA.chars.find(ch) != std::wstring::npos) {
        return m_tierA.dist(m_rng);
    }

    // Base keys: clamped to [10.0, 140.0]
    double sample = m_baseDist(m_rng);
    return std::clamp(sample, 10.0, 140.0);
}

} // namespace LensDesk::Native
