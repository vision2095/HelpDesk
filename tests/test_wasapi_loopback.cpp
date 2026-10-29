// derived: rea/native/windows/src/authority.hpp
#include "../src/native/wasapi_loopback.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    // 1. Verify RingBuffer SPSC semantics
    {
        RingBuffer rb(64);
        assert(rb.Capacity() == 64);
        assert(rb.Available() == 0);

        uint8_t writeData[16] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
        size_t written = rb.Write(writeData, 16);
        assert(written == 16);
        assert(rb.Available() == 16);

        uint8_t readData[16]{};
        size_t drained = rb.Drain(readData, 16);
        assert(drained == 16);
        assert(rb.Available() == 0);
        for (int i = 0; i < 16; ++i) {
            assert(readData[i] == writeData[i]);
        }

        // Test wrap-around boundary condition
        std::vector<uint8_t> bulk(50, 0xAA);
        written = rb.Write(bulk.data(), bulk.size());
        assert(written == 50);

        std::vector<uint8_t> outBulk(30);
        drained = rb.Drain(outBulk.data(), 30);
        assert(drained == 30);
        assert(rb.Available() == 20);

        written = rb.Write(bulk.data(), 40);
        assert(written == 40); // 20 + 40 = 60 <= 64
        assert(rb.Available() == 60);

        rb.Clear();
        assert(rb.Available() == 0);
    }

    // 2. Verify WasapiLoopback lifecycle
    WasapiLoopback loopback;
    assert(!loopback.IsRunning());

    loopback.Start();
    assert(loopback.IsRunning());

    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    assert(loopback.GetRingBuffer().Capacity() > 0);

    loopback.Stop();
    assert(!loopback.IsRunning());

    std::cout << "[PASS] test_wasapi_loopback: 17 asserts verified.\n";
    return 0;
}
