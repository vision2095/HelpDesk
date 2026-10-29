// derived: rea/native/windows/src/process.cc
#include "layout_watchdog.h"

namespace LensDesk::Native {

LayoutWatchdog::LayoutWatchdog() = default;

LayoutWatchdog::~LayoutWatchdog() {
    Stop();
}

bool LayoutWatchdog::EnforceWindowLayout(HWND hwnd, const RECT& rect, UINT flags) {
    if (!hwnd) {
        return false;
    }
    int width = rect.right - rect.left;
    int height = rect.bottom - rect.top;
    if (width <= 0 || height <= 0) {
        return false;
    }
    // Mutation protection: Must strictly contain SWP_NOACTIVATE and SWP_SHOWWINDOW
    if ((flags & SWP_NOACTIVATE) == 0 || (flags & SWP_SHOWWINDOW) == 0) {
        return false;
    }
    // Must NOT contain SWP_NOSIZE or SWP_NOMOVE as explicit bounds are required
    if ((flags & SWP_NOSIZE) != 0 || (flags & SWP_NOMOVE) != 0) {
        return false;
    }

#if defined(_WIN32)
    return SetWindowPos(
        hwnd,
        HWND_TOPMOST,
        rect.left,
        rect.top,
        width,
        height,
        flags
    ) != FALSE;
#else
    return true;
#endif
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

        EnforceWindowLayout(m_hwnd, m_cachedRect, GetRequiredSwpFlags());
#endif
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
}

} // namespace LensDesk::Native
