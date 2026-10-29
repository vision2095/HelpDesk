// derived: rea/native/windows/src/process.cc
#pragma once
#include "common.h"

namespace LensDesk::Native {

class HotkeyDispatcher {
public:
    using CommandHandler = std::function<void(const std::string&)>;

    HotkeyDispatcher();
    ~HotkeyDispatcher();

    bool RegisterGlobalHotkeys(HWND hwnd);
    void UnregisterGlobalHotkeys(HWND hwnd);

    // Call from WndProc on WM_HOTKEY
    bool OnHotKey(int hotkeyId);

    // Call from WndProc on WM_DESTROY
    void OnDestroy(HWND hwnd);

    void SetHandler(CommandHandler handler);
    size_t GetProcessedCount() const noexcept { return m_processedCount.load(); }
    size_t GetQueueSize();

private:
    void WorkerLoop();

    std::mutex m_mutex;
    std::condition_variable m_cv;
    std::vector<std::string> m_queue;
    std::atomic<bool> m_running{ false };
    std::atomic<size_t> m_processedCount{ 0 };
    std::thread m_worker;
    CommandHandler m_handler;
};

} // namespace LensDesk::Native
