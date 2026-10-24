# Known limitations — 19 October 2026

- Only Windows and macOS are in scope. Linux packaging, release routes, download UI and workflow were removed.
- Windows ZIP archive, resources, x64 executable structure and source freshness are checked on macOS. Native Windows execution, physical shortcuts, capture, audio and typing acceptance require a Windows environment.
- Intel Mac startup passed through installed Rosetta on Apple Silicon; it is not Intel hardware acceptance.
- Packaged Mac cold-start automation was intermittent: initial CDP/Chromium child-process failures were followed by passing retries and a successful installed app launch. First-launch reliability needs further investigation.
- Mac packages are ad-hoc signed and not notarized. Windows publisher signing is not configured. Public signing requires the publisher's credentials.
- No authorized live AI keys/local inference runtime, real SMTP delivery, Google OAuth deployment, real Stripe settlement or production host/domain was established. Fixture results do not close those acceptance requirements.
- Account answer-history opt-in/archive, Windows OCR fallback, complete offline/incremental sync, global cross-app mouse gestures and exact reference visual/live-preview parity remain incomplete.
- OS content protection cannot guarantee exclusion from screenshots/recordings. The distribution uses LensDesk branding; no Microsoft identity spoofing is configured.
- All nine settings tabs and captured-image workflows have controlled integration checks. Real OS capture, physical typing across external applications and native system audio are not fully accepted by those tests.
- Existing saved model IDs are preserved. A provider must list/accept that ID with an authorized account before live AI success can be claimed.
- Another writer changed the original LensDesk tree. This release is isolated in lensdesk-reviewed-1.3.6; original-tree artifacts do not certify this copy.
- Disk space is low. Only explicitly identified obsolete applications and generated packaging staging were cleaned. User databases, credentials and histories were preserved.

Earlier automatic approval review failed because of an account usage limit. Normal approval review now succeeds, and the affected local build/launch operations were rerun through the normal path.
