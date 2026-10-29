// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"
#include "wasapi_loopback.h"

#if defined(_WIN32)
#include <winhttp.h>
#else
using HINTERNET = void*;
#ifndef WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE
#define WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE 0
#endif
#endif

namespace LensDesk::Native {

#pragma pack(push, 1)
// B4: Fixed 16-byte frame header before PCM audio
struct AudioFrameHeader {
    uint32_t magic = 0x5341444C; // 'LDAS'
    uint16_t sampleRate = 48000;
    uint16_t channels = 2;
    uint32_t byteCount = 0;
    uint32_t seq = 0;
};
#pragma pack(pop)
static_assert(sizeof(AudioFrameHeader) == 16, "AudioFrameHeader must be exactly 16 bytes");

// B2: Transport abstraction for testability
struct IAudioSink {
    virtual bool Open(const wchar_t* url) = 0;
    virtual bool Send(const uint8_t* p, size_t n) = 0;
    virtual void Close() = 0;
    virtual bool QueryCloseStatus(USHORT* outStatus = nullptr) = 0;
    virtual ~IAudioSink() = default;
};

// B3: WinHTTP implementation of IAudioSink
class WinHttpAudioSink : public IAudioSink {
public:
    WinHttpAudioSink();
    ~WinHttpAudioSink() override;

    bool Open(const wchar_t* url) override;
    bool Send(const uint8_t* p, size_t n) override;
    void Close() override;
    bool QueryCloseStatus(USHORT* outStatus = nullptr) override;

    bool IsConnected() const noexcept { return m_hWebSocket != nullptr; }

private:
    void CleanupHandles();

    HINTERNET m_hSession = nullptr;
    HINTERNET m_hConnect = nullptr;
    HINTERNET m_hRequest = nullptr;
    HINTERNET m_hWebSocket = nullptr;
};

// B5: Sender thread & backoff state machine
class WebSocketAudioSender {
public:
    WebSocketAudioSender(RingBuffer& ring, std::shared_ptr<IAudioSink> sink);
    ~WebSocketAudioSender();

    void Start(const wchar_t* url);
    void Stop();
    bool IsRunning() const noexcept { return m_running.load(); }
    bool HasErrorState() const noexcept { return m_errorState.load(); }
    uint32_t GetCurrentSequence() const noexcept { return m_sequence.load(); }
    int GetBackoffLevel() const noexcept { return m_backoffLevel.load(); }
    int GetBackoffMs() const noexcept;
    int GetFullBackoffCount() const noexcept { return m_fullBackoffCount.load(); }

    // Deterministic state-machine single step execution (for unit tests)
    bool StepOnce();

private:
    void SenderLoop();

    RingBuffer& m_ring;
    std::shared_ptr<IAudioSink> m_sink;
    std::wstring m_url;
    std::atomic<bool> m_running{ false };
    std::atomic<bool> m_errorState{ false };
    std::atomic<uint32_t> m_sequence{ 0 };
    std::atomic<int> m_backoffLevel{ 0 };
    std::atomic<int> m_fullBackoffCount{ 0 };
    bool m_connected{ false };
    std::thread m_worker;
};

} // namespace LensDesk::Native
