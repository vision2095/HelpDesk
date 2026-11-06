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

static std::filesystem::path EnsureDistAssetsExtracted(HINSTANCE hInstance) {
    std::filesystem::path exeDir = GetExecutableDirectory();
    std::vector<std::filesystem::path> localCandidates = {
        exeDir / L"dist",
        exeDir.parent_path() / L"dist",
        exeDir.parent_path().parent_path() / L"dist",
        exeDir.parent_path().parent_path().parent_path() / L"dist"
    };
    for (const auto& p : localCandidates) {
        if (std::filesystem::exists(p / L"index.html")) {
            LogInfo("Web assets located at local directory: " + p.string());
            return p;
        }
    }

    wchar_t localAppData[MAX_PATH] = {0};
    if (GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH) > 0) {
        std::filesystem::path targetDir = std::filesystem::path(localAppData) / L"LensDesk" / L"dist";
        std::filesystem::path indexHtml = targetDir / L"index.html";

        // Try extracting embedded resource 102 (IDR_DIST_BUNDLE)
        HRSRC hRes = FindResourceW(hInstance, MAKEINTRESOURCEW(102), RT_RCDATA);
        if (hRes) {
            HGLOBAL hMem = LoadResource(hInstance, hRes);
            if (hMem) {
                DWORD resSize = SizeofResource(hInstance, hRes);
                void* pData = LockResource(hMem);
                if (pData && resSize > 0) {
                    std::error_code ec;
                    std::filesystem::create_directories(targetDir, ec);
                    std::filesystem::path tempZip = targetDir.parent_path() / L"dist_bundle.zip";

                    bool needExtract = !std::filesystem::exists(indexHtml);
                    if (!needExtract) {
                        std::filesystem::path stampFile = targetDir / L".bundle_size";
                        if (std::filesystem::exists(stampFile)) {
                            std::ifstream ifs(stampFile);
                            DWORD savedSize = 0;
                            ifs >> savedSize;
                            if (savedSize != resSize) needExtract = true;
                        } else {
                            needExtract = true;
                        }
                    }

                    if (needExtract) {
                        LogInfo("Extracting self-contained embedded web assets (" + std::to_string(resSize) + " bytes)...");
                        std::ofstream ofs(tempZip, std::ios::binary | std::ios::trunc);
                        if (ofs.is_open()) {
                            ofs.write(reinterpret_cast<const char*>(pData), resSize);
                            ofs.close();

                            // 1. Built-in Windows tar.exe (fastest, standard in Windows 10 version 1803+ and 11)
                            std::wstring tarCmd = L"tar.exe -xf \"" + tempZip.wstring() + L"\" -C \"" + targetDir.wstring() + L"\"";
                            STARTUPINFOW si{};
                            si.cb = sizeof(si);
                            si.dwFlags = STARTF_USESHOWWINDOW;
                            si.wShowWindow = SW_HIDE;
                            PROCESS_INFORMATION pi{};
                            if (CreateProcessW(nullptr, tarCmd.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
                                WaitForSingleObject(pi.hProcess, 5000);
                                CloseHandle(pi.hProcess);
                                CloseHandle(pi.hThread);
                            }

                            // 2. Fallback to PowerShell Expand-Archive if index.html was not created
                            if (!std::filesystem::exists(indexHtml)) {
                                std::wstring psCmd = L"powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"Expand-Archive -Path '" + tempZip.wstring() + L"' -DestinationPath '" + targetDir.wstring() + L"' -Force\"";
                                if (CreateProcessW(nullptr, psCmd.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
                                    WaitForSingleObject(pi.hProcess, 10000);
                                    CloseHandle(pi.hProcess);
                                    CloseHandle(pi.hThread);
                                }
                            }

                            DeleteFileW(tempZip.c_str());

                            if (std::filesystem::exists(indexHtml)) {
                                std::ofstream stampOut(targetDir / L".bundle_size");
                                stampOut << resSize;
                                LogInfo("Successfully extracted embedded web assets to: " + targetDir.string());
                            } else {
                                LogError("Embedded web assets extraction completed but index.html not found.");
                            }
                        }
                    }

                    if (std::filesystem::exists(indexHtml)) {
                        return targetDir;
                    }
                }
            }
        }

        if (std::filesystem::exists(indexHtml)) {
            LogInfo("Web assets located at LocalAppData: " + targetDir.string());
            return targetDir;
        }
    }

    wchar_t progFiles[MAX_PATH] = {0};
    if (GetEnvironmentVariableW(L"ProgramFiles", progFiles, MAX_PATH) > 0) {
        std::filesystem::path pfPath = std::filesystem::path(progFiles) / L"LensDesk" / L"dist";
        if (std::filesystem::exists(pfPath / L"index.html")) {
            LogInfo("Web assets located at ProgramFiles: " + pfPath.string());
            return pfPath;
        }
    }

    LogInfo("Web assets ('dist' directory) not found; running pure Dear ImGui native HUD.");
    return exeDir / L"dist";
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    // 0. Attach console and configure logging
    if (AttachConsole(ATTACH_PARENT_PROCESS)) {
        FILE* fp = nullptr;
        freopen_s(&fp, "CONOUT$", "w", stdout);
        freopen_s(&fp, "CONOUT$", "w", stderr);
    }

    std::filesystem::path logPath = GetExecutableDirectory() / L"runtime_host.log";
    s_logFile.open(logPath, std::ios::out | std::ios::trunc);
    LogInfo("LensDesk 2.0 Native Windows Host starting...");

    // 1. Single Instance Guard (GAP 09: uniquely namespaced, crash-tolerant, session-isolated)
    const UINT wmActivateMsg = RegisterWindowMessageW(WM_LENSDESK_ACTIVATE_NAME);
    HANDLE hMutex = CreateMutexW(nullptr, TRUE, SINGLE_INSTANCE_MUTEX);
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        DWORD waitRes = WaitForSingleObject(hMutex, 0);
        if (waitRes == WAIT_ABANDONED) {
            LogInfo("Previous instance abandoned single-instance mutex (crashed). Acquired ownership cleanly.");
        } else {
            HWND existingHwnd = FindWindowW(WINDOW_CLASS_NAME, nullptr);
            if (existingHwnd) {
                LogInfo("Existing instance detected via named mutex. Sending activation message and bringing to foreground.");
                PostMessageW(existingHwnd, wmActivateMsg, 0, 0);
                ShowWindow(existingHwnd, SW_RESTORE);
                ShowWindow(existingHwnd, SW_SHOW);
                SetForegroundWindow(existingHwnd);
                SetWindowPos(existingHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                if (hMutex) CloseHandle(hMutex);
                return 0;
            }
            LogInfo("Single instance mutex detected but no window found. Previous instance ungracefully closed; proceeding.");
        }
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
    winMgr.SetOpacityCallback([&dcompEngine](float op) { dcompEngine.SetOpacity(op); });

    // 8. Initialize Dear ImGui Overlay
    imguiOverlay.Initialize(hwnd, d3dRenderer.GetDevice(), d3dRenderer.GetContext());
    LogInfo("Dear ImGui Overlay initialized.");

    // 9. Initialize Global Input Manager
    inputMgr.Initialize(hwnd);
    LogInfo("Global Input Manager initialized.");

    // 10. Locate Dist Folder for Built React 19 Frontend
    std::filesystem::path distPath = EnsureDistAssetsExtracted(hInstance);
    if (std::filesystem::exists(distPath / L"index.html")) {
        imguiOverlay.SetWebSuppressed(true);
        LogInfo("React 19 web assets active; suppressing duplicate native ImGui windows.");
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
        [hwnd, &dcompEngine, &browserMgr, &focusMgr, &imguiOverlay](ICoreWebView2Environment* env) {
            LogInfo("WebView2 environment ready. Initializing browser manager tabs.");
            browserMgr.Initialize(hwnd, env, dcompEngine.GetBrowserVisual(), &dcompEngine, &focusMgr);
            imguiOverlay.SetWebSuppressed(true);
        }
    );
    LogInfo("WebView2 Host initialization started.");

    // 14. Connect Window Message Router
    winMgr.SetMessageCallback(
        [&focusMgr, &d3dRenderer, &webHost, &browserMgr, &inputMgr, &dispatcher, &winMgr, &imguiOverlay, wmActivateMsg](
            HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam, bool& handled
        ) -> LRESULT {
            // GAP 09: Single-instance activation message
            if (msg == wmActivateMsg) {
                LogInfo("Received single-instance activation message from secondary launch. Restoring overlay.");
                winMgr.SetVisible(true);
                ShowWindow(hWnd, SW_RESTORE);
                ShowWindow(hWnd, SW_SHOW);
                HWND curFg = GetForegroundWindow();
                if (curFg && curFg != hWnd) {
                    DWORD fgThread = GetWindowThreadProcessId(curFg, nullptr);
                    DWORD curThread = GetCurrentThreadId();
                    if (fgThread != 0 && fgThread != curThread) {
                        AttachThreadInput(curThread, fgThread, TRUE);
                    }
                    BringWindowToTop(hWnd);
                    SetForegroundWindow(hWnd);
                    SetActiveWindow(hWnd);
                    SetFocus(hWnd);
                    if (fgThread != 0 && fgThread != curThread) {
                        AttachThreadInput(curThread, fgThread, FALSE);
                    }
                } else {
                    SetForegroundWindow(hWnd);
                    SetFocus(hWnd);
                }
                SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                if (!dispatcher.HasSession()) {
                    imguiOverlay.GetState().showAuthGate = false;
                    focusMgr.SetFocusTarget(FocusState::FOCUSED_ASSISTANT, "activate_login_focus");
                } else {
                    if (!webHost.IsReady()) {
                        imguiOverlay.GetState().showChatWindow = true;
                    }
                }
                handled = true;
                return 0;
            }

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

        // 1:1 HintLens Topmost Parity: Check if any overlapping window has moved above overlay
        if (winMgr.IsAlwaysOnTop() && winMgr.IsVisible()) {
            if (winMgr.IsCoveredByAnotherWindow() || GetWindow(winMgr.GetHwnd(), GW_HWNDPREV) != nullptr) {
                winMgr.EnforceTopmost();
            }
        }

        // Render Frame
        d3dRenderer.BeginFrame();
        imguiOverlay.BeginFrame();
        imguiOverlay.Render();
        imguiOverlay.EndFrame();
        d3dRenderer.EndFrame();

        // DirectComposition commit
        dcompEngine.Commit();

        // Yield time-slice without dropping frame rate (VSync in EndFrame handles 60/120Hz pacing)
        Sleep(1);
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
    ReleaseMutex(hMutex);
    CloseHandle(hMutex);
    return static_cast<int>(msg.wParam);
}
