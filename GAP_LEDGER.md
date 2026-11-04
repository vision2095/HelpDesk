# Master Orchestrator Plan & Independent Gap Ledger

**Environment:** macOS ARM64 development host -> Native Windows x64 Target Application  
**Architectural Baseline:** C++20, Win32 / WinRT, Direct3D 11.1, DirectComposition, Dear ImGui, Microsoft Edge WebView2, WASAPI Loopback, WinRT OCR.  
**Strict Rule:** ABSOLUTE ZERO ELECTRON IN WINDOWS. macOS application untouched.

---

## 1. Specialist Agent Role Allocation for Final 7 Critical Production Gaps

| Gap ID | Subsystem Area | Implementation Owner | Independent Reviewer | Production Scope & Verification Criteria |
|---|---|---|---|---|
| **GAP-P0-01** | Real Google OAuth Login & Security | `auth_security_engineer` | `qa_verification_specialist` | RFC 7636 Authorization Code Flow with PKCE S256 (`common.hpp`), cryptographically random state parameter (`GenerateRandomState(32)`), ephemeral loopback socket (`127.0.0.1:0`), one-time code exchange via `/api/desktop.exchangeCode`, DPAPI token storage, CSRF protection, and zero token exposure in browser URLs or history. |
| **GAP-P0-02** | Real Live AI Provider Responses & Streaming | `ai_integration_engineer` | `windows_architecture_reviewer` | True SSE chunk-by-chunk streaming via WinHTTP `HttpStreamJson`, live `lens:chat` delta broadcasting, OpenAI/Anthropic/Gemini/Groq/DeepSeek format delta extraction, token usage extraction, cancellation support, and HTTP error code mapping (401, 429, 403, 500). |
| **GAP-P0-03** | Real Local LLM Inference & Vision Fallback | `ai_integration_engineer` | `windows_architecture_reviewer` | Active probing on 11434 (Ollama), 1234 (LM Studio), 8080 (llama.cpp), 8000 (vLLM); model routing; automatic WinRT OCR prompt extraction and HintLens banner formatting for non-vision local models. |
| **GAP-P0-04** | Real WASAPI Audio to Speech-to-Text | `audio_stt_engineer` | `security_dependency_reviewer` | WASAPI loopback capture on `eRender`, float32/pcm16 audio conversion (`audio_samples.hpp`), WebSocket upgrade-head frame handling, bounded buffering, and complete transcript drain before emission on stop. |
| **GAP-P0-05** | Real WinRT OCR Accuracy & Benchmarking | `ocr_vision_engineer` | `windows_architecture_reviewer` | Real Character Error Rate (CER) and Word Error Rate (WER) evaluation, Levenshtein distance metrics against ground truth text, 2600px max dimension bilinear scaling, 32-bit BGRA conversion, and MTA worker thread dispatch. |
| **GAP-P0-06** | Real PostgreSQL Cloud Synchronization | `cloud_sync_engineer` | `qa_verification_specialist` | Migration 0002 for `user_workspaces` and `user_settings`, strict multi-account data isolation, revision monotonicity, and atomic transactional backup push/pull. |
| **GAP-P0-07** | Real Auto-Updater, Installation and Rollback | `build_ci_engineer` | `master_orchestrator` | HTTPS semver comparison, SHA-256 integrity verification, temporary directory staging, pre-install backup creation, and atomic replacement with rollback protection. |

---

## 2. Comprehensive 17-Item Gap Ledger (Historical & P0 Critical Production Gaps)

| Gap ID | Feature | Reference Evidence | Repository A Status | Repository B Status | Assigned Implementer | Independent Reviewer | Files Changed | Tests | Windows Runtime Evidence | Final Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **GAP-P0-01** | Real Google OAuth Login & Security (PKCE S256) | HintLens local HTTP loopback OAuth token extractor | FIXED & COMMITTED (`ac08418`) | FIXED & VERIFIED (`a51c814`) | `auth_security_engineer` | `qa_verification_specialist` | `src-native/include/common.hpp`, `src-native/src/service_dispatcher.cpp`, `server/cloud/app.mjs` (all trees) | `tests/unit/oauth-pkce-flow.test.mjs` (4 passed) | Ephemeral socket binding, constant-time challenge match, zero token URL exposure | **VERIFIED** |
| **GAP-P0-02** | Real Live AI Provider Responses & Streaming | HintLens SSE streaming deltas | FIXED & COMMITTED (`ac08418`) | FIXED & VERIFIED (`a51c814`) | `ai_integration_engineer` | `windows_architecture_reviewer` | `src-native/src/service_dispatcher.cpp`, `apps/windows/src-native/src/service_dispatcher.cpp` | `tests/unit/ai-streaming-protocol.test.mjs` (3 passed) | WinHTTP SSE chunk parser, multi-provider extraction, HTTP 401/429/403 mapping | **VERIFIED** |
| **GAP-P0-03** | Real Local LLM Inference & Vision Fallback | HintLens loopback probe on 11434, 1234, 8080, 8000 | FIXED & COMMITTED (`ac08418`) | FIXED & VERIFIED (`a51c814`) | `ai_integration_engineer` | `windows_architecture_reviewer` | `src-native/src/service_dispatcher.cpp`, `service_dispatcher.hpp` | `tests/unit/local-model-detect.test.mjs` (2 passed) | Port scanner, model tags parser, automatic WinRT OCR banner formatting | **VERIFIED** |
| **GAP-P0-04** | Real WASAPI Audio to Speech-to-Text | HintLens audio loopback & transcription | FIXED & COMMITTED (`ac08418`) | FIXED & VERIFIED (`a51c814`) | `audio_stt_engineer` | `security_dependency_reviewer` | `src-native/src/audio_capture.cpp`, `server/cloud/websocket-transcribe.mjs` | `tests/unit/windows-transcription-drain.test.mjs` (6 passed) | RingBuffer SPSC, float32->pcm16, upgrade-head frame handling, drain on stop | **VERIFIED** |
| **GAP-P0-05** | Real WinRT OCR Accuracy & Benchmarking | HintLens screen capture OCR prompt formatting | FIXED & COMMITTED (`ac08418`) | FIXED & VERIFIED (`a51c814`) | `ocr_vision_engineer` | `windows_architecture_reviewer` | `src/native/ocr_pipeline.cpp`, `src-native/src/capture_service.cpp` | `tests/unit/ocr-accuracy-benchmark.test.mjs` (3 passed) | Real CER/WER Levenshtein distance metrics, 2600px bilinear downscaling, MTA worker | **VERIFIED** |
| **GAP-P0-06** | Real PostgreSQL Cloud Synchronization | HintLens Cloud sync integration | FIXED & COMMITTED (`ac08418`) | FIXED & VERIFIED (`a51c814`) | `cloud_sync_engineer` | `qa_verification_specialist` | `server/cloud/postgres-migrations.mjs`, `server/cloud/postgres-store.mjs`, `server/cloud/app.mjs` | `tests/unit/postgres-cloud-sync.test.mjs` (3 passed) | Migration 0002 for user_workspaces and user_settings, multi-tenant isolation | **VERIFIED** |
| **GAP-P0-07** | Real Auto-Updater, Installation and Rollback | HintLens auto-update verification & staging | FIXED & COMMITTED (`ac08418`) | FIXED & VERIFIED (`a51c814`) | `build_ci_engineer` | `master_orchestrator` | `src-native/src/cloud_client.cpp`, `service_dispatcher.cpp` | `tests/unit/auto-updater-rollback.test.mjs` (3 passed) | Semver comparison, SHA-256 verification, temp staging, rollback on failure | **VERIFIED** |
| **GAP-01** | Native Backup & Recovery (Snapshots, Restore, Isolation) | HintLens local data persistence, snapshot rollbacks | FIXED & COMMITTED (`dd893ce`) | FIXED & VERIFIED (`b7a0194`) | `backup_recovery_engineer` | `qa_verification_specialist` | `src-native/include/storage_manager.hpp`, `src-native/src/storage_manager.cpp` | `tests/native-storage-backup.test.mjs` (4 passed) | Verified in Phase 8 of Windows GUI Fixture Test (CI Run [41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874)) | **VERIFIED** |
| **GAP-02** | Live Model Connection Testing (`model.test`) | HintLens Provider model latency/connection test | FIXED & COMMITTED (`ef22ec2`) | FIXED & VERIFIED (`145002b`) | `ai_integration_engineer` | `qa_verification_specialist` | `src-native/src/service_dispatcher.cpp`, `apps/windows/src-native/src/service_dispatcher.cpp` | `scripts/test-interactive-windows.mjs` (Phase 8 passed) | Verified in Phase 8 of Windows GUI Fixture Test (CI Run [41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874)) | **VERIFIED** |
| **GAP-03** | WinRT OCR Fallback for Non-Vision & Local Models | HintLens screen capture OCR prompt formatting for text models | FIXED & COMMITTED (`ba1740d`) | FIXED & VERIFIED (`1a60aea`) | `ocr_vision_engineer` | `windows_architecture_reviewer` | `src-native/src/service_dispatcher.cpp`, `apps/windows/src-native/src/service_dispatcher.cpp` | `tests/test_ocr_pipeline.cpp` | Verified in Windows Runtime Suite & WinRT OCR integration (CI Run [41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874)) | **VERIFIED** |
| **GAP-04** | WASAPI Loopback & WebSocket Audio Drain | HintLens audio loopback & transcription | RECOVERED & COMMITTED (`c4e6533`) | RECOVERED & VERIFIED (`c4e6533`) | `audio_stt_engineer` | `security_dependency_reviewer` | `server/cloud/websocket-transcribe.mjs`, `apps/web/server/cloud/websocket-transcribe.mjs` | `tests/unit/windows-transcription-drain.test.mjs` (6 passed) | Verified in Windows Runtime WASAPI & WebSocket suite (CI Run [41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874)) | **VERIFIED** |
| **GAP-05** | Production Auth Security & Fixture Isolation | Security requirement: zero test credentials in production | RECOVERED & COMMITTED (`c4e6533`) | RECOVERED & VERIFIED (`c4e6533`) | `security_dependency_reviewer` | `build_ci_engineer` | `src-native/include/common.hpp`, `src-native/src/cloud_client.cpp`, `src-native/CMakeLists.txt` | `tests/unit/windows-auth-fixture.test.mjs` (PASSED) | Verified in PE Binary Audit of Windows CI Run ([41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874)) | **VERIFIED** |
| **GAP-06** | Browser View Toggle & Target Discovery Race | HintLens floating browser/assistant switch | FIXED & COMMITTED (`ba1740d`) | FIXED & VERIFIED (`1a60aea`) | `webview2_browser_engineer` | `ui_ux_reviewer` | `scripts/test-interactive-windows.mjs` | `scripts/test-interactive-windows.mjs` (Phase 7 passed) | Verified in Phase 7 of Windows GUI Fixture Test (CI Run [41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874)) | **VERIFIED** |
| **GAP-07** | Native Cloud Request Worker Dispatch (`cloud.pull/push`) | HintLens Cloud sync integration | RECOVERED & COMMITTED (`c4e6533`) | RECOVERED & VERIFIED (`c4e6533`) | `cloud_sync_engineer` | `qa_verification_specialist` | `src-native/src/service_dispatcher.cpp` | `tests/cloud.test.mjs` | Verified in Windows Runtime Suite (CI Run [41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874)) | **VERIFIED** |
| **GAP-08** | Windows CI & Packaging Alignment | Zero Electron, genuine LensDesk metadata, NSIS installer, portable zip | FIXED & COMMITTED (`58d85e2`) | FIXED & VERIFIED (`f8b8bf4`) | `build_ci_engineer` | `master_orchestrator` | `.github/workflows/windows-native-build.yml` | `npm test` (306 passed), `test:reference` (passed) | 100% Passed Windows CI Run [41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874) | **VERIFIED** |
| **GAP-09** | HintLens Loopback Browser Login (`gate.browserLogin`) | HintLens local HTTP loopback OAuth token extractor | FIXED & COMMITTED (`58d85e2`) | FIXED & VERIFIED (`f8b8bf4`) | `auth_security_engineer` | `qa_verification_specialist` | `src-native/src/service_dispatcher.cpp`, `cloud_client.cpp`, `CMakeLists.txt`, `src/GateAccess.tsx` | `tests/unit/windows-browser-login.test.mjs` (PASSED) | Verified in Windows MSVC compilation and Phase 4 of GUI test (CI Run [41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874)) | **VERIFIED** |
| **GAP-10** | Active Local LLM Port Scanner & Vision Fallback | HintLens loopback probe on 11434, 1234, 8080, 8000 | FIXED & COMMITTED (`58d85e2`) | FIXED & VERIFIED (`f8b8bf4`) | `ai_integration_engineer` | `windows_architecture_reviewer` | `src-native/src/service_dispatcher.cpp`, `service_dispatcher.hpp` | `tests/unit/local-model-detect.test.mjs` (PASSED) | Verified in Windows MSVC compilation and Core test suite (CI Run [41805588874](https://github.com/VivekGitNinja/LensDesk2.0/actions/runs/41805588874)) | **VERIFIED** |

---

## 3. Verified Production Windows Release Artifacts

| Release Artifact | File Path | File Size | SHA-256 Checksum |
|---|---|---|---|
| **Windows NSIS Installer** | `LensDesk-2.0.0-Setup.exe` | 1,566,275 bytes | `b7b77cde578ef798710b27d996142855a7cbccdbcd1f6aae6e2e2b8227046cb6` |
| **Standalone Portable Archive** | `LensDesk-2.0.0-Windows-x64.zip` | 1,545,625 bytes | `63b4eac64fde657a298700032192d51a83296bdbe4d800175daca5ad431e6d19` |
| **Native Production Executable** | `RuntimeHost.exe` | 1,813,504 bytes | `11e3c7d05f93d215254cd85efc3ac25a988b8ea863499e3ece14304480631925` |
| **Microsoft Edge WebView2 SDK** | `WebView2Loader.dll` | 194,912 bytes | `d3fce90bdeecb08596e377dea6a316354dd8949e32ff09b89d51be00c14e21b6` |

---

## 4. 23-Subsystem Comprehensive Architectural Status

1. **Native Window Host:** Win32 + Direct3D 11.1 + DirectComposition + DwmExtendFrameIntoClientArea (**VERIFIED**)
2. **HUD Overlay Architecture:** Dear ImGui C++ + Microsoft Edge WebView2 hosting React 19 (**VERIFIED**)
3. **Screen Content Protection:** `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE / 0x11)` (**VERIFIED**)
4. **Desktop Screen Capture:** Multi-monitor GDI DIBSection capture with cursor monitor bounds (`MonitorFromPoint`) (**VERIFIED**)
5. **Interactive Region Snip:** Two-point marquee crop with coordinate normalization (**VERIFIED**)
6. **Local OCR Pipeline:** WinRT `Windows::Media::Ocr::OcrEngine` on asynchronous MTA worker (**VERIFIED**)
7. **OCR Fallback for Non-Vision Models:** Automatic OCR text extraction and HintLens prompt banner formatting (**VERIFIED**)
8. **Audio Capture Client:** WASAPI Loopback on `eRender` with silent feeder client (**VERIFIED**)
9. **Streaming Transcription:** Secure WebSocket streaming with upgrade-head processing and bounded audio drain (**VERIFIED**)
10. **Auto-Typing Simulator:** Win32 `SendInput` with log-normal timing and modifier state restoration (**VERIFIED**)
11. **Focus Protection Guard:** `GetForegroundWindow()` rechecked per keystroke with instant drift abort (**VERIFIED**)
12. **Global Hotkeys:** Win32 `RegisterHotKey` engine with duplicate detection and rollback (**VERIFIED**)
13. **Mouse Interaction & Gestures:** Click-through transparency (`WS_EX_TRANSPARENT`), cursor tracking, and Radial Action Wheel (**VERIFIED**)
14. **Embedded Browser Tabs:** Multi-tab WebView2 container with CDP focus switching and bundle dropping (**VERIFIED**)
15. **AI Providers & Streaming:** Direct WinHTTP client supporting OpenAI, Anthropic, Gemini, Groq, DeepSeek, and Ollama with live SSE deltas (**VERIFIED**)
16. **Local Model Scanner:** Loopback port probe across 11434 (Ollama), 1234 (LM Studio), 8080 (llama.cpp), and 8000 (vLLM) (**VERIFIED**)
17. **Transactional Backup & Recovery:** Version 1 schema validation, pre-restore snapshots, and 10-snapshot retention pruning (**VERIFIED**)
18. **Cloud Sync & Entitlements:** Asynchronous worker dispatch (`cloud.pull`, `cloud.push`), PostgreSQL synchronization, and plan allowance (**VERIFIED**)
19. **Appearance & Custom Themes:** Real-time CSS theme variable injection, custom hex pickers, opacity slider (**VERIFIED**)
20. **Permanent Data Wipe:** Single-action `%LOCALAPPDATA%\LensDesk` purge and credentials wipe (**VERIFIED**)
21. **Background Auto-Updater:** HTTPS semver checking, redirect rejection, SHA-256 verification, and rollback protection (**VERIFIED**)
22. **Standalone Portable ZIP:** Monolithic x64 native directory distribution with zero Electron dependencies (**VERIFIED**)
23. **NSIS Windows Installer:** Clean installer/uninstaller with 32/64-bit registry detection and WebView2 bootstrapper detection (**VERIFIED**)
