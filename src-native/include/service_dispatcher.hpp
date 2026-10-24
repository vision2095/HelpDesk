#pragma once
#include "common.hpp"

namespace LensDesk {

class WindowManager;
class WebView2Host;
class BrowserTabsManager;
class InputManager;
class CaptureService;
class StorageManager;
class ImGuiOverlay;

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
        ImGuiOverlay* imguiOverlay
    );

    void Dispatch(const std::string& action, const json& payload, DispatchResponseCallback callback);

    void BroadcastEvent(const std::string& eventName, const json& eventData);

private:
    void HandleChat(const json& payload, DispatchResponseCallback callback);

    WindowManager* m_winMgr = nullptr;
    WebView2Host* m_webHost = nullptr;
    BrowserTabsManager* m_browserMgr = nullptr;
    InputManager* m_inputMgr = nullptr;
    CaptureService* m_captureSvc = nullptr;
    StorageManager* m_storageMgr = nullptr;
    ImGuiOverlay* m_imguiOverlay = nullptr;
};

} // namespace LensDesk
