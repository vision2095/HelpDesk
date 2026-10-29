#include "../include/audio_capture.hpp"
#include <iostream>

namespace LensDesk {

WasapiLoopbackCapture::WasapiLoopbackCapture() = default;

WasapiLoopbackCapture::~WasapiLoopbackCapture() {
    Shutdown();
}

bool WasapiLoopbackCapture::Initialize() {
#if defined(_WIN32)
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

    // 10,000,000 reference time units = 1 second buffer
    const REFERENCE_TIME hnsBufferDuration = 10000000;
    hr = m_audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        hnsBufferDuration,
        0,
        m_waveFormat,
        nullptr
    );
    if (FAILED(hr)) return false;

    hr = m_audioClient->GetService(
        __uuidof(IAudioCaptureClient),
        reinterpret_cast<void**>(m_captureClient.GetAddressOf())
    );
    if (FAILED(hr)) return false;

    return true;
#else
    return false;
#endif
}

void WasapiLoopbackCapture::Shutdown() {
    StopCapture();
    if (m_waveFormat) {
        CoTaskMemFree(m_waveFormat);
        m_waveFormat = nullptr;
    }
    m_captureClient.Reset();
    m_audioClient.Reset();
    m_device.Reset();
    m_enumerator.Reset();
}

bool WasapiLoopbackCapture::StartCapture() {
    if (m_isCapturing) return true;
    if (!m_audioClient || !m_captureClient) {
        if (!Initialize()) return false;
    }

#if defined(_WIN32)
    HRESULT hr = m_audioClient->Start();
    if (FAILED(hr)) return false;

    m_stopCapture = false;
    m_isCapturing = true;
    m_captureThread = std::thread(&WasapiLoopbackCapture::CaptureThreadLoop, this);
    return true;
#else
    return false;
#endif
}

void WasapiLoopbackCapture::StopCapture() {
    m_stopCapture = true;
    if (m_captureThread.joinable()) {
        m_captureThread.join();
    }
#if defined(_WIN32)
    if (m_audioClient) {
        m_audioClient->Stop();
    }
#endif
    m_isCapturing = false;
}

void WasapiLoopbackCapture::CaptureThreadLoop() {
#if defined(_WIN32)
    while (!m_stopCapture) {
        UINT32 nextPacketSize = 0;
        HRESULT hr = m_captureClient ? m_captureClient->GetNextPacketSize(&nextPacketSize) : E_FAIL;
        
        // Explicit audio session recovery routing:
        // Intercept AUDCLNT_E_DEVICE_INVALIDATED notifications on hardware endpoint detachment
        if (hr == AUDCLNT_E_DEVICE_INVALIDATED || FAILED(hr)) {
            if (m_stopCapture) break;

            // Release invalidated endpoint interfaces
            m_captureClient.Reset();
            m_audioClient.Reset();
            m_device.Reset();

            // Wait before attempting session recovery to allow hardware enumeration to settle
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            if (m_stopCapture) break;

            if (Initialize()) {
                if (m_audioClient && SUCCEEDED(m_audioClient->Start())) {
                    continue; // Recovery successful
                }
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            continue;
        }

        while (nextPacketSize != 0 && !m_stopCapture) {
            BYTE* pData = nullptr;
            UINT32 numFramesAvailable = 0;
            DWORD flags = 0;

            hr = m_captureClient->GetBuffer(&pData, &numFramesAvailable, &flags, nullptr, nullptr);
            if (SUCCEEDED(hr)) {
                size_t byteCount = numFramesAvailable * m_waveFormat->nBlockAlign;
                {
                    std::lock_guard<std::mutex> lock(m_bufferMutex);
                    if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                        m_audioBuffer.insert(m_audioBuffer.end(), byteCount, 0);
                    } else if (pData) {
                        m_audioBuffer.insert(m_audioBuffer.end(), pData, pData + byteCount);
                    }

                    // Keep bounded ring buffer (max 10 seconds of raw audio)
                    size_t maxBytes = m_waveFormat->nAvgBytesPerSec * 10;
                    if (m_audioBuffer.size() > maxBytes) {
                        m_audioBuffer.erase(m_audioBuffer.begin(), m_audioBuffer.begin() + (m_audioBuffer.size() - maxBytes));
                    }
                }
                m_captureClient->ReleaseBuffer(numFramesAvailable);
            }

            hr = m_captureClient->GetNextPacketSize(&nextPacketSize);
            if (FAILED(hr)) break;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
#endif
}

std::vector<uint8_t> WasapiLoopbackCapture::GetAudioData(bool clear) {
    std::lock_guard<std::mutex> lock(m_bufferMutex);
    std::vector<uint8_t> data = m_audioBuffer;
    if (clear) {
        m_audioBuffer.clear();
    }
    return data;
}

std::string WasapiLoopbackCapture::GetAudioDataBase64(bool clear) {
    std::vector<uint8_t> raw = GetAudioData(clear);
    if (raw.empty()) return "";
    return Base64Encode(raw.data(), raw.size());
}

} // namespace LensDesk
