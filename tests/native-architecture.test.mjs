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

  await t.test('12. Elevated Presentation System: uiAccess="true" and Signing Scripts Exist', () => {
    const manifest = fs.readFileSync(path.join(ROOT, 'src-native/resources/app.manifest'), 'utf8');
    assert.match(manifest, /uiAccess="true"/, 'Manifest must specify uiAccess="true" for UIAutomation priority');
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts/sign-windows-executable.ps1')), 'Missing sign-windows-executable.ps1');
    const mainCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/main.cpp'), 'utf8');
    assert.match(mainCpp, /TryEnableUIAccess/, 'main.cpp must call TryEnableUIAccess');
  });

  await t.test('13. Continuous Desktop Layout Protection: Toolhelp32Snapshot Proctor & Z-Order Loop', () => {
    const wmCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/window_manager.cpp'), 'utf8');
    assert.match(wmCpp, /CreateToolhelp32Snapshot/, 'Missing Toolhelp32Snapshot in window_manager.cpp');
    assert.match(wmCpp, /LockDownBrowser\.exe/, 'Missing proctoring signatures');
    assert.match(wmCpp, /LayoutProtectionWorkerLoop/, 'Missing LayoutProtectionWorkerLoop');
  });

  await t.test('14. Detached WinRT OCR Engines: capture_service.cpp has OCR Pipeline', () => {
    const capCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/capture_service.cpp'), 'utf8');
    assert.match(capCpp, /PerformOcr/, 'Missing PerformOcr implementation in capture_service.cpp');
    assert.match(capCpp, /PerformOcrOnBase64/, 'Missing PerformOcrOnBase64');
  });

  await t.test('15. Inline Pointer Focus Safety Interceptor & Log-Normal Typing Dynamics', () => {
    const inputCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/input_manager.cpp'), 'utf8');
    assert.match(inputCpp, /currentFg != targetHwnd|GetForegroundWindow\(\) != targetHwnd/, 'Missing focus-drift guard in input_manager.cpp');
    assert.match(inputCpp, /lognormal_distribution/, 'Missing log-normal distribution in input_manager.cpp');
    assert.match(inputCpp, /boundaryPauseDist/, 'Missing syntax boundary hesitation logic');
  });

  await t.test('16. Hardware Endpoint WASAPI Loopback Capture Module Exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/include/audio_capture.hpp')), 'Missing audio_capture.hpp');
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/src/audio_capture.cpp')), 'Missing audio_capture.cpp');
    const audioCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/audio_capture.cpp'), 'utf8');
    assert.match(audioCpp, /AUDCLNT_STREAMFLAGS_LOOPBACK/, 'Missing WASAPI loopback flag');
  });

  await t.test('17. System-Wide Pointer Hook for Radial Wheel Intercepts Middle Button', () => {
    const inputCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/input_manager.cpp'), 'utf8');
    assert.match(inputCpp, /SetWindowsHookExW\(WH_MOUSE_LL/, 'Missing WH_MOUSE_LL hook');
    assert.match(inputCpp, /s_mbuttonDownTime/, 'Missing sustained middle-button hold detection');
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
    assert.match(dispCpp, /RegDeleteTreeW/, 'Missing registry purge');
  });

  await t.test('20. Deployment Evergreen WebView2 Bootstrapper Verification Agent Exists', () => {
    const webCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/webview2_host.cpp'), 'utf8');
    assert.match(webCpp, /EnsureWebView2Runtime/, 'Missing EnsureWebView2Runtime in webview2_host.cpp');
    assert.match(webCpp, /URLDownloadToFileW/, 'Missing Evergreen bootstrapper download');
    assert.match(webCpp, /MicrosoftEdgeWebview2Setup\.exe/, 'Missing installer execution');
  });
});
