// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"

namespace LensDesk::Native {

struct LognormalTier {
    std::wstring characters;
    double targetMeanMs = 0.0;
    double sigma = 0.0;
    std::lognormal_distribution<double> distribution;

    LognormalTier(std::wstring chars, double mean, double s)
        : characters(std::move(chars))
        , targetMeanMs(mean)
        , sigma(s)
        , distribution(std::log(mean) - (s * s / 2.0), s)
    {
    }
};

class TypingDynamics {
public:
    TypingDynamics();

    double CalculateDelayMs(wchar_t ch);

    const LognormalTier& GetTierA() const noexcept { return m_tierA; }
    const LognormalTier& GetTierB() const noexcept { return m_tierB; }
    const LognormalTier& GetBaseTier() const noexcept { return m_baseTier; }

private:
    std::random_device m_rd;
    std::mt19937 m_rng;

    // Named lognormal tiers with explicit mean and sigma parameters
    LognormalTier m_tierA;    // Delimiters: , : ( ) [ ] . -> mean 200ms, sigma 0.30
    LognormalTier m_tierB;    // Structural boundaries: ; } { \n -> mean 420ms, sigma 0.28
    LognormalTier m_baseTier; // Base keys -> mean 55ms, sigma 0.38, clamped [10, 140]
};

} // namespace LensDesk::Native
