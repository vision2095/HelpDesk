# LensDesk 2.0 Native Windows Final Rebuild Report

**Report date:** 2026-10-25  
**Workspace:** `C:\Users\hp\Downloads\LensDesk2.0-windows-native-final-rebuild\LensDesk2.0-windows-native-final-rebuild`  
**Branch:** `windows-native-final-rebuild`  
**Repository:** `https://github.com/VivekGitNinja/LensDesk2.0`

## 1. Verdict

**Functional native Windows rebuild, verified locally; not fully production-final for public distribution.**

The native C++20 host builds and runs, real OS keyboard input works in the assistant, embedded browser, Notepad, Windows Terminal, VS Code, Chrome, and Edge, the subscription gate rejects signed-out access, and the final installer installs, launches, and uninstalls cleanly.

It is **not** appropriate to call this a fully production-final public release yet because:

- The hosted subscription backend was tested only against a local cloud fixture, not a deployed production service.
- No real provider API key was available, so live hosted-provider chat was not tested end to end; an OpenAI-compatible mock verified the request/stream path.
- Firefox and Brave were not installed, so those browsers were not tested.
- The installer and `RuntimeHost.exe` are unsigned.
- The embedded browser uses one shared WebView2 controller with per-tab history, not a true multi-WebView implementation.
- `npm run test:reference` is an Electron/Playwright check and fails against the native host because it waits for `.hintlens-overlay-shell`.
- CI status must be confirmed after the delivery push; no `gh` CLI is installed.

## 2. Scope and constraints

- Work was confined to the extracted workspace above. The original LensDesk 1.3.6 project was not modified.
- The native architecture was preserved: C++20, Win32, Direct3D 11, DirectComposition, Dear ImGui, WebView2, and the existing React 19 frontend.
- The existing LensDesk UI and floating HUD design were preserved.
- Input tests used real OS `SendInput`, not CDP `fill()` or JavaScript value assignment.
- Production CDP is disabled unless `WEBVIEW2_REMOTE_DEBUGGING_PORT` is explicitly set for local testing.

## 3. Delivered artifacts

| Artifact | Path | Size | SHA-256 |
| --- | --- | ---: | --- |
| Native host | `build-native\bin\Release\RuntimeHost.exe` | 1,128,448 bytes | `7EC6992666AD6B3483E7F922DA104DC1A6FA40FFC544C68E63889DAF1DBB110D` |
| Portable ZIP | `release\LensDesk-2.0.0-Windows-x64.zip` | 1,019,936 bytes | `10FE6B1613EFEE8804288F19AAB4785C84243963DE5E32D0571AB94EB03C7C73` |
| NSIS installer | `release\LensDesk-2.0.0-Setup.exe` | 1,134,512 bytes | `8DC43F0CFAE1D25314BC622D0B7E8A903637177A70EA026348DBBBC923761AEB` |
| WebView2 loader | `build-native\bin\Release\WebView2Loader.dll` | 194,912 bytes | `D3FCE90BDEECB08596E377DEA6A316354DD8949E32FF09B89D51BE00C14E21B6` |

The authoritative hash list is also in `artifacts\final\SHA256SUMS.txt`.

`RuntimeHost.exe` version metadata:

- `FileDescription`: `LensDesk 2.0 Native Windows Host`
- `ProductName`: `LensDesk 2.0`
- `FileVersion` / `ProductVersion`: `2.0.0.0`
- `OriginalFilename`: `RuntimeHost.exe`

Both the host and installer are **NotSigned**.

## 4. Preserved architecture

- Native Win32 top-level window with per-monitor DPI handling and a floating HUD.
- Direct3D 11 swapchain and DirectComposition visual tree.
- Dear ImGui overlay for native HUD/status surfaces.
- WebView2 composition controller for the React 19 frontend and the embedded browser.
- Native service dispatcher for overlay, assistant/chat, browser, capture, storage, profiles, settings, cloud/gate, and auto-typing actions.
- Windows DPAPI for saved API keys.
- WebView2 keyboard routing through native focus ownership and `MoveFocus`; no nonexistent WebView2 keyboard-injection API is used.

## 5. Defects found and fixed

| Defect | Root cause | Fix | Verification |
| --- | --- | --- | --- |
| Subscription gate could remain active after expiry | A hardcoded/local `phase: "active"` path and UI checks that only looked at `phase`/`entitlement` | Removed the local active fallback. `CloudClient::AuthorizedNow()` now requires active phase, a non-null entitlement, verification within 120 seconds, and remaining time. Added a 45-second heartbeat. UI authorization now requires `licenseValid === true`. | Signed-out gate screenshot on the final installed build; gate/heartbeat tests in `npm test`; code inspection of `src-native\src\cloud_client.cpp` and `src\main.tsx`. |
| Saved `captureProtection` and `alwaysOnTop` preferences were ignored at startup | Preferences were read by the UI, but the native window was created with safe defaults and the saved values were not applied | Apply persisted preferences in `ServiceDispatcher` initialization before the UI reads state. | `captureProtection:false` produced window affinity `0`; `captureProtection:true` produced affinity `17`; `alwaysOnTop:true` produced the topmost style. Screenshot tests use the explicit preference rather than bypassing capture protection. |
| Embedded browser page rendered at the window origin, covering the toolbar | `ApplyLayout()` passed the screen offset in `put_Bounds` while the composition visual was already positioned; rendering and hit-testing disagreed | Offset `m_browserVisual` by the React layout origin and set controller bounds to local `(0,0,width,height)`. | `browser-os-typing.png` shows the title bar, tabs, address bar, page below, and bottom HUD. Real OS click and typing into the page succeeded. |
| Assistant did not reliably regain keyboard focus after leaving the browser | Focus remained on the browser/WebView2 surface when switching views | `OverlayView` now focuses the assistant composer when the active view changes from `browser` to `assistant`; native focus ownership remains with WebView2. | Real OS assistant typing produced the expected mock response; `assistant-os-typing.png`. |
| Browser Find overlay did not close cleanly on Escape | Escape closed the UI without clearing the native find state or returning focus | Added `closeFind()` to clear find text, close the overlay, and refocus the browser; viewport is hidden when no tab is active. | `npm test`; manual browser interaction. |
| Production build exposed CDP port 9222 by default | Remote debugging was enabled unconditionally for testing | Only enable 9222 when `WEBVIEW2_REMOTE_DEBUGGING_PORT` is explicitly set. | Final launch with no environment variable: `cdp_9222_listeners=0` in `performance-final.txt`; installed launch also had no 9222 listener. |
| Installer left `runtime_host.log` behind | Uninstaller did not delete the runtime log | Added `Delete "$INSTDIR\runtime_host.log"` to the uninstall section. | Final silent uninstall removed the install directory completely. |
| Native ZIP check assumed the Electron layout | `scripts\windows-archive-check.mjs` only understood the Electron archive | Added a native archive branch that validates CRC, x64 PE/version metadata, the bundled WebView2 loader, and fresh frontend files while preserving the Electron branch. | `npm run test:windows-archive` passed. |
| Build script depended on `cmake`/`makensis` being on `PATH` | Build could silently skip packaging on a clean machine | Added VS Build Tools CMake discovery, NSIS discovery, failure propagation, dist synchronization, and README/icon inclusion in the portable ZIP. | Final build and installer logs. |

### 5.1 Subscription enforcement detail

The final gate path is authoritative:

- `ApplyAuthoritativeSnapshot()` sets `phase` from the server entitlement, not from a local constant.
- `ApplyHeartbeat()` refreshes entitlement and verification time.
- `AuthorizedNow()` returns false if the phase is not active, entitlement is missing, the last verification is older than 120 seconds, or remaining time is exhausted.
- `GetGateView()` exposes `licenseValid`; `auth.status` and guarded operations use it.
- The React desktop gate requires `gate.phase === "active" && gate.licenseValid === true && Boolean(gate.entitlement)`.

The final installed build with cleared app data showed the sign-in gate (`gate-signed-out-final.png`), not the HUD.

### 5.2 Browser composition detail

`BrowserTabsManager::ApplyLayout()` now does the following:

```cpp
if (m_browserVisual) {
    m_browserVisual->SetOffsetX(static_cast<float>(m_layout.x));
    m_browserVisual->SetOffsetY(static_cast<float>(m_layout.y));
}
RECT rc{ 0, 0, 0, 0 };
if (show) {
    rc = RECT{ 0, 0, m_layout.width, m_layout.height };
}
m_controller->put_Bounds(rc);
m_controller->put_IsVisible(show ? TRUE : FALSE);
```

This keeps rendering and mouse hit-testing in the same coordinate space.

## 6. Build and static verification

- Compiler: Microsoft C/C++ Optimizing Compiler **19.51.36257 for x64**.
- CMake: **4.3.1-msvc1**.
- Configuration: **Release x64, C++20, Win32 subsystem**.
- Build log: `artifacts\final\build-windows-native.log`.
- PE audit log: `artifacts\final\native-binary-audit.log`.

PE audit result:

- Architecture: `x86_64 (64-bit AMD64)`
- Format: `PE32+ (Executable)`
- Sections: `.text`, `.rdata`, `.data`, `.pdata`, `.rsrc`, `.reloc`
- Native imports include `user32.dll`, `gdi32.dll`, `d3d11.dll`, `dcomp.dll`, `winhttp.dll`, `ole32.dll`, `shell32.dll`, `crypt32.dll`, `imm32.dll`.
- No Electron runtime imports (`node.dll`, `ffmpeg.dll`, `v8.dll`) were found.

## 7. Automated test results

| Check | Result | Evidence |
| --- | --- | --- |
| `npm test` | **222 passed, 0 failed** | `artifacts\final\npm-test.log` |
| `npm run test:windows-archive` | **Pass** — native ZIP passed CRC, x64 PE/version metadata, bundled WebView2 loader, and 4 fresh frontend files | `artifacts\final\native-archive-check.log` |
| PE binary audit | **Pass** — x64 PE32+, native imports, zero Electron runtime dependencies | `artifacts\final\native-binary-audit.log` |
| `npm run test:reference` | **Not applicable / fails** — Electron/Playwright check timed out waiting for `.hintlens-overlay-shell`, which the native host does not expose | `artifacts\final\reference-check.log` |

The `test:reference` failure is documented, not hidden. It is an Electron workflow check and is not evidence against the native host.

## 8. Real OS keyboard and browser tests

All input below was produced with the `SendInput` harness in `artifacts\final\keyboard\sendinput.ps1`. No CDP `fill()` or JavaScript value assignment was used to enter text.

| Target | Exact entered string | Evidence |
| --- | --- | --- |
| Notepad | `The quick brown fox jumps over the lazy dog 0123456789` | `artifacts\final\keyboard\notepad-e2e.txt` |
| Windows Terminal | `LensDesk real OS typing - Windows Terminal ` | `artifacts\final\keyboard\terminal-e2e.txt` |
| VS Code | `LensDesk real OS typing - VS Code 2026-10-25` | `artifacts\final\keyboard\vscode-e2e.txt` |
| Google Chrome | `Chrome real OS typing 2026-10-25` | `artifacts\final\keyboard\chrome-e2e.txt`, `artifacts\final\keyboard\chrome-os-typing.png` |
| Microsoft Edge | `Edge real OS typing 2026-10-25` | `artifacts\final\keyboard\edge-e2e.txt`, `artifacts\final\keyboard\edge-os-typing.png` |
| LensDesk assistant | `Final fixed binary typing 2026-10-25` | `artifacts\final\assistant-os-typing.png` |
| LensDesk embedded browser page input | `Fixed layout OS typing 2026-10-25` | `artifacts\final\browser-os-typing.png` |

Notes:

- Chrome and Edge were launched with isolated test profiles. The first Edge profile triggered Edge's own first-run Microsoft-account sync prompt; no credentials were entered. The clean Edge evidence was then produced in Edge guest mode, which avoids the prompt and extensions.
- Firefox and Brave are not installed on this machine, so they could not be tested.
- The assistant response was `Mock provider answer for: Final fixed binary typing 2026-10-25`, confirming that the real OS keystrokes reached the React composer and the native `lens:chat` bridge, then returned through the mock OpenAI-compatible provider on `127.0.0.1:4321/v1`.
- The embedded browser was navigated by real OS address-bar typing to `http://127.0.0.1:4320/e2e-test.html`; the page input was then clicked and typed with real OS input.

## 9. Screenshots

| Screenshot | What it shows |
| --- | --- |
| `artifacts\final\assistant-os-typing.png` | Assistant with the real-OS prompt and mock response, final browser-fixed binary. |
| `artifacts\final\browser-os-typing.png` | Embedded browser after the composition fix: toolbar, tabs, address bar, page below, and typed page input. |
| `artifacts\final\gate-signed-out-final.png` | Final installed build with cleared app data: sign-in gate, no HUD. |
| `artifacts\final\installed-final-hud.png` | Final installed build, signed-in HUD. |
| `artifacts\final\keyboard\chrome-os-typing.png` | Chrome with the exact real-OS string in the page input. |
| `artifacts\final\keyboard\edge-os-typing.png` | Edge guest window with the exact real-OS string in the page input. |

## 10. Security and subscription results

- **No hardcoded active subscription bypass remains.** The local "active" fallback was removed; authorization is derived from the hosted snapshot and entitlement.
- **Offline grace is bounded.** `AuthorizedNow()` requires verification within 120 seconds; the heartbeat runs every 45 seconds.
- **UI gate is authoritative.** The React desktop shell requires `licenseValid === true` in addition to active phase and entitlement.
- **Signed-out access was verified visually** on the final installed build.
- **DPAPI key storage was verified.** API keys are saved and read through Windows DPAPI (`CryptProtectData`); the mock chat path used the saved local configuration.
- **Production CDP is off by default.** A normal launch with no `WEBVIEW2_REMOTE_DEBUGGING_PORT` had zero listeners on 9222. Setting the variable explicitly enables 9222 for local testing.
- **Capture protection defaults to enabled.** Persisted `captureProtection` is applied at startup; screenshot verification explicitly opted out via the preference rather than faking a bypass.
- **Installer is per-user.** It writes HKCU uninstall/App Paths keys and requests no elevation.
- **No credentials are embedded in the repository.** The local cloud fixture account and test data were removed during cleanup.

## 11. Packaging and installer lifecycle

Installer build log: `artifacts\final\installer-build.log`.  
Full verification record: `artifacts\final\installer-verification.txt`.

Verified on the final installer:

1. Silent install to `C:\Users\hp\AppData\Local\Temp\opencode\LensDeskInstallTest` exited `0`.
2. `RuntimeHost.exe` hash matched the build output exactly.
3. Version metadata was correct.
4. `dist\index.html` and 3 frontend asset files were installed.
5. HKCU uninstall key contained `DisplayName`, `DisplayVersion`, `Publisher`, `DisplayIcon`, and `UninstallString`.
6. HKCU `App Paths\RuntimeHost.exe` pointed at the installed host.
7. Start Menu shortcuts (`LensDesk.lnk`, `Uninstall.lnk`, `Website.lnk`) and the Desktop shortcut existed with correct targets.
8. The installed host launched with no CDP listener on 9222.
9. Silent uninstall exited `0` and removed the install directory, both HKCU keys, the Start Menu folder, and the Desktop shortcut.
10. A second clean install was used to verify the signed-out gate; it also uninstalled completely.

The portable ZIP was checked by `npm run test:windows-archive` and contains the host, WebView2 loader, icon/README, and fresh frontend assets.

## 12. Performance

Final smoke test (`artifacts\final\performance-final.txt`), 1040x740 window at 125% DPI:

- Launch to window: **1,146 ms**
- Working set: **61.0 MB**
- Private memory: **47.7 MB**
- Threads: **14**
- CDP 9222 listeners: **0**

These numbers are a local smoke result, not a benchmark across hardware.

## 13. GitHub delivery and CI

- Repository: `https://github.com/VivekGitNinja/LensDesk2.0`
- Branch: `windows-native-final-rebuild`
- Remote branch existed at delivery time (`git ls-remote` succeeded); the GitHub REST API returned 404 without authentication, consistent with a private repository.
- The workspace originally had no `.git` directory. The final source was overlaid onto a clone of the remote branch and pushed as a delivery commit.
- The repository contains `.github\workflows\windows-native-build.yml`, which runs the native build, tests, PE audit, runtime/interactive checks, ZIP packaging, NSIS installer build, and distribution verification on Windows.
- CI run link/status should be read from the repository's Actions page after the push. No `gh` CLI was installed in this environment.

## 14. Limitations and remaining production work

1. **Hosted backend not production-deployed.** The local cloud fixture proved login, entitlement, heartbeat, and signed-out gating, but it is not a production service.
2. **No real provider E2E.** The mock provider verified the OpenAI-compatible request/stream/commit path; a live hosted provider still needs a real key and production endpoint test.
3. **Firefox/Brave untested.** Those browsers are not installed.
4. **Unsigned binaries.** Code signing and SmartScreen reputation are not done.
5. **Single shared WebView2 controller.** Tabs have independent history/state, but the implementation does not create one WebView2 per tab.
6. **Electron-only reference test.** `npm run test:reference` cannot validate the native host.
7. **CI confirmation.** The workflow is committed, but the run result must be checked after push.
8. **Production deployment artifacts.** The hosted cloud service, TLS/reverse proxy, SMTP, payment webhook secrets, and release signing still require deployment-specific configuration.

## 15. Evidence index

All paths are relative to the workspace root.

```
artifacts\final\
  SHA256SUMS.txt
  build-windows-native.log
  native-binary-audit.log
  npm-test.log
  native-archive-check.log
  reference-check.log
  performance-final.txt
  installer-build.log
  installer-verification.txt
  installed-runtime.log
  assistant-os-typing.png
  browser-os-typing.png
  gate-signed-out-final.png
  installed-final-hud.png
  verification-summary.json
  keyboard\
    sendinput.ps1
    notepad-e2e.txt
    terminal-e2e.txt
    vscode-e2e.txt
    chrome-e2e.txt
    chrome-os-typing.png
    edge-e2e.txt
    edge-os-typing.png
```

## 16. Final assessment

The rebuild is a genuine native Windows application, not an Electron wrapper. The highest-risk interactive defects found during final testing—assistant focus handoff, embedded-browser composition/hit-testing, startup preference application, stale subscription authorization, and installer cleanup—were fixed and re-tested with real OS input and final packaged artifacts.

The correct production verdict is: **ready for controlled local/self-hosted evaluation and installer testing; not yet a fully production-final public release** until the hosted backend, live provider path, code signing, and CI/release confirmation are completed.
