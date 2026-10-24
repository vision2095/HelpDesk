#pragma once
#include "common.hpp"
#include "../third_party/imgui/imgui.h"
#include "../third_party/imgui/imgui_impl_win32.h"
#include "../third_party/imgui/imgui_impl_dx11.h"

namespace LensDesk {

struct OverlayState {
    bool showRadialMenu = false;
    bool showDiagnostics = false;
    bool captureProtectionActive = true;
    bool aiConnected = true;
    std::string activeProfileName = "Software Engineer";
    std::string statusMessage = "Ready";
    float fps = 60.0f;
    float memoryMb = 48.0f;
};

class ImGuiOverlay {
public:
    ImGuiOverlay();
    ~ImGuiOverlay();

    bool Initialize(HWND hwnd, ID3D11Device* device, ID3D11DeviceContext* context);
    void Shutdown();

    void BeginFrame();
    void Render();
    void EndFrame();

    LRESULT HandleMessage(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled);

    bool WantCaptureMouse() const;
    bool WantCaptureKeyboard() const;

    OverlayState& GetState() { return m_state; }
    void ToggleRadialMenu() { m_state.showRadialMenu = !m_state.showRadialMenu; }
    void ToggleDiagnostics() { m_state.showDiagnostics = !m_state.showDiagnostics; }

    using ActionCallback = std::function<void(const std::string& action)>;
    void SetActionCallback(ActionCallback callback) { m_actionCallback = callback; }

private:
    void SetupTheme();
    void RenderStatusPill();
    void RenderRadialMenu();
    void RenderDiagnostics();

    HWND m_hwnd = nullptr;
    bool m_initialized = false;
    OverlayState m_state{};
    ActionCallback m_actionCallback = nullptr;
};

} // namespace LensDesk
