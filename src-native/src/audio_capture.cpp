#include "../include/audio_capture.hpp"
#include <iostream>
#include <ksmedia.h>

namespace LensDesk {

WasapiLoopbackCapture::WasapiLoopbackCapture() = default;

WasapiLoopbackCapture::~WasapiLoopbackCapture() {
    Shutdown();
}

bool WasapiLoopbackCapture::Initialize() {
#if defined(_WIN32)
    // Release the previous endpoint before recovery or a retry. Buffered samples
    // are cleared when the new format is committed below.
    m_silentRenderClient.Reset();
    m_silentAudioClient.Reset();
    m_captureClient.Reset();
    m_audioClient.Reset();
    m_device.Reset();
    m_enumerator.Reset();
    if (m_waveFormat) { CoTaskMemFree(m_waveFormat); m_waveFormat = nullptr; }
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

    AudioSamples::Format format{};
    format.channels = m_waveFormat->nChannels;
    format.containerBits = m_waveFormat->wBitsPerSample;
    format.validBits = format.containerBits;
    bool isFloat = m_waveFormat->wFormatTag == WAVE_FORMAT_IEEE_FLOAT;
    bool isPcm = m_waveFormat->wFormatTag == WAVE_FORMAT_PCM;
    if (m_waveFormat->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
        if (m_waveFormat->cbSize < sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) return false;
        const auto* extended = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(m_waveFormat);
        isFloat = IsEqualGUID(extended->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
        isPcm = IsEqualGUID(extended->SubFormat, KSDATAFORMAT_SUBTYPE_PCM);
        format.validBits = extended->Samples.wValidBitsPerSample;
    }
    if ((!isFloat && !isPcm) || !m_waveFormat->nSamplesPerSec) return false;
    format.encoding = isFloat ? AudioSamples::Encoding::Float32 : AudioSamples::Encoding::IntegerPcm;
    if (!AudioSamples::Supported(format) ||
        m_waveFormat->nBlockAlign != format.channels * (format.containerBits / 8)) return false;

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

    // Initialize silent feeder to keep the WASAPI clock ticking during quiet intervals
    m_device->Activate(
        __uuidof(IAudioClient),
        CLSCTX_ALL,
        nullptr,
        reinterpret_cast<void**>(m_silentAudioClient.GetAddressOf())
    );
    if (m_silentAudioClient) {
        if (SUCCEEDED(m_silentAudioClient->Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            0,
            hnsBufferDuration,
            0,
            m_waveFormat,
            nullptr
        ))) {
            m_silentAudioClient->GetService(
                __uuidof(IAudioRenderClient),
                reinterpret_cast<void**>(m_silentRenderClient.GetAddressOf())
            );
        }
    }

    {
        std::lock_guard<std::mutex> lock(m_bufferMutex);
        m_audioBuffer.clear();
        m_format = format;
        m_sampleRate = m_waveFormat->nSamplesPerSec;
        m_channels = format.channels;
    }
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
    m_silentRenderClient.Reset();
    m_silentAudioClient.Reset();
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
    if (m_silentAudioClient) {
        m_silentAudioClient->Start();
    }

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
    if (m_silentAudioClient) {
        m_silentAudioClient->Stop();
    }
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
                const size_t byteCount = static_cast<size_t>(numFramesAvailable) * m_waveFormat->nBlockAlign;
                {
                    std::lock_guard<std::mutex> lock(m_bufferMutex);
                    if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                        m_audioBuffer.insert(m_audioBuffer.end(), static_cast<size_t>(numFramesAvailable) * m_channels, 0.0f);
                    } else if (pData) {
                        AudioSamples::ToFloat(pData, byteCount, m_format, m_audioBuffer);
                    }
                    // Retain complete frames for at most 10 seconds.
                    const size_t maxSamples = static_cast<size_t>(m_sampleRate) * m_channels * 10;
                    if (m_audioBuffer.size() > maxSamples) {
                        m_audioBuffer.erase(m_audioBuffer.begin(), m_audioBuffer.begin() + (m_audioBuffer.size() - maxSamples));
                    }
                }
                m_captureClient->ReleaseBuffer(numFramesAvailable);
            }

            hr = m_captureClient->GetNextPacketSize(&nextPacketSize);
            if (FAILED(hr)) break;
        }

        if (nextPacketSize == 0 && m_silentRenderClient && m_silentAudioClient) {
            UINT32 padding = 0;
            if (SUCCEEDED(m_silentAudioClient->GetCurrentPadding(&padding))) {
                UINT32 bufferFrames = 0;
                m_silentAudioClient->GetBufferSize(&bufferFrames);
                UINT32 available = bufferFrames - padding;
                if (available > 0) {
                    BYTE* pSilence = nullptr;
                    if (SUCCEEDED(m_silentRenderClient->GetBuffer(available, &pSilence))) {
                        m_silentRenderClient->ReleaseBuffer(available, AUDCLNT_BUFFERFLAGS_SILENT);
                    }
                }
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
#endif
}

WasapiLoopbackCapture::AudioChunk WasapiLoopbackCapture::GetAudioChunk(bool pcm16, bool clear) {
    std::vector<float> samples;
    AudioChunk chunk;
    {
        std::lock_guard<std::mutex> lock(m_bufferMutex);
        samples = m_audioBuffer;
        chunk.sampleRate = m_sampleRate;
        chunk.channels = m_channels;
        if (clear) m_audioBuffer.clear();
    }
    if (pcm16) {
        const auto bytes = AudioSamples::ToPcm16(samples);
        if (!bytes.empty()) chunk.data = Base64Encode(bytes.data(), bytes.size());
    } else if (!samples.empty()) {
        chunk.data = Base64Encode(reinterpret_cast<const uint8_t*>(samples.data()), samples.size() * sizeof(float));
    }
    return chunk;
}

} // namespace LensDesk
