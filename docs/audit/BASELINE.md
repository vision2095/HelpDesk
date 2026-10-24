> Current scope (19 October 2026): Windows and macOS only. Linux build configuration, download UI and workflow have been removed at the user’s request. Linux evidence below is historical.

# Current-copy notice

This document was inherited from the initial audit. The maintained implementation is now isolated at `/Users/vivek/new repo/lensdesk-reviewed-1.3.6`. Linux packaging is prepared; current execution evidence and source-drift limits are in TEST_REPORT.md. Historical counts and paths below are not a completion certificate.

# LensDesk source and verification baseline

Inspection date: 18 October 2026. Workspace: `/Users/vivek/new repo/lensdesk`.

This source baseline supersedes the earlier document's old framework versions, invented reference states and universal completion claim. Source presence is **IMPLEMENTED_UNVERIFIED** until an applicable executed result is recorded in the feature matrix/test report. Concurrent changes may update this snapshot.

## Identity and working state

The inspected application package version is `1.3.5`. This does not prove that an existing installed application or previous download contains this source. Git lists the application files as untracked; existing work is preserved. No clean committed release, push or production deployment is inferred.

The host is macOS. A cross-built Windows artifact does not establish Windows execution. The reference executable has not been runtime-tested on Windows in this audit. Photographs show reference UI states, not successful integrations or hidden implementation details.

Exact versions in the inspected lockfile are Electron `44.9.0`, React/React DOM `19.3.1`, TypeScript `5.9.3`, Vite `6.4.4`, and electron-builder `26.15.3`. `package.json` requires Node.js `>=24.15.0`; its desktop entry is `desktop/main.cjs`. Recheck versions when producing release evidence.

## Actual owning boundaries

| Area                      | Source owner                                                                                                                                              | Boundary and persistence                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace/session UI      | `src/main.tsx`, `Home.tsx`, `types.ts`                                                                                                                    | Sessions, chat, transcript, capture attachments, settings/account/security/recovery navigation.                                                                                  |
| Floating UI               | `src/OverlayView.tsx`                                                                                                                                     | Receives overlay state/action callbacks; a visible button alone does not prove its native action.                                                                                |
| Reference-style settings  | `src/HintLensSettingsModal.tsx`                                                                                                                           | Nine visible categories; delegates workspace and desktop persistence. Trace each control independently.                                                                          |
| Other settings/account UI | `src/DesktopSettings.tsx`, `AppearanceSettings.tsx`, `ProviderModels.tsx`, `CaptureArchiveSettings.tsx`, `Account.tsx`, `Security.tsx`, `MfaSettings.tsx` | Existing independent consumers; check shared state and different save boundaries.                                                                                                |
| API selection             | `src/api.ts`, `src/cloud.ts`                                                                                                                              | Desktop IPC or HTTP; hosted account calls are distinct from local workspace calls.                                                                                               |
| Native trust boundary     | `desktop/preload.cjs`, `desktop/main.cjs`                                                                                                                 | Isolated preload action allowlist, named event listeners and main-process dispatch. An action must exist at every boundary.                                                      |
| Desktop persistence       | `desktop/preferences.cjs`                                                                                                                                 | Validated preferences/window bounds in `desktop-preferences.json`; serialized temporary-file/rename writes.                                                                      |
| Global shortcuts          | `desktop/shortcut-actions.cjs`, main and renderer handlers                                                                                                | Native registration/callbacks differ from renderer keyboard events. Saved mappings, stale defaults, restoration and OS conflicts need separate checks.                           |
| Capture/archive           | `desktop/capture.cjs`, `capture-archive.cjs`, `src/screen-capture.ts`                                                                                     | OS/source capture and optional local PNG archive; permission, selected source, failure restoration and archive failure are independent.                                          |
| Browser                   | `desktop/browser.cjs`, `src/Browser.tsx`                                                                                                                  | Electron browser views, partition, state events, navigation/search/zoom, downloads/data clearing. Website compatibility needs actual runtime evidence.                           |
| Auto-type                 | `desktop/autotype.cjs`                                                                                                                                    | Native typing subprocess and cancellation; OS permission and target-app behavior are external dependencies. Settings must reach this owner.                                      |
| Radial menu               | `src/RadialActionWheel.tsx`, renderer handlers                                                                                                            | A renderer menu does not establish a global mouse hook. Trigger, hold, style, cancellation and slots need their own paths/tests.                                                 |
| Service/contracts         | `server/core.mjs`, `contracts.mjs`                                                                                                                        | Validated dispatch: settings, sessions/profiles, models, streamed chat/cancel, transcription/OCR, documents, backups/history/recovery.                                           |
| Workspace persistence     | `server/workspace-store.mjs`                                                                                                                              | SQLite WAL, synchronous FULL, revisions/conflicts, entities/assets/history; runtime supplies encryption/decryption. An unencrypted fixture does not prove native secure storage. |
| Settings concurrency      | `src/settings-writer.ts`                                                                                                                                  | Serialized updates, current revision reads, overlapping remote-field conflict rejection.                                                                                         |
| Models                    | `server/ai.mjs`, `local-models.mjs`, `src/ProviderModels.tsx`                                                                                             | Adapters, discovery, listing, model testing and inference are distinct. HTTP fixtures do not prove real provider/local-model operation.                                          |
| Local/hosted bridge       | `server/desktop-bridge.mjs`                                                                                                                               | Local credentials or hosted funding where available; local provider routes stay local.                                                                                           |
| Hosted service            | `server/cloud/{app,auth,billing,mfa,releases}.mjs`, `desktop/cloud.cjs`                                                                                   | Accounts/email/MFA, billing and release endpoints. Local fixtures do not prove SMTP delivery, payment settlement, production OAuth or deployment.                                |

Typical desktop request path: **control → React handler → api → preload allowlist → main dispatch → native owner or service → result/event → rendered state and persisted revision**. Record broken/missing steps in the feature matrix.

## Reference boundary

All 22 image views were individually reviewed. The supplied temporary PNG paths no longer resolve during the current check; all 22 matching JPEG photos in `/Users/vivek/Downloads/interior` were individually opened and mapped to attachment order in [REFERENCE_INVENTORY.md](REFERENCE_INVENTORY.md). The main-window photos show empty chat/bundle states, not successful chat responses or screenshot thumbnails.

The Windows ZIP's previous static inspection establishes artifact identity. Static resources/strings cannot prove authentication, AI, capture exclusion, proxy behavior, mouse interception or shortcut execution. [ENVIRONMENT_REPORT.md](ENVIRONMENT_REPORT.md) distinguishes REA developer analysis from LensDesk runtime dependencies.

## Verification entry points and limits

The package defines unit/service, build, browser, desktop/browser, hosted-browser, streamed-browser, packaged and bundle checks. Their existence is not a pass result. Record the command actually run, source/build identity, result and coverage limits. Historical counts such as 105 or 111 are not the current audit result.

Beyond compilation or mocks, verification is needed for every control/reset and saved state after restart; physical global keys in other permitted apps; real native capture/audio/typing with OS permissions; authorized live inference/email/OAuth/payments/deployed sync; Windows launch; signing/notarization where claimed. Recorder/API differences prevent a universal screenshot/recording invisibility claim.

This baseline does not certify parity or end-to-end completion. The finite feature matrix, executed test report and known limitations are the decision record.
