// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"

namespace LensDesk::Native {

class TokenElevation {
public:
    static bool IsUIAccessEnabled();
    static bool ElevateAndRelaunchSelf();
};

} // namespace LensDesk::Native
