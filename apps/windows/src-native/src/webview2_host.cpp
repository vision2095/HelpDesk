#include "../include/webview2_host.hpp"
#include "../include/service_dispatcher.hpp"
#include <wrl/event.h>
#include <urlmon.h>

using namespace Microsoft::WRL;

namespace LensDesk {

#if defined(_WIN32)
// Asynchronous active IBindStatusCallback framework for Evergreen bootstrapper download
class AsyncDownloadStatusCallback : public IBindStatusCallback {
public:
    AsyncDownloadStatusCallback() : m_refCount(1) {}
    virtual ~AsyncDownloadStatusCallback() = default;

    STDMETHODIMP QueryInterface(REFIID riid, void** ppvObject) override {
        if (!ppvObject) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IBindStatusCallback) {
            *ppvObject = static_cast<IBindStatusCallback*>(this);
            AddRef();
            return S_OK;
        }
        *ppvObject = nullptr;
        return E_NOINTERFACE;
    }

    STDMETHODIMP_(ULONG) AddRef() override {
        return ++m_refCount;
    }

    STDMETHODIMP_(ULONG) Release() override {
        ULONG count = --m_refCount;
        if (count == 0) delete this;
        return count;
    }

    STDMETHODIMP OnStartBinding(DWORD, IBinding*) override { return S_OK; }
    STDMETHODIMP GetPriority(LONG*) override { return S_OK; }
    STDMETHODIMP OnLowResource(DWORD) override { return S_OK; }
    STDMETHODIMP OnProgress(ULONG ulProgress, ULONG ulProgressMax, ULONG ulStatusCode, LPCWSTR szStatusText) override {
        return S_OK;
    }
    STDMETHODIMP OnStopBinding(HRESULT, LPCWSTR) override { return S_OK; }
    STDMETHODIMP GetBindInfo(DWORD* grfBINDF, BINDINFO* pbindinfo) override { return S_OK; }
    STDMETHODIMP OnDataAvailable(DWORD, DWORD, FORMATETC*, STGMEDIUM*) override { return S_OK; }
    STDMETHODIMP OnObjectAvailable(REFIID, IUnknown*) override { return S_OK; }

private:
    std::atomic<ULONG> m_refCount;
};
#endif

static bool EnsureWebView2Runtime(HWND hwnd) {
#if defined(_WIN32)
    LPWSTR versionInfo = nullptr;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &versionInfo);
    if (SUCCEEDED(hr) && versionInfo != nullptr && wcslen(versionInfo) > 0) {
        CoTaskMemFree(versionInfo);
        return true; // Active Microsoft WebView2 runtime already present
    }

    // Missing dependencies: build non-blocking background initialization thread with active IBindStatusCallback
    std::thread([hwnd]() {
        wchar_t tempPath[MAX_PATH]{};
        GetTempPathW(MAX_PATH, tempPath);
        std::wstring installerPath = std::wstring(tempPath) + L"MicrosoftEdgeWebview2Setup.exe";

        // Asynchronous background downloading sequence utilizing active IBindStatusCallback framework
        AsyncDownloadStatusCallback* pCallback = new AsyncDownloadStatusCallback();
        HRESULT hr = URLDownloadToFileW(
            nullptr,
            L"https://go.microsoft.com/fwlink/p/?LinkId=2124703",
            installerPath.c_str(),
            0,
            pCallback
        );
        pCallback->Release();

        if (SUCCEEDED(hr)) {
            STARTUPINFOW si{};
            si.cb = sizeof(si);
            PROCESS_INFORMATION pi{};
            std::wstring cmd = installerPath + L" /silent /install";
            if (CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi)) {
                WaitForSingleObject(pi.hProcess, 60000); // Await completion up to 60s
                CloseHandle(pi.hProcess);
                CloseHandle(pi.hThread);
            }
            DeleteFileW(installerPath.c_str());
        }
    }).detach();

#endif
    return false;
}

WebView2Host::WebView2Host() = default;

WebView2Host::~WebView2Host() {
    Shutdown();
}

bool WebView2Host::Initialize(
    HWND hwnd,
    IDCompositionVisual* hudVisual,
    const std::filesystem::path& distPath,
    ServiceDispatcher* dispatcher,
    std::function<void(ICoreWebView2Environment*)> onReady
) {
    if (!hwnd || !hudVisual || !dispatcher) return false;
    m_hwnd = hwnd;
    m_distPath = distPath;
    m_dispatcher = dispatcher;

    // Verify dependencies and deploy Evergreen bootstrapper if missing
    EnsureWebView2Runtime(hwnd);

    std::filesystem::path userDataDir = GetAppDataDirectory() / L"WebView2_Data";
    std::filesystem::create_directories(userDataDir);

    auto options = Make<CoreWebView2EnvironmentOptions>();
    std::wstring browserArgs = L"--enable-features=msWebView2BrowserHitTransparent --disable-background-timer-throttling --disable-features=msSmartScreenProtection";

    // Remote debugging port support for automated interactive E2E testing
    wchar_t portBuf[32]{};
    if (GetEnvironmentVariableW(L"WEBVIEW2_REMOTE_DEBUGGING_PORT", portBuf, 32) > 0) {
        browserArgs += L" --remote-debugging-port=";
        browserArgs += portBuf;
    } else if (wcsstr(GetCommandLineW(), L"--remote-debugging-port=") != nullptr) {
        const wchar_t* p = wcsstr(GetCommandLineW(), L"--remote-debugging-port=");
        const wchar_t* end = wcschr(p, L' ');
        browserArgs += L" ";
        if (end) {
            browserArgs.append(p, end - p);
        } else {
            browserArgs += p;
        }
    }
    options->put_AdditionalBrowserArguments(browserArgs.c_str());

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr,
        userDataDir.c_str(),
        options.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this, hwnd, hudVisual, onReady](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
                if (FAILED(hr) || !env) {
                    if (!IsHeadlessOrCI()) {
                        std::wstring msg = L"LensDesk 2.0 requires the Microsoft Edge WebView2 Runtime to display its user interface.\n\n"
                                           L"Would you like to download and install the WebView2 Runtime from Microsoft now?";
                        int choice = MessageBoxW(hwnd, msg.c_str(), L"LensDesk 2.0 - Prerequisite Required", MB_ICONQUESTION | MB_YESNO | MB_DEFBUTTON1);
                        if (choice == IDYES) {
                            ShellExecuteW(nullptr, L"open", L"https://go.microsoft.com/fwlink/p/?LinkId=2124703", nullptr, nullptr, SW_SHOWNORMAL);
                        }
                    }
                    return hr;
                }
                m_environment = env;

                ComPtr<ICoreWebView2Environment3> env3;
                hr = env->QueryInterface(IID_PPV_ARGS(&env3));
                if (FAILED(hr)) return hr;

                hr = env3->CreateCoreWebView2CompositionController(
                    hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
                        [this, hudVisual, onReady](HRESULT hr, ICoreWebView2CompositionController* compController) -> HRESULT {
                            if (FAILED(hr) || !compController) return hr;
                            m_compositionController = compController;

                            hr = compController->QueryInterface(IID_PPV_ARGS(&m_controller));
                            if (FAILED(hr)) return hr;

                            // 1. Root visual to DirectComposition
                            compController->put_RootVisualTarget(hudVisual);

                            // 2. Query webView
                            m_controller->get_CoreWebView2(&m_webView);
                            if (!m_webView) return E_FAIL;

                            // 3. Make background 100% transparent
                            COREWEBVIEW2_COLOR transparentColor{ 0, 0, 0, 0 };
                            ComPtr<ICoreWebView2Controller2> controller2;
                            if (SUCCEEDED(m_controller.As(&controller2))) {
                                controller2->put_DefaultBackgroundColor(transparentColor);
                            }

                            // 4. Set initial bounds
                            RECT rc{};
                            GetClientRect(m_hwnd, &rc);
                            m_controller->put_Bounds(rc);
                            m_controller->put_IsVisible(TRUE);

                            // 5. Virtual host mapping to dist folder
                            ComPtr<ICoreWebView2_3> webView3;
                            if (SUCCEEDED(m_webView.As(&webView3))) {
                                webView3->SetVirtualHostNameToFolderMapping(
                                    L"lensdesk.local",
                                    m_distPath.c_str(),
                                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW
                                );
                            }

                            // 6. Inject the window.lens bridge
                            InjectLensDeskBridge();

                            // 7. Setup WebMessage handling
                            SetupWebMessageHandling();

                            // 8. Setup focus and accelerator handling
                            SetupFocusAndAcceleratorHandling();

                            // 9. Focus the HUD once its document is ready so
                            // real Windows key messages reach the sign-in
                            // form and the assistant composer immediately.
                            m_webView->add_NavigationCompleted(
                                Callback<ICoreWebView2NavigationCompletedEventHandler>(
                                    [this](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                                        if (!m_initialFocusDone && m_controller && GetForegroundWindow() == m_hwnd) {
                                            m_initialFocusDone = true;
                                            m_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
                                        }
                                        return S_OK;
                                    }
                                ).Get(), nullptr
                            );

                            // 10. Navigate to React 19 app
                            m_webView->Navigate(L"https://lensdesk.local/index.html");

                            m_isReady = true;

                            if (onReady && m_environment) {
                                onReady(m_environment.Get());
                            }

                            return S_OK;
                        }
                    ).Get()
                );

                return hr;
            }
        ).Get()
    );

    return SUCCEEDED(hr);
}

void WebView2Host::Shutdown() {
    if (m_controller) {
        if (m_gotFocusToken.value != 0) m_controller->remove_GotFocus(m_gotFocusToken);
        if (m_lostFocusToken.value != 0) m_controller->remove_LostFocus(m_lostFocusToken);
        if (m_moveFocusRequestedToken.value != 0) m_controller->remove_MoveFocusRequested(m_moveFocusRequestedToken);
        if (m_acceleratorToken.value != 0) m_controller->remove_AcceleratorKeyPressed(m_acceleratorToken);
        m_controller->Close();
    }
    if (m_webView && m_webMessageToken.value != 0) {
        m_webView->remove_WebMessageReceived(m_webMessageToken);
        m_webMessageToken.value = 0;
    }
    m_webView.Reset();
    m_compositionController.Reset();
    m_controller.Reset();
    m_environment.Reset();
    m_isReady = false;
    m_hasFocus = false;
}

void WebView2Host::Resize(int width, int height) {
    if (m_controller) {
        RECT rc{ 0, 0, width, height };
        m_controller->put_Bounds(rc);
    }
}

void WebView2Host::SetBounds(int x, int y, int width, int height) {
    if (m_controller) {
        RECT rc{ x, y, x + width, y + height };
        m_controller->put_Bounds(rc);
    }
}

void WebView2Host::SetVisible(bool visible) {
    if (m_controller) {
        m_controller->put_IsVisible(visible ? TRUE : FALSE);
    }
}

void WebView2Host::SendMouseInput(UINT msg, WPARAM wParam, LPARAM lParam) {
    if (!m_compositionController) return;

    POINT pt{ GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
    if (msg == WM_MOUSEWHEEL || msg == WM_MOUSEHWHEEL) {
        ScreenToClient(m_hwnd, &pt);
    }
    COREWEBVIEW2_MOUSE_EVENT_KIND mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE;
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS virtKeys = COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE;
    UINT32 mouseData = 0;

    switch (msg) {
        case WM_MOUSEMOVE:
            mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE;
            break;
        case WM_LBUTTONDOWN:
            mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN;
            break;
        case WM_LBUTTONUP:
            mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP;
            break;
        case WM_RBUTTONDOWN:
            mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOWN;
            break;
        case WM_RBUTTONUP:
            mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_UP;
            break;
        case WM_MOUSEWHEEL:
            mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_WHEEL;
            mouseData = GET_WHEEL_DELTA_WPARAM(wParam);
            break;
        default:
            return;
    }

    if (wParam & MK_LBUTTON) virtKeys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON;
    if (wParam & MK_RBUTTON) virtKeys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_RIGHT_BUTTON;
    if (wParam & MK_SHIFT)   virtKeys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_SHIFT;
    if (wParam & MK_CONTROL) virtKeys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_CONTROL;

    m_compositionController->SendMouseInput(mouseKind, virtKeys, mouseData, pt);
}

void WebView2Host::MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON reason) {
    if (m_controller) {
        m_controller->MoveFocus(reason);
    }
}

void WebView2Host::SetupFocusAndAcceleratorHandling() {
    if (!m_controller) return;

    // 1. GotFocus event
    m_controller->add_GotFocus(
        Callback<ICoreWebView2FocusChangedEventHandler>(
            [this](ICoreWebView2Controller* sender, IUnknown* args) -> HRESULT {
                m_hasFocus = true;
                if (m_focusCallback) m_focusCallback(true);
                return S_OK;
            }
        ).Get(),
        &m_gotFocusToken
    );

    // 2. LostFocus event
    m_controller->add_LostFocus(
        Callback<ICoreWebView2FocusChangedEventHandler>(
            [this](ICoreWebView2Controller* sender, IUnknown* args) -> HRESULT {
                m_hasFocus = false;
                if (m_focusCallback) m_focusCallback(false);
                return S_OK;
            }
        ).Get(),
        &m_lostFocusToken
    );

    // 3. MoveFocusRequested event (Tab / Shift-Tab boundary handoff)
    m_controller->add_MoveFocusRequested(
        Callback<ICoreWebView2MoveFocusRequestedEventHandler>(
            [this](ICoreWebView2Controller* sender, ICoreWebView2MoveFocusRequestedEventArgs* args) -> HRESULT {
                COREWEBVIEW2_MOVE_FOCUS_REASON reason = COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC;
                args->get_Reason(&reason);
                if (m_moveFocusRequestedCallback) {
                    m_moveFocusRequestedCallback(reason);
                }
                args->put_Handled(TRUE);
                return S_OK;
            }
        ).Get(),
        &m_moveFocusRequestedToken
    );

    // 4. AcceleratorKeyPressed event (ensures standard key combinations flow to DOM)
    m_controller->add_AcceleratorKeyPressed(
        Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
            [this](ICoreWebView2Controller* sender, ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT {
                UINT virtualKey = 0;
                args->get_VirtualKey(&virtualKey);

                // Let WebView2 process all standard keys, text inputs, shortcuts, and IME natively
                args->put_Handled(FALSE);
                return S_OK;
            }
        ).Get(),
        &m_acceleratorToken
    );
}

void WebView2Host::InjectLensDeskBridge() {
    if (!m_webView) return;

    const wchar_t* bridgeJs = LR"JS(
(function() {
  if (window.lens) return;
  var nextId = 1;
  var pending = new Map();
  var listeners = {
    gate: new Set(),
    preferences: new Set(),
    browserState: new Set(),
    browserFocusAddress: new Set(),
    browserFocusFind: new Set(),
    chat: new Set(),
    shortcut: new Set(),
    overlay: new Set(),
    clickThrough: new Set(),
    opacity: new Set(),
    globalKey: new Set(),
    updaterProgress: new Set(),
    updaterAvailable: new Set(),
    custom: new Map()
  };

  window.chrome.webview.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg) return;
    if (msg.type === 'response') {
      var p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      }
    } else if (msg.type === 'event') {
      var evName = msg.event;
      var data = msg.data;
      if (evName === 'lens:gate') listeners.gate.forEach(function(fn) { fn(data); });
      else if (evName === 'lens:preferences') listeners.preferences.forEach(function(fn) { fn(data); });
      else if (evName === 'lens:browser-state') listeners.browserState.forEach(function(fn) { fn(data); });
      else if (evName === 'lens:browser-focus-address') listeners.browserFocusAddress.forEach(function(fn) { fn(); });
      else if (evName === 'lens:browser-focus-find') listeners.browserFocusFind.forEach(function(fn) { fn(); });
      else if (evName === 'lens:chat') listeners.chat.forEach(function(fn) { fn(data); });
      else if (evName === 'lens:shortcut') listeners.shortcut.forEach(function(fn) { fn(typeof data === 'object' && data && data.action ? data.action : data); });
      else if (evName === 'lens:overlay') listeners.overlay.forEach(function(fn) { fn(data); });
      else if (evName === 'lens:clickThrough') listeners.clickThrough.forEach(function(fn) { fn(data); });
      else if (evName === 'lens:opacity-changed') listeners.opacity.forEach(function(fn) { fn(typeof data === 'number' ? data : (data && data.opacity != null ? data.opacity : 1)); });
      else if (evName === 'gkey') listeners.globalKey.forEach(function(fn) { fn(data); });
      else if (evName === 'desktop.updater.progress') listeners.updaterProgress.forEach(function(fn) { fn(data); });
      else if (evName === 'desktop.updater.available') listeners.updaterAvailable.forEach(function(fn) { fn(data); });

      var customSet = listeners.custom.get(evName);
      if (customSet) {
        customSet.forEach(function(fn) { fn(data); });
      }
    }
  });

  window.lens = {
    platform: 'win32',
    invoke: function(action, payload) {
      return new Promise(function(resolve, reject) {
        var id = nextId++;
        pending.set(id, { resolve: resolve, reject: reject });
        window.chrome.webview.postMessage({ id: id, action: action, payload: payload || {} });
      });
    },
    capture: function(payload) {
      return window.lens.invoke('desktop.capture', payload || {});
    },
    relaunch: function() {
      return window.lens.invoke('desktop.restart', {});
    },
    openScreenSettings: function() {
      return window.lens.invoke('desktop.openScreenSettings', {});
    },
    openAccessibilitySettings: function() {
      return window.lens.invoke('desktop.openAccessibilitySettings', {});
    },
    openSettings: function() {
      return window.lens.invoke('desktop.openSettings', {});
    },
    onGate: function(fn) { listeners.gate.add(fn); return function() { listeners.gate.delete(fn); }; },
    onPreferences: function(fn) { listeners.preferences.add(fn); return function() { listeners.preferences.delete(fn); }; },
    onBrowserState: function(fn) { listeners.browserState.add(fn); return function() { listeners.browserState.delete(fn); }; },
    onBrowserFocusAddress: function(fn) { listeners.browserFocusAddress.add(fn); return function() { listeners.browserFocusAddress.delete(fn); }; },
    onBrowserFocusFind: function(fn) { listeners.browserFocusFind.add(fn); return function() { listeners.browserFocusFind.delete(fn); }; },
    onChatEvent: function(fn) { listeners.chat.add(fn); return function() { listeners.chat.delete(fn); }; },
    onShortcut: function(fn) { listeners.shortcut.add(fn); return function() { listeners.shortcut.delete(fn); }; },
    onOverlay: function(fn) { listeners.overlay.add(fn); return function() { listeners.overlay.delete(fn); }; },
    onClickThrough: function(fn) { listeners.clickThrough.add(fn); return function() { listeners.clickThrough.delete(fn); }; },
    onOpacityChanged: function(fn) { listeners.opacity.add(fn); return function() { listeners.opacity.delete(fn); }; },
    onGlobalKey: function(fn) { listeners.globalKey.add(fn); return function() { listeners.globalKey.delete(fn); }; },
    onUpdaterProgress: function(fn) { listeners.updaterProgress.add(fn); return function() { listeners.updaterProgress.delete(fn); }; },
    onUpdaterAvailable: function(fn) { listeners.updaterAvailable.add(fn); return function() { listeners.updaterAvailable.delete(fn); }; },
    on: function(channel, listener) {
      if (channel === 'desktop.updater.available') return window.lens.onUpdaterAvailable(listener);
      if (channel === 'desktop.updater.progress') return window.lens.onUpdaterProgress(listener);
      if (channel === 'gkey') return window.lens.onGlobalKey(listener);
      if (!listeners.custom.has(channel)) {
        listeners.custom.set(channel, new Set());
      }
      var set = listeners.custom.get(channel);
      set.add(listener);
      return function() { set.delete(listener); };
    }
  };
})();
)JS";

    m_webView->AddScriptToExecuteOnDocumentCreated(bridgeJs, nullptr);
}

void WebView2Host::SetupWebMessageHandling() {
    if (!m_webView || !m_dispatcher) return;

    m_webView->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this](ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                LPWSTR rawJson = nullptr;
                HRESULT hr = args->get_WebMessageAsJson(&rawJson);
                if (FAILED(hr) || !rawJson) return hr;

                std::wstring wideJson(rawJson);
                CoTaskMemFree(rawJson);

                std::string utf8Json = WideToUtf8(wideJson);
                try {
                    auto parsed = json::parse(utf8Json);
                    int id = parsed.value("id", 0);
                    std::string action = parsed.value("action", "");
                    json payload = parsed.value("payload", json::object());

                    m_dispatcher->Dispatch(
                        action,
                        payload,
                        [this, id](const json& result, bool isError) {
                            json resp;
                            resp["type"] = "response";
                            resp["id"] = id;
                            if (isError) {
                                resp["error"] = result.is_string() ? result.get<std::string>() : "Action failed";
                            } else {
                                resp["result"] = result;
                            }
                            PostWebMessage(resp);
                        }
                    );
                } catch (const std::exception& ex) {
                    std::cerr << "WebMessage parse error: " << ex.what() << std::endl;
                }

                return S_OK;
            }
        ).Get(),
        &m_webMessageToken
    );
}

void WebView2Host::PostWebMessage(const json& message) {
    if (!m_webView) return;
    std::string dump = message.dump();
    std::wstring wide = Utf8ToWide(dump);
    m_webView->PostWebMessageAsJson(wide.c_str());
}

void WebView2Host::BroadcastEvent(const std::string& eventName, const json& eventData) {
    json msg;
    msg["type"] = "event";
    msg["event"] = eventName;
    msg["data"] = eventData;
    PostWebMessage(msg);
}

} // namespace LensDesk
