// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"

namespace LensDesk::Native {

struct HesitationTier {
    std::wstring chars;
    std::lognormal_distribution<double> dist;
};

class TypingDynamics {
public:
    TypingDynamics();

    double CalculateDelayMs(wchar_t ch);
    const HesitationTier& GetTierA() const noexcept { return m_tierA; }
    const HesitationTier& GetTierB() const noexcept { return m_tierB; }
    const std::lognormal_distribution<double>& GetBaseDist() const noexcept { return m_baseDist; }

private:
    std::mt19937 m_rng;
    HesitationTier m_tierA; // , : ( ) [ ] . -> mean 200 ms, sigma 0.30
    HesitationTier m_tierB; // ; } { \n     -> mean 420 ms, sigma 0.28
    std::lognormal_distribution<double> m_baseDist; // base -> mean 55 ms, sigma 0.38 clamped [10, 140]
};

} // namespace LensDesk::Native
