> Windows follow-up: see [20 October request-denied repair](WINDOWS_FIX_2026-10-20.md). The Windows ZIP described below was found stale and has been rebuilt; the following table records historical checks.

# Verified Windows/macOS update — 19 October 2026

Release source: /Users/vivek/new repo/lensdesk-reviewed-1.3.6. Version: 1.3.6. Linux is excluded.

| Check | Result and practical scope |
|---|---|
| Production frontend build | TypeScript/Vite passed. Approximately 644 KB minified; Vite bundle-size advisory remains. |
| Complete Node regression suite | 140 passed, zero failures, zero skips. Native calls and external providers use controlled dependencies where stated by the tests. |
| Reference Electron workflow | Passed all nine settings sections; screenshot Capture without AI; real 200×100 crop from 400×200 synthetic image; cancellation; display routing and unavailable-display errors; disabled/enabled mouse gesture handling; persistence. Includes regression for unassigned shortcut hints. |
| Settings/auth UI integration | Passed validation, resets, persistence, save errors, model selection and login/MFA success/failure paths with isolated IPC/cloud doubles. |
| Hosted account browser E2E | Passed local homepage, signup, verification outbox, login/logout, authentication persistence and responsive layout. No real SMTP delivery. |
| Streaming/audio/MFA browser E2E | Passed incremental/cancel/retry, autosave, usage, MFA, controlled WebM metering and encrypted audio recovery. AI responses are fixtures. |
| Windows ZIP | Built single-file portable release ZIP containing exclusively LensDesk.exe (103,519,843 bytes). CRC integrity, PE x64 binary structure, clean metadata (FileDescription=LensDesk, ProductName=LensDesk), embedded runtime (ASAR v1.3.6, ICU, Chromium/Electron licenses) verified with 7za. No loose DLLs, runtime files, or resource folders. |
| Apple Silicon Mac | Built DMG. Packaged app passed production renderer/preload/IPC, account/settings controls, model-detection module and isolated workspace checks on retry. |
| Intel Mac | Built DMG. Exact runtime source matched; packaged app passed the same startup/IPC checks through installed Rosetta on Apple Silicon. This is not Intel hardware acceptance. |
| Mac signature and DMGs | Both app signature structures validated with codesign --verify --deep --strict; both DMGs passed hdiutil checksum verification. Ad-hoc signing is not Apple notarization. |
| Installed Mac update | /Applications/LensDesk.app updated, version 1.3.6, all 31 runtime files match final source. Native UI showed five existing sessions, the settings screen and corrected unassigned shortcut hints. Existing database entity counts were preserved. |
| Cleanup | Superseded /Applications copy removed after acceptance; obsolete Desktop 1.3.5 app moved to Trash through Finder after terminal access was denied. User database and histories retained. Older rollback installers retained where native target acceptance is incomplete. |

## Failed attempts and limits

The first packaged Mac CDP launch attempts timed out and logged a Chromium child-process/network-service failure. Subsequent isolated runs and the installed app launch passed. This intermittent cold-start behavior remains a limitation; a passing retry does not prove first-launch reliability in all environments.

Intel DMG creation first failed because disk space ran out. Specifically identified obsolete generated staging/archive files were removed, then DMG creation and checksum verification passed. The first Intel launch used an insufficient 10-second first-launch wait and failed to expose CDP; the bounded 45-second first-launch check passed via Rosetta.

Initial sandbox loopback denials were rerun through normal approved execution. A prior-turn automatic review usage-limit failure recovered; no review gate was bypassed. The native Windows runtime, physical cross-application keyboard/typing behavior, real system-audio capture, live AI, production payments/email/OAuth and full hosted deployment are not proven by these results.

Evidence logs are in evidence-2026-10-19/. Artifact sizes and SHA-256 values are in release/checksums.json from the project root. See KNOWN_LIMITATIONS.md and feature-ledger.json for incomplete requirements. This update is not a claim of complete HintLens feature parity.
