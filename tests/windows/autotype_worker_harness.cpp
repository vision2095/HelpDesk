// Behavior harness for the production AutoTypeWorker compiled against Win32 stubs.
// Run: python3 tests/windows/test_autotype_worker.py [--compiler PATH]
// This does not exercise Windows, physical input, or actual SendInput semantics.
#include <algorithm>
#include <atomic>
#include <cassert>
#include <chrono>
#include <cmath>
#include <functional>
#include <random>
#include <string>
#include <thread>

using WORD = unsigned short;
using DWORD = unsigned long;
using UINT = unsigned int;
using HWND = int;
struct INPUT { int type; struct { WORD wScan; WORD wVk; DWORD dwFlags; } ki; };
constexpr int INPUT_KEYBOARD = 1, KEYEVENTF_KEYUP = 2, KEYEVENTF_UNICODE = 4;
constexpr WORD VK_RETURN = 13, VK_TAB = 9, VK_LEFT = 37, VK_RIGHT = 39;
std::atomic<int> foreground{1}, modifierPolls{0}, sends{0};
std::atomic<bool> modifier{true}, partialSend{false};
std::atomic<bool> blockSecondPoll{false}, secondPollEntered{false}, releaseSecondPoll{false};
HWND GetForegroundWindow() { return foreground.load(); }
bool IsAnyModifierDown() {
    // The first call is the initial modifier-release check.
    const int poll = ++modifierPolls;
    if (poll == 1) return false;
    const bool result = modifier.load();
    if (poll == 2 && blockSecondPoll) {
        secondPollEntered = true;
        while (!releaseSecondPoll) std::this_thread::yield();
    }
    return result;
}
UINT SendInput(UINT count, INPUT*, int) { ++sends; return partialSend ? count - 1 : count; }
struct InputManager {
    HWND m_hwnd = 9;
    std::atomic<bool> m_stopAutoTyping{false}, m_isTypingPaused{false}, m_isAutoTyping{true};
    std::function<void(const std::string&)> m_hotkeyCallback;
    void AutoTypeWorker(std::wstring, int);
};

// PRODUCTION_WORKER_INSERTION_POINT

void waitForCharacterModifierCheck() {
    for (int i = 0; i < 600 && modifierPolls < 2; ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    assert(modifierPolls >= 2);
}
void reset() {
    foreground = 1; modifier = true; modifierPolls = 0; sends = 0; partialSend = false;
    blockSecondPoll = false; secondPollEntered = false; releaseSecondPoll = false;
}
int main() {
    {
        reset();
        InputManager manager;
        std::atomic<bool> drift{false};
        manager.m_hotkeyCallback = [&](const std::string& e) { if (e == "typing:drifted") drift = true; };
        std::thread worker(&InputManager::AutoTypeWorker, &manager, L"x", 5);
        waitForCharacterModifierCheck();
        foreground = 2;
        modifier = false;
        worker.join();
        assert(drift && sends == 0);
    }
    {
        reset();
        InputManager manager;
        modifier = false;
        blockSecondPoll = true;
        std::thread worker(&InputManager::AutoTypeWorker, &manager, L"x", 5);
        for (int i = 0; i < 600 && !secondPollEntered; ++i)
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        assert(secondPollEntered);
        // Pause after the modifier was sampled, before the worker sees its result.
        manager.m_isTypingPaused = true;
        releaseSecondPoll = true;
        for (int i = 0; i < 600 && modifierPolls < 3 && sends == 0; ++i)
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        assert(modifierPolls >= 3 && sends == 0);
        manager.m_isTypingPaused = false;
        worker.join();
        assert(sends == 1);
    }
    {
        reset();
        InputManager manager;
        std::thread worker(&InputManager::AutoTypeWorker, &manager, L"x", 5);
        waitForCharacterModifierCheck();
        manager.m_stopAutoTyping = true;
        worker.join();
        assert(sends == 0 && !manager.m_isAutoTyping);
    }
    {
        reset();
        InputManager manager;
        std::atomic<bool> error{false};
        manager.m_hotkeyCallback = [&](const std::string& e) { if (e == "typing:error") error = true; };
        // Return one accepted event from the two-event batch.
        partialSend = true;
        std::thread worker(&InputManager::AutoTypeWorker, &manager, L"xy", 5);
        waitForCharacterModifierCheck();
        modifier = false;
        worker.join();
        assert(error && sends == 1 && !manager.m_isAutoTyping);
    }
}
