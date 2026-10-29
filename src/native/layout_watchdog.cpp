// derived: rea/native/windows/src/process.cc
#include "layout_watchdog.h"
#include <cwctype>

namespace LensDesk::Native {

namespace {
    std::mutex g_targetsMutex;
    std::vector<std::wstring> g_dynamicTargets;

    // Baseline hardcoded proctor list with exact rea string table citations
    const std::vector<std::wstring>& GetDefaultProctors() {
        static const std::vector<std::wstring> s_defaults = {
            // rea:str@0x1b0cd0 L"LockDownBrowser.exe"
            L"lockdownbrowser.exe",
            // rea:str@0x1b0cf8 L"LockDownBrowserOEM.exe"
            L"lockdownbrowseroem.exe",
            // rea:str@0x1b0c58 L"SafeExamBrowser.exe"
            L"safeexambrowser.exe",
            // rea:str@0x1b0c20 L"SafeExamBrowser.Client.exe"
            L"safeexambrowser.client.exe",
            // rea:str@0x1b0d68 L"Guardian Browser.exe"
            L"guardian browser.exe",
            // rea:str@0x1b0e08 L"PSI Secure Browser.exe"
            L"psi secure browser.exe",
            // rea:str@0x1b0ee0 L"ProProctor.exe"
            L"proproctor.exe",
            // rea:str@0x1b0eb8 L"Proctortrack.exe"
            L"proctortrack.exe",
            // rea:str@0x1b0d48 L"ProctorU.exe"
            L"proctoru.exe",
            // Note: ProctorU may ship as Proctor.exe or ProctorU.Client.exe in variant deployments
            L"proctor.exe",
            // rea:str@0x1b0c80 L"Examplify.exe"
            L"examplify.exe",
            // rea:str@0x1b0ca0 L"Examsoft.SoftShield.exe"
            L"examsoft.softshield.exe",
            // rea:str@0x1b0d28 L"ExamGuard.exe"
            L"examguard.exe"
        };
        return s_defaults;
    }
}

LayoutWatchdog::LayoutWatchdog() = default;

LayoutWatchdog::~LayoutWatchdog() {
    Stop();
}

std::wstring LayoutWatchdog::NormalizeToLower(std::wstring_view str) {
    std::wstring out;
    out.reserve(str.size());
    for (wchar_t ch : str) {
        out.push_back(static_cast<wchar_t>(std::towlower(ch)));
    }
    return out;
}

std::wstring LayoutWatchdog::ExtractBasename(std::wstring_view fullPath) {
    size_t lastSep = fullPath.find_last_of(L"\\/");
    if (lastSep != std::wstring_view::npos) {
        fullPath = fullPath.substr(lastSep + 1);
    }
    return std::wstring(fullPath);
}

const std::vector<std::wstring>& LayoutWatchdog::GetConstrainedProctorList() {
    std::lock_guard<std::mutex> lock(g_targetsMutex);
    if (!g_dynamicTargets.empty()) {
        return g_dynamicTargets;
    }
    return GetDefaultProctors();
}

void LayoutWatchdog::SetDynamicTargets(const std::vector<std::wstring>& targets) {
    std::lock_guard<std::mutex> lock(g_targetsMutex);
    g_dynamicTargets.clear();
    for (const auto& t : targets) {
        g_dynamicTargets.push_back(NormalizeToLower(ExtractBasename(t)));
    }
}

bool LayoutWatchdog::IsConstrainedProctorProcess(std::wstring_view exeNameOrPath) {
    if (exeNameOrPath.empty()) {
        return false;
    }
    std::wstring base = ExtractBasename(exeNameOrPath);
    std::wstring lowerBase = NormalizeToLower(base);

    std::lock_guard<std::mutex> lock(g_targetsMutex);
    const auto& targets = g_dynamicTargets.empty() ? GetDefaultProctors() : g_dynamicTargets;
    for (const auto& target : targets) {
        // Strict case-insensitive whole-name match (not substring)
        if (lowerBase == target) {
            return true;
        }
    }
    return false;
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
