#pragma once
#include "common.hpp"
#include "audio_samples.hpp"
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <thread>
#include <atomic>
#include <vector>
#include <mutex>

namespace LensDesk {

class WasapiLoopbackCapture {
public:
    WasapiLoopbackCapture();
    ~WasapiLoopbackCapture();

    bool Initialize();
    void Shutdown();

    bool StartCapture();
    void StopCapture();
    bool IsCapturing() const { return m_isCapturing.load(); }

    struct AudioChunk {
        std::string data;
        unsigned sampleRate = 0;
        unsigned channels = 0;
    };
    AudioChunk GetAudioChunk(bool pcm16, bool clear = true);

private:
    void CaptureThreadLoop();

    ComPtr<IMMDeviceEnumerator> m_enumerator;
    ComPtr<IMMDevice> m_device;
    ComPtr<IAudioClient> m_audioClient;
    ComPtr<IAudioCaptureClient> m_captureClient;
    ComPtr<IAudioClient> m_silentAudioClient;
    ComPtr<IAudioRenderClient> m_silentRenderClient;
    WAVEFORMATEX* m_waveFormat = nullptr;

    std::thread m_captureThread;
    std::atomic<bool> m_isCapturing{ false };
    std::atomic<bool> m_stopCapture{ false };

    std::mutex m_bufferMutex;
    std::vector<float> m_audioBuffer;
    AudioSamples::Format m_format{};
    unsigned m_sampleRate = 0;
    unsigned m_channels = 0;
};

} // namespace LensDesk
