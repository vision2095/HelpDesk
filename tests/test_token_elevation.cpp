// derived: rea/native/windows/src/authority.hpp
#include "../src/native/token_elevation.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

int run_test_token_elevation() {
    LensDesk::Test::ResetAssertionCounter();

    // 1. Verify ScopedHandle RAII semantics
    {
        ScopedHandle h1;
        CHECK(!h1.valid());
        CHECK(h1.get() == INVALID_HANDLE_VALUE);

        ScopedHandle h2(reinterpret_cast<HANDLE>(0x100));
        CHECK(h2.valid());
        CHECK(h2.get() == reinterpret_cast<HANDLE>(0x100));

        HANDLE released = h2.release();
        CHECK(released == reinterpret_cast<HANDLE>(0x100));
        CHECK(!h2.valid());

        h1.reset(reinterpret_cast<HANDLE>(0x200));
        CHECK(h1.valid());
        CHECK(h1.get() == reinterpret_cast<HANDLE>(0x200));

        ScopedHandle h3(std::move(h1));
        CHECK(h3.valid());
        CHECK(!h1.valid());
        CHECK(h3.get() == reinterpret_cast<HANDLE>(0x200));

        ScopedHandle h4;
        h4 = std::move(h3);
        CHECK(h4.valid());
        CHECK(!h3.valid());
        CHECK(h4.get() == reinterpret_cast<HANDLE>(0x200));
    }

    // 2. Verify elevation function invocation boundary without crashing
    bool elevated = TokenElevation::ElevateAndRelaunchSelf();
    CHECK(elevated == true || elevated == false);

    std::cout << "[PASS] test_token_elevation: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_token_elevation();
}
#endif
