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
#include <tlhelp32.h>

using namespace LensDesk;

static std::ofstream s_logFile;

static void LogInfo(const std::string& msg) {
    std::string line = "[" + GetIsoTimestamp() + "] [INFO] " + msg;
    std::cout << line << std::endl;
    if (s_logFile.is_open()) {
        s_logFile << line << std::endl;
        s_logFile.flush();
    }
}

static void LogError(const std::string& msg) {
    std::string line = "[" + GetIsoTimestamp() + "] [ERROR] " + msg;
    std::cerr << line << std::endl;
    if (s_logFile.is_open()) {
        s_logFile << line << std::endl;
        s_logFile.flush();
    }
}

static void ShowErrorDialog(HWND hwnd, const wchar_t* text, const wchar_t* title) {
    char buf[512]{};
    WideCharToMultiByte(CP_UTF8, 0, text, -1, buf, sizeof(buf), nullptr, nullptr);
    LogError(std::string("Reported Error: ") + buf);

    if (!IsHeadlessOrCI()) {
        MessageBoxW(hwnd, text, title, MB_ICONERROR);
    }
}

// UIAccess Token Duplication helper for elevated focus & SendInput priority (1:1 HintLens parity)
static bool TryEnableUIAccess() {
#ifdef _WIN32
    HANDLE hToken = nullptr;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_ADJUST_DEFAULT | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY, &hToken)) {
        DWORD uia = 0;
        DWORD retLen = 0;
        if (GetTokenInformation(hToken, TokenUIAccess, &uia, sizeof(uia), &retLen) && uia != 0) {
            CloseHandle(hToken);
            LogInfo("UIAccess already active — continuing");
            return true;
        }

        DWORD enable = 1;
        if (SetTokenInformation(hToken, TokenUIAccess, &enable, sizeof(enable))) {
            CloseHandle(hToken);
            LogInfo("UIAccess enabled on current token");
            return true;
        }
        CloseHandle(hToken);
    }

    LogInfo("No UIAccess — attempting token elevation via winlogon");
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnapshot != INVALID_HANDLE_VALUE) {
        PROCESSENTRY32W pe{ sizeof(PROCESSENTRY32W) };
        DWORD winlogonPid = 0;
        if (Process32FirstW(hSnapshot, &pe)) {
            do {
                if (_wcsicmp(pe.szExeFile, L"winlogon.exe") == 0) {
                    winlogonPid = pe.th32ProcessID;
                    break;
                }
            } while (Process32NextW(hSnapshot, &pe));
        }
        CloseHandle(hSnapshot);

        if (winlogonPid != 0) {
            HANDLE hWinlogon = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_DUP_HANDLE, FALSE, winlogonPid);
            if (hWinlogon) {
                HANDLE hWinlogonToken = nullptr;
                if (OpenProcessToken(hWinlogon, TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY, &hWinlogonToken)) {
                    HANDLE hDupToken = nullptr;
                    if (DuplicateTokenEx(hWinlogonToken, MAXIMUM_ALLOWED, nullptr, SecurityImpersonation, TokenPrimary, &hDupToken)) {
                        DWORD enable = 1;
                        if (SetTokenInformation(hDupToken, TokenUIAccess, &enable, sizeof(enable))) {
                            wchar_t exePath[MAX_PATH]{};
                            if (GetModuleFileNameW(nullptr, exePath, MAX_PATH)) {
                                STARTUPINFOW si{ sizeof(STARTUPINFOW) };
                                PROCESS_INFORMATION pi{};
                                if (CreateProcessAsUserW(hDupToken, exePath, GetCommandLineW(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi)) {
                                    LogInfo("Respawned with UIAccess token from winlogon — exiting parent instance");
                                    CloseHandle(pi.hProcess);
                                    CloseHandle(pi.hThread);
                                    CloseHandle(hDupToken);
                                    CloseHandle(hWinlogonToken);
                                    CloseHandle(hWinlogon);
                                    ExitProcess(0);
                                    return true;
                                }
                            }
                        }
                        CloseHandle(hDupToken);
                    }
                    CloseHandle(hWinlogonToken);
                }
                CloseHandle(hWinlogon);
            }
        }
    }

    DWORD err = GetLastError();
    char errMsg[128];
    snprintf(errMsg, sizeof(errMsg), "CreateUIAccessToken FAILED (err=%lu) — falling back to z-order thread", err);
    LogInfo(errMsg);
#endif
    return false;
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    // Enable UIAccess presentation priority
    TryEnableUIAccess();

    // 0. Attach console and configure logging
    if (AttachConsole(ATTACH_PARENT_PROCESS)) {
        FILE* fp = nullptr;
        freopen_s(&fp, "CONOUT$", "w", stdout);
        freopen_s(&fp, "CONOUT$", "w", stderr);
    }

    std::filesystem::path logPath = GetExecutableDirectory() / L"runtime_host.log";
    s_logFile.open(logPath, std::ios::out | std::ios::trunc);
    LogInfo("LensDesk 2.0 Native Windows Host starting...");

    // 1. Single Instance Guard
    HANDLE hMutex = CreateMutexW(nullptr, TRUE, SINGLE_INSTANCE_MUTEX);
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existingHwnd = FindWindowW(WINDOW_CLASS_NAME, nullptr);
        if (existingHwnd) {
            LogInfo("Existing instance detected via named mutex. Bringing to foreground.");
            ShowWindow(existingHwnd, SW_RESTORE);
            ShowWindow(existingHwnd, SW_SHOW);
            SetForegroundWindow(existingHwnd);
            SetWindowPos(existingHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            if (hMutex) CloseHandle(hMutex);
            return 0;
        }
        LogInfo("Single instance mutex detected but no window found. Previous instance ungracefully closed; proceeding.");
    }

    // 2. Initialize COM
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) {
        LogError("Failed to initialize COM apartment threaded.");
        CloseHandle(hMutex);
        return -1;
    }
    LogInfo("COM initialized.");

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
    LogInfo("Storage and Capture services initialized.");

    // 5. Initialize Window Manager
    if (!winMgr.Initialize(hInstance, nCmdShow)) {
        ShowErrorDialog(nullptr, L"Failed to initialize LensDesk 2.0 native window.", L"Error");
        CoUninitialize();
        CloseHandle(hMutex);
        return -1;
    }

    HWND hwnd = winMgr.GetHwnd();
    WindowBounds bounds = winMgr.GetBounds();
    LogInfo("WindowManager initialized. HWND = " + std::to_string(reinterpret_cast<uintptr_t>(hwnd)) +
            ", Bounds = " + std::to_string(bounds.width) + "x" + std::to_string(bounds.height));

    // 6. Initialize Direct3D 11 Renderer
    if (!d3dRenderer.Initialize(hwnd, bounds.width, bounds.height)) {
        ShowErrorDialog(nullptr, L"Failed to initialize Direct3D 11 renderer.", L"Error");
        CoUninitialize();
        CloseHandle(hMutex);
        return -1;
    }
    LogInfo("Direct3D 11 Renderer initialized.");

    // 7. Initialize DirectComposition Engine
    if (!dcompEngine.Initialize(hwnd, d3dRenderer.GetDevice(), d3dRenderer.GetSwapChain())) {
        ShowErrorDialog(nullptr, L"Failed to initialize DirectComposition engine.", L"Error");
        CoUninitialize();
        CloseHandle(hMutex);
        return -1;
    }
    LogInfo("DirectComposition engine initialized.");

    // 8. Initialize Dear ImGui Overlay
    imguiOverlay.Initialize(hwnd, d3dRenderer.GetDevice(), d3dRenderer.GetContext());
    LogInfo("Dear ImGui Overlay initialized.");

    // 9. Initialize Global Input Manager
    inputMgr.Initialize(hwnd);
    LogInfo("Global Input Manager initialized.");

    // 10. Locate Dist Folder for Built React 19 Frontend
    std::filesystem::path exeDir = GetExecutableDirectory();
    std::filesystem::path distPath = exeDir / L"dist";
    if (!std::filesystem::exists(distPath)) {
        distPath = exeDir.parent_path() / L"dist";
    }
    if (!std::filesystem::exists(distPath)) {
        distPath = exeDir.parent_path().parent_path() / L"dist";
    }
    if (!std::filesystem::exists(distPath)) {
        distPath = exeDir.parent_path().parent_path().parent_path() / L"dist";
    }
    if (!std::filesystem::exists(distPath)) {
        LogError("Web assets ('dist' directory) could not be located.");
        if (!IsHeadlessOrCI()) {
            MessageBoxW(
                hwnd,
                L"LensDesk 2.0 Web Assets ('dist' directory) could not be located.\n\n"
                L"Please verify that the application was installed correctly.",
                L"LensDesk - Missing Assets",
                MB_ICONWARNING | MB_OK
            );
        }
    } else {
        LogInfo("Web assets located at: " + distPath.string());
    }

    // 11. Wire Services & Dispatcher
    dispatcher.Initialize(
        &winMgr,
        &webHost,
        &browserMgr,
        &inputMgr,
        &captureSvc,
        &storageMgr,
        &imguiOverlay,
        &focusMgr
    );
    LogInfo("ServiceDispatcher initialized.");

    // 12. Initialize Focus Manager
    focusMgr.Initialize(hwnd, &webHost, &browserMgr, &imguiOverlay);
    LogInfo("FocusManager initialized.");

    // 13. Initialize WebView2 Host (hosts React 19 app) & Embedded Browser
    webHost.Initialize(
        hwnd,
        dcompEngine.GetHudVisual(),
        distPath,
        &dispatcher,
        [hwnd, &dcompEngine, &browserMgr, &focusMgr](ICoreWebView2Environment* env) {
            LogInfo("WebView2 environment ready. Initializing browser manager tabs.");
            browserMgr.Initialize(hwnd, env, dcompEngine.GetBrowserVisual(), &dcompEngine, &focusMgr);
        }
    );
    LogInfo("WebView2 Host initialization started.");

    // 14. Connect Window Message Router
    winMgr.SetMessageCallback(
        [&focusMgr, &d3dRenderer, &webHost, &browserMgr, &inputMgr, &dispatcher, &winMgr](
            HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled
        ) -> LRESULT {
            // Marshal background work (cloud/chat) back onto the UI thread.
            if (msg == WM_LENSDESK_IPC_DISPATCH) {
                handled = true;
                dispatcher.ProcessPendingUi();
                return 0;
            }

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

    // 15. Message & Render Loop
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

    // 16. Teardown
    dispatcher.Shutdown();
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
