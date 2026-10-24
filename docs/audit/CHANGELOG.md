# Current Windows/Mac update

- Removed Linux release targets, download UI/routes and workflow at the user's request.
- Fixed overlay hints that advertised fallback keys for unassigned shortcuts; added a native renderer regression assertion.
- Corrected homepage claims about guaranteed invisibility, simulated typing mistakes and zero-prompt macOS security bypass.
- Built portable Windows ZIP and separate Mac architectures from isolated reviewed source.
- Updated local /Applications/LensDesk.app and checked continuity of five sessions and settings.

## Earlier work (historical)

> Current scope (19 October 2026): Windows and macOS only. Linux build configuration, download UI and workflow have been removed at the user’s request. Linux evidence below is historical.

# Change record — reconstruction pass

## Functional repairs in the tested snapshot

- Separated Capture from Get Answer and replaced full-screen Snip alias with a real crop-selection workflow.
- Added active/all/specific display selection and explicit missing-display failure; preserved images/drafts on AI and archive errors.
- Removed duplicate renderer/native shortcut toggles and hardcoded key hints; preserved modifier identity and canonical saved mouse action identifiers.
- Made gesture handling opt-in, scoped to LensDesk's own window, with configured styles/slots/hold, release selection and cancellation.
- Replaced fabricated account/plan/version/auth behavior with actual cloud/native contracts and visible unavailable integrations.
- Wired saved WPM/variation/pauses to actual typing engines, retained native confirmation and focus/cancellation checks, and removed full-answer fallback after possible partial output.
- Changed primary Windows downloads to a branded full-runtime ZIP with verified extraction and launch.
- Removed unsupported invisibility, fake signing and zero-security-prompt marketing claims from the reviewed frontend.
- Replaced unsupported all-verified audit labels with a finite evidence ledger and individually mapped all 22 supplied reference photos.

## Separate reviewed copy

- Preserves the original working tree after concurrent metadata/source/test-command changes were detected.
- Restores LensDesk branding, the complete root regression command, and a Windows launcher requiring `LensDesk.exe` plus `resources/app.asar`.
- Excludes process impersonation, hidden input-hook code and the proposed monitoring bypasses.
- Adds Linux x64/arm64 packaging configuration, real-manifest download handling, route tests and a manual Linux CI definition.
- Does not claim fresh builds, deployment, public signing/notarization or complete E2E for this copy. See TEST_REPORT.md and KNOWN_LIMITATIONS.md.
