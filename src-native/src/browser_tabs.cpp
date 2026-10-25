#include "../include/browser_tabs.hpp"
#include <wrl/event.h>
#include <algorithm>
#include <cctype>
#include <cmath>

using namespace Microsoft::WRL;

namespace LensDesk {

namespace {

std::string Trim(std::string value) {
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) value.erase(value.begin());
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.pop_back();
    return value;
}

std::string UrlEncode(std::string_view value) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    out.reserve(value.size() * 3);
    for (unsigned char c : value) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            out.push_back(static_cast<char>(c));
        } else {
            out.push_back('%');
            out.push_back(hex[(c >> 4) & 0xF]);
            out.push_back(hex[c & 0xF]);
        }
    }
    return out;
}

std::string NormalizeUrl(const std::string& raw) {
    std::string value = Trim(raw);
    if (value.empty()) return "";
    std::string lower = value;
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (lower.rfind("http://", 0) == 0 || lower.rfind("https://", 0) == 0 ||
        lower.rfind("about:", 0) == 0 || lower.rfind("data:", 0) == 0 ||
        lower.rfind("file:", 0) == 0 || lower.rfind("edge:", 0) == 0) {
        return value;
    }
    if (lower.rfind("//", 0) == 0) return "https:" + value;
    const bool hasSpace = value.find_first_of(" \t\r\n") != std::string::npos;
    const bool looksLikeHost = !hasSpace &&
        (value.find('.') != std::string::npos || lower.rfind("localhost", 0) == 0);
    if (looksLikeHost) return "https://" + value;
    return "https://www.google.com/search?q=" + UrlEncode(value);
}

std::string FileNameFromUri(const std::string& uri) {
    std::string path = uri;
    const size_t query = path.find_first_of("?#");
    if (query != std::string::npos) path.erase(query);
    const size_t slash = path.find_last_of("/\\");
    if (slash != std::string::npos) path = path.substr(slash + 1);
    if (path.empty()) path = "download";
    return path;
}

std::string DownloadStateToString(COREWEBVIEW2_DOWNLOAD_STATE state) {
    switch (state) {
        case COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS: return "progressing";
        case COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED: return "completed";
        case COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED: return "interrupted";
        default: return "progressing";
    }
}

} // namespace

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

                // Keep the embedded browser fully hidden until the React HUD
                // asks for a viewport. It must never cover the HUD at startup.
                RECT hidden{ 0, 0, 0, 0 };
                m_controller->put_Bounds(hidden);
                m_controller->put_IsVisible(FALSE);

                COREWEBVIEW2_COLOR whiteBg{ 255, 255, 255, 255 };
                ComPtr<ICoreWebView2Controller2> c2;
                if (SUCCEEDED(m_controller.As(&c2))) {
                    c2->put_DefaultBackgroundColor(whiteBg);
                }

                SetupFocusAndAcceleratorHandling();
                SetupDownloadHandling();

                if (m_webView) {
                    m_webView->add_NavigationStarting(
                        Callback<ICoreWebView2NavigationStartingEventHandler>(
                            [this](ICoreWebView2* sender, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                                UINT64 navigationId = 0;
                                args->get_NavigationId(&navigationId);
                                m_latestNavigationId = navigationId;

                                if (!m_activeTabId.empty()) {
                                    auto it = m_tabs.find(m_activeTabId);
                                    if (it != m_tabs.end()) {
                                        it->second.isLoading = true;
                                        it->second.error.clear();
                                        // Reflect the destination immediately so the
                                        // UI never shows the previous page while a
                                        // navigation is in flight.
                                        LPWSTR uri = nullptr;
                                        if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
                                            it->second.url = WideToUtf8(uri);
                                            CoTaskMemFree(uri);
                                        }
                                    }
                                    NotifyStateChanged();
                                }
                                return S_OK;
                            }
                        ).Get(), nullptr
                    );

                    m_webView->add_NavigationCompleted(
                        Callback<ICoreWebView2NavigationCompletedEventHandler>(
                            [this](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                                // A navigation that was superseded by a newer one
                                // must not overwrite the active tab's state.
                                UINT64 navigationId = 0;
                                args->get_NavigationId(&navigationId);
                                if (navigationId != m_latestNavigationId) return S_OK;

                                if (!m_activeTabId.empty()) {
                                    auto it = m_tabs.find(m_activeTabId);
                                    if (it != m_tabs.end()) {
                                        it->second.isLoading = false;
                                        BOOL success = FALSE;
                                        args->get_IsSuccess(&success);
                                        if (!success) {
                                            COREWEBVIEW2_WEB_ERROR_STATUS status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                                            args->get_WebErrorStatus(&status);
                                            switch (status) {
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED:
                                                    it->second.error = "The site's address could not be found.";
                                                    break;
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED:
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET:
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT:
                                                    it->second.error = "The site could not be reached.";
                                                    break;
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT:
                                                    it->second.error = "The site took too long to respond.";
                                                    break;
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT:
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED:
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS:
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED:
                                                case COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID:
                                                    it->second.error = "The site's security certificate could not be verified.";
                                                    break;
                                                default:
                                                    it->second.error = "The page could not be loaded.";
                                                    break;
                                            }
                                        } else {
                                            it->second.error.clear();
                                        }
                                        BOOL canGoBack = FALSE;
                                        BOOL canGoForward = FALSE;
                                        m_webView->get_CanGoBack(&canGoBack);
                                        m_webView->get_CanGoForward(&canGoForward);
                                        it->second.canGoBack = canGoBack != FALSE;
                                        it->second.canGoForward = canGoForward != FALSE;

                                        // DocumentTitleChanged and SourceChanged are
                                        // not guaranteed to arrive in a deterministic
                                        // order (and may not fire for cached pages),
                                        // so refresh both from the document that just
                                        // finished loading.
                                        LPWSTR uri = nullptr;
                                        if (SUCCEEDED(m_webView->get_Source(&uri)) && uri) {
                                            std::string value = WideToUtf8(uri);
                                            if (!value.empty()) it->second.url = value;
                                            CoTaskMemFree(uri);
                                        }
                                        LPWSTR title = nullptr;
                                        if (SUCCEEDED(m_webView->get_DocumentTitle(&title)) && title) {
                                            std::string value = WideToUtf8(title);
                                            if (!value.empty()) it->second.title = value;
                                            CoTaskMemFree(title);
                                        }
                                    }
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
                                    std::string value = WideToUtf8(uri);
                                    if (!value.empty() && !m_activeTabId.empty()) {
                                        auto it = m_tabs.find(m_activeTabId);
                                        if (it != m_tabs.end()) it->second.url = value;
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
                                        auto it = m_tabs.find(m_activeTabId);
                                        if (it != m_tabs.end()) {
                                            std::string value = WideToUtf8(title);
                                            it->second.title = value.empty() ? "New Tab" : value;
                                        }
                                        NotifyStateChanged();
                                    }
                                    CoTaskMemFree(title);
                                }
                                return S_OK;
                            }
                        ).Get(), nullptr
                    );

                    m_webView->add_NewWindowRequested(
                        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                            [this](ICoreWebView2* sender, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                                LPWSTR uri = nullptr;
                                if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
                                    const std::string url = WideToUtf8(uri);
                                    CoTaskMemFree(uri);
                                    args->put_Handled(TRUE);
                                    if (!m_activeTabId.empty()) {
                                        Navigate(m_activeTabId, url);
                                    }
                                }
                                return S_OK;
                            }
                        ).Get(), nullptr
                    );
                }

                m_ready = true;
                m_layout = BrowserLayout{};
                ApplyLayout();

                if (!m_activeTabId.empty()) {
                    auto it = m_tabs.find(m_activeTabId);
                    if (it != m_tabs.end() && !it->second.url.empty() && m_webView) {
                        m_webView->Navigate(Utf8ToWide(it->second.url).c_str());
                    }
                }
                NotifyStateChanged();
                return S_OK;
            }
        ).Get()
    );

    return SUCCEEDED(hr);
}

void BrowserTabsManager::Shutdown() {
    for (auto& download : m_downloads) {
        if (download.operation) {
            if (download.bytesToken.value != 0) download.operation->remove_BytesReceivedChanged(download.bytesToken);
            if (download.stateToken.value != 0) download.operation->remove_StateChanged(download.stateToken);
        }
    }
    m_downloads.clear();

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
    m_tabOrder.clear();
    m_activeTabId.clear();
    m_hasFocus = false;
    m_ready = false;
}

void BrowserTabsManager::SetupFocusAndAcceleratorHandling() {
    if (!m_controller) return;

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

    m_controller->add_MoveFocusRequested(
        Callback<ICoreWebView2MoveFocusRequestedEventHandler>(
            [this](ICoreWebView2Controller* sender, ICoreWebView2MoveFocusRequestedEventArgs* args) -> HRESULT {
                // Let the host decide where Tab goes when it leaves the page.
                args->put_Handled(TRUE);
                return S_OK;
            }
        ).Get(),
        &m_moveFocusRequestedToken
    );

    m_controller->add_AcceleratorKeyPressed(
        Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
            [this](ICoreWebView2Controller* sender, ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT {
                UINT virtualKey = 0;
                args->get_VirtualKey(&virtualKey);
                const bool control = (GetKeyState(VK_CONTROL) & 0x8000) != 0;
                const bool alt = (GetKeyState(VK_MENU) & 0x8000) != 0;
                if (control && !alt && (virtualKey == 'L' || virtualKey == 'F')) {
                    args->put_Handled(TRUE);
                    if (virtualKey == 'L') FocusAddressBar();
                    else FocusFind();
                    return S_OK;
                }
                // Everything else, including ordinary text and IME input,
                // must be processed by the WebView2 content.
                args->put_Handled(FALSE);
                return S_OK;
            }
        ).Get(),
        &m_acceleratorToken
    );
}

void BrowserTabsManager::SetupDownloadHandling() {
    if (!m_webView) return;
    ComPtr<ICoreWebView2_4> webView4;
    if (FAILED(m_webView.As(&webView4)) || !webView4) return;

    webView4->add_DownloadStarting(
        Callback<ICoreWebView2DownloadStartingEventHandler>(
            [this](ICoreWebView2* sender, ICoreWebView2DownloadStartingEventArgs* args) -> HRESULT {
                ComPtr<ICoreWebView2DownloadOperation> operation;
                if (FAILED(args->get_DownloadOperation(&operation)) || !operation) return S_OK;

                BrowserDownload download;
                download.id = "dl_" + std::to_string(++m_downloadSequence);
                LPWSTR uri = nullptr;
                if (SUCCEEDED(operation->get_Uri(&uri)) && uri) {
                    download.name = FileNameFromUri(WideToUtf8(uri));
                    CoTaskMemFree(uri);
                }
                if (download.name.empty()) download.name = "download";
                INT64 total = 0;
                operation->get_TotalBytesToReceive(&total);
                download.total = total;
                download.operation = operation;

                operation->add_BytesReceivedChanged(
                    Callback<ICoreWebView2BytesReceivedChangedEventHandler>(
                        [this, id = download.id](ICoreWebView2DownloadOperation* sender, IUnknown* args) -> HRESULT {
                            UpdateDownload(id);
                            return S_OK;
                        }
                    ).Get(),
                    &download.bytesToken
                );
                operation->add_StateChanged(
                    Callback<ICoreWebView2StateChangedEventHandler>(
                        [this, id = download.id](ICoreWebView2DownloadOperation* sender, IUnknown* args) -> HRESULT {
                            UpdateDownload(id);
                            return S_OK;
                        }
                    ).Get(),
                    &download.stateToken
                );

                m_downloads.push_back(std::move(download));
                NotifyStateChanged();
                return S_OK;
            }
        ).Get(),
        nullptr
    );
}

void BrowserTabsManager::UpdateDownload(const std::string& id) {
    for (auto& download : m_downloads) {
        if (download.id != id || !download.operation) continue;
        INT64 received = 0;
        INT64 total = 0;
        COREWEBVIEW2_DOWNLOAD_STATE state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
        download.operation->get_BytesReceived(&received);
        download.operation->get_TotalBytesToReceive(&total);
        download.operation->get_State(&state);
        download.received = received;
        download.total = total;
        download.state = DownloadStateToString(state);
        NotifyStateChanged();
        return;
    }
}

std::string BrowserTabsManager::CreateTab(const std::string& initialUrl) {
    std::string id = "tab_" + std::to_string(++m_tabSequence) + "_" +
        std::to_string(std::chrono::system_clock::now().time_since_epoch().count());
    BrowserTab tab;
    tab.id = id;
    tab.url = initialUrl.empty() ? "about:blank" : NormalizeUrl(initialUrl);
    tab.title = "New Tab";
    m_tabs[id] = tab;
    m_tabOrder.push_back(id);
    m_activeTabId = id;

    if (m_ready && m_webView) {
        m_webView->Navigate(Utf8ToWide(tab.url).c_str());
    }
    NotifyStateChanged();
    return id;
}

bool BrowserTabsManager::CloseTab(const std::string& id) {
    auto it = m_tabs.find(id);
    if (it == m_tabs.end()) return false;
    m_tabs.erase(it);
    m_tabOrder.erase(std::remove(m_tabOrder.begin(), m_tabOrder.end(), id), m_tabOrder.end());

    if (m_activeTabId == id) {
        if (!m_tabOrder.empty()) {
            SelectTab(m_tabOrder.front());
        } else {
            m_activeTabId.clear();
            m_layout.visible = false;
            ApplyLayout();
            NotifyStateChanged();
        }
    } else {
        NotifyStateChanged();
    }
    return true;
}

bool BrowserTabsManager::SelectTab(const std::string& id) {
    auto it = m_tabs.find(id);
    if (it == m_tabs.end()) return false;
    const bool changed = m_activeTabId != id;
    m_activeTabId = id;

    if (changed && m_ready && m_webView) {
        if (!it->second.url.empty()) {
            m_webView->Navigate(Utf8ToWide(it->second.url).c_str());
        }
        if (m_controller) {
            m_controller->put_ZoomFactor(static_cast<double>(it->second.zoomLevel));
        }
    }
    NotifyStateChanged();
    return true;
}

bool BrowserTabsManager::Navigate(const std::string& id, const std::string& url) {
    auto it = m_tabs.find(id);
    if (it == m_tabs.end()) return false;
    const std::string normalized = NormalizeUrl(url);
    if (normalized.empty()) return false;
    it->second.url = normalized;
    it->second.error.clear();

    if (m_activeTabId == id && m_ready && m_webView) {
        m_webView->Navigate(Utf8ToWide(normalized).c_str());
    }
    NotifyStateChanged();
    return true;
}

bool BrowserTabsManager::GoBack(const std::string& id) {
    if (m_activeTabId == id && m_webView) {
        const HRESULT hr = m_webView->GoBack();
        NotifyStateChanged();
        return SUCCEEDED(hr);
    }
    return false;
}

bool BrowserTabsManager::GoForward(const std::string& id) {
    if (m_activeTabId == id && m_webView) {
        const HRESULT hr = m_webView->GoForward();
        NotifyStateChanged();
        return SUCCEEDED(hr);
    }
    return false;
}

bool BrowserTabsManager::Reload(const std::string& id) {
    if (m_activeTabId == id && m_webView) {
        const HRESULT hr = m_webView->Reload();
        NotifyStateChanged();
        return SUCCEEDED(hr);
    }
    return false;
}

bool BrowserTabsManager::Stop(const std::string& id) {
    if (m_activeTabId == id && m_webView) {
        const HRESULT hr = m_webView->Stop();
        NotifyStateChanged();
        return SUCCEEDED(hr);
    }
    return false;
}

bool BrowserTabsManager::Home(const std::string& homeUrl) {
    const std::string url = homeUrl.empty() ? "https://www.google.com" : NormalizeUrl(homeUrl);
    if (m_activeTabId.empty()) {
        CreateTab(url);
        return true;
    }
    return Navigate(m_activeTabId, url);
}

bool BrowserTabsManager::Find(const std::string& text, bool forward, bool findNext) {
    if (!m_webView) return false;
    std::string script;
    if (text.empty()) {
        script = "(() => { const s = window.getSelection(); if (s) s.removeAllRanges(); return true; })()";
    } else {
        script = "(() => { const term = " + json(text).dump() +
            "; return window.find(term, false, " + (forward ? "false" : "true") +
            ", true, false, false, false); })()";
        (void)findNext;
    }
    m_webView->ExecuteScript(Utf8ToWide(script).c_str(), nullptr);
    return true;
}

bool BrowserTabsManager::CancelDownload(const std::string& id) {
    for (auto& download : m_downloads) {
        if (download.id != id || !download.operation) continue;
        if (download.state == "progressing") {
            download.operation->Cancel();
            NotifyStateChanged();
            return true;
        }
    }
    return false;
}

void BrowserTabsManager::SetLayout(const BrowserLayout& layout, float dpiScale) {
    if (dpiScale > 0.0f) m_dpiScale = dpiScale;
    m_layout = layout;
    ApplyLayout();
    NotifyStateChanged();
}

void BrowserTabsManager::SetDpiScale(float scale) {
    if (scale <= 0.0f || std::abs(scale - m_dpiScale) < 0.001f) return;
    const float ratio = scale / (m_dpiScale > 0.0f ? m_dpiScale : 1.0f);
    m_dpiScale = scale;
    m_layout.x = static_cast<int>(std::lround(m_layout.x * ratio));
    m_layout.y = static_cast<int>(std::lround(m_layout.y * ratio));
    m_layout.width = static_cast<int>(std::lround(m_layout.width * ratio));
    m_layout.height = static_cast<int>(std::lround(m_layout.height * ratio));
    ApplyLayout();
    NotifyStateChanged();
}

void BrowserTabsManager::ApplyLayout() {
    if (!m_controller) return;
    const bool show = m_layout.visible && m_layout.width > 0 && m_layout.height > 0;

    // The composition controller renders inside its root visual. Position the
    // visual at the React layout origin and keep the controller bounds local
    // (0,0,width,height). Passing the screen offset in put_Bounds instead made
    // the page render at the window origin (covering the toolbar) while mouse
    // hit-testing still used the offset, so clicks landed in the wrong place.
    if (m_browserVisual) {
        m_browserVisual->SetOffsetX(static_cast<float>(m_layout.x));
        m_browserVisual->SetOffsetY(static_cast<float>(m_layout.y));
    }

    RECT rc{ 0, 0, 0, 0 };
    if (show) {
        rc = RECT{ 0, 0, m_layout.width, m_layout.height };
    }
    m_controller->put_Bounds(rc);
    m_controller->put_IsVisible(show ? TRUE : FALSE);
}

void BrowserTabsManager::SetZoom(const std::string& id, float factor) {
    auto it = m_tabs.find(id);
    if (it == m_tabs.end()) return;
    const float clamped = std::max(0.25f, std::min(5.0f, factor));
    it->second.zoomLevel = clamped;

    if (m_activeTabId == id && m_controller) {
        m_controller->put_ZoomFactor(static_cast<double>(clamped));
    }
    NotifyStateChanged();
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
    for (const auto& id : m_tabOrder) {
        auto found = m_tabs.find(id);
        if (found == m_tabs.end()) continue;
        const BrowserTab& tab = found->second;
        json t;
        t["id"] = tab.id;
        t["url"] = tab.url;
        t["title"] = tab.title;
        t["loading"] = tab.isLoading;
        t["isLoading"] = tab.isLoading;
        t["error"] = tab.error;
        t["canGoBack"] = tab.canGoBack;
        t["canGoForward"] = tab.canGoForward;
        t["zoom"] = tab.zoomLevel;
        t["zoomLevel"] = tab.zoomLevel;
        tabsArray.push_back(t);
    }

    json downloads = json::array();
    for (const auto& download : m_downloads) {
        downloads.push_back({
            { "id", download.id },
            { "name", download.name },
            { "received", download.received },
            { "total", download.total },
            { "state", download.state }
        });
    }

    json j;
    j["tabs"] = tabsArray;
    j["activeId"] = m_activeTabId.empty() ? json(nullptr) : json(m_activeTabId);
    j["activeTabId"] = m_activeTabId;
    j["downloads"] = downloads;
    j["layout"] = {
        { "x", m_layout.x },
        { "y", m_layout.y },
        { "width", m_layout.width },
        { "height", m_layout.height },
        { "visible", m_layout.visible },
        { "dpiScale", m_dpiScale }
    };
    return j;
}

void BrowserTabsManager::SendMouseInput(UINT msg, WPARAM wParam, LPARAM lParam) {
    if (!m_compositionController || !m_layout.visible) return;

    POINT pt{ GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
    if (msg == WM_MOUSEWHEEL || msg == WM_MOUSEHWHEEL) {
        ScreenToClient(m_hwnd, &pt);
    }
    pt.x -= m_layout.x;
    pt.y -= m_layout.y;

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

void BrowserTabsManager::FocusAddressBar() {
    if (m_eventCallback) m_eventCallback("lens:browser-focus-address");
}

void BrowserTabsManager::FocusFind() {
    if (m_eventCallback) m_eventCallback("lens:browser-focus-find");
}

void BrowserTabsManager::NotifyStateChanged() {
    if (m_stateCallback) {
        m_stateCallback(GetStateSnapshot());
    }
}

} // namespace LensDesk
