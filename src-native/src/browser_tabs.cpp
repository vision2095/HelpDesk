#include "../include/browser_tabs.hpp"
#include <wrl/event.h>

using namespace Microsoft::WRL;

namespace LensDesk {

BrowserTabsManager::BrowserTabsManager() = default;

BrowserTabsManager::~BrowserTabsManager() {
    Shutdown();
}

bool BrowserTabsManager::Initialize(HWND hwnd, ICoreWebView2Environment* env, IDCompositionVisual* browserVisual) {
    if (!hwnd || !env || !browserVisual) return false;
    m_hwnd = hwnd;
    m_env = env;
    m_browserVisual = browserVisual;

    ComPtr<ICoreWebView2Environment3> env3;
    HRESULT hr = env->QueryInterface(IID_PPV_ARGS(&env3));
    if (FAILED(hr)) return false;

    hr = env3->CreateCoreWebView2CompositionController(
        hwnd,
        Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
            [this, browserVisual](HRESULT hr, ICoreWebView2CompositionController* compController) -> HRESULT {
                if (FAILED(hr) || !compController) return hr;
                m_compositionController = compController;

                hr = compController->QueryInterface(IID_PPV_ARGS(&m_controller));
                if (FAILED(hr)) return hr;

                compController->put_RootVisualTarget(browserVisual);
                m_controller->get_CoreWebView2(&m_webView);

                // Set initial default background
                COREWEBVIEW2_COLOR whiteBg{ 255, 255, 255, 255 };
                ComPtr<ICoreWebView2Controller2> c2;
                if (SUCCEEDED(m_controller.As(&c2))) {
                    c2->put_DefaultBackgroundColor(whiteBg);
                }

                // Focus and accelerator handling
                SetupFocusAndAcceleratorHandling();

                // Listen to navigation events
                if (m_webView) {
                    m_webView->add_NavigationStarting(
                        Callback<ICoreWebView2NavigationStartingEventHandler>(
                            [this](ICoreWebView2* sender, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                                if (!m_activeTabId.empty()) {
                                    m_tabs[m_activeTabId].isLoading = true;
                                    NotifyStateChanged();
                                }
                                return S_OK;
                            }
                        ).Get(), nullptr
                    );

                    m_webView->add_NavigationCompleted(
                        Callback<ICoreWebView2NavigationCompletedEventHandler>(
                            [this](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                                if (!m_activeTabId.empty()) {
                                    m_tabs[m_activeTabId].isLoading = false;
                                    BOOL canGoBack = FALSE;
                                    BOOL canGoForward = FALSE;
                                    m_webView->get_CanGoBack(&canGoBack);
                                    m_webView->get_CanGoForward(&canGoForward);
                                    m_tabs[m_activeTabId].canGoBack = canGoBack;
                                    m_tabs[m_activeTabId].canGoForward = canGoForward;
                                    NotifyStateChanged();
                                }
                                return S_OK;
                            }
                        ).Get(), nullptr
                    );

                    m_webView->add_SourceChanged(
                        Callback<ICoreWebView2SourceChangedEventHandler>(
                            [this](ICoreWebView2* sender, ICoreWebView2SourceChangedEventArgs* args) -> HRESULT {
                                LPWSTR uri = nullptr;
                                if (SUCCEEDED(m_webView->get_Source(&uri)) && uri) {
                                    if (!m_activeTabId.empty()) {
                                        m_tabs[m_activeTabId].url = WideToUtf8(uri);
                                        NotifyStateChanged();
                                    }
                                    CoTaskMemFree(uri);
                                }
                                return S_OK;
                            }
                        ).Get(), nullptr
                    );

                    m_webView->add_DocumentTitleChanged(
                        Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
                            [this](ICoreWebView2* sender, IUnknown* args) -> HRESULT {
                                LPWSTR title = nullptr;
                                if (SUCCEEDED(m_webView->get_DocumentTitle(&title)) && title) {
                                    if (!m_activeTabId.empty()) {
                                        m_tabs[m_activeTabId].title = WideToUtf8(title);
                                        NotifyStateChanged();
                                    }
                                    CoTaskMemFree(title);
                                }
                                return S_OK;
                            }
                        ).Get(), nullptr
                    );
                }

                // Create initial tab
                CreateTab("https://www.google.com");
                return S_OK;
            }
        ).Get()
    );

    return SUCCEEDED(hr);
}

void BrowserTabsManager::Shutdown() {
    if (m_controller) {
        if (m_gotFocusToken.value != 0) m_controller->remove_GotFocus(m_gotFocusToken);
        if (m_lostFocusToken.value != 0) m_controller->remove_LostFocus(m_lostFocusToken);
        if (m_moveFocusRequestedToken.value != 0) m_controller->remove_MoveFocusRequested(m_moveFocusRequestedToken);
        if (m_acceleratorToken.value != 0) m_controller->remove_AcceleratorKeyPressed(m_acceleratorToken);
        m_controller->Close();
    }
    m_webView.Reset();
    m_compositionController.Reset();
    m_controller.Reset();
    m_tabs.clear();
    m_activeTabId.clear();
    m_hasFocus = false;
}

void BrowserTabsManager::SetupFocusAndAcceleratorHandling() {
    if (!m_controller) return;

    // GotFocus
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

    // LostFocus
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

    // MoveFocusRequested
    m_controller->add_MoveFocusRequested(
        Callback<ICoreWebView2MoveFocusRequestedEventHandler>(
            [this](ICoreWebView2Controller* sender, ICoreWebView2MoveFocusRequestedEventArgs* args) -> HRESULT {
                args->put_Handled(TRUE);
                return S_OK;
            }
        ).Get(),
        &m_moveFocusRequestedToken
    );

    // AcceleratorKeyPressed (allow browser shortcuts & normal text input)
    m_controller->add_AcceleratorKeyPressed(
        Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
            [this](ICoreWebView2Controller* sender, ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT {
                args->put_Handled(FALSE);
                return S_OK;
            }
        ).Get(),
        &m_acceleratorToken
    );
}

std::string BrowserTabsManager::CreateTab(const std::string& initialUrl) {
    std::string id = "tab_" + std::to_string(std::chrono::system_clock::now().time_since_epoch().count());
    BrowserTab tab;
    tab.id = id;
    tab.url = initialUrl.empty() ? "https://www.google.com" : initialUrl;
    tab.title = "New Tab";
    m_tabs[id] = tab;

    SelectTab(id);
    return id;
}

bool BrowserTabsManager::CloseTab(const std::string& id) {
    auto it = m_tabs.find(id);
    if (it == m_tabs.end()) return false;
    m_tabs.erase(it);

    if (m_activeTabId == id) {
        if (!m_tabs.empty()) {
            SelectTab(m_tabs.begin()->first);
        } else {
            m_activeTabId.clear();
            if (m_controller) m_controller->put_IsVisible(FALSE);
            NotifyStateChanged();
        }
    }
    return true;
}

bool BrowserTabsManager::SelectTab(const std::string& id) {
    auto it = m_tabs.find(id);
    if (it == m_tabs.end()) return false;
    m_activeTabId = id;

    if (m_webView) {
        std::wstring wideUrl = Utf8ToWide(it->second.url);
        m_webView->Navigate(wideUrl.c_str());
    }
    NotifyStateChanged();
    return true;
}

bool BrowserTabsManager::Navigate(const std::string& id, const std::string& url) {
    auto it = m_tabs.find(id);
    if (it == m_tabs.end()) return false;
    it->second.url = url;

    if (m_activeTabId == id && m_webView) {
        std::wstring wideUrl = Utf8ToWide(url);
        m_webView->Navigate(wideUrl.c_str());
    }
    NotifyStateChanged();
    return true;
}

bool BrowserTabsManager::GoBack(const std::string& id) {
    if (m_activeTabId == id && m_webView) {
        return SUCCEEDED(m_webView->GoBack());
    }
    return false;
}

bool BrowserTabsManager::GoForward(const std::string& id) {
    if (m_activeTabId == id && m_webView) {
        return SUCCEEDED(m_webView->GoForward());
    }
    return false;
}

bool BrowserTabsManager::Reload(const std::string& id) {
    if (m_activeTabId == id && m_webView) {
        return SUCCEEDED(m_webView->Reload());
    }
    return false;
}

bool BrowserTabsManager::Stop(const std::string& id) {
    if (m_activeTabId == id && m_webView) {
        return SUCCEEDED(m_webView->Stop());
    }
    return false;
}

void BrowserTabsManager::SetLayout(const BrowserLayout& layout) {
    m_layout = layout;
    if (m_controller) {
        RECT rc{ layout.x, layout.y, layout.x + layout.width, layout.y + layout.height };
        m_controller->put_Bounds(rc);
        m_controller->put_IsVisible(layout.visible ? TRUE : FALSE);
    }
    NotifyStateChanged();
}

void BrowserTabsManager::SetZoom(const std::string& id, float factor) {
    auto it = m_tabs.find(id);
    if (it == m_tabs.end()) return;
    it->second.zoomLevel = factor;

    if (m_activeTabId == id && m_controller) {
        m_controller->put_ZoomFactor(static_cast<double>(factor));
    }
}

void BrowserTabsManager::ClearData() {
    if (!m_webView) return;
    ComPtr<ICoreWebView2_13> webView13;
    if (SUCCEEDED(m_webView.As(&webView13)) && webView13) {
        ComPtr<ICoreWebView2Profile> profile;
        if (SUCCEEDED(webView13->get_Profile(&profile)) && profile) {
            ComPtr<ICoreWebView2Profile2> profile2;
            if (SUCCEEDED(profile.As(&profile2)) && profile2) {
                profile2->ClearBrowsingDataAll(nullptr);
            }
        }
    }
}

json BrowserTabsManager::GetStateSnapshot() const {
    json tabsArray = json::array();
    for (const auto& [id, tab] : m_tabs) {
        json t;
        t["id"] = tab.id;
        t["url"] = tab.url;
        t["title"] = tab.title;
        t["canGoBack"] = tab.canGoBack;
        t["canGoForward"] = tab.canGoForward;
        t["isLoading"] = tab.isLoading;
        t["zoomLevel"] = tab.zoomLevel;
        tabsArray.push_back(t);
    }

    json j;
    j["tabs"] = tabsArray;
    j["activeTabId"] = m_activeTabId;
    j["layout"] = {
        { "x", m_layout.x },
        { "y", m_layout.y },
        { "width", m_layout.width },
        { "height", m_layout.height },
        { "visible", m_layout.visible }
    };
    return j;
}

void BrowserTabsManager::SendMouseInput(UINT msg, WPARAM wParam, LPARAM lParam) {
    if (!m_compositionController || !m_layout.visible) return;

    POINT pt{ GET_X_LPARAM(lParam) - m_layout.x, GET_Y_LPARAM(lParam) - m_layout.y };
    COREWEBVIEW2_MOUSE_EVENT_KIND mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE;
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS virtKeys = COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE;
    UINT32 mouseData = 0;

    switch (msg) {
        case WM_MOUSEMOVE:   mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE; break;
        case WM_LBUTTONDOWN: mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN; break;
        case WM_LBUTTONUP:   mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP; break;
        case WM_RBUTTONDOWN: mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOWN; break;
        case WM_RBUTTONUP:   mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_UP; break;
        case WM_MOUSEWHEEL:
            mouseKind = COREWEBVIEW2_MOUSE_EVENT_KIND_WHEEL;
            mouseData = GET_WHEEL_DELTA_WPARAM(wParam);
            break;
        default: return;
    }

    if (wParam & MK_LBUTTON) virtKeys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON;
    if (wParam & MK_RBUTTON) virtKeys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_RIGHT_BUTTON;
    if (wParam & MK_SHIFT)   virtKeys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_SHIFT;
    if (wParam & MK_CONTROL) virtKeys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_CONTROL;

    m_compositionController->SendMouseInput(mouseKind, virtKeys, mouseData, pt);
}

void BrowserTabsManager::MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON reason) {
    if (m_controller && m_layout.visible) {
        m_controller->MoveFocus(reason);
    }
}

void BrowserTabsManager::NotifyStateChanged() {
    if (m_stateCallback) {
        m_stateCallback(GetStateSnapshot());
    }
}

} // namespace LensDesk
