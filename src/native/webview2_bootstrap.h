// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"

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
        return ++m_refCount;
    }

    STDMETHODIMP_(ULONG) Release() override {
        ULONG count = --m_refCount;
        if (count == 0) {
            delete this;
        }
        return count;
    }

    STDMETHODIMP OnStartBinding(DWORD, IBinding*) override { return S_OK; }
    STDMETHODIMP GetPriority(LONG*) override { return S_OK; }
    STDMETHODIMP OnLowResource(DWORD) override { return S_OK; }
    STDMETHODIMP OnProgress(ULONG ulProgress, ULONG ulProgressMax, ULONG ulStatusCode, LPCWSTR szStatusText) override {
        m_progress = ulProgress;
        m_progressMax = ulProgressMax;
        return S_OK;
    }
    STDMETHODIMP OnStopBinding(HRESULT, LPCWSTR) override { return S_OK; }
    STDMETHODIMP GetBindInfo(DWORD* grfBINDF, BINDINFO* pbindinfo) override { return S_OK; }
    STDMETHODIMP OnDataAvailable(DWORD, DWORD, FORMATETC*, STGMEDIUM*) override { return S_OK; }
    STDMETHODIMP OnObjectAvailable(REFIID, IUnknown*) override { return S_OK; }

    ULONG GetProgress() const noexcept { return m_progress.load(); }
    ULONG GetRefCount() const noexcept { return m_refCount.load(); }

private:
    std::atomic<ULONG> m_refCount{ 1 };
    std::atomic<ULONG> m_progress{ 0 };
    std::atomic<ULONG> m_progressMax{ 0 };
};
#else
class DownloadCallback {
public:
    DownloadCallback() : m_refCount(1) {}
    uint32_t AddRef() { return ++m_refCount; }
    uint32_t Release() {
        uint32_t c = --m_refCount;
        if (c == 0) delete this;
        return c;
    }
    uint32_t GetRefCount() const noexcept { return m_refCount.load(); }
private:
    std::atomic<uint32_t> m_refCount{ 1 };
};
#endif

class WebView2Bootstrap {
public:
    static bool IsRuntimeInstalled();
    static bool DownloadAndInstallRuntime();
};

} // namespace LensDesk::Native
