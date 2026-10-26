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
    UninstallMouseHook();
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

static bool IsAnyModifierDown() {
#ifdef _WIN32
    const int modifiers[] = { VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN };
    for (int vk : modifiers) {
        if ((GetAsyncKeyState(vk) & 0x8000) != 0) {
            return true;
        }
    }
#endif
    return false;
}

static void SendVirtualKeyNative(WORD vk, int holdMs = 20) {
#ifdef _WIN32
    INPUT inputDown{};
    inputDown.type = INPUT_KEYBOARD;
    inputDown.ki.wVk = vk;
    inputDown.ki.wScan = static_cast<WORD>(MapVirtualKeyW(vk, 0));
    inputDown.ki.dwFlags = 0;
    SendInput(1, &inputDown, sizeof(INPUT));

    if (holdMs > 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(holdMs));
    }

    INPUT inputUp{};
    inputUp.type = INPUT_KEYBOARD;
    inputUp.ki.wVk = vk;
    inputUp.ki.wScan = static_cast<WORD>(MapVirtualKeyW(vk, 0));
    inputUp.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(1, &inputUp, sizeof(INPUT));
#endif
}

static void SendCaretNudgeNative() {
#ifdef _WIN32
    SendVirtualKeyNative(VK_LEFT, 10);
    SendVirtualKeyNative(VK_RIGHT, 10);
#endif
}

void InputManager::AutoTypeWorker(std::wstring wideText, int delayMs) {
    // 1. Initial short delay to allow target window activation
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    // 2. Query target window
    HWND targetHwnd = GetForegroundWindow();

    // 3. Safety validation: never type into LensDesk itself
    if (!targetHwnd || targetHwnd == m_hwnd) {
        m_isAutoTyping = false;
        return;
    }

    // 4. Wait for user to release any modifier keys (Shift, Ctrl, Alt, Win)
    for (int wait = 0; wait < 250 && !m_stopAutoTyping; ++wait) {
        if (!IsAnyModifierDown()) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }

    // 5. Send unicode keystrokes with realistic hold and interruptible slicing
    for (wchar_t ch : wideText) {
        if (m_stopAutoTyping) break;

        // Verify target foreground window is still active (HintLens focus drift guard)
        if (GetForegroundWindow() != targetHwnd) {
            // [TypeSim] Focus drifted stopping to avoid typing into wrong window
            break;
        }

        // Wait if modifier key is pressed mid-typing
        while (IsAnyModifierDown() && !m_stopAutoTyping) {
            std::this_thread::sleep_for(std::chrono::milliseconds(15));
        }
        if (m_stopAutoTyping) break;

        if (ch == L'\r') {
            continue; // Skip CR in CRLF
        } else if (ch == L'\n') {
            SendVirtualKeyNative(VK_RETURN, 20);
        } else if (ch == L'\t') {
            SendVirtualKeyNative(VK_TAB, 20);
        } else {
            // Key Down with KEYEVENTF_UNICODE
            INPUT inputDown{};
            inputDown.type = INPUT_KEYBOARD;
            inputDown.ki.wScan = ch;
            inputDown.ki.dwFlags = KEYEVENTF_UNICODE;
            SendInput(1, &inputDown, sizeof(INPUT));

            // Human key-hold contact duration (18ms)
            std::this_thread::sleep_for(std::chrono::milliseconds(18));

            // Key Up with KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
            INPUT inputUp{};
            inputUp.type = INPUT_KEYBOARD;
            inputUp.ki.wScan = ch;
            inputUp.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            SendInput(1, &inputUp, sizeof(INPUT));
        }

        // Caret nudge for delimiter characters (prevents autocomplete bracket double expansion)
        if (ch == L'{' || ch == L'}' || ch == L'(' || ch == L')' ||
            ch == L'[' || ch == L']' || ch == L'"' || ch == L'\'') {
            SendCaretNudgeNative();
        }

        // Interruptible delay in 10ms slices
        int remaining = delayMs;
        while (remaining > 0 && !m_stopAutoTyping) {
            int step = std::min(10, remaining);
            std::this_thread::sleep_for(std::chrono::milliseconds(step));
            remaining -= step;
        }
    }

    m_isAutoTyping = false;
}

static HHOOK s_globalMouseHook = nullptr;
static InputManager* s_inputManagerInstance = nullptr;

static LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && s_inputManagerInstance) {
        if (wParam == WM_MBUTTONDOWN || wParam == WM_RBUTTONDOWN) {
            // Trigger global radial action wheel overlay
            s_inputManagerInstance->HandleHotkey(109, 0);
        }
    }
    return CallNextHookEx(s_globalMouseHook, nCode, wParam, lParam);
}

bool InputManager::InstallMouseHook(bool enable, const std::string& trigger) {
    s_inputManagerInstance = this;
    if (!enable) {
        UninstallMouseHook();
        return true;
    }
    if (s_globalMouseHook) return true;
    s_globalMouseHook = SetWindowsHookExW(WH_MOUSE_LL, LowLevelMouseProc, GetModuleHandle(nullptr), 0);
    return s_globalMouseHook != nullptr;
}

void InputManager::UninstallMouseHook() {
    if (s_globalMouseHook) {
        UnhookWindowsHookEx(s_globalMouseHook);
        s_globalMouseHook = nullptr;
    }
}

} // namespace LensDesk
