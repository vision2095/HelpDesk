import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');

test('LensDesk 2.0 Native Windows Host Architecture', async (t) => {
  await t.test('1. Core C++20 Header and Implementation Files Exist', () => {
    const requiredFiles = [
      'src-native/include/common.hpp',
      'src-native/include/window_manager.hpp',
      'src-native/src/window_manager.cpp',
      'src-native/include/d3d11_renderer.hpp',
      'src-native/src/d3d11_renderer.cpp',
      'src-native/include/dcomp_engine.hpp',
      'src-native/src/dcomp_engine.cpp',
      'src-native/include/imgui_overlay.hpp',
      'src-native/src/imgui_overlay.cpp',
      'src-native/include/webview2_host.hpp',
      'src-native/src/webview2_host.cpp',
      'src-native/include/browser_tabs.hpp',
      'src-native/src/browser_tabs.cpp',
      'src-native/include/focus_manager.hpp',
      'src-native/src/focus_manager.cpp',
      'src-native/include/input_manager.hpp',
      'src-native/src/input_manager.cpp',
      'src-native/include/capture_service.hpp',
      'src-native/src/capture_service.cpp',
      'src-native/include/storage_manager.hpp',
      'src-native/src/storage_manager.cpp',
      'src-native/include/service_dispatcher.hpp',
      'src-native/src/service_dispatcher.cpp',
      'src-native/src/main.cpp',
    ];

    for (const file of requiredFiles) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `Missing file: ${file}`);
    }
  });

  await t.test('2. Dear ImGui and WebView2 Vendored Dependencies Exist', () => {
    const requiredVendors = [
      'src-native/third_party/imgui/imgui.h',
      'src-native/third_party/imgui/imgui.cpp',
      'src-native/third_party/imgui/imgui_impl_win32.h',
      'src-native/third_party/imgui/imgui_impl_win32.cpp',
      'src-native/third_party/imgui/imgui_impl_dx11.h',
      'src-native/third_party/imgui/imgui_impl_dx11.cpp',
      'src-native/third_party/webview2/include/WebView2.h',
      'src-native/third_party/webview2/lib/x64/WebView2Loader.dll',
      'src-native/third_party/webview2/lib/x64/WebView2LoaderStatic.lib',
      'src-native/third_party/nlohmann/json.hpp',
    ];

    for (const v of requiredVendors) {
      assert.ok(fs.existsSync(path.join(ROOT, v)), `Missing vendor file: ${v}`);
    }
  });

  await t.test('3. CMakeLists.txt Specifies C++20 and Win32 Subsystem', () => {
    const cmakeContent = fs.readFileSync(path.join(ROOT, 'src-native/CMakeLists.txt'), 'utf8');
    assert.match(cmakeContent, /set\(CMAKE_CXX_STANDARD 20\)/);
    assert.match(cmakeContent, /add_executable\(RuntimeHost WIN32/);
    assert.match(cmakeContent, /d3d11/);
    assert.match(cmakeContent, /dcomp/);
    assert.match(cmakeContent, /WebView2LoaderStatic\.lib/);
  });

  await t.test('4. Windows Resources and Manifest Exist', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/resources/app.rc')));
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/resources/app.manifest')));
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/resources/app.ico')));

    const manifestContent = fs.readFileSync(path.join(ROOT, 'src-native/resources/app.manifest'), 'utf8');
    assert.match(manifestContent, /PerMonitorV2/);

    const rcContent = fs.readFileSync(path.join(ROOT, 'src-native/resources/app.rc'), 'utf8');
    assert.match(rcContent, /2,0,0,0/);
    assert.match(rcContent, /LensDesk 2\.0/);
  });

  await t.test('5. NSIS Installer Configuration Exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'installer/installer.nsi')));
    const nsi = fs.readFileSync(path.join(ROOT, 'installer/installer.nsi'), 'utf8');
    assert.match(nsi, /!define PRODUCT_NAME "LensDesk"/);
    assert.match(nsi, /!define PRODUCT_VERSION "2\.0\.0"/);
    assert.match(nsi, /RuntimeHost\.exe/);
  });

  await t.test('6. Production React 19 Frontend Bundle Exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'dist/index.html')));
    const html = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');
    assert.match(html, /LensDesk/);
  });

  await t.test('7. Package.json Version is 2.0.0 with Native Scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '2.0.0');
    assert.ok(pkg.scripts['build']);
  });

  await t.test('8. Strict Check: No Non-Existent SendKeyboardInput Calls', () => {
    const srcNativeFiles = [
      'src-native/include/webview2_host.hpp',
      'src-native/src/webview2_host.cpp',
      'src-native/include/browser_tabs.hpp',
      'src-native/src/browser_tabs.cpp',
      'src-native/include/focus_manager.hpp',
      'src-native/src/focus_manager.cpp',
    ];
    for (const f of srcNativeFiles) {
      const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(!content.includes('SendKeyboardInput'), `Found invalid SendKeyboardInput in ${f}`);
    }
  });

  await t.test('9. Focus State Machine Has All 8 Required States', () => {
    const focusHeader = fs.readFileSync(path.join(ROOT, 'src-native/include/focus_manager.hpp'), 'utf8');
    const requiredStates = [
      'INACTIVE',
      'ACTIVATING',
      'FOCUSED_ASSISTANT',
      'FOCUSED_BROWSER',
      'FOCUSED_NATIVE_CONTROL',
      'SWITCHING_VIEW',
      'FOCUS_LOST',
      'RESTORING'
    ];
    for (const s of requiredStates) {
      assert.match(focusHeader, new RegExp(`\\b${s}\\b`), `Missing state ${s} in FocusState enum`);
    }
  });

  await t.test('10. Real Windows Runtime Integration Script and Quickstart Exist', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts/test-windows-runtime.ps1')), 'Missing test-windows-runtime.ps1');
    assert.ok(fs.existsSync(path.join(ROOT, 'QUICKSTART.txt')), 'Missing QUICKSTART.txt');
    const nsi = fs.readFileSync(path.join(ROOT, 'installer/installer.nsi'), 'utf8');
    assert.match(nsi, /F3017226-FE2A-4295-8BDF-00C3A9A7E4C5/, 'Missing WebView2 detection in installer.nsi');
  });

  await t.test('11. Interactive CDP Test and Packaging Verification Scripts Exist', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts/test-interactive-windows.mjs')), 'Missing test-interactive-windows.mjs');
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts/test-windows-distributions.ps1')), 'Missing test-windows-distributions.ps1');
  });

  await t.test('12. Windows Security Boundary: standard-user manifest, no UIAccess token theft', () => {
    const manifest = fs.readFileSync(path.join(ROOT, 'src-native/resources/app.manifest'), 'utf8');
    assert.match(manifest, /level="asInvoker"/, 'Manifest must run as the invoking user');
    assert.match(manifest, /uiAccess="false"/, 'Manifest must not request UIAccess elevation');
    assert.doesNotMatch(manifest, /requireAdministrator/, 'Manifest must not require administrator rights');

    const mainCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/main.cpp'), 'utf8');
    assert.doesNotMatch(mainCpp, /winlogon/i, 'Host must not open or duplicate winlogon tokens');
    assert.doesNotMatch(mainCpp, /TokenUIAccess/, 'Host must not rewrite its token UIAccess flag');
    assert.doesNotMatch(mainCpp, /CreateProcessAsUserW/, 'Host must not relaunch itself with another process token');
  });

  await t.test('13. Overlay Z-order without proctoring-process evasion', () => {
    const wmCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/window_manager.cpp'), 'utf8');
    assert.match(wmCpp, /HWND_TOPMOST/, 'Overlay must use normal topmost z-order');
    assert.match(wmCpp, /EVENT_SYSTEM_FOREGROUND/, 'Overlay must restore z-order on foreground changes');
    assert.doesNotMatch(wmCpp, /CreateToolhelp32Snapshot/, 'Window manager must not enumerate other processes');
    assert.doesNotMatch(wmCpp, /LockDownBrowser|SafeExamBrowser|Proctor/i, 'Window manager must not detect proctoring software');
    assert.doesNotMatch(wmCpp, /OpenInputDesktop/, 'Window manager must not inspect or switch input desktops');
    assert.doesNotMatch(wmCpp, /SetParent\(m_hwnd, GetDesktopWindow\(\)\)/, 'Window manager must not detach the overlay to evade window constraints');
  });

  await t.test('14. Detached WinRT OCR Engines: BGRA conversion and bounded recognition', () => {
    const capCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/capture_service.cpp'), 'utf8');
    assert.match(capCpp, /PerformOcr/, 'Missing PerformOcr implementation in capture_service.cpp');
    assert.match(capCpp, /PerformOcrOnBase64/, 'Missing PerformOcrOnBase64');
    assert.match(capCpp, /CreateFormatConverter/, 'OCR input must be converted to a known pixel format');
    assert.match(capCpp, /GUID_WICPixelFormat32bppBGRA/, 'OCR input must be converted to BGRA');
    assert.match(capCpp, /m_ocrMutex/, 'OCR execution must be serialized');

    const ocrCpp = fs.readFileSync(path.join(ROOT, 'src/native/ocr_pipeline.cpp'), 'utf8');
    assert.match(ocrCpp, /kMaxOcrDimension/, 'OCR must enforce the WinRT maximum image dimension');
    assert.match(ocrCpp, /FitForOcr/, 'OCR must scale oversized images proportionally');
    assert.match(ocrCpp, /multi_threaded/, 'OCR must run in an MTA-compatible worker');
    assert.doesNotMatch(ocrCpp, /targetWidth = std::min\(buffer\.width/, 'OCR must not clip dimensions independently');
  });

  await t.test('15. Inline Pointer Focus Safety Interceptor & Log-Normal Typing Dynamics', () => {
    const inputCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/input_manager.cpp'), 'utf8');
    assert.match(inputCpp, /currentFg != targetHwnd|GetForegroundWindow\(\) != targetHwnd/, 'Missing focus-drift guard in input_manager.cpp');
    assert.match(inputCpp, /lognormal_distribution/, 'Missing log-normal distribution in input_manager.cpp');
    assert.match(inputCpp, /boundaryPauseDist/, 'Missing syntax boundary hesitation logic');
    const workspaceInputCpp = fs.readFileSync(path.join(ROOT, 'apps/windows/src-native/src/input_manager.cpp'), 'utf8');
    assert.equal(workspaceInputCpp, inputCpp, 'Windows input implementations must stay synchronized');
    assert.doesNotMatch(inputCpp, /\bBlockInput\s*\(/, 'Auto-type must leave physical keyboard and mouse input available');
    const worker = inputCpp.slice(inputCpp.indexOf('void InputManager::AutoTypeWorker'));
    const modifierWait = worker.indexOf('const bool modifierDown = IsAnyModifierDown()');
    const focusCheck = worker.indexOf('HWND currentFg = GetForegroundWindow()');
    assert.ok(modifierWait >= 0 && focusCheck > modifierWait, 'Check foreground after waiting for modifier keys');
    assert.doesNotMatch(worker, /typoChar|SendVirtualKeyNative\(VK_BACK/, 'Do not send delayed typo corrections to a changed target');
    assert.match(worker, /SendInput\(inputCount, inputs, sizeof\(INPUT\)\) != inputCount/, 'Submit paired keystrokes together and detect incomplete delivery');
    assert.match(inputCpp, /tier1PauseDist/, 'Missing multi-tier delimiter hesitation distribution');
    assert.match(inputCpp, /tier2PauseDist/, 'Missing multi-tier structural hesitation distribution');
  });

  await t.test('16. Hardware Endpoint WASAPI Loopback Capture Module Exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/include/audio_capture.hpp')), 'Missing audio_capture.hpp');
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/src/audio_capture.cpp')), 'Missing audio_capture.cpp');
    const audioCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/audio_capture.cpp'), 'utf8');
    assert.match(audioCpp, /AUDCLNT_STREAMFLAGS_LOOPBACK/, 'Missing WASAPI loopback flag');
    assert.match(audioCpp, /AUDCLNT_E_DEVICE_INVALIDATED/, 'Missing audio session recovery routing for device detachment');
  });

  await t.test('17. System-Wide Pointer Hook for Radial Wheel Intercepts Middle Button', () => {
    const inputCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/input_manager.cpp'), 'utf8');
    assert.match(inputCpp, /SetWindowsHookExW\(WH_MOUSE_LL/, 'Missing WH_MOUSE_LL hook');
    assert.match(inputCpp, /s_mbuttonDownTime/, 'Missing sustained middle-button hold detection');
    assert.match(inputCpp, /s_lastRadialPos/, 'Missing pointer coordinate translation');
  });

  await t.test('18. Integrated Global Runtime Hotkeys Registered for HintLens Parity', () => {
    const inputCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/input_manager.cpp'), 'utf8');
    assert.match(inputCpp, /RegisterHotkey\(110, MOD_CONTROL \| MOD_SHIFT, 'D', "desktop\.capture"\)/);
    assert.match(inputCpp, /RegisterHotkey\(111, MOD_CONTROL \| MOD_SHIFT, 'M', "window\.toggleMouseMode"\)/);
    assert.match(inputCpp, /RegisterHotkey\(112, MOD_CONTROL \| MOD_SHIFT, 'G', "browser\.toggle"\)/);
    assert.match(inputCpp, /RegisterHotkey\(113, MOD_CONTROL \| MOD_SHIFT, 'P', "provider\.cycle"\)/);
  });

  await t.test('19. Local Sandbox Profile Sanitization in service_dispatcher.cpp', () => {
    const dispCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/service_dispatcher.cpp'), 'utf8');
    assert.match(dispCpp, /desktop\.wipeAllData/, 'Missing desktop.wipeAllData handler');
    assert.match(dispCpp, /RegDeleteTreeW/, 'Missing LensDesk registry cleanup');
    assert.doesNotMatch(dispCpp, /msedgewebview2\.exe/, 'Data wipe must not terminate unrelated WebView2 processes');
    assert.doesNotMatch(dispCpp, /TerminateProcess/, 'Data wipe must not terminate other processes');
    assert.match(dispCpp, /remove_all\(base \/ L"LensDesk"/, 'Data wipe must be scoped to LensDesk-owned data');
  });

  await t.test('20. Deployment Evergreen WebView2 Bootstrapper Verification Agent Exists', () => {
    const webCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/webview2_host.cpp'), 'utf8');
    assert.match(webCpp, /EnsureWebView2Runtime/, 'Missing EnsureWebView2Runtime in webview2_host.cpp');
    assert.match(webCpp, /URLDownloadToFileW/, 'Missing Evergreen bootstrapper download');
    assert.match(webCpp, /MicrosoftEdgeWebview2Setup\.exe/, 'Missing installer execution');
    assert.match(webCpp, /IBindStatusCallback/, 'Missing asynchronous IBindStatusCallback framework');
  });

  await t.test('21. Native updater verifies HTTPS artifacts and SHA-256 before launch', () => {
    const clientCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/cloud_client.cpp'), 'utf8');
    assert.match(clientCpp, /\/api\/v1\/updates\/check/, 'Updater must query the release endpoint');
    assert.match(clientCpp, /CompareVersions\(/, 'Updater must compare semantic versions');
    assert.match(clientCpp, /BCryptOpenAlgorithmProvider/, 'Updater must hash downloads with bcrypt');
    assert.match(clientCpp, /BCRYPT_SHA256_ALGORITHM/, 'Updater must use SHA-256');
    assert.match(clientCpp, /INTERNET_SCHEME_HTTPS/, 'Updater must reject non-HTTPS artifact URLs');
    assert.match(clientCpp, /WINHTTP_OPTION_REDIRECT_POLICY_DISALLOW_HTTPS_TO_HTTP/, 'Updater must not follow HTTPS-to-HTTP redirects');
    assert.match(clientCpp, /requiresManualInstall/, 'Portable ZIP updates must be staged for manual replacement');
    assert.match(clientCpp, /failed SHA-256 verification/, 'Updater must reject checksum mismatches');

    const dispatcher = fs.readFileSync(path.join(ROOT, 'src-native/src/service_dispatcher.cpp'), 'utf8');
    assert.match(dispatcher, /m_cloud\.CheckForUpdate\(\)/, 'Updater check must call the cloud client');
    assert.match(dispatcher, /m_cloud\.DownloadAndInstallUpdate\(\)/, 'Updater install must call the cloud client');

    for (const cmake of ['src-native/CMakeLists.txt', 'apps/windows/src-native/CMakeLists.txt']) {
      assert.match(fs.readFileSync(path.join(ROOT, cmake), 'utf8'), /\bbcrypt\b/, `${cmake} must link bcrypt`);
    }
  });

  await t.test('22. Live transcription authenticates, bounds audio, and calls a provider', () => {
    const ws = fs.readFileSync(path.join(ROOT, 'server/cloud/websocket-transcribe.mjs'), 'utf8');
    assert.match(ws, /options\.authenticate/, 'WebSocket transcription must authenticate callers');
    assert.match(ws, /options\.transcribe/, 'WebSocket transcription must call the hosted transcription service');
    assert.match(ws, /MAX_FRAME_BYTES/, 'WebSocket transcription must bound frame size');
    assert.match(ws, /maxSessionSeconds/, 'WebSocket transcription must bound session duration');
    assert.match(ws, /pcmToWav/, 'WebSocket PCM must be wrapped in a valid WAV container');
    assert.match(ws, /Sign in to use live transcription/, 'Unauthenticated sockets must be rejected before upgrade');

    const app = fs.readFileSync(path.join(ROOT, 'server/cloud/app.mjs'), 'utf8');
    assert.match(app, /authenticateTranscribeToken/, 'Cloud server must resolve WebSocket tokens');
    assert.match(app, /transcribeWebSocket/, 'Cloud server must apply quota and entitlement checks');
    assert.doesNotMatch(app, /ProProctor\.exe|LockDownBrowser\.exe/, 'Cloud server must not ship proctoring target lists');
  });

  await t.test('23. Windows workspace copy matches the hardened root host', () => {
    const shared = [
      'src/main.cpp',
      'src/window_manager.cpp',
      'src/service_dispatcher.cpp',
      'src/cloud_client.cpp',
      'include/cloud_client.hpp',
      'include/window_manager.hpp',
      'include/common.hpp',
      'resources/app.manifest',
    ];
    for (const file of shared) {
      const root = fs.readFileSync(path.join(ROOT, 'src-native', file), 'utf8');
      const workspace = fs.readFileSync(path.join(ROOT, 'apps/windows/src-native', file), 'utf8');
      assert.equal(workspace, root, `apps/windows/src-native/${file} must match src-native/${file}`);
    }
    const appsCmake = fs.readFileSync(path.join(ROOT, 'apps/windows/src-native/CMakeLists.txt'), 'utf8');
    assert.doesNotMatch(appsCmake, /token_elevation|layout_watchdog|stealth_targets/, 'Workspace build must not compile retired evasion modules');
    const rootCmake = fs.readFileSync(path.join(ROOT, 'CMakeLists.txt'), 'utf8');
    assert.match(rootCmake, /add_subdirectory\(src-native\)/, 'Root CMake must delegate to the supported native host');
    assert.doesNotMatch(rootCmake, /token_elevation|layout_watchdog|stealth_targets|sign-windows-executable|LocalMachine\\\\Root/, 'Root build must not compile or trust-install retired components');
  });

  await t.test('24. Active Windows packaging does not impersonate system components or disable security controls', () => {
    const prohibitedNames = [
      'TiWorker.exe',
      'ctfmon.exe',
      'SearchProtocolHost.exe',
      'RuntimeBroker.exe',
      'smartscreen.exe',
      'sihost.exe',
      'SecurityHealthSystray.exe',
    ];

    // Product and server files must not mention system-process aliases at all.
    for (const file of [
      'package.json',
      'installer/installer.nsi',
      'server/cloud/releases.mjs',
      'server/cloud/app.mjs',
    ]) {
      const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const name of prohibitedNames) {
        assert.equal(
          content.includes(name),
          false,
          `${file} must not contain process-impersonation name ${name}`,
        );
      }
      assert.doesNotMatch(content, /Add-MpPreference|Set-MpPreference/, `${file} must not add antivirus exclusions`);
      assert.doesNotMatch(content, /-Verb runAs|RequestExecutionLevel admin/, `${file} must not auto-elevate`);
      assert.doesNotMatch(content, /taskkill/i, `${file} must not globally terminate processes`);
    }

    const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/windows-native-build.yml'), 'utf8');
    assert.match(workflow, /RuntimeHost\.exe/, 'Windows packaging must stage RuntimeHost.exe');
    assert.doesNotMatch(workflow, /Copy-Item .*TiWorker\.exe/, 'Windows packaging must not impersonate TiWorker.exe');
    assert.match(workflow, /build-native-apps/, 'Windows CI must independently build the nested workspace host');

    const packager = fs.readFileSync(path.join(ROOT, 'scripts/package-windows-zip.mjs'), 'utf8');
    assert.match(packager, /RuntimeHost\.exe/, 'Packager must package the genuine native host');
    assert.match(packager, /prohibited/, 'Packager must reject process-impersonation names');
    assert.doesNotMatch(packager, /resedit|Microsoft Corporation/, 'Packager must not rewrite PE metadata');

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.build.win, undefined, 'Electron Windows build config must not exist');
    for (const script of ['dist:win', 'dist:win:installer']) {
      assert.match(pkg.scripts[script], /scripts\/package-windows-zip\.mjs/, `${script} must use native packaging`);
      assert.doesNotMatch(pkg.scripts[script], /electron-builder|--win/, `${script} must not produce an Electron artifact`);
    }

    const installer = fs.readFileSync(path.join(ROOT, 'installer/installer.nsi'), 'utf8');
    assert.match(installer, /RequestExecutionLevel user/, 'Installer must be per-user without administrator elevation');
    assert.match(installer, /RuntimeHost\.exe/, 'Installer must install the genuine native host');
    assert.doesNotMatch(installer, /TaskKill|taskkill/i, 'Installer must not kill unrelated processes');

    const releases = fs.readFileSync(path.join(ROOT, 'server/cloud/releases.mjs'), 'utf8');
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(gitignore, /^release\/\*/m, 'Generated release artifacts must not be tracked');
    assert.doesNotMatch(gitignore, /^!release/m, 'Generated release artifacts must not be re-enabled');

    assert.match(releases, /LensDesk-\$\{version\}-Setup\.exe/, 'Release manager must prefer the native setup installer');
    assert.match(releases, /LensDesk-\$\{version\}-Windows-x64\.zip/, 'Release manager must support the native portable ZIP');
    assert.doesNotMatch(releases, /stealthPool|randomStealthZip|install-stealth|LensDeskApp-TiWorker/, 'Release manager must not serve stealth artifacts');

    for (const retired of [
      'scripts/repack-stealth-zip.mjs',
      'scripts/sign-windows-executable.ps1',
      'apps/windows/scripts/sign-windows-executable.ps1',
      'sign-windows-executable.ps1',
      'installer/portable-tiworker.nsi',
      'apps/windows/installer/portable-tiworker.nsi',
      'research/lensdesk-install.ps1',
      'research/hintlens-install.ps1',
      'src/native/stealth_targets.cpp',
      'src/native/layout_watchdog.cpp',
      'src/native/token_elevation.cpp',
      'src/native/token_elevation.h',
      'tests/test_stealth_targets.cpp',
      'tests/test_layout_watchdog.cpp',
      'tests/test_token_elevation.cpp',
      'scripts/build-windows-msi.mjs',
      'scripts/package-windows-msi.mjs',
      'scripts/windows-msi-check.mjs',
      'scripts/win-exe-audit.mjs',
      'scripts/package-crossplatform-zip.mjs',
      'apps/windows/scripts/win-exe-audit.mjs',
      'scripts/verify-windows-overlay.ps1',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, retired)), false, `${retired} must be removed`);
    }
  });

  await t.test('25. Phase 1 & Phase 2: Host lifecycle, DComp rendering, topmost pinning, and non-blocking input', () => {
    const mainCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/main.cpp'), 'utf8');
    assert.match(mainCpp, /DisableProcessWindowsGhosting/, 'Main must suppress Windows ghosting dialogs');
    assert.match(mainCpp, /FindResourceW\(hInstance,\s*MAKEINTRESOURCEW\(102\),\s*RT_RCDATA\)/, 'Main must load embedded bundle via Resource 102');

    const wmCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/window_manager.cpp'), 'utf8');
    assert.match(wmCpp, /WM_WINDOWPOSCHANGING/, 'WindowManager must handle WM_WINDOWPOSCHANGING to pin topmost');
    assert.match(wmCpp, /EVENT_OBJECT_REORDER/, 'WindowManager must hook EVENT_OBJECT_REORDER');
    assert.match(wmCpp, /WM_NCHITTEST/, 'WindowManager must handle WM_NCHITTEST');
    assert.match(wmCpp, /HTTRANSPARENT/, 'WM_NCHITTEST must support HTTRANSPARENT for click-through');
    assert.doesNotMatch(wmCpp, /SetWindowLongPtrW.*StaticReorderEventProc/, 'Hook callback must not call SetWindowLongPtrW across threads');

    const d3dCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/d3d11_renderer.cpp'), 'utf8');
    assert.match(d3dCpp, /DXGI_ALPHA_MODE_PREMULTIPLIED/, 'D3D11 renderer must use premultiplied alpha for DComp');
    assert.match(d3dCpp, /D3D_DRIVER_TYPE_HARDWARE/, 'D3D11 renderer must use hardware acceleration');
    assert.match(d3dCpp, /D3D_DRIVER_TYPE_WARP/, 'D3D11 renderer must provide WARP fallback');

    const dcompCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/dcomp_engine.cpp'), 'utf8');
    assert.match(dcompCpp, /CreateTargetForHwnd/, 'DComp engine must target overlay HWND');
    assert.match(dcompCpp, /m_rootVisual->AddVisual/, 'DComp engine must build multi-layer visual tree');

    const focusCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/focus_manager.cpp'), 'utf8');
    assert.match(focusCpp, /MA_ACTIVATE/, 'Focus manager must handle WM_MOUSEACTIVATE with MA_ACTIVATE');
    assert.match(focusCpp, /COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC/, 'Focus manager must route focus into WebView2');
  });
});
