// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"

namespace LensDesk::Native {

class AtomicRefCount {
public:
    explicit AtomicRefCount(uint32_t init = 1) : m_refCount(init) {}
    uint32_t AddRef() noexcept { return ++m_refCount; }
    uint32_t Release() noexcept { return --m_refCount; }
    uint32_t Get() const noexcept { return m_refCount.load(); }
private:
    std::atomic<uint32_t> m_refCount;
};

class WebView2Bootstrap {
public:
    static bool IsRuntimeInstalled();
    static bool DownloadAndInstallRuntime();

    static const wchar_t* GetRegistrySubkey() noexcept {
        return L"SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    }

    static const wchar_t* GetGuidString() noexcept {
        return L"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    }

    static const wchar_t* GetSilentInstallArgs() noexcept {
        return L" /silent /install";
    }

    static bool EvaluateRegistryPresence(bool hklmHasPv, const wchar_t* hklmVal, bool hkcuHasPv, const wchar_t* hkcuVal) {
        if (hklmHasPv && hklmVal && std::wcslen(hklmVal) > 0 && std::wcscmp(hklmVal, L"0.0.0.0") != 0) {
            return true;
        }
        if (hkcuHasPv && hkcuVal && std::wcslen(hkcuVal) > 0 && std::wcscmp(hkcuVal, L"0.0.0.0") != 0) {
            return true;
        }
        return false;
    }
};

} // namespace LensDesk::Native
