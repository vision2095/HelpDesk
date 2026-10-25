#pragma once
#include "common.hpp"
#include "cloud_client.hpp"
#include <condition_variable>

namespace LensDesk {

class WindowManager;
class WebView2Host;
class BrowserTabsManager;
class InputManager;
class CaptureService;
class StorageManager;
class ImGuiOverlay;
class FocusManager;

using DispatchResponseCallback = std::function<void(const json& result, bool isError)>;

class ServiceDispatcher {
public:
    ServiceDispatcher();
    ~ServiceDispatcher();

    void Initialize(
        WindowManager* winMgr,
        WebView2Host* webHost,
        BrowserTabsManager* browserMgr,
        InputManager* inputMgr,
        CaptureService* captureSvc,
        StorageManager* storageMgr,
        ImGuiOverlay* imguiOverlay,
        FocusManager* focusMgr = nullptr
    );

    void Dispatch(const std::string& action, const json& payload, DispatchResponseCallback callback);

    void BroadcastEvent(const std::string& eventName, const json& eventData);
    void ProcessPendingUi();
    void Shutdown();

private:
    void HandleChat(const json& payload, DispatchResponseCallback callback);
    void PostToUi(std::function<void()> work);
    void HeartbeatLoop();
    json BuildFullState();
    json GetGateView();

    WindowManager* m_winMgr = nullptr;
    WebView2Host* m_webHost = nullptr;
    BrowserTabsManager* m_browserMgr = nullptr;
    InputManager* m_inputMgr = nullptr;
    CaptureService* m_captureSvc = nullptr;
    StorageManager* m_storageMgr = nullptr;
    ImGuiOverlay* m_imguiOverlay = nullptr;
    FocusManager* m_focusMgr = nullptr;
    CloudClient m_cloud;
    std::mutex m_cloudMutex;
    HWND m_hwnd = nullptr;
    std::mutex m_uiMutex;
    std::vector<std::function<void()>> m_uiQueue;
    std::vector<std::thread> m_workers;
    std::mutex m_heartbeatMutex;
    std::condition_variable m_heartbeatCv;
    std::thread m_heartbeatThread;
    bool m_heartbeatStop = false;
};

} // namespace LensDesk
