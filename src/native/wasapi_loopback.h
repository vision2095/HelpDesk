// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"

namespace LensDesk::Native {

class RingBuffer {
public:
    explicit RingBuffer(size_t capacityBytes = 48000 * 2 * 2 * 10); // 10s of 48kHz 16-bit stereo

    size_t Write(const uint8_t* data, size_t count);
    size_t Drain(uint8_t* destination, size_t maxCount);
    size_t Available() const noexcept;
    size_t Capacity() const noexcept { return m_capacity; }
    void Clear() noexcept;

private:
    std::vector<uint8_t> m_buffer;
    size_t m_capacity = 0;
    std::atomic<size_t> m_head{ 0 };
    std::atomic<size_t> m_tail{ 0 };
};

class WasapiLoopback {
public:
    WasapiLoopback();
    ~WasapiLoopback();

    bool Start();
    void Stop();
    bool IsRunning() const noexcept { return m_running.load(); }
    RingBuffer& GetRingBuffer() noexcept { return m_ring; }

    // Audio session recovery helper: retries up to 8 times on device invalidation
    bool RunCaptureWithRecovery();

private:
    bool InitializeEndpoint();
    void ReleaseInterfaces();

    RingBuffer m_ring;
    std::atomic<bool> m_running{ false };
    std::thread m_thread;

#if defined(_WIN32)
    ComPtr<IMMDeviceEnumerator> m_enumerator;
    ComPtr<IMMDevice> m_device;
    ComPtr<IAudioClient> m_audioClient;
    ComPtr<IAudioCaptureClient> m_captureClient;
    WAVEFORMATEX* m_waveFormat = nullptr;
#endif
};

} // namespace LensDesk::Native
