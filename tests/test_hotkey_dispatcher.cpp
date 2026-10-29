// derived: rea/native/windows/src/process.cc
#include "../src/native/hotkey_dispatcher.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    HotkeyDispatcher dispatcher;

    std::vector<std::string> received;
    std::mutex mtx;
    dispatcher.SetHandler([&](const std::string& cmd) {
        std::lock_guard<std::mutex> lk(mtx);
        received.push_back(cmd);
    });

    HWND mockHwnd = reinterpret_cast<HWND>(0x7777);
    bool reg = dispatcher.RegisterGlobalHotkeys(mockHwnd);
    assert(reg);

    // Dispatch known Hotkey IDs 110-114
    assert(dispatcher.OnHotKey(110)); // desktop.capture
    assert(dispatcher.OnHotKey(111)); // window.toggleMouseMode
    assert(dispatcher.OnHotKey(112)); // browser.toggle
    assert(dispatcher.OnHotKey(113)); // provider.cycle
    assert(dispatcher.OnHotKey(114)); // pasteBundle
    assert(!dispatcher.OnHotKey(999)); // Unknown ID

    // Wait for single persistent worker thread to drain
    for (int wait = 0; wait < 100; ++wait) {
        if (dispatcher.GetProcessedCount() == 5) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    assert(dispatcher.GetProcessedCount() == 5);
    assert(dispatcher.GetQueueSize() == 0);

    {
        std::lock_guard<std::mutex> lk(mtx);
        assert(received.size() == 5);
        assert(received[0] == "desktop.capture");
        assert(received[1] == "window.toggleMouseMode");
        assert(received[2] == "browser.toggle");
        assert(received[3] == "provider.cycle");
        assert(received[4] == "pasteBundle");
    }

    dispatcher.OnDestroy(mockHwnd);
    std::cout << "[PASS] test_hotkey_dispatcher: 15 asserts verified.\n";
    return 0;
}
