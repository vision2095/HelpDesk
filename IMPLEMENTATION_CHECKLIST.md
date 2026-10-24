# Completion checklist

The gap review is the scope ledger. No item is considered complete because a mock passes or a configuration file exists. Statuses: planned, implemented, verified locally, needs external validation, blocked by required configuration, or outside software scope. Test evidence is recorded alongside each completed item.

## Reliability and production foundations

- R01 Durable transactional workspace writes; rollback after storage failure.
- R02 Optimistic revisions and conflict handling across tabs/devices/processes.
- R03 Entity storage, attachment storage, pagination, search, and storage quotas.
- R04 Versioned schema migration and recovery UI.
- R05 Encryption for workspace contents/backups; key rotation and recovery tooling.
- R06 Background workers and bounded resource/concurrency limits.
- R07 Multi-instance backend storage and deployment validation.

## Billing and accounts

- B01 Idempotent checkout and prevention of duplicate subscriptions.
- B02 Subscription identity/event-order protection and reconciliation.
- B03 Safe account-deletion ordering and retry behavior.
- B04 Actual audio duration metering; exact usage accounting.
- B05 Token/cost budgets and operator usage controls.
- B06 MFA, device/session management, rotation, logout everywhere.
- B07 Browser-cookie/desktop-token separation.
- B08 Account administration, audit events, abuse controls, account changes.
- B09 Real Stripe Checkout/portal/webhook acceptance — requires Stripe configuration.
- B10 Real verification/reset email delivery — requires SMTP configuration.

## AI and live audio

- A01 Stream answers; cancel generation; retries and provider failover.
- A02 Model discovery, capability validation, connection testing.
- A03 Token/context budgeting and long-session summarization.
- A04 Multi-model comparison, model provenance, edits/regeneration/branching/ratings.
- A05 Low-latency audio, bounded durable queues, retry/recovery, simultaneous chat.
- A06 Device selector, input meter, silence/quality checks, timestamps/speaker labels.
- A07 Question detection and opt-in automatic suggestions.
- A08 Search/citations, searchable document retrieval, OCR.
- A09 Dedicated practice workflows, structured feedback, diagrams, code exercises.
- A10 Live provider and native audio verification — requires provider credentials/OS permissions.

## Sync and desktop

- D01 Automatic bidirectional incremental sync with conflicts, revisions, tombstones.
- D02 Offline queue, pending/error indicators, reconnect reconciliation.
- D03 Explicit consent-based screen sharing and remote assistance.
- D04 User-controlled typing into another app, with stop control and OS permission handling.
- D05 Configurable global shortcuts and registration-failure UI.
- D06 Tray/menu bar, launch at login, restored window placement and multi-monitor bounds.
- D07 Region capture, annotation, image-aware exports and readable PDF rendering.
- D08 Automatic updates, signatures, rollback/recovery design.
- D09 Signed Windows/macOS releases and notarization — requires publisher credentials.
- D10 Windows/Intel native acceptance — requires corresponding hardware/VM.
- D11 Capture protection cannot guarantee invisibility to every OS capture implementation.

## Experience and operations

- E01 Accurate autosave/sync states, session duration, recovery paths.
- E02 Accessibility/keyboard/mobile audit and localized UI.
- E03 In-app help, support, invoice/usage views, transparent privacy/retention controls.
- O01 Monitoring, structured logs, health/readiness, operational alerts.
- O02 Off-site backup/restore drill and retention controls.
- O03 Signed release publishing and cross-platform CI runtime tests.
- O04 Load/soak/offline/disk-full/concurrency/update tests.
- O05 Production deployment/HTTPS — requires hosting/domain access.
- O06 Resolve development advisories without unsafe dependency changes.
- O07 Business-specific privacy/terms/support configuration — requires business details.
- X01 Physical Evadus hardware is outside a desktop/web software deliverable.

## Version 1.2.2 evidence and remaining work

The following statuses supersede the initial planned list above. “Verified locally” includes controlled provider/payment responses, not live service acceptance.

| IDs      | Status                                | Evidence or remaining work                                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01      | Verified locally                      | SQLite WAL/FULL transactions; injected disk-full failures roll back records, assets and revisions.                                                                                                                                                                                                                     |
| R02      | Partial, tested                       | CAS prevents cross-process overwrites; autosave preserves conflicting text in the editor. Rich conflict comparison/resolution remains.                                                                                                                                                                                 |
| R03      | Partial, tested                       | Entities, deduplicated assets, search, summary pagination and quotas include history/snapshots. Frontend still loads full state; orphan-asset reclamation remains.                                                                                                                                                     |
| R04      | Verified locally                      | Legacy JSON migration, visible corruption errors, 30 revisions/item, 10 workspace recovery snapshots and restore UI.                                                                                                                                                                                                   |
| R05      | Partial, tested                       | Hosted and native records/internal snapshots encrypted; credentials excluded from history. Portable JSON downloads are plaintext. Master-key rotation/recovery tooling remains.                                                                                                                                        |
| R06      | Partial, tested                       | Isolated PDF worker, time/memory limits, bounded media-process pool. Durable audio jobs and broader resource limits remain.                                                                                                                                                                                            |
| R07      | Planned                               | Single-host SQLite; no multi-host database adapter.                                                                                                                                                                                                                                                                    |
| B01      | Partial, tested                       | Stable persisted checkout idempotency key, cached URL, concurrency lease, retry-safe parameters. Live/missed-checkout reconciliation still needs acceptance.                                                                                                                                                           |
| B02      | Partial, tested                       | Subscription identity and stale-event protection; manual reconciliation rejects races with newer webhooks. Scheduled reconciliation remains.                                                                                                                                                                           |
| B03      | Verified locally                      | In-flight deletion guard before cancellation; retriable deleting state blocks new work. Actual Stripe deletion acceptance remains external.                                                                                                                                                                            |
| B04      | Partial, tested                       | Real ffprobe duration for PCM and browser WebM. Exactly-once accounting across interrupted/retried audio uploads remains.                                                                                                                                                                                              |
| B05      | Partial, tested                       | Daily token reservations/settlement, funded-model allowlist, usage UI. Dollar-cost budgets and operator controls remain.                                                                                                                                                                                               |
| B06      | Verified locally                      | OTPAuth MFA, encrypted secrets, replay rejection, ten one-use recovery codes, device list/revocation, password rotation and revoke-others. Chrome MFA enrollment/sign-in E2E passed.                                                                                                                                   |
| B07      | Verified locally                      | Browser receives HTTP-only cookie only; native explicitly requests encrypted persisted bearer token.                                                                                                                                                                                                                   |
| B08      | Partial, tested                       | Security/billing audit events, rate limits and password changes. Admin console and account email/name changes remain.                                                                                                                                                                                                  |
| B09, B10 | Needs external configuration          | Real Stripe and SMTP credentials/delivery acceptance.                                                                                                                                                                                                                                                                  |
| A01      | Partial, tested                       | Incremental compatible/Anthropic streams, Stop across browser/desktop, transient retry before output, truncated-stream rejection. Provider failover remains.                                                                                                                                                           |
| A02      | Partial, tested                       | Model discovery and small connection test, explicit inferred capabilities. Actual provider/vision capability validation remains.                                                                                                                                                                                       |
| A03      | Partial, tested                       | Conservative context budget and omitted-history notice; automatic long-session summaries remain.                                                                                                                                                                                                                       |
| A04      | Partial                               | Provider/model/token provenance saved. Comparison, edit/regenerate, branches and rating UI remain.                                                                                                                                                                                                                     |
| A05      | Partial, tested                       | Encrypted IndexedDB audio recovery, account isolation, bounded backpressure, cached transcription and stable append IDs. Real Chrome E2E covers upload/append failure, reload, account switching, download/discard and simultaneous chat. Cross-tab leasing and exactly-once provider charging remain.                 |
| A06      | Partial, tested                       | Device selector, level meter, capture timestamps and measured clip durations. Speaker diarization and detailed silence/quality handling remain.                                                                                                                                                                        |
| A07      | Planned                               | Opt-in detection and automatic suggestions.                                                                                                                                                                                                                                                                            |
| A08      | Partial                               | Backend session search and OCR/scanned PDF fallback. Retrieval/citations and full OCR acceptance remain.                                                                                                                                                                                                               |
| A09      | Partial                               | Dedicated mode instructions added. Structured practice feedback/scoring, interactive diagrams and exercises remain.                                                                                                                                                                                                    |
| A10      | Needs external validation             | Live AI keys and real OS microphone/system audio permissions. Synthetic audio is not physical-hardware acceptance.                                                                                                                                                                                                     |
| D01      | Planned beyond foundation             | Incremental change feed and tombstones exist; automatic bidirectional sync engine/conflict UI do not.                                                                                                                                                                                                                  |
| D02      | Planned beyond foundation             | Saving/pending/error states exist; durable offline queue/reconnect reconciliation do not.                                                                                                                                                                                                                              |
| D03      | Planned                               | Remote assistance and consent workflow are not implemented.                                                                                                                                                                                                                                                            |
| D04      | Partial, tested                       | User-controlled external typing, native confirmation, focus checks, Accessibility permission, immediate stop, cancel-safe delays, clipboard preservation. Browser-to-desktop E2E verifies same-shortcut start/stop and cancellation; physical editors and Windows runtime need acceptance.                             |
| D05      | Verified locally                      | Configurable global shortcuts; registration failures restore prior bindings. Native E2E covers duplicate rejection, same-key hide/restore, and same-key auto-typing stop. Physical acceptance across other applications and Windows remains.                                                                           |
| D06      | Partial, tested                       | Tray/menu, close-to-tray preference, login configuration and clamped restored bounds. Native tray-close test passed; installed login and multi-monitor acceptance remain.                                                                                                                                              |
| D07, D08 | Planned beyond baseline               | Region annotation, rich/image-aware exports, automatic updates/signature verification and rollback remain.                                                                                                                                                                                                             |
| D09, D10 | Needs external configuration/hardware | Public publisher signing/notarization and Windows/Intel native acceptance.                                                                                                                                                                                                                                             |
| D11      | Partial, tested; platform constraint  | Window starts hidden; capture request applied before showing. Native E2E covers startup, toggle, floating and reload. On this macOS host the API reports true even after false; the app-bound CUA screenshot was blank while protection was enabled, but ScreenCaptureKit and third-party exclusion remain unverified. |
| E01      | Partial, tested                       | Debounced autosave status, conflicts, correct end/resume timer, version recovery. Automatic sync status depends on unfinished sync engine.                                                                                                                                                                             |
| E02      | Partial, tested                       | Light/dark/system themes persist and respect system preference; responsive layouts and native browser keyboard flows pass E2E. Full accessibility audit and UI localization remain.                                                                                                                                    |
| E03      | Partial                               | Help, usage, billing portal and revision-retention disclosure exist. Dedicated support, invoices and configurable retention remain.                                                                                                                                                                                    |
| O01      | Partial, tested                       | Correlated structured request logs, liveness/readiness, protected metrics. Operational alert delivery remains.                                                                                                                                                                                                         |
| O02      | Planned                               | Off-site consistent backup automation, retention controls, rotation and restore drill remain.                                                                                                                                                                                                                          |
| O03      | Partial                               | CI workflows include media prerequisites, tests and real-browser/native checks. Remote CI execution and signed publishing are not verified.                                                                                                                                                                            |
| O04      | Partial, tested                       | Storage failure rollback, concurrency, provider truncation/cancel/retry. Load/soak, durable offline recovery and update-failure tests remain.                                                                                                                                                                          |
| O05      | Needs external configuration          | Domain/hosting/TLS deployment acceptance.                                                                                                                                                                                                                                                                              |
| O06      | Verified locally                      | npm audit reports zero vulnerabilities after compatible global-agent override; packaging is checked separately.                                                                                                                                                                                                        |
| O07      | Needs business input                  | Privacy/terms/contact/support details.                                                                                                                                                                                                                                                                                 |
| X01      | Outside software scope                | Physical reference hardware is not reproduced by this application.                                                                                                                                                                                                                                                     |

See VALIDATION.md for executed checks. Unfinished rows are not represented as complete or hidden behind a production-ready claim.

### Version 1.2.1 update (historical)

- Added DeepSeek as an OpenAI-compatible provider and a desktop-only OpenAI-compatible local endpoint. Unit tests verify model discovery and generation against a fixture without API-key authorization; cloud routes reject local-provider requests to prevent server-side access to user network endpoints.
- Added browser home URL, search-engine, and default-zoom preferences, a home action, and a confirmed clear-data action scoped to the embedded browser session. Native Electron E2E covers the preferences, navigation, and site-data clearing.
- Rebuilt arm64/Intel macOS and Windows x64 artifacts at 1.2.1. The packaged macOS app passes launch and sandbox checks; Windows was cross-built and archive-inspected but was not launched on Windows.
- Screenshot parity gaps remain as listed in REFERENCE_PARITY.md: local server auto-detection/OCR fallback, configurable mouse action wheel, complete reference shortcut catalog, screenshot-to-disk archive and account answer-history toggle, fine-grained typing simulation, appearance color/layout controls, real Windows/macOS hardware acceptance, signed/notarized releases, and live external service acceptance.

### Version 1.2.2 update

- A02: Desktop detection checks only the four documented loopback model-list endpoints, with two-second timeouts, no credentials, redirect rejection and bounded responses. Results never change the saved endpoint automatically. E2E covers detection against a loopback fixture and ignores late replies after the model endpoint changes. No installed Ollama/LM Studio or Windows OCR acceptance is claimed.
- D05: Added 14 optional actions for browser/theme, opacity, pending attachments, cancel answer, shortcut settings, scrolling, and four-direction window movement. Unit tests cover monitor clamping; Electron E2E covers enabled bindings, same-key toggles, attachment removal, arrow-key recording, actual saved shortcut hints, and retirement of replaced default renderer bindings. New actions are unassigned until chosen. Provider/model cycling, region actions and application restart/quit bindings remain.
- D07: Added a screenshot disk archive with explicit folder selection, disabled-by-default saving, private PNG writes, per-image/total quotas, usage and open-folder controls. Saving off retains files. Synthetic Electron E2E verifies PNG output and a write failure that preserves the captured image and returns a warning. Region capture/annotation and monitor combination remain.
- E02: Per-theme text colors and full/compact session layout persist. The floating transcript is expandable; native E2E verifies control visibility at 360/480 px. Visual review caught and fixed color-swatch sizing and clipped floating controls.
- O04: The browser workspace E2E now launches isolated Vite/API processes on temporary ports and cleans them up. It no longer depends on a running dev server or deletes named QA records from an existing workspace.
- Still unfinished: mouse gesture wheel, account answer-history toggle, automatic incremental sync/offline queue, Windows OCR, detailed typing controls, local runtime/live-provider/native audio acceptance, signed/notarized updates, and production deployment. The earlier ledger remains applicable unless explicitly updated above.
