// derived: rea/native/windows/src/authority.hpp
#include "webview2_bootstrap.h"

namespace LensDesk::Native {

#if defined(_WIN32)
class DownloadCallback : public IBindStatusCallback {
public:
    DownloadCallback() : m_refCount(1) {}
    virtual ~DownloadCallback() = default;

    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IBindStatusCallback) {
            *ppv = static_cast<IBindStatusCallback*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }

    STDMETHODIMP_(ULONG) AddRef() override {
        return InterlockedIncrement(&m_refCount);
    }

    STDMETHODIMP_(ULONG) Release() override {
        ULONG count = InterlockedDecrement(&m_refCount);
        if (count == 0) {
            delete this;
        }
        return count;
    }

    STDMETHODIMP OnStartBinding(DWORD, IBinding*) override { return S_OK; }
    STDMETHODIMP GetPriority(LONG*) override { return S_OK; }
    STDMETHODIMP OnLowResource(DWORD) override { return S_OK; }
    STDMETHODIMP OnProgress(ULONG ulProgress, ULONG ulProgressMax, ULONG, LPCWSTR) override {
        m_progress = ulProgress;
        m_progressMax = ulProgressMax;
        return S_OK;
    }
    STDMETHODIMP OnStopBinding(HRESULT, LPCWSTR) override { return S_OK; }
    STDMETHODIMP GetBindInfo(DWORD* grfBINDF, BINDINFO* pbindinfo) override { return S_OK; }
    STDMETHODIMP OnDataAvailable(DWORD, DWORD, FORMATETC*, STGMEDIUM*) override { return S_OK; }
    STDMETHODIMP OnObjectAvailable(REFIID, IUnknown*) override { return S_OK; }

    ULONG GetProgress() const noexcept { return m_progress.load(); }
    ULONG GetRefCount() const noexcept { return m_refCount; }

private:
    volatile ULONG m_refCount{ 1 };
    std::atomic<ULONG> m_progress{ 0 };
    std::atomic<ULONG> m_progressMax{ 0 };
};
#endif

bool WebView2Bootstrap::IsRuntimeInstalled() {
#if defined(_WIN32)
    const wchar_t* subkey = L"SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    wchar_t version[128]{};
    DWORD cbData = sizeof(version);

    // 1. Check HKLM
    LSTATUS status = RegGetValueW(
        HKEY_LOCAL_MACHINE,
        subkey,
        L"pv",
        RRF_RT_REG_SZ,
        nullptr,
        version,
        &cbData
    );
    if (status == ERROR_SUCCESS && wcslen(version) > 0 && wcscmp(version, L"0.0.0.0") != 0) {
        return true;
    }

    // 2. Check HKCU fallback
    cbData = sizeof(version);
    status = RegGetValueW(
        HKEY_CURRENT_USER,
        subkey,
        L"pv",
        RRF_RT_REG_SZ,
        nullptr,
        version,
        &cbData
    );
    return (status == ERROR_SUCCESS && wcslen(version) > 0 && wcscmp(version, L"0.0.0.0") != 0);
#else
    return true;
#endif
}

bool WebView2Bootstrap::DownloadAndInstallRuntime() {
    if (IsRuntimeInstalled()) {
        return true;
    }

#if defined(_WIN32)
    wchar_t tempPath[MAX_PATH]{};
    GetTempPathW(MAX_PATH, tempPath);
    std::wstring installerPath = std::wstring(tempPath) + L"MicrosoftEdgeWebview2Setup.exe";

    // ComPtr holds the callback alive across URLDownloadToFileW
    ComPtr<IBindStatusCallback> callback;
    callback.Attach(new DownloadCallback());

    HRESULT hr = URLDownloadToFileW(
        nullptr,
        L"https://go.microsoft.com/fwlink/p/?LinkId=2124703",
        installerPath.c_str(),
        0,
        callback.Get()
    );

    if (FAILED(hr)) {
        return false;
    }

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    std::wstring cmd = installerPath + L" /silent /install";

    if (CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, 60000);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        DeleteFileW(installerPath.c_str());
        return IsRuntimeInstalled();
    }

    DeleteFileW(installerPath.c_str());
    return false;
#else
    return true;
#endif
}

} // namespace LensDesk::Native
