#include "../include/input_manager.hpp"
#include <thread>
#include <chrono>
#include <algorithm>
#include <random>

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

    // Mandate and enforce explicit HintLens parity global hotkeys
    RegisterHotkey(110, MOD_CONTROL | MOD_SHIFT, 'D', "desktop.capture");
    RegisterHotkey(111, MOD_CONTROL | MOD_SHIFT, 'M', "window.toggleMouseMode");
    RegisterHotkey(112, MOD_CONTROL | MOD_SHIFT, 'G', "browser.toggle");
    RegisterHotkey(113, MOD_CONTROL | MOD_SHIFT, 'P', "provider.cycle");
    RegisterHotkey(104, MOD_CONTROL | MOD_SHIFT, 'O', "overlay");
    RegisterHotkey(105, MOD_CONTROL | MOD_SHIFT, 'A', "hideAnswer");
    RegisterHotkey(106, MOD_CONTROL | MOD_SHIFT, 'T', "autoType");
    RegisterHotkey(107, MOD_CONTROL | MOD_ALT, VK_ESCAPE, "stopTyping");
    RegisterHotkey(108, MOD_SHIFT, 'M', "clickThrough");
    RegisterHotkey(109, MOD_CONTROL | MOD_ALT, 'R', "overlay.radial");
    RegisterHotkey(114, MOD_CONTROL | MOD_SHIFT, 'B', "pasteBundle");

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
            // Coordinate thread-affinity: dispatch asynchronously so WndProc message pump never stalls
            std::string action = it->second.actionName;
            auto cb = m_hotkeyCallback;
            std::thread([cb, action]() {
                cb(action);
            }).detach();
        }
        return 0;
    }
    return 0;
}

bool InputManager::StartAutoType(const std::string& text, int delayMs) {
    if (text.empty()) return false;
    if (m_isAutoTyping) {
        // Toggle pause / resume if typing is already in progress
        TogglePauseAutoType();
        return true;
    }

    StopAutoType();

    m_stopAutoTyping = false;
    m_isTypingPaused = false;
    m_isAutoTyping = true;

    std::wstring wideText = Utf8ToWide(text);
    m_autoTypeThread = std::thread(&InputManager::AutoTypeWorker, this, wideText, std::max(5, delayMs));
    return true;
}

void InputManager::StopAutoType() {
    m_stopAutoTyping = true;
    m_isTypingPaused = false;
    if (m_autoTypeThread.joinable()) {
        m_autoTypeThread.join();
    }
    m_isAutoTyping = false;
}

void InputManager::TogglePauseAutoType() {
    if (!m_isAutoTyping) return;
    m_isTypingPaused = !m_isTypingPaused;
    if (m_hotkeyCallback) {
        m_hotkeyCallback(m_isTypingPaused ? "typing:paused" : "typing:resumed");
    }
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

    // UIPI / Elevation compatibility check
    bool targetElevated = IsWindowElevated(targetHwnd);
    bool currentElevated = IsCurrentProcessElevated();
    bool uiAccess = HasUiAccess();

    if (targetElevated && !currentElevated && !uiAccess) {
        if (m_hotkeyCallback) {
            m_hotkeyCallback("typing:elevated_target");
        }
    }

    // 4. Wait for user to release any modifier keys (Shift, Ctrl, Alt, Win)
    for (int wait = 0; wait < 250 && !m_stopAutoTyping; ++wait) {
        if (!IsAnyModifierDown()) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }

    // 5. Initialize log-normal distribution for non-linear keystroke timing dynamics
    std::random_device rd;
    std::mt19937 gen(rd());
    double targetMean = static_cast<double>(std::max(5, delayMs));
    double sigma = 0.38; // Human variance shape parameter
    double mu = std::log(targetMean) - (sigma * sigma / 2.0);
    std::lognormal_distribution<double> logNormalDist(mu, sigma);

    // Multi-tier hesitation distributions for syntax delimiters and structural boundaries
    std::uniform_int_distribution<int> boundaryPauseDist(150, 400);
    std::uniform_int_distribution<int> tier1PauseDist(150, 250); // Delimiters: , : ( ) [ ] ' "
    std::uniform_int_distribution<int> tier2PauseDist(350, 500); // Structural: ; } { \n

    // Keep hardware input available so the user can pause or stop typing.

    // 6. Send unicode keystrokes with focus-drift safety and humanized timing
    for (wchar_t ch : wideText) {
        if (m_stopAutoTyping) break;

        // Recheck pause while modifiers are held: pause can arrive during this wait.
        while (!m_stopAutoTyping) {
            const bool modifierDown = IsAnyModifierDown();
            if (!modifierDown && !m_isTypingPaused) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(15));
        }
        if (m_stopAutoTyping) break;

        // INLINE POINTER FOCUS SAFETY INTERCEPTOR:
        // Verify target foreground window is strictly unchanged before dispatching input
        HWND currentFg = GetForegroundWindow();
        if (currentFg != targetHwnd) {
            // [TypeSim] Focus drifted - stopping to avoid typing into wrong window
            if (m_hotkeyCallback) {
                m_hotkeyCallback("typing:drifted");
            }
            break;
        }

        if (ch == L'\r') continue; // Skip CR in CRLF.

        // Send each key-down/up pair and any caret nudge in one batch so hardware
        // events cannot interleave with a partially sent keystroke.
        INPUT inputs[6]{};
        UINT inputCount = 0;
        auto appendKey = [&](WORD code, DWORD flags, bool unicode) {
            INPUT down{};
            down.type = INPUT_KEYBOARD;
            if (unicode) down.ki.wScan = code;
            else down.ki.wVk = code;
            down.ki.dwFlags = flags;
            inputs[inputCount++] = down;
            INPUT up = down;
            up.ki.dwFlags |= KEYEVENTF_KEYUP;
            inputs[inputCount++] = up;
        };
        if (ch == L'\n') appendKey(VK_RETURN, 0, false);
        else if (ch == L'\t') appendKey(VK_TAB, 0, false);
        else appendKey(static_cast<WORD>(ch), KEYEVENTF_UNICODE, true);

        if (ch == L'{' || ch == L'}' || ch == L'(' || ch == L')' ||
            ch == L'[' || ch == L']' || ch == L'"' || ch == L'\'') {
            appendKey(VK_LEFT, 0, false);
            appendKey(VK_RIGHT, 0, false);
        }
        if (SendInput(inputCount, inputs, sizeof(INPUT)) != inputCount) {
            DWORD err = GetLastError();
            if (err == ERROR_ACCESS_DENIED || (targetElevated && !currentElevated && !uiAccess)) {
                if (m_hotkeyCallback) m_hotkeyCallback("typing:elevated_target");
            } else {
                if (m_hotkeyCallback) m_hotkeyCallback("typing:error");
            }
            break;
        }

        // CONTEXT-AWARE LOG-NORMAL TYPING DYNAMICS:
        // Multi-tier hesitation weight matrix
        if (ch == L';' || ch == L'}' || ch == L'{' || ch == L'\n') {
            // Tier 2: Structural boundaries (350ms-500ms)
            int boundaryDelay = tier2PauseDist(gen);
            while (boundaryDelay > 0 && !m_stopAutoTyping) {
                int step = std::min(10, boundaryDelay);
                std::this_thread::sleep_for(std::chrono::milliseconds(step));
                boundaryDelay -= step;
            }
        } else if (ch == L',' || ch == L':' || ch == L'(' || ch == L')' ||
                   ch == L'[' || ch == L']' || ch == L'\'' || ch == L'"' || ch == L'.') {
            // Tier 1: Syntactic syntax delimiters (150ms-250ms)
            int boundaryDelay = tier1PauseDist(gen);
            while (boundaryDelay > 0 && !m_stopAutoTyping) {
                int step = std::min(10, boundaryDelay);
                std::this_thread::sleep_for(std::chrono::milliseconds(step));
                boundaryDelay -= step;
            }
        } else {
            // Non-linear asymmetric log-normal stroke latency
            int strokeDelay = std::clamp(static_cast<int>(logNormalDist(gen)), 8, 250);
            while (strokeDelay > 0 && !m_stopAutoTyping) {
                int step = std::min(10, strokeDelay);
                std::this_thread::sleep_for(std::chrono::milliseconds(step));
                strokeDelay -= step;
            }
        }
    }

    m_isAutoTyping = false;
}

static HHOOK s_globalMouseHook = nullptr;
static InputManager* s_inputManagerInstance = nullptr;
static ULONGLONG s_mbuttonDownTime = 0;
static POINT s_buttonDownPt{};
static bool s_buttonHeld = false;
static WPARAM s_heldButton = 0;
static std::atomic<POINT> s_lastRadialPos{};

static LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && s_inputManagerInstance) {
        auto* pMouse = reinterpret_cast<MSLLHOOKSTRUCT*>(lParam);
        if (wParam == WM_MBUTTONDOWN || wParam == WM_RBUTTONDOWN) {
            s_mbuttonDownTime = GetTickCount64();
            s_buttonDownPt = pMouse->pt;
            s_buttonHeld = true;
            s_heldButton = wParam;
        } else if (wParam == WM_MOUSEMOVE && s_buttonHeld) {
            ULONGLONG elapsed = GetTickCount64() - s_mbuttonDownTime;
            int dx = std::abs(pMouse->pt.x - s_buttonDownPt.x);
            int dy = std::abs(pMouse->pt.y - s_buttonDownPt.y);
            // 1:1 HintLens gesture: quick click preserves native context menu; hold-and-move triggers radial wheel
            if (elapsed >= 150 && (dx > 6 || dy > 6)) {
                s_buttonHeld = false; // Disarm to avoid redundant triggers
                s_lastRadialPos.store(pMouse->pt);
                s_inputManagerInstance->HandleHotkey(109, MAKELPARAM(pMouse->pt.x, pMouse->pt.y));
            }
        } else if (wParam == WM_MBUTTONUP || wParam == WM_RBUTTONUP) {
            s_buttonHeld = false;
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

bool InputManager::IsCurrentProcessElevated() {
    HANDLE hToken = nullptr;
    bool isElevated = false;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
        TOKEN_ELEVATION elevation{};
        DWORD cbSize = sizeof(TOKEN_ELEVATION);
        if (GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &cbSize)) {
            isElevated = (elevation.TokenIsElevated != 0);
        }
        CloseHandle(hToken);
    }
    return isElevated;
}

bool InputManager::HasUiAccess() {
    HANDLE hToken = nullptr;
    DWORD uiAccess = 0;
    DWORD cbSize = sizeof(uiAccess);
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
        GetTokenInformation(hToken, TokenUIAccess, &uiAccess, sizeof(uiAccess), &cbSize);
        CloseHandle(hToken);
    }
    return uiAccess != 0;
}

bool InputManager::IsWindowElevated(HWND targetHwnd) {
    if (!targetHwnd || !IsWindow(targetHwnd)) return false;
    DWORD pid = 0;
    GetWindowThreadProcessId(targetHwnd, &pid);
    if (pid == 0 || pid == GetCurrentProcessId()) return false;

    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!hProcess) {
        // If OpenProcess fails with access denied, the target process is elevated or protected relative to us
        if (GetLastError() == ERROR_ACCESS_DENIED) return true;
        return false;
    }
    HANDLE hToken = nullptr;
    bool isElevated = false;
    if (OpenProcessToken(hProcess, TOKEN_QUERY, &hToken)) {
        TOKEN_ELEVATION elevation{};
        DWORD cbSize = sizeof(TOKEN_ELEVATION);
        if (GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &cbSize)) {
            isElevated = (elevation.TokenIsElevated != 0);
        }
        CloseHandle(hToken);
    }
    CloseHandle(hProcess);
    return isElevated;
}

} // namespace LensDesk
