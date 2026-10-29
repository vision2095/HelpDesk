#include "../include/imgui_overlay.hpp"
#include <cmath>

extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);

namespace LensDesk {

ImGuiOverlay::ImGuiOverlay() = default;

ImGuiOverlay::~ImGuiOverlay() {
    Shutdown();
}

bool ImGuiOverlay::Initialize(HWND hwnd, ID3D11Device* device, ID3D11DeviceContext* context) {
    if (!hwnd || !device || !context) return false;
    m_hwnd = hwnd;

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    io.IniFilename = nullptr; // Stateless / memory-only

    SetupTheme();

    if (!ImGui_ImplWin32_Init(hwnd)) return false;
    if (!ImGui_ImplDX11_Init(device, context)) return false;

    m_initialized = true;
    return true;
}

void ImGuiOverlay::Shutdown() {
    if (m_initialized) {
        ImGui_ImplDX11_Shutdown();
        ImGui_ImplWin32_Shutdown();
        ImGui::DestroyContext();
        m_initialized = false;
    }
}

void ImGuiOverlay::SetupTheme() {
    ImGuiStyle& style = ImGui::GetStyle();
    ImVec4* colors = style.Colors;

    // LensDesk Dark Glass + Cyan palette
    colors[ImGuiCol_Text]                  = ImVec4(0.95f, 0.96f, 0.98f, 1.00f);
    colors[ImGuiCol_TextDisabled]          = ImVec4(0.50f, 0.55f, 0.65f, 1.00f);
    colors[ImGuiCol_WindowBg]              = ImVec4(0.04f, 0.06f, 0.09f, 0.88f); // Translucent Dark Glass
    colors[ImGuiCol_ChildBg]               = ImVec4(0.00f, 0.00f, 0.00f, 0.00f);
    colors[ImGuiCol_PopupBg]               = ImVec4(0.06f, 0.09f, 0.14f, 0.95f);
    colors[ImGuiCol_Border]                = ImVec4(0.12f, 0.16f, 0.23f, 0.80f);
    colors[ImGuiCol_BorderShadow]          = ImVec4(0.00f, 0.00f, 0.00f, 0.00f);
    colors[ImGuiCol_FrameBg]               = ImVec4(0.09f, 0.13f, 0.20f, 0.70f);
    colors[ImGuiCol_FrameBgHovered]        = ImVec4(0.12f, 0.18f, 0.28f, 0.80f);
    colors[ImGuiCol_FrameBgActive]         = ImVec4(0.15f, 0.22f, 0.35f, 0.90f);
    colors[ImGuiCol_TitleBg]               = ImVec4(0.04f, 0.06f, 0.09f, 0.90f);
    colors[ImGuiCol_TitleBgActive]         = ImVec4(0.06f, 0.09f, 0.14f, 1.00f);
    colors[ImGuiCol_TitleBgCollapsed]      = ImVec4(0.04f, 0.06f, 0.09f, 0.60f);
    colors[ImGuiCol_MenuBarBg]             = ImVec4(0.06f, 0.09f, 0.14f, 1.00f);
    colors[ImGuiCol_ScrollbarBg]           = ImVec4(0.02f, 0.03f, 0.05f, 0.50f);
    colors[ImGuiCol_ScrollbarGrab]         = ImVec4(0.15f, 0.20f, 0.28f, 0.80f);
    colors[ImGuiCol_ScrollbarGrabHovered]  = ImVec4(0.20f, 0.28f, 0.40f, 0.90f);
    colors[ImGuiCol_ScrollbarGrabActive]   = ImVec4(0.02f, 0.71f, 0.83f, 1.00f); // Cyan
    colors[ImGuiCol_CheckMark]             = ImVec4(0.02f, 0.71f, 0.83f, 1.00f);
    colors[ImGuiCol_SliderGrab]            = ImVec4(0.02f, 0.71f, 0.83f, 1.00f);
    colors[ImGuiCol_SliderGrabActive]      = ImVec4(0.20f, 0.85f, 0.95f, 1.00f);
    colors[ImGuiCol_Button]                = ImVec4(0.08f, 0.12f, 0.18f, 0.80f);
    colors[ImGuiCol_ButtonHovered]         = ImVec4(0.12f, 0.20f, 0.30f, 0.90f);
    colors[ImGuiCol_ButtonActive]          = ImVec4(0.02f, 0.71f, 0.83f, 0.90f);
    colors[ImGuiCol_Header]                = ImVec4(0.08f, 0.12f, 0.18f, 0.70f);
    colors[ImGuiCol_HeaderHovered]         = ImVec4(0.12f, 0.20f, 0.30f, 0.85f);
    colors[ImGuiCol_HeaderActive]          = ImVec4(0.02f, 0.71f, 0.83f, 0.80f);
    colors[ImGuiCol_Separator]             = ImVec4(0.12f, 0.16f, 0.23f, 0.70f);
    colors[ImGuiCol_SeparatorHovered]      = ImVec4(0.02f, 0.71f, 0.83f, 0.80f);
    colors[ImGuiCol_SeparatorActive]       = ImVec4(0.02f, 0.71f, 0.83f, 1.00f);

    // Smooth curvature and modern padding
    style.WindowRounding    = 10.0f;
    style.ChildRounding     = 8.0f;
    style.FrameRounding     = 6.0f;
    style.PopupRounding     = 8.0f;
    style.ScrollbarRounding = 9.0f;
    style.GrabRounding      = 6.0f;
    style.TabRounding       = 6.0f;
    style.WindowBorderSize  = 1.0f;
    style.FrameBorderSize   = 0.0f;
    style.PopupBorderSize   = 1.0f;
    style.WindowPadding     = ImVec2(12.0f, 12.0f);
    style.FramePadding      = ImVec2(8.0f, 5.0f);
    style.ItemSpacing       = ImVec2(8.0f, 6.0f);
}

void ImGuiOverlay::BeginFrame() {
    if (!m_initialized) return;
    ImGui_ImplDX11_NewFrame();
    ImGui_ImplWin32_NewFrame();
    ImGui::NewFrame();
}

void ImGuiOverlay::Render() {
    if (!m_initialized) return;

    // 1. Render status indicator pill in the corner
    RenderStatusPill();

    // 2. Render radial action wheel if active
    if (m_state.showRadialMenu) {
        RenderRadialMenu();
    }

    // 3. Render diagnostics if toggled
    if (m_state.showDiagnostics) {
        RenderDiagnostics();
    }
}

void ImGuiOverlay::EndFrame() {
    if (!m_initialized) return;
    ImGui::Render();
    ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
}

void ImGuiOverlay::RenderStatusPill() {
    ImGuiIO& io = ImGui::GetIO();
    m_state.fps = io.Framerate;

    // The decorative status pill must never steal mouse or keyboard input
    // from the assistant/browser WebView2 underneath it.
    ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration |
                             ImGuiWindowFlags_AlwaysAutoResize |
                             ImGuiWindowFlags_NoSavedSettings |
                             ImGuiWindowFlags_NoFocusOnAppearing |
                             ImGuiWindowFlags_NoInputs;

    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x - 240.0f, 16.0f), ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.75f);

    if (ImGui::Begin("##LensDesk_StatusPill", nullptr, flags)) {
        // Cyan status dot
        ImDrawList* drawList = ImGui::GetWindowDrawList();
        ImVec2 p = ImGui::GetCursorScreenPos();
        drawList->AddCircleFilled(ImVec2(p.x + 6, p.y + 8), 4.0f, IM_COL32(6, 182, 212, 255));
        ImGui::Dummy(ImVec2(14.0f, 14.0f));
        ImGui::SameLine();

        ImGui::TextColored(ImVec4(0.02f, 0.71f, 0.83f, 1.0f), "LensDesk 2.0");
        ImGui::SameLine();
        ImGui::TextDisabled("|");
        ImGui::SameLine();

        if (m_state.captureProtectionActive) {
            ImGui::TextColored(ImVec4(0.2f, 0.8f, 0.4f, 1.0f), "Shield On");
        } else {
            ImGui::TextColored(ImVec4(0.8f, 0.4f, 0.2f, 1.0f), "Shield Off");
        }
    }
    ImGui::End();
}

void ImGuiOverlay::RenderRadialMenu() {
    ImGuiIO& io = ImGui::GetIO();
    ImVec2 center = ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f);
    float radiusInner = 60.0f;
    float radiusOuter = 160.0f;

    ImDrawList* drawList = ImGui::GetForegroundDrawList();

    // Dark tinted backdrop
    drawList->AddRectFilled(ImVec2(0, 0), io.DisplaySize, IM_COL32(0, 0, 0, 140));

    // Radial items
    struct RadialItem {
        const char* label;
        const char* action;
        ImU32 color;
    };

    static const RadialItem items[] = {
        { "AI Snip (Ctrl+Shift+S)", "action.snip", IM_COL32(6, 182, 212, 240) },
        { "Assistant Chat", "action.chat", IM_COL32(59, 130, 246, 240) },
        { "AutoType", "action.autotype", IM_COL32(16, 185, 129, 240) },
        { "Web Browser", "action.browser", IM_COL32(245, 158, 11, 240) },
        { "Notes / Resume", "action.notes", IM_COL32(139, 92, 246, 240) },
        { "Hide Overlay", "action.hide", IM_COL32(239, 68, 68, 240) },
    };
    constexpr int itemCount = sizeof(items) / sizeof(items[0]);
    constexpr float angleStep = (2.0f * 3.14159265f) / itemCount;

    ImVec2 mousePos = io.MousePos;
    float dx = mousePos.x - center.x;
    float dy = mousePos.y - center.y;
    float dist = std::sqrt(dx * dx + dy * dy);
    float mouseAngle = std::atan2(dy, dx);
    if (mouseAngle < 0.0f) mouseAngle += 2.0f * 3.14159265f;

    int hoveredIndex = -1;
    if (dist >= radiusInner && dist <= radiusOuter) {
        hoveredIndex = static_cast<int>(mouseAngle / angleStep) % itemCount;
    }

    for (int i = 0; i < itemCount; ++i) {
        float startAngle = i * angleStep;
        float endAngle = (i + 1) * angleStep;
        bool isHovered = (i == hoveredIndex);

        ImU32 sliceColor = isHovered ? IM_COL32(6, 182, 212, 220) : IM_COL32(15, 23, 42, 200);
        float currentOuter = isHovered ? (radiusOuter + 10.0f) : radiusOuter;

        // Draw sector arc approximation
        constexpr int segCount = 16;
        for (int s = 0; s < segCount; ++s) {
            float a1 = startAngle + (endAngle - startAngle) * (float)s / segCount;
            float a2 = startAngle + (endAngle - startAngle) * (float)(s + 1) / segCount;
            ImVec2 p1(center.x + std::cos(a1) * radiusInner, center.y + std::sin(a1) * radiusInner);
            ImVec2 p2(center.x + std::cos(a2) * radiusInner, center.y + std::sin(a2) * radiusInner);
            ImVec2 p3(center.x + std::cos(a2) * currentOuter, center.y + std::sin(a2) * currentOuter);
            ImVec2 p4(center.x + std::cos(a1) * currentOuter, center.y + std::sin(a1) * currentOuter);
            drawList->AddQuadFilled(p1, p2, p3, p4, sliceColor);
        }

        // Draw label
        float midAngle = (startAngle + endAngle) * 0.5f;
        float textRadius = (radiusInner + currentOuter) * 0.5f;
        ImVec2 textPos(center.x + std::cos(midAngle) * textRadius, center.y + std::sin(midAngle) * textRadius);
        ImVec2 textSize = ImGui::CalcTextSize(items[i].label);
        drawList->AddText(ImVec2(textPos.x - textSize.x * 0.5f, textPos.y - textSize.y * 0.5f),
                         isHovered ? IM_COL32(255, 255, 255, 255) : IM_COL32(220, 230, 242, 240),
                         items[i].label);
    }

    // Center circular badge
    drawList->AddCircleFilled(center, radiusInner - 4.0f, IM_COL32(11, 15, 23, 250));
    drawList->AddCircle(center, radiusInner - 4.0f, IM_COL32(6, 182, 212, 180), 32, 2.0f);
    const char* centerText = "LensDesk";
    ImVec2 centerTextSize = ImGui::CalcTextSize(centerText);
    drawList->AddText(ImVec2(center.x - centerTextSize.x * 0.5f, center.y - centerTextSize.y * 0.5f),
                     IM_COL32(6, 182, 212, 255), centerText);

    // Handle click
    if (io.MouseClicked[0]) {
        if (hoveredIndex >= 0 && m_actionCallback) {
            m_actionCallback(items[hoveredIndex].action);
        }
        m_state.showRadialMenu = false;
    }
}

void ImGuiOverlay::RenderDiagnostics() {
    ImGui::SetNextWindowSize(ImVec2(340.0f, 260.0f), ImGuiCond_FirstUseEver);
    if (ImGui::Begin("LensDesk 2.0 Architecture Diagnostics", &m_state.showDiagnostics)) {
        ImGui::TextColored(ImVec4(0.02f, 0.71f, 0.83f, 1.0f), "Native Host Architecture");
        ImGui::Separator();
        ImGui::BulletText("Runtime: Native C++20 Win32 Executable");
        ImGui::BulletText("Rendering: Direct3D 11.1 + DirectComposition");
        ImGui::BulletText("Overlay: Dear ImGui v1.91.x DX11 Backend");
        ImGui::BulletText("Web Engine: Microsoft Edge WebView2 SDK");
        ImGui::BulletText("Electron Runtime: NONE (100% Eliminated)");
        ImGui::Separator();
        ImGui::Text("FPS: %.1f (%.2f ms/frame)", m_state.fps, 1000.0f / (m_state.fps > 0 ? m_state.fps : 60.0f));
        ImGui::Text("Capture Affinity: WDA_EXCLUDEFROMCAPTURE (17)");
        ImGui::Text("DPI Scale: %.2f", ImGui::GetIO().DisplayFramebufferScale.x);
        ImGui::Text("Focus Mode: Deterministic Win32 Router");
    }
    ImGui::End();
}

LRESULT ImGuiOverlay::HandleMessage(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled) {
    if (!m_initialized) {
        handled = false;
        return 0;
    }

    // Always let the ImGui Win32 backend observe the message so its IO state
    // stays current, but only consume input when an interactive native
    // surface (radial menu or diagnostics window) is actually open.
    const LRESULT imguiResult = ImGui_ImplWin32_WndProcHandler(hwnd, msg, wParam, lParam);
    const bool interactive = m_state.showRadialMenu || m_state.showDiagnostics;

    if (interactive) {
        if (imguiResult) {
            handled = true;
            return imguiResult;
        }
        if (msg >= WM_MOUSEFIRST && msg <= WM_MOUSELAST) {
            handled = true;
            return 0;
        }
    }

    // Keyboard input is never consumed here. When the HUD or embedded
    // browser has focus, WebView2 receives real Windows key messages through
    // its own focused input window.
    handled = false;
    return 0;
}

bool ImGuiOverlay::WantCaptureMouse() const {
    if (!m_initialized) return false;
    return m_state.showRadialMenu || m_state.showDiagnostics;
}

bool ImGuiOverlay::WantCaptureKeyboard() const {
    // Native surfaces have no text fields; the WebView2s own the keyboard.
    return false;
}

} // namespace LensDesk
