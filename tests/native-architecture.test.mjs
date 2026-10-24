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
});
