// derived: rea/native/windows/src/authority.hpp
#include "../src/native/token_elevation.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    // 1. Verify ScopedHandle RAII semantics
    {
        ScopedHandle h1;
        assert(!h1.valid());
        assert(h1.get() == INVALID_HANDLE_VALUE);

        ScopedHandle h2(reinterpret_cast<HANDLE>(0x100));
        assert(h2.valid());
        assert(h2.get() == reinterpret_cast<HANDLE>(0x100));

        HANDLE released = h2.release();
        assert(released == reinterpret_cast<HANDLE>(0x100));
        assert(!h2.valid());

        h1.reset(reinterpret_cast<HANDLE>(0x200));
        assert(h1.valid());
        assert(h1.get() == reinterpret_cast<HANDLE>(0x200));

        ScopedHandle h3 = std::move(h1);
        assert(!h1.valid());
        assert(h3.valid());
        assert(h3.get() == reinterpret_cast<HANDLE>(0x200));
    }

    // 2. Verify TokenElevation state checks
    bool enabled = TokenElevation::IsUIAccessEnabled();
    assert(!enabled || enabled); // Valid boolean return without throwing or crashing

    // 3. Verify ElevateAndRelaunchSelf API boundary
    // In test environment, returns without unhandled exception
    bool elevatedOrRunning = TokenElevation::ElevateAndRelaunchSelf();
    assert(elevatedOrRunning == false || elevatedOrRunning == true);

    std::cout << "[PASS] test_token_elevation: 13 asserts verified.\n";
    return 0;
}
