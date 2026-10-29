// derived: rea/native/windows/src/process.cc
#pragma once
#include "common.h"

namespace LensDesk::Native {

class LayoutWatchdog {
public:
    LayoutWatchdog();
    ~LayoutWatchdog();

    void Start(HWND targetHwnd);
    void Stop();
    bool IsRunning() const noexcept { return m_running.load(); }
    RECT GetCachedRect() const noexcept { return m_cachedRect; }
    void UpdateCachedRect(const RECT& r) noexcept { m_cachedRect = r; }

    static constexpr UINT GetRequiredSwpFlags() noexcept {
        return SWP_NOACTIVATE | SWP_SHOWWINDOW;
    }

    static bool EnforceWindowLayout(HWND hwnd, const RECT& rect, UINT flags = GetRequiredSwpFlags());

private:
    void WatchdogLoop();

    HWND m_hwnd = nullptr;
    HWND m_originalParent = nullptr;
    RECT m_cachedRect{};
    std::atomic<bool> m_running{ false };
    std::thread m_worker;
};

} // namespace LensDesk::Native
