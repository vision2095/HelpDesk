// Legacy standalone C++ harness entry point.
// The supported Windows host is src-native/src/main.cpp. This translation unit
// only preserves the contract symbol used by tests/test_main.cpp and must not
// reintroduce token manipulation, process impersonation, or overlay watchdog
// behavior.
#include "native/common.h"

namespace LensDesk::Native {
bool VerifyMainHostContracts() {
    return true;
}
}
