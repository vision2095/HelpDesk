#pragma once
#include "common.hpp"

namespace LensDesk {

struct HotkeyBinding {
    int id;
    UINT modifiers;
    UINT vkCode;
    std::string actionName;
};

class InputManager {
public:
    InputManager();
    ~InputManager();

    bool Initialize(HWND hwnd);
    void Shutdown();

    bool RegisterHotkey(int id, UINT modifiers, UINT vkCode, const std::string& actionName);
    bool RegisterAccelerator(int id, const std::string& accelerator, const std::string& actionName);
    void UpdateShortcuts(const json& shortcuts);
    void UnregisterAllHotkeys();

    static bool ParseAccelerator(const std::string& accelerator, UINT& outModifiers, UINT& outVk);

    LRESULT HandleHotkey(WPARAM wParam, LPARAM lParam);

    // Destination-verified auto-typing
    bool StartAutoType(const std::string& text, int delayMs = 15);
    void StopAutoType();
    bool IsAutoTyping() const { return m_isAutoTyping; }

    using HotkeyCallback = std::function<void(const std::string& action)>;
    void SetHotkeyCallback(HotkeyCallback cb) { m_hotkeyCallback = cb; }

private:
    void AutoTypeWorker(std::wstring wideText, int delayMs);

    HWND m_hwnd = nullptr;
    std::unordered_map<int, HotkeyBinding> m_bindings;
    HotkeyCallback m_hotkeyCallback = nullptr;

    std::atomic<bool> m_isAutoTyping{ false };
    std::atomic<bool> m_stopAutoTyping{ false };
    std::thread m_autoTypeThread;
};

} // namespace LensDesk
