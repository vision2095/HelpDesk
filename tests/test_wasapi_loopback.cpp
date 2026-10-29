// derived: rea/native/windows/src/authority.hpp
#include "../src/native/wasapi_loopback.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

int run_test_wasapi_loopback() {
    LensDesk::Test::ResetAssertionCounter();

    // 1. Verify RingBuffer SPSC semantics
    {
        RingBuffer rb(64);
        CHECK(rb.Capacity() == 64);
        CHECK(rb.Available() == 0);

        uint8_t writeData[16] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
        size_t written = rb.Write(writeData, 16);
        CHECK(written == 16);
        CHECK(rb.Available() == 16);

        uint8_t readData[16]{};
        size_t drained = rb.Drain(readData, 16);
        CHECK(drained == 16);
        CHECK(rb.Available() == 0);
        for (int i = 0; i < 16; ++i) {
            CHECK(readData[i] == writeData[i]);
        }

        // Test wrap-around boundary condition
        std::vector<uint8_t> bulk(50, 0xAA);
        written = rb.Write(bulk.data(), bulk.size());
        CHECK(written == 50);

        std::vector<uint8_t> outBulk(30);
        drained = rb.Drain(outBulk.data(), 30);
        CHECK(drained == 30);
        CHECK(rb.Available() == 20);

        written = rb.Write(bulk.data(), 40);
        CHECK(written == 40); // 20 + 40 = 60 <= 64
        CHECK(rb.Available() == 60);

        rb.Clear();
        CHECK(rb.Available() == 0);
    }

    // 2. Verify WasapiLoopback lifecycle
    WasapiLoopback loopback;
    CHECK(!loopback.IsRunning());

    loopback.Start();
    CHECK(loopback.IsRunning());

    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    CHECK(loopback.GetRingBuffer().Capacity() > 0);

    loopback.Stop();
    CHECK(!loopback.IsRunning());

    std::cout << "[PASS] test_wasapi_loopback: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_wasapi_loopback();
}
#endif
