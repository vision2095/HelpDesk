// derived: rea/native/windows/src/process.cc
#include "layout_watchdog.h"

namespace LensDesk::Native {

LayoutWatchdog::LayoutWatchdog() = default;

LayoutWatchdog::~LayoutWatchdog() {
    Stop();
}

void LayoutWatchdog::Start(HWND targetHwnd) {
    if (m_running.exchange(true)) {
        return;
    }
    m_hwnd = targetHwnd;

#if defined(_WIN32)
    if (m_hwnd && IsWindow(m_hwnd)) {
        GetWindowRect(m_hwnd, &m_cachedRect);
        m_originalParent = GetParent(m_hwnd);
        SetParent(m_hwnd, GetDesktopWindow());
        SetWindowDisplayAffinity(m_hwnd, WDA_EXCLUDEFROMCAPTURE);
    }
#endif

    m_worker = std::thread(&LayoutWatchdog::WatchdogLoop, this);
}

void LayoutWatchdog::Stop() {
    if (!m_running.exchange(false)) {
        return;
    }
    if (m_worker.joinable()) {
        m_worker.join();
    }

#if defined(_WIN32)
    if (m_hwnd && IsWindow(m_hwnd)) {
        if (m_originalParent) {
            SetParent(m_hwnd, m_originalParent);
        }
    }
#endif
    m_hwnd = nullptr;
    m_originalParent = nullptr;
}

void LayoutWatchdog::WatchdogLoop() {
    while (m_running.load()) {
#if defined(_WIN32)
        if (!m_hwnd || !IsWindow(m_hwnd)) {
            break;
        }

        DWORD processId = 0;
        if (GetWindowThreadProcessId(m_hwnd, &processId) == 0) {
            break; // Stale window handle
        }

        int width = m_cachedRect.right - m_cachedRect.left;
        int height = m_cachedRect.bottom - m_cachedRect.top;

        SetWindowPos(
            m_hwnd,
            HWND_TOPMOST,
            m_cachedRect.left,
            m_cachedRect.top,
            width,
            height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW
        );
#endif
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
}

} // namespace LensDesk::Native
