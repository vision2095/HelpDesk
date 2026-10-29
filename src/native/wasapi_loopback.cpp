// derived: rea/native/windows/src/authority.hpp
#include "wasapi_loopback.h"

namespace LensDesk::Native {

RingBuffer::RingBuffer(size_t capacityBytes)
    : m_buffer(capacityBytes + 1)
    , m_capacity(capacityBytes)
    , m_head(0)
    , m_tail(0)
{
}

void RingBuffer::Clear() noexcept {
    m_head.store(0);
    m_tail.store(0);
}

size_t RingBuffer::Available() const noexcept {
    size_t head = m_head.load(std::memory_order_acquire);
    size_t tail = m_tail.load(std::memory_order_relaxed);
    if (head >= tail) {
        return head - tail;
    }
    return (m_capacity + 1) - (tail - head);
}

size_t RingBuffer::Write(const uint8_t* data, size_t count) {
    if (!data || count == 0) return 0;

    size_t head = m_head.load(std::memory_order_relaxed);
    size_t tail = m_tail.load(std::memory_order_acquire);
    size_t bufferSize = m_capacity + 1;

    size_t freeSpace = (head >= tail) ? (m_capacity - (head - tail)) : (tail - head - 1);
    size_t bytesToWrite = std::min(count, freeSpace);

    for (size_t i = 0; i < bytesToWrite; ++i) {
        m_buffer[head] = data[i];
        head = (head + 1) % bufferSize;
    }

    m_head.store(head, std::memory_order_release);
    return bytesToWrite;
}

size_t RingBuffer::Drain(uint8_t* destination, size_t maxCount) {
    if (!destination || maxCount == 0) return 0;

    size_t head = m_head.load(std::memory_order_acquire);
    size_t tail = m_tail.load(std::memory_order_relaxed);
    size_t bufferSize = m_capacity + 1;

    size_t available = (head >= tail) ? (head - tail) : (bufferSize - (tail - head));
    size_t bytesToRead = std::min(maxCount, available);

    for (size_t i = 0; i < bytesToRead; ++i) {
        destination[i] = m_buffer[tail];
        tail = (tail + 1) % bufferSize;
    }

    m_tail.store(tail, std::memory_order_release);
    return bytesToRead;
}

WasapiLoopback::WasapiLoopback() = default;

WasapiLoopback::~WasapiLoopback() {
    Stop();
    ReleaseInterfaces();
}

void WasapiLoopback::ReleaseInterfaces() {
#if defined(_WIN32)
    if (m_waveFormat) {
        CoTaskMemFree(m_waveFormat);
        m_waveFormat = nullptr;
    }
    m_captureClient.Reset();
    m_audioClient.Reset();
    m_device.Reset();
    m_enumerator.Reset();
#endif
}

bool WasapiLoopback::InitializeEndpoint() {
#if defined(_WIN32)
    ReleaseInterfaces();

    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator),
        nullptr,
        CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator),
        reinterpret_cast<void**>(m_enumerator.GetAddressOf())
    );
    if (FAILED(hr)) return false;

    hr = m_enumerator->GetDefaultAudioEndpoint(eRender, eConsole, m_device.GetAddressOf());
    if (FAILED(hr)) return false;

    hr = m_device->Activate(
        __uuidof(IAudioClient),
        CLSCTX_ALL,
        nullptr,
        reinterpret_cast<void**>(m_audioClient.GetAddressOf())
    );
    if (FAILED(hr)) return false;

    hr = m_audioClient->GetMixFormat(&m_waveFormat);
    if (FAILED(hr) || !m_waveFormat) return false;

    // Buffer sized to 10 seconds of raw frames derived from mix format
    size_t tenSecondsBytes = m_waveFormat->nAvgBytesPerSec * 10;
    m_ring = RingBuffer(tenSecondsBytes);

    const REFERENCE_TIME hnsBufferDuration = 10000000; // 1s buffer
    // rea:iface IAudioClient::Initialize (vtable slot 3)
    hr = m_audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        hnsBufferDuration,
        0,
        m_waveFormat,
        nullptr
    );
    if (FAILED(hr)) return false;

    // rea:iface IAudioClient::GetService (vtable slot 14)
    hr = m_audioClient->GetService(
        __uuidof(IAudioCaptureClient),
        reinterpret_cast<void**>(m_captureClient.GetAddressOf())
    );
    return SUCCEEDED(hr);
#else
    return true;
#endif
}

bool WasapiLoopback::Start() {
    if (m_running.exchange(true)) {
        return true;
    }
    m_thread = std::thread(&WasapiLoopback::RunCaptureWithRecovery, this);
    return true;
}

void WasapiLoopback::Stop() {
    if (!m_running.exchange(false)) {
        return;
    }
    if (m_thread.joinable()) {
        m_thread.join();
    }
#if defined(_WIN32)
    if (m_audioClient) {
        m_audioClient->Stop();
    }
#endif
}

bool WasapiLoopback::RunCaptureWithRecovery() {
    int attempts = 0;
    const int maxAttempts = 8;

    while (m_running.load() && attempts < maxAttempts) {
        if (!InitializeEndpoint()) {
            attempts++;
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            continue;
        }

#if defined(_WIN32)
        if (FAILED(m_audioClient->Start())) {
            attempts++;
            ReleaseInterfaces();
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            continue;
        }

        // Inner capture loop
        bool deviceInvalidated = false;
        while (m_running.load() && !deviceInvalidated) {
            UINT32 nextPacketSize = 0;
            HRESULT hr = m_captureClient->GetNextPacketSize(&nextPacketSize);
            if (hr == AUDCLNT_E_DEVICE_INVALIDATED || FAILED(hr)) {
                deviceInvalidated = true;
                break;
            }

            while (nextPacketSize != 0 && m_running.load()) {
                BYTE* pData = nullptr;
                UINT32 numFrames = 0;
                DWORD flags = 0;
                hr = m_captureClient->GetBuffer(&pData, &numFrames, &flags, nullptr, nullptr);
                if (SUCCEEDED(hr)) {
                    if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && pData) {
                        size_t byteCount = numFrames * m_waveFormat->nBlockAlign;
                        m_ring.Write(pData, byteCount);
                    }
                    m_captureClient->ReleaseBuffer(numFrames);
                }
                hr = m_captureClient->GetNextPacketSize(&nextPacketSize);
                if (FAILED(hr)) break;
            }

            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }

        if (deviceInvalidated) {
            attempts++;
            ReleaseInterfaces();
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            continue;
        }
#else
        // Mock capture loop on non-Windows platform for deterministic testing
        while (m_running.load()) {
            uint8_t dummyFrame[4] = { 0x12, 0x34, 0x56, 0x78 };
            m_ring.Write(dummyFrame, 4);
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        break;
#endif
    }

    return attempts < maxAttempts;
}

} // namespace LensDesk::Native
