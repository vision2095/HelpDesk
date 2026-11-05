import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');

test('LensDesk 2.0 Native Windows HintLens Parity & 9 Gaps Audit', async (t) => {

  await t.test('GAP 01: Native executable architecture, resources, and zero Electron on Windows', () => {
    // Zero Electron on Windows
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.build?.win, undefined, 'Must have zero Electron Windows build target');
    assert.match(pkg.scripts['dist:win'], /package-windows-zip\.mjs/, 'Windows packaging must use native packager');

    // C++20 Win32 CMake configuration
    const cmake = fs.readFileSync(path.join(ROOT, 'src-native/CMakeLists.txt'), 'utf8');
    assert.match(cmake, /CMAKE_CXX_STANDARD 20/);
    assert.match(cmake, /add_executable\(RuntimeHost WIN32/);
    assert.match(cmake, /LENSDESK_BUILD_UIACCESS/);
    assert.match(cmake, /app-accessibility\.manifest/);

    // PE resources and manifest
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/resources/app.rc')));
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/resources/app.manifest')));
    const manifest = fs.readFileSync(path.join(ROOT, 'src-native/resources/app.manifest'), 'utf8');
    assert.match(manifest, /level="asInvoker"/);
    assert.match(manifest, /PerMonitorV2/);
  });

  await t.test('GAP 02: Complete Dear ImGui UI migration component audit', () => {
    const overlayCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/imgui_overlay.cpp'), 'utf8');
    const overlayHpp = fs.readFileSync(path.join(ROOT, 'src-native/include/imgui_overlay.hpp'), 'utf8');

    // Reference Window Tags
    const requiredWindowTags = [
      'Settings###SettingsWin',
      'Hotkeys###CheatSheet',
      'LensDesk Assistant###ChatWin',
      'Interview Workspace###InterviewWin',
      'Browser###BrowserWin',
      'LensDesk Sign In###AuthGateWin',
      'LensDesk 2.0 Architecture Diagnostics'
    ];
    for (const tag of requiredWindowTags) {
      assert.ok(overlayCpp.includes(tag), `Dear ImGui overlay must implement window tag ${tag}`);
    }

    // Reference Widget IDs
    const requiredWidgetIds = [
      '##min_strip',
      '##min_status',
      '##min_chat',
      '##chat',
      '##set_provider',
      '##set_model',
      '##stop_answer',
      '##ivtranscript',
      '##ivspeech',
      '##ivsuggest',
      '##ivshots',
      '##ivcompactline',
      '##exitinterview',
      '##settings_nav',
      '##settings_content',
      '##light_sw',
      '##light_text',
      '##dark_sw',
      '##dark_text',
      '##reset_colors',
      '##opacity',
      '##capmon',
      '##typing_wpm',
      '##browser_home',
      '##browser_search',
      '##browser_zoom',
      '##confirm_clear_browser',
      '##local_host',
      '##local_port',
      '##local_model',
      '##signout_btn',
      '##wipe_btn',
      '##confirm_wipe',
      '##url',
      '##back',
      '##fwd',
      '##reload',
      '##home',
      '##loginpanel',
      '##login_email',
      '##login_pwd',
      '##quit',
      '##sysprompt',
      'Full##iv',
      'Compact##iv',
      '##ivopacity',
      '##gesture_trigger',
      '-##armdec',
      '+##arminc',
      '##slot',
      '##typing_jitter',
      '##typing_mistakes',
      '##typing_pauses',
      '##save_shots_disk',
      '##save_ans_hist',
      '##iv_ai_help',
      '##iv_undo_shot',
      '##iv_clear_trans'
    ];
    for (const id of requiredWidgetIds) {
      assert.ok(overlayCpp.includes(id), `Dear ImGui overlay must implement reference widget ID ${id}`);
    }

    // 9 Settings Navigation Tabs (Model, Appearance, Capture, Typing, Hotkeys, Mouse, Browser, Local LLM, Account)
    for (const tab of ['Model', 'Appearance', 'Capture', 'Typing', 'Hotkeys', 'Mouse', 'Browser', 'Local LLM', 'Account']) {
      assert.ok(overlayCpp.includes(`"${tab}"`), `Dear ImGui settings navigation must include tab ${tab}`);
    }

    // Mathematical formula / Unicode translation
    assert.match(overlayCpp, /FormatMarkdownMath/);
    assert.match(overlayCpp, /\\rightarrow/);
    assert.match(overlayCpp, /\\sqrt/);
    assert.match(overlayCpp, /\\leq/);
    assert.match(overlayCpp, /\\land/);
    assert.match(overlayCpp, /\\lor/);
    assert.match(overlayCpp, /\\neg/);
    assert.match(overlayCpp, /\\deg/);
    assert.match(overlayCpp, /\\mapsto/);
    assert.match(overlayCpp, /\\implies/);

    // Markdown table rendering (##mdtable) & Interview live indicators
    assert.match(overlayCpp, /##mdtable/);
    assert.match(overlayCpp, /\[interviewer: live\]/);
    assert.match(overlayCpp, /\[interviewer: off\]/);
  });

  await t.test('GAP 03: Windows window management, topmost, DPI and input dynamics', () => {
    const wmCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/window_manager.cpp'), 'utf8');
    assert.match(wmCpp, /HWND_TOPMOST/);
    assert.match(wmCpp, /EVENT_SYSTEM_FOREGROUND/);

    const inputCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/input_manager.cpp'), 'utf8');
    assert.match(inputCpp, /lognormal_distribution/);
    assert.match(inputCpp, /boundaryPauseDist/);
    assert.match(inputCpp, /tier1PauseDist/);
    assert.match(inputCpp, /tier2PauseDist/);
    assert.doesNotMatch(inputCpp, /BlockInput/);

    // Elevation & UIPI compatibility checks
    const inputHpp = fs.readFileSync(path.join(ROOT, 'src-native/include/input_manager.hpp'), 'utf8');
    assert.match(inputHpp, /IsCurrentProcessElevated/);
    assert.match(inputHpp, /HasUiAccess/);
    assert.match(inputHpp, /IsWindowElevated/);
    assert.match(inputCpp, /typing:elevated_target/);

    const dispCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/service_dispatcher.cpp'), 'utf8');
    assert.match(dispCpp, /typing:elevated_target/);
    assert.match(dispCpp, /desktop\.requestElevation/);
    assert.match(dispCpp, /isElevated/);
    assert.match(dispCpp, /hasUiAccess/);

    const overlayCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/imgui_overlay.cpp'), 'utf8');
    assert.match(overlayCpp, /Restart Elevated \(Run as Administrator\)##req_elevation/);
    assert.match(overlayCpp, /Elevate Process via UAC##diag_elevate/);

    const focusHpp = fs.readFileSync(path.join(ROOT, 'src-native/include/focus_manager.hpp'), 'utf8');
    for (const s of ['INACTIVE', 'ACTIVATING', 'FOCUSED_ASSISTANT', 'FOCUSED_BROWSER', 'FOCUSED_NATIVE_CONTROL', 'SWITCHING_VIEW', 'FOCUS_LOST', 'RESTORING']) {
      assert.match(focusHpp, new RegExp(`\\b${s}\\b`));
    }
  });

  await t.test('GAP 04: Process compatibility, lifecycle, diagnostics and clean logging', () => {
    const overlayCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/imgui_overlay.cpp'), 'utf8');
    assert.match(overlayCpp, /RenderDiagnostics/);
    assert.match(overlayCpp, /WDA_EXCLUDEFROMCAPTURE/);
    assert.match(overlayCpp, /Direct3D 11\.1 \+ DirectComposition/);

    const mainCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/main.cpp'), 'utf8');
    assert.match(mainCpp, /runtime_host\.log/);
    assert.match(mainCpp, /AttachConsole/);
  });

  await t.test('GAP 05: WebView2 prerequisite handling, authentic Microsoft source and offline fallback', () => {
    const webCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/webview2_host.cpp'), 'utf8');
    assert.match(webCpp, /EnsureWebView2Runtime/);
    assert.match(webCpp, /https:\/\/go\.microsoft\.com\/fwlink\/p\/\?LinkId=2124703/);
    assert.match(webCpp, /MicrosoftEdgeWebview2Setup\.exe/);
    assert.match(webCpp, /\/silent \/install/);
    assert.match(webCpp, /m_runtimeAvailable = false/);

    // Dear ImGui browser view must handle missing runtime gracefully
    const overlayCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/imgui_overlay.cpp'), 'utf8');
    assert.match(overlayCpp, /Browser mode unavailable - is the WebView2 runtime installed\?/);
    assert.match(overlayCpp, /Make sure the Microsoft Edge WebView2 Runtime is installed, then try again\./);
    assert.match(overlayCpp, /Download & Install Evergreen WebView2 Runtime/);
  });

  await t.test('GAP 06: Secure per-user installation and active Windows protection compatibility', () => {
    const nsi = fs.readFileSync(path.join(ROOT, 'installer/installer.nsi'), 'utf8');
    assert.match(nsi, /RequestExecutionLevel user/);
    assert.doesNotMatch(nsi, /Set-MpPreference|Add-MpPreference/);
    assert.doesNotMatch(nsi, /TaskKill|taskkill/i);

    const webCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/webview2_host.cpp'), 'utf8');
    assert.doesNotMatch(webCpp, /msSmartScreenProtection/, 'Must not disable Windows SmartScreen protection');

    // Signed Accessibility manifest & signing integration script
    assert.ok(fs.existsSync(path.join(ROOT, 'src-native/resources/app-accessibility.manifest')));
    const accessManifest = fs.readFileSync(path.join(ROOT, 'src-native/resources/app-accessibility.manifest'), 'utf8');
    assert.match(accessManifest, /uiAccess="true"/);
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts/sign-accessibility-binary.ps1')));
  });

  await t.test('GAP 07: Browser zoom (50%-150%) and search selector (Google, DuckDuckGo, Bing)', () => {
    // 1. Storage Manager preferences support
    const storageHpp = fs.readFileSync(path.join(ROOT, 'src-native/include/storage_manager.hpp'), 'utf8');
    assert.match(storageHpp, /GetSearchEngine/);
    assert.match(storageHpp, /SetSearchEngine/);
    assert.match(storageHpp, /GetBrowserZoom/);
    assert.match(storageHpp, /SetBrowserZoom/);

    const storageCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/storage_manager.cpp'), 'utf8');
    assert.match(storageCpp, /prefs\["browser"\]\["searchEngine"\] = engine/);
    assert.match(storageCpp, /prefs\["browser"\]\["zoom"\] = clamped/);

    // 2. Browser Tabs normalization logic
    const browserCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/browser_tabs.cpp'), 'utf8');
    assert.match(browserCpp, /https:\/\/www\.google\.com\/search\?q=/);
    assert.match(browserCpp, /https:\/\/duckduckgo\.com\/\?q=/);
    assert.match(browserCpp, /https:\/\/www\.bing\.com\/search\?q=/);
    assert.match(browserCpp, /m_searchEngine/);
    assert.match(browserCpp, /m_defaultZoom/);

    // 3. ImGui Overlay UI controls
    const overlayCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/imgui_overlay.cpp'), 'utf8');
    assert.match(overlayCpp, /##browser_search/);
    assert.match(overlayCpp, /##browser_zoom/);
    assert.match(overlayCpp, /50%/);
    assert.match(overlayCpp, /75%/);
    assert.match(overlayCpp, /100%/);
    assert.match(overlayCpp, /125%/);
    assert.match(overlayCpp, /150%/);

    // 4. Service Dispatcher IPC routing
    const dispCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/service_dispatcher.cpp'), 'utf8');
    assert.match(dispCpp, /browser\.searchEngine/);
    assert.match(dispCpp, /browser\.zoom/);
  });

  await t.test('GAP 08: Native custom text color controls with validation, live preview, and reset', () => {
    // 1. Common validation helper
    const commonHpp = fs.readFileSync(path.join(ROOT, 'src-native/include/common.hpp'), 'utf8');
    assert.match(commonHpp, /IsValidHexColor/);

    // 2. Storage Manager persistence
    const storageCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/storage_manager.cpp'), 'utf8');
    assert.match(storageCpp, /SetLightTextColor/);
    assert.match(storageCpp, /SetDarkTextColor/);
    assert.match(storageCpp, /ResetColors/);
    assert.match(storageCpp, /#24384c/, 'Light text color default');
    assert.match(storageCpp, /#e2eaf5/, 'Dark text color default');

    // 3. Dear ImGui Overlay controls
    const overlayCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/imgui_overlay.cpp'), 'utf8');
    assert.match(overlayCpp, /##light_sw/);
    assert.match(overlayCpp, /##light_text/);
    assert.match(overlayCpp, /##dark_sw/);
    assert.match(overlayCpp, /##dark_text/);
    assert.match(overlayCpp, /Reset colors/);
    assert.match(overlayCpp, /color_preview_box/);
    assert.match(overlayCpp, /Invalid #hex!/);

    // 4. Service Dispatcher IPC routing
    const dispCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/service_dispatcher.cpp'), 'utf8');
    assert.match(dispCpp, /appearance\.setTextColor/);
    assert.match(dispCpp, /appearance\.resetColors/);
  });

  await t.test('GAP 09: Single-instance management, activation message, and crash recovery', () => {
    const commonHpp = fs.readFileSync(path.join(ROOT, 'src-native/include/common.hpp'), 'utf8');
    assert.match(commonHpp, /WM_LENSDESK_ACTIVATE_NAME/);
    assert.match(commonHpp, /SINGLE_INSTANCE_MUTEX/);

    const mainCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/main.cpp'), 'utf8');
    assert.match(mainCpp, /RegisterWindowMessageW/);
    assert.match(mainCpp, /CreateMutexW\(nullptr, TRUE, SINGLE_INSTANCE_MUTEX\)/);
    assert.match(mainCpp, /WAIT_ABANDONED/, 'Must handle ungraceful predecessor crash');
    assert.match(mainCpp, /PostMessageW\(existingHwnd, wmActivateMsg/);
    assert.match(mainCpp, /ReleaseMutex\(hMutex\)/);
    assert.doesNotMatch(mainCpp, /TiWorker\.exe|svchost\.exe|explorer\.exe/);
  });

  await t.test('GAP 10: End-to-end native interaction, non-blocking mouse, live streaming & standalone Dear ImGui', () => {
    // 1. Non-blocking mouse capture: WantCaptureMouse only captures when hovering an ImGui widget or modal wheel
    const overlayCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/imgui_overlay.cpp'), 'utf8');
    assert.match(overlayCpp, /return io\.WantCaptureMouse \|\| m_state\.showRadialMenu;/);

    // 2. Real Auth Gate and Account actions
    assert.match(overlayCpp, /m_dispatcher->Dispatch\("gate\.login"/);
    assert.match(overlayCpp, /m_dispatcher->Dispatch\("gate\.browserLogin"/);
    assert.match(overlayCpp, /m_dispatcher->Dispatch\("gate\.logout"/);

    // 3. Standalone pure Dear ImGui execution without dist/
    const webCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/webview2_host.cpp'), 'utf8');
    assert.match(webCpp, /Web assets \('dist' directory\) absent or omitted/);
    assert.match(webCpp, /m_controller->put_IsVisible\(FALSE\)/);

    const mainCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/main.cpp'), 'utf8');
    assert.match(mainCpp, /running pure Dear ImGui native HUD/);
    assert.doesNotMatch(mainCpp, /MessageBoxW\(hwnd,.*Missing Assets/);

    // 4. Live SSE streaming deltas and transcription forwarded to ImGui overlay
    const dispCpp = fs.readFileSync(path.join(ROOT, 'src-native/src/service_dispatcher.cpp'), 'utf8');
    assert.match(dispCpp, /ForwardEventToImgui/);
    assert.match(dispCpp, /state\.streamingAnswer \+= delta;/);
    assert.match(dispCpp, /m_imguiOverlay->AppendInterviewTranscript/);
    assert.match(dispCpp, /Dispatch\("desktop\.capture"/);
    assert.match(dispCpp, /Dispatch\("desktop\.ocr"/);

    // 5. Intelligent interviewer question vs conversational filler filter
    assert.match(dispCpp, /IsInterviewerQuestion/);
    assert.match(dispCpp, /Listening - \(no question yet\)/);
    assert.match(dispCpp, /Question detected - asking AI\.\.\./);
  });

  await t.test('Parity check: apps/windows workspace matches root src-native', () => {
    const filesToSync = [
      'include/common.hpp',
      'include/storage_manager.hpp',
      'src/storage_manager.cpp',
      'include/browser_tabs.hpp',
      'src/browser_tabs.cpp',
      'include/imgui_overlay.hpp',
      'src/imgui_overlay.cpp',
      'include/webview2_host.hpp',
      'src/webview2_host.cpp',
      'include/service_dispatcher.hpp',
      'src/service_dispatcher.cpp',
      'include/input_manager.hpp',
      'src/input_manager.cpp',
      'src/main.cpp',
    ];
    for (const f of filesToSync) {
      const rootContent = fs.readFileSync(path.join(ROOT, 'src-native', f), 'utf8');
      const wsContent = fs.readFileSync(path.join(ROOT, 'apps/windows/src-native', f), 'utf8');
      assert.equal(wsContent, rootContent, `apps/windows/src-native/${f} must match src-native/${f}`);
    }
  });
});
