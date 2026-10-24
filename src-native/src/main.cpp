#include "../include/common.hpp"
#include "../include/window_manager.hpp"
#include "../include/d3d11_renderer.hpp"
#include "../include/dcomp_engine.hpp"
#include "../include/imgui_overlay.hpp"
#include "../include/storage_manager.hpp"
#include "../include/capture_service.hpp"
#include "../include/input_manager.hpp"
#include "../include/browser_tabs.hpp"
#include "../include/webview2_host.hpp"
#include "../include/service_dispatcher.hpp"
#include "../include/focus_manager.hpp"

using namespace LensDesk;

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    // 1. Single Instance Guard
    HANDLE hMutex = CreateMutexW(nullptr, TRUE, SINGLE_INSTANCE_MUTEX);
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existingHwnd = FindWindowW(WINDOW_CLASS_NAME, nullptr);
        if (existingHwnd) {
            ShowWindow(existingHwnd, SW_SHOW);
            SetForegroundWindow(existingHwnd);
        }
        if (hMutex) CloseHandle(hMutex);
        return 0;
    }

    // 2. Initialize COM
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) {
        CloseHandle(hMutex);
        return -1;
    }

    // 3. Instantiate Subsystems
    WindowManager winMgr;
    D3D11Renderer d3dRenderer;
    DCompEngine dcompEngine;
    ImGuiOverlay imguiOverlay;
    StorageManager storageMgr;
    CaptureService captureSvc;
    InputManager inputMgr;
    BrowserTabsManager browserMgr;
    WebView2Host webHost;
    ServiceDispatcher dispatcher;
    FocusManager focusMgr;

    // 4. Initialize Core Data Services
    storageMgr.Initialize();
    captureSvc.Initialize();

    // 5. Initialize Window Manager
    if (!winMgr.Initialize(hInstance, nCmdShow)) {
        MessageBoxW(nullptr, L"Failed to initialize LensDesk 2.0 native window.", L"Error", MB_ICONERROR);
        CoUninitialize();
        CloseHandle(hMutex);
        return -1;
    }

    HWND hwnd = winMgr.GetHwnd();
    WindowBounds bounds = winMgr.GetBounds();

    // 6. Initialize Direct3D 11 Renderer
    if (!d3dRenderer.Initialize(hwnd, bounds.width, bounds.height)) {
        MessageBoxW(nullptr, L"Failed to initialize Direct3D 11 renderer.", L"Error", MB_ICONERROR);
        CoUninitialize();
        CloseHandle(hMutex);
        return -1;
    }

    // 7. Initialize DirectComposition Engine
    if (!dcompEngine.Initialize(hwnd, d3dRenderer.GetDevice(), d3dRenderer.GetSwapChain())) {
        MessageBoxW(nullptr, L"Failed to initialize DirectComposition engine.", L"Error", MB_ICONERROR);
        CoUninitialize();
        CloseHandle(hMutex);
        return -1;
    }

    // 8. Initialize Dear ImGui Overlay
    imguiOverlay.Initialize(hwnd, d3dRenderer.GetDevice(), d3dRenderer.GetContext());

    // 9. Initialize Global Input Manager
    inputMgr.Initialize(hwnd);

    // 10. Locate Dist Folder for Built React 19 Frontend
    std::filesystem::path exeDir = GetExecutableDirectory();
    std::filesystem::path distPath = exeDir / L"dist";
    if (!std::filesystem::exists(distPath)) {
        // Fallback to parent path if running from build/Release
        distPath = exeDir.parent_path() / L"dist";
    }

    // 11. Wire Services & Dispatcher
    dispatcher.Initialize(
        &winMgr,
        &webHost,
        &browserMgr,
        &inputMgr,
        &captureSvc,
        &storageMgr,
        &imguiOverlay
    );

    // 12. Initialize WebView2 Host (hosts React 19 app)
    webHost.Initialize(hwnd, dcompEngine.GetHudVisual(), distPath, &dispatcher);

    // 13. Initialize Embedded Browser Manager
    // Initialized after environment is ready in webHost
    browserMgr.Initialize(hwnd, webHost.GetWebView() ? nullptr : nullptr, dcompEngine.GetBrowserVisual());

    // 14. Initialize Focus Manager
    focusMgr.Initialize(hwnd, &webHost, &browserMgr, &imguiOverlay);

    // 15. Connect Window Message Router
    winMgr.SetMessageCallback(
        [&focusMgr, &d3dRenderer, &webHost, &browserMgr, &inputMgr, &dispatcher, &winMgr](
            HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled
        ) -> LRESULT {
            // Handle hotkeys
            if (msg == WM_HOTKEY) {
                handled = true;
                return inputMgr.HandleHotkey(wParam, lParam);
            }

            // Handle resize
            if (msg == WM_SIZE) {
                int w = LOWORD(lParam);
                int h = HIWORD(lParam);
                if (w > 0 && h > 0) {
                    d3dRenderer.Resize(w, h);
                    webHost.Resize(w, h);
                }
            }

            // Route focus, mouse, and keyboard messages
            return focusMgr.RouteMessage(hWnd, msg, wParam, lParam, handled);
        }
    );

    // 16. Message & Render Loop
    MSG msg{};
    bool running = true;
    while (running) {
        while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
            if (msg.message == WM_QUIT) {
                running = false;
                break;
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        if (!running) break;

        // Render Frame
        d3dRenderer.BeginFrame();
        imguiOverlay.BeginFrame();
        imguiOverlay.Render();
        imguiOverlay.EndFrame();
        d3dRenderer.EndFrame();

        // DirectComposition commit
        dcompEngine.Commit();

        // 60 FPS frame throttle to avoid high CPU usage
        Sleep(16);
    }

    // 17. Teardown
    inputMgr.Shutdown();
    browserMgr.Shutdown();
    webHost.Shutdown();
    imguiOverlay.Shutdown();
    dcompEngine.Shutdown();
    d3dRenderer.Shutdown();
    winMgr.Shutdown();
    captureSvc.Shutdown();

    CoUninitialize();
    CloseHandle(hMutex);
    return static_cast<int>(msg.wParam);
}
