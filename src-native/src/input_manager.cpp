#include "../include/input_manager.hpp"
#include <thread>
#include <chrono>
#include <algorithm>

namespace LensDesk {

InputManager::InputManager() = default;

InputManager::~InputManager() {
    Shutdown();
}

bool InputManager::Initialize(HWND hwnd) {
    m_hwnd = hwnd;

    // Register default global hotkeys
    // 1. Ctrl+Shift+L: Toggle Overlay
    RegisterHotkey(101, MOD_CONTROL | MOD_SHIFT, 'L', "desktop.overlay");
    // 2. Ctrl+Shift+S: AI Snip Screen
    RegisterHotkey(102, MOD_CONTROL | MOD_SHIFT, 'S', "desktop.capture");
    // 3. Ctrl+Shift+A: AutoType last answer
    RegisterHotkey(103, MOD_CONTROL | MOD_SHIFT, 'A', "desktop.autoType");
    // 4. Ctrl+Alt+R: Radial Menu
    RegisterHotkey(104, MOD_CONTROL | MOD_ALT, 'R', "overlay.radial");

    return true;
}

void InputManager::Shutdown() {
    StopAutoType();
    UnregisterAllHotkeys();
    m_hwnd = nullptr;
}

bool InputManager::RegisterHotkey(int id, UINT modifiers, UINT vkCode, const std::string& actionName) {
    if (!m_hwnd) return false;

    // Check if ID already exists, unregister first
    UnregisterHotKey(m_hwnd, id);

    if (RegisterHotKey(m_hwnd, id, modifiers | MOD_NOREPEAT, vkCode)) {
        m_bindings[id] = { id, modifiers, vkCode, actionName };
        return true;
    }
    return false;
}

void InputManager::UnregisterAllHotkeys() {
    if (!m_hwnd) return;
    for (const auto& [id, _] : m_bindings) {
        UnregisterHotKey(m_hwnd, id);
    }
    m_bindings.clear();
}

LRESULT InputManager::HandleHotkey(WPARAM wParam, LPARAM lParam) {
    int id = static_cast<int>(wParam);
    auto it = m_bindings.find(id);
    if (it != m_bindings.end()) {
        if (m_hotkeyCallback) {
            m_hotkeyCallback(it->second.actionName);
        }
        return 0;
    }
    return 0;
}

bool InputManager::StartAutoType(const std::string& text, int delayMs) {
    if (text.empty() || m_isAutoTyping) return false;

    StopAutoType();

    m_stopAutoTyping = false;
    m_isAutoTyping = true;

    std::wstring wideText = Utf8ToWide(text);
    m_autoTypeThread = std::thread(&InputManager::AutoTypeWorker, this, wideText, std::max(5, delayMs));
    return true;
}

void InputManager::StopAutoType() {
    m_stopAutoTyping = true;
    if (m_autoTypeThread.joinable()) {
        m_autoTypeThread.join();
    }
    m_isAutoTyping = false;
}

void InputManager::AutoTypeWorker(std::wstring wideText, int delayMs) {
    // 1. Initial short delay to allow target window activation
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    // 2. Query target window
    HWND targetHwnd = GetForegroundWindow();

    // 3. Safety validation: never type into LensDesk itself
    if (targetHwnd == m_hwnd) {
        m_isAutoTyping = false;
        return;
    }

    // 4. Send unicode keystrokes
    for (wchar_t ch : wideText) {
        if (m_stopAutoTyping) break;

        // Verify target foreground window is still active
        if (GetForegroundWindow() != targetHwnd) {
            // Target window lost focus, abort to prevent accidental typing
            break;
        }

        INPUT inputs[2]{};

        // Key Down
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wScan = ch;
        inputs[0].ki.dwFlags = KEYEVENTF_UNICODE;

        // Key Up
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wScan = ch;
        inputs[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

        SendInput(2, inputs, sizeof(INPUT));

        std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
    }

    m_isAutoTyping = false;
}

} // namespace LensDesk
