// derived: rea/native/windows/src/authority.hpp
#include "websocket_audio_sink.h"

namespace LensDesk::Native {

WinHttpAudioSink::WinHttpAudioSink() = default;

WinHttpAudioSink::~WinHttpAudioSink() {
    Close();
}

void WinHttpAudioSink::CleanupHandles() {
#if defined(_WIN32)
    if (m_hWebSocket) {
        WinHttpWebSocketClose(m_hWebSocket, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, nullptr, 0);
        WinHttpCloseHandle(m_hWebSocket);
        m_hWebSocket = nullptr;
    }
    if (m_hRequest) {
        WinHttpCloseHandle(m_hRequest);
        m_hRequest = nullptr;
    }
    if (m_hConnect) {
        WinHttpCloseHandle(m_hConnect);
        m_hConnect = nullptr;
    }
    if (m_hSession) {
        WinHttpCloseHandle(m_hSession);
        m_hSession = nullptr;
    }
#else
    m_hWebSocket = nullptr;
    m_hRequest = nullptr;
    m_hConnect = nullptr;
    m_hSession = nullptr;
#endif
}

bool WinHttpAudioSink::Open(const wchar_t* url) {
    CleanupHandles();
    if (!url) return false;

#if defined(_WIN32)
    URL_COMPONENTS urlComp{};
    urlComp.dwStructSize = sizeof(urlComp);
    wchar_t hostName[256]{};
    wchar_t urlPath[1024]{};
    urlComp.lpszHostName = hostName;
    urlComp.dwHostNameLength = sizeof(hostName) / sizeof(wchar_t);
    urlComp.lpszUrlPath = urlPath;
    urlComp.dwUrlPathLength = sizeof(urlPath) / sizeof(wchar_t);

    if (!WinHttpCrackUrl(url, static_cast<DWORD>(wcslen(url)), 0, &urlComp)) {
        return false;
    }

    m_hSession = WinHttpOpen(
        L"Hintlens-Audio/1.0",
        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0
    );
    if (!m_hSession) return false;

    m_hConnect = WinHttpConnect(m_hSession, hostName, urlComp.nPort, 0);
    if (!m_hConnect) {
        CleanupHandles();
        return false;
    }

    DWORD reqFlags = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    const wchar_t* path = (urlComp.dwUrlPathLength > 0) ? urlPath : L"/ws/transcribe?source=system";

    m_hRequest = WinHttpOpenRequest(
        m_hConnect,
        L"GET",
        path,
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        reqFlags
    );
    if (!m_hRequest) {
        CleanupHandles();
        return false;
    }

    if (!WinHttpSetOption(m_hRequest, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, nullptr, 0)) {
        CleanupHandles();
        return false;
    }

    if (!WinHttpSendRequest(m_hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) {
        CleanupHandles();
        return false;
    }

    if (!WinHttpReceiveResponse(m_hRequest, nullptr)) {
        CleanupHandles();
        return false;
    }

    m_hWebSocket = WinHttpWebSocketCompleteUpgrade(m_hRequest, 0);
    // Request handle consumed or failed: must release immediately
    WinHttpCloseHandle(m_hRequest);
    m_hRequest = nullptr;

    if (!m_hWebSocket) {
        CleanupHandles();
        return false;
    }

    return true;
#else
    m_hWebSocket = reinterpret_cast<void*>(0xCAFE);
    return true;
#endif
}

bool WinHttpAudioSink::Send(const uint8_t* p, size_t n) {
    if (!m_hWebSocket || !p || n == 0) return false;

#if defined(_WIN32)
    DWORD dwError = WinHttpWebSocketSend(
        m_hWebSocket,
        WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE,
        const_cast<uint8_t*>(p),
        static_cast<DWORD>(n)
    );
    return (dwError == ERROR_SUCCESS);
#else
    return true;
#endif
}

void WinHttpAudioSink::Close() {
#if defined(_WIN32)
    if (m_hWebSocket) {
        WinHttpWebSocketShutdown(m_hWebSocket, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, nullptr, 0);
    }
#endif
    CleanupHandles();
}

bool WinHttpAudioSink::QueryCloseStatus(USHORT* outStatus) {
#if defined(_WIN32)
    if (!m_hWebSocket) return true;
    USHORT status = 0;
    ULONG bytesTransferred = 0;
    DWORD err = WinHttpWebSocketQueryCloseStatus(m_hWebSocket, &status, nullptr, 0, &bytesTransferred);
    if (outStatus) *outStatus = status;
    return (err == ERROR_SUCCESS && status != 0);
#else
    if (outStatus) *outStatus = 0;
    return false;
#endif
}

// ═══ WebSocketAudioSender ═══

WebSocketAudioSender::WebSocketAudioSender(RingBuffer& ring, std::shared_ptr<IAudioSink> sink)
    : m_ring(ring)
    , m_sink(std::move(sink))
{
}

WebSocketAudioSender::~WebSocketAudioSender() {
    Stop();
}

int WebSocketAudioSender::GetBackoffMs() const noexcept {
    switch (m_backoffLevel.load()) {
        case 0: return 0;
        case 1: return 500;
        case 2: return 1000;
        case 3: return 2000;
        case 4: return 4000;
        default: return 10000; // Cap at 10s
    }
}

bool WebSocketAudioSender::StepOnce() {
    if (!m_sink) return false;

    if (!m_connected) {
        bool ok = m_sink->Open(m_url.c_str());
        if (ok) {
            m_connected = true;
            m_backoffLevel.store(0);
            m_fullBackoffCount.store(0);
            m_errorState.store(false);
            return true;
        } else {
            int currentLevel = m_backoffLevel.load();
            if (currentLevel < 5) {
                m_backoffLevel.store(currentLevel + 1);
            } else {
                int fullCount = m_fullBackoffCount.fetch_add(1) + 1;
                if (fullCount >= 3) {
                    m_errorState.store(true); // 3 consecutive full backoffs: surface error
                }
            }
            return false;
        }
    }

    // Connected: process available PCM data
    if (m_sink->QueryCloseStatus()) {
        m_sink->Close();
        m_connected = false;
        return false;
    }

    uint8_t pcmBuffer[4096];
    size_t popped = m_ring.Pop(pcmBuffer, sizeof(pcmBuffer));
    if (popped == 0) {
        return true; // No data yet
    }

    AudioFrameHeader hdr;
    hdr.magic = 0x5341444C; // 'LDAS'
    hdr.sampleRate = 48000;
    hdr.channels = 2;
    hdr.byteCount = static_cast<uint32_t>(popped);
    hdr.seq = m_sequence.fetch_add(1);

    std::vector<uint8_t> frame(sizeof(AudioFrameHeader) + popped);
    std::memcpy(frame.data(), &hdr, sizeof(AudioFrameHeader));
    std::memcpy(frame.data() + sizeof(AudioFrameHeader), pcmBuffer, popped);

    bool sent = m_sink->Send(frame.data(), frame.size());
    if (!sent) {
        m_sink->Close();
        m_connected = false;
        return false;
    }

    // Reset backoff on first successful send
    m_backoffLevel.store(0);
    m_fullBackoffCount.store(0);
    return true;
}

void WebSocketAudioSender::Start(const wchar_t* url) {
    if (m_running.exchange(true)) return;
    m_url = url ? url : L"";
    m_worker = std::thread(&WebSocketAudioSender::SenderLoop, this);
}

void WebSocketAudioSender::Stop() {
    if (!m_running.exchange(false)) return;
    if (m_worker.joinable()) {
        m_worker.join();
    }
    if (m_sink) {
        m_sink->Close();
    }
    m_connected = false;
}

void WebSocketAudioSender::SenderLoop() {
    while (m_running.load()) {
        if (!m_connected) {
            int delayMs = GetBackoffMs();
            if (delayMs > 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
            }
        } else {
            m_ring.WaitForData(100);
        }

        StepOnce();
    }
}

} // namespace LensDesk::Native
