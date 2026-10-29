// derived: rea/native/windows/src/process.cc
#include "hotkey_dispatcher.h"

namespace LensDesk::Native {

HotkeyDispatcher::HotkeyDispatcher() {
    m_running = true;
    m_worker = std::thread(&HotkeyDispatcher::WorkerLoop, this);
}

HotkeyDispatcher::~HotkeyDispatcher() {
    m_running = false;
    m_cv.notify_all();
    if (m_worker.joinable()) {
        m_worker.join();
    }
}

bool HotkeyDispatcher::RegisterGlobalHotkeys(HWND hwnd) {
#if defined(_WIN32)
    if (!hwnd) return false;
    // Register explicit HintLens Parity Hotkeys: Ctrl+Shift+D, M, G, P, B
    bool ok = true;
    ok &= (RegisterHotKey(hwnd, 110, MOD_CONTROL | MOD_SHIFT, 'D') != 0);
    ok &= (RegisterHotKey(hwnd, 111, MOD_CONTROL | MOD_SHIFT, 'M') != 0);
    ok &= (RegisterHotKey(hwnd, 112, MOD_CONTROL | MOD_SHIFT, 'G') != 0);
    ok &= (RegisterHotKey(hwnd, 113, MOD_CONTROL | MOD_SHIFT, 'P') != 0);
    ok &= (RegisterHotKey(hwnd, 114, MOD_CONTROL | MOD_SHIFT, 'B') != 0);
    return ok;
#else
    return hwnd != nullptr;
#endif
}

void HotkeyDispatcher::UnregisterGlobalHotkeys(HWND hwnd) {
#if defined(_WIN32)
    if (!hwnd) return;
    for (int id = 110; id <= 114; ++id) {
        UnregisterHotKey(hwnd, id);
    }
#else
    (void)hwnd;
#endif
}

bool HotkeyDispatcher::OnHotKey(int hotkeyId) {
    std::string command;
    switch (hotkeyId) {
        case 110: command = "desktop.capture"; break;
        case 111: command = "window.toggleMouseMode"; break;
        case 112: command = "browser.toggle"; break;
        case 113: command = "provider.cycle"; break;
        case 114: command = "pasteBundle"; break;
        default: return false;
    }

    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_queue.push_back(command);
    }
    m_cv.notify_one();
    return true;
}

void HotkeyDispatcher::OnDestroy(HWND hwnd) {
    UnregisterGlobalHotkeys(hwnd);
}

void HotkeyDispatcher::SetHandler(CommandHandler handler) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_handler = std::move(handler);
}

size_t HotkeyDispatcher::GetQueueSize() {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_queue.size();
}

void HotkeyDispatcher::WorkerLoop() {
    while (m_running.load()) {
        std::string command;
        {
            std::unique_lock<std::mutex> lock(m_mutex);
            m_cv.wait(lock, [this] {
                return !m_running.load() || !m_queue.empty();
            });

            if (!m_running.load() && m_queue.empty()) {
                break;
            }

            if (!m_queue.empty()) {
                command = std::move(m_queue.front());
                m_queue.erase(m_queue.begin());
            }
        }

        if (!command.empty()) {
            if (m_handler) {
                m_handler(command);
            }
            m_processedCount.fetch_add(1);
        }
    }
}

} // namespace LensDesk::Native
