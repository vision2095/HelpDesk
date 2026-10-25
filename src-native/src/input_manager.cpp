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

    // Register standard default global hotkeys
    RegisterHotkey(101, MOD_CONTROL | MOD_SHIFT, 'L', "toggle");
    RegisterHotkey(102, MOD_SHIFT, 'H', "hide");
    RegisterHotkey(103, MOD_CONTROL | MOD_SHIFT, 'S', "capture");
    RegisterHotkey(104, MOD_CONTROL | MOD_SHIFT, 'O', "overlay");
    RegisterHotkey(105, MOD_CONTROL | MOD_SHIFT, 'A', "hideAnswer");
    RegisterHotkey(106, MOD_CONTROL | MOD_SHIFT, 'T', "autoType");
    RegisterHotkey(107, MOD_CONTROL | MOD_ALT, VK_ESCAPE, "stopTyping");
    RegisterHotkey(108, MOD_SHIFT, 'M', "clickThrough");
    RegisterHotkey(109, MOD_CONTROL | MOD_ALT, 'R', "overlay.radial");

    return true;
}

bool InputManager::ParseAccelerator(const std::string& accelerator, UINT& outModifiers, UINT& outVk) {
    outModifiers = 0;
    outVk = 0;
    if (accelerator.empty()) return false;

    std::vector<std::string> parts;
    std::string current;
    for (char c : accelerator) {
        if (c == '+') {
            if (!current.empty()) {
                parts.push_back(current);
                current.clear();
            }
        } else if (!std::isspace(static_cast<unsigned char>(c))) {
            current += c;
        }
    }
    if (!current.empty()) parts.push_back(current);
    if (parts.empty()) return false;

    for (size_t i = 0; i < parts.size(); ++i) {
        std::string part = parts[i];
        std::string lower;
        for (char c : part) lower += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

        if (lower == "ctrl" || lower == "control" || lower == "commandorcontrol" || lower == "cmdorctrl") {
            outModifiers |= MOD_CONTROL;
        } else if (lower == "shift") {
            outModifiers |= MOD_SHIFT;
        } else if (lower == "alt" || lower == "option") {
            outModifiers |= MOD_ALT;
        } else if (lower == "meta" || lower == "command" || lower == "cmd" || lower == "super" || lower == "win") {
            outModifiers |= MOD_WIN;
        } else {
            // Key
            if (part.size() == 1) {
                char c = part[0];
                if (c >= 'a' && c <= 'z') outVk = static_cast<UINT>('A' + (c - 'a'));
                else if (c >= 'A' && c <= 'Z') outVk = static_cast<UINT>(c);
                else if (c >= '0' && c <= '9') outVk = static_cast<UINT>(c);
                else if (c == '`' || c == '~') outVk = VK_OEM_3;
                else if (c == '-' || c == '_') outVk = VK_OEM_MINUS;
                else if (c == '=' || c == '+') outVk = VK_OEM_PLUS;
                else if (c == '[' || c == '{') outVk = VK_OEM_4;
                else if (c == ']' || c == '}') outVk = VK_OEM_6;
                else if (c == '\\' || c == '|') outVk = VK_OEM_5;
                else if (c == ';' || c == ':') outVk = VK_OEM_1;
                else if (c == '\'' || c == '\"') outVk = VK_OEM_7;
                else if (c == ',' || c == '<') outVk = VK_OEM_COMMA;
                else if (c == '.' || c == '>') outVk = VK_OEM_PERIOD;
                else if (c == '/' || c == '?') outVk = VK_OEM_2;
                else if (c == ' ') outVk = VK_SPACE;
            } else {
                if (lower == "space") outVk = VK_SPACE;
                else if (lower == "escape" || lower == "esc") outVk = VK_ESCAPE;
                else if (lower == "return" || lower == "enter") outVk = VK_RETURN;
                else if (lower == "tab") outVk = VK_TAB;
                else if (lower == "backspace") outVk = VK_BACK;
                else if (lower == "delete" || lower == "del") outVk = VK_DELETE;
                else if (lower == "insert" || lower == "ins") outVk = VK_INSERT;
                else if (lower == "home") outVk = VK_HOME;
                else if (lower == "end") outVk = VK_END;
                else if (lower == "pageup") outVk = VK_PRIOR;
                else if (lower == "pagedown") outVk = VK_NEXT;
                else if (lower == "up") outVk = VK_UP;
                else if (lower == "down") outVk = VK_DOWN;
                else if (lower == "left") outVk = VK_LEFT;
                else if (lower == "right") outVk = VK_RIGHT;
                else if (lower.size() >= 2 && lower[0] == 'f') {
                    try {
                        int fNum = std::stoi(lower.substr(1));
                        if (fNum >= 1 && fNum <= 24) {
                            outVk = VK_F1 + (fNum - 1);
                        }
                    } catch (...) {}
                }
            }
        }
    }

    return outVk != 0;
}

bool InputManager::RegisterAccelerator(int id, const std::string& accelerator, const std::string& actionName) {
    UINT modifiers = 0;
    UINT vkCode = 0;
    if (!ParseAccelerator(accelerator, modifiers, vkCode)) return false;
    return RegisterHotkey(id, modifiers, vkCode, actionName);
}

void InputManager::UpdateShortcuts(const json& shortcuts) {
    if (!m_hwnd || !shortcuts.is_object()) return;

    UnregisterAllHotkeys();

    int nextId = 1000;
    for (const auto& [action, accValue] : shortcuts.items()) {
        if (!accValue.is_string()) continue;
        std::string accelerator = accValue.get<std::string>();
        if (accelerator.empty()) continue;

        RegisterAccelerator(nextId++, accelerator, action);
    }
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
