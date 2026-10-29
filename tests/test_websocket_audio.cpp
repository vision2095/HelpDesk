// derived: rea/native/windows/src/authority.hpp
#include "../src/native/websocket_audio_sink.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

class MockAudioSink : public IAudioSink {
public:
    bool shouldOpenSucceed = true;
    bool shouldSendSucceed = true;
    bool closeStatusQueried = false;
    bool isClosed = false;

    int openCount = 0;
    int sendCount = 0;
    int closeCount = 0;

    std::vector<std::vector<uint8_t>> sentFrames;

    bool Open(const wchar_t* /*url*/) override {
        openCount++;
        if (shouldOpenSucceed) {
            isClosed = false;
            return true;
        }
        return false;
    }

    bool Send(const uint8_t* p, size_t n) override {
        sendCount++;
        if (shouldSendSucceed && !isClosed) {
            sentFrames.emplace_back(p, p + n);
            return true;
        }
        return false;
    }

    void Close() override {
        closeCount++;
        isClosed = true;
    }

    bool QueryCloseStatus(USHORT* outStatus = nullptr) override {
        if (outStatus) *outStatus = closeStatusQueried ? 1000 : 0;
        return closeStatusQueried;
    }
};

int run_test_websocket_audio() {
    LensDesk::Test::ResetAssertionCounter();

    // 1. Pop wrap-around test proving zero frame loss across buffer wrap boundary
    {
        RingBuffer rb(64);
        CHECK(rb.Capacity() == 64);

        // Fill with initial 40 bytes
        std::vector<uint8_t> bulk1(40);
        for (size_t i = 0; i < 40; ++i) bulk1[i] = static_cast<uint8_t>(i);
        size_t written = rb.Write(bulk1.data(), 40);
        CHECK(written == 40);

        // Drain/Pop 30 bytes to advance tail towards end
        std::vector<uint8_t> out1(30);
        size_t popped = rb.Pop(out1.data(), 30);
        CHECK(popped == 30);
        CHECK(rb.Available() == 10);

        // Write 40 more bytes which forces head wrap around boundary
        std::vector<uint8_t> bulk2(40);
        for (size_t i = 0; i < 40; ++i) bulk2[i] = static_cast<uint8_t>(100 + i);
        written = rb.Write(bulk2.data(), 40);
        CHECK(written == 40);
        CHECK(rb.Available() == 50);

        // Pop all 50 bytes across the wrap-around boundary and verify bytes
        std::vector<uint8_t> out2(50);
        popped = rb.Pop(out2.data(), 50);
        CHECK(popped == 50);
        CHECK(rb.Available() == 0);

        // First 10 bytes match bulk1[30..39]
        for (size_t i = 0; i < 10; ++i) {
            CHECK(out2[i] == bulk1[30 + i]);
        }
        // Remaining 40 bytes match bulk2[0..39]
        for (size_t i = 0; i < 40; ++i) {
            CHECK(out2[10 + i] == bulk2[i]);
        }
    }

    // 2. WaitForData test
    {
        RingBuffer rb(64);
        CHECK(!rb.WaitForData(5)); // Empty buffer returns false on timeout
        uint8_t oneByte = 42;
        rb.Write(&oneByte, 1);
        CHECK(rb.WaitForData(5));  // Returns true immediately when data available
    }

    // 3. State-machine unit test against MockAudioSink:
    // Open-fail -> backoff -> open-ok -> send-ok -> close-status -> reconnect
    {
        RingBuffer ring(1024);
        auto mock = std::make_shared<MockAudioSink>();
        WebSocketAudioSender sender(ring, mock);

        // Phase 1: Open fails -> verifies exponential backoff ladder
        mock->shouldOpenSucceed = false;
        CHECK(!sender.StepOnce());
        CHECK(sender.GetBackoffLevel() == 1);
        CHECK(sender.GetBackoffMs() == 500);

        CHECK(!sender.StepOnce());
        CHECK(sender.GetBackoffLevel() == 2);
        CHECK(sender.GetBackoffMs() == 1000);

        CHECK(!sender.StepOnce());
        CHECK(sender.GetBackoffLevel() == 3);
        CHECK(sender.GetBackoffMs() == 2000);

        CHECK(!sender.StepOnce());
        CHECK(sender.GetBackoffLevel() == 4);
        CHECK(sender.GetBackoffMs() == 4000);

        CHECK(!sender.StepOnce());
        CHECK(sender.GetBackoffLevel() == 5);
        CHECK(sender.GetBackoffMs() == 10000); // Capped at 10s

        // 3 consecutive full backoffs triggers error state without killing host
        CHECK(!sender.StepOnce()); // 1st full
        CHECK(!sender.StepOnce()); // 2nd full
        CHECK(!sender.StepOnce()); // 3rd full -> surfaces error state
        CHECK(sender.HasErrorState());

        // Phase 2: Open succeeds -> resets backoff and error state
        mock->shouldOpenSucceed = true;
        CHECK(sender.StepOnce());
        CHECK(sender.GetBackoffLevel() == 0);
        CHECK(sender.GetBackoffMs() == 0);
        CHECK(!sender.HasErrorState());

        // Phase 3: Push PCM audio into ring and verify Send + Frame Header
        uint8_t testPcm[100];
        for (int i = 0; i < 100; ++i) testPcm[i] = static_cast<uint8_t>(i);
        ring.Write(testPcm, 100);

        CHECK(sender.StepOnce()); // Pops and sends
        CHECK(mock->sendCount == 1);
        CHECK(mock->sentFrames.size() == 1);

        // Assert 16-byte header fields
        const auto& sentRaw = mock->sentFrames[0];
        CHECK(sentRaw.size() == sizeof(AudioFrameHeader) + 100);

        AudioFrameHeader header;
        std::memcpy(&header, sentRaw.data(), sizeof(AudioFrameHeader));
        CHECK(header.magic == 0x5341444C); // 'LDAS'
        CHECK(header.sampleRate == 48000);
        CHECK(header.channels == 2);
        CHECK(header.byteCount == 100);
        CHECK(header.seq == 0);

        // Phase 4: Second send verifies monotonic sequence increment
        ring.Write(testPcm, 50);
        CHECK(sender.StepOnce());
        CHECK(mock->sendCount == 2);
        AudioFrameHeader header2;
        std::memcpy(&header2, mock->sentFrames[1].data(), sizeof(AudioFrameHeader));
        CHECK(header2.seq == 1); // Monotonic increment: 0 -> 1

        // Phase 5: Remote close status detected -> triggers close and marks disconnected
        mock->closeStatusQueried = true;
        CHECK(!sender.StepOnce()); // Disconnects
        CHECK(mock->closeCount >= 1);

        // Phase 6: Next step reconnects cleanly
        mock->closeStatusQueried = false;
        CHECK(sender.StepOnce()); // Reconnects
        CHECK(mock->openCount > 1);
    }

    std::cout << "[PASS] test_websocket_audio: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_websocket_audio();
}
#endif
