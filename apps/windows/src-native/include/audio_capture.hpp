#pragma once
#include "common.hpp"
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

    std::vector<uint8_t> GetAudioData(bool clear = true);
    std::string GetAudioDataBase64(bool clear = true);

private:
    void CaptureThreadLoop();

    ComPtr<IMMDeviceEnumerator> m_enumerator;
    ComPtr<IMMDevice> m_device;
    ComPtr<IAudioClient> m_audioClient;
    ComPtr<IAudioCaptureClient> m_captureClient;
    WAVEFORMATEX* m_waveFormat = nullptr;

    std::thread m_captureThread;
    std::atomic<bool> m_isCapturing{ false };
    std::atomic<bool> m_stopCapture{ false };

    std::mutex m_bufferMutex;
    std::vector<uint8_t> m_audioBuffer;
};

} // namespace LensDesk
