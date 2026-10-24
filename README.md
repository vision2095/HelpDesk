# LensDesk

A desktop and hosted AI workspace for macOS and Windows, built alongside the requested REA toolkit. The implementation is original; HintLens and Evadus were used as public feature references.

## Run it

Use Node.js 24.15 or later.

```sh
npm ci
node node_modules/electron/install.js
npm run build
npm start
```

For desktop development, use `npm run desktop`. For the browser preview, use `npm run dev` and open `http://127.0.0.1:5173`. Browser-preview API keys live in memory. Desktop keys and cloud sign-in tokens use the operating system's credential encryption.

For the hosted application:

```sh
npm run build
npm run cloud
```

Open `http://127.0.0.1:4319`. Register an account. In development, verification and reset email links are saved as JSON in `.data/cloud/outbox`; open the `url` from the matching file. In production, configure SMTP; registration fails visibly if transactional email is unavailable.

## Version 1.2.2

Adds explicit detection of local model servers, protection against stale model-picker replies, separate light/dark text colors, compact/full session layouts, an expandable floating transcript, opt-in screenshot saving with usage/quota controls, and 14 optional desktop shortcut actions. Shortcut hints now follow saved bindings; replacing a binding disables the old renderer shortcut. Arrow keys and macOS Control/Command are recorded correctly, and floating controls remain visible at 360 px. The app also includes the 1.2.1 browser controls and DeepSeek/local model support, streaming answers, encrypted storage, hosted accounts, MFA, billing controls, and explicit cloud sync.

To detect a local server, choose **Local model** in Settings and select **Detect local servers**. This checks only this computer's standard Ollama, LM Studio, llama.cpp and vLLM ports. Select a result, load/test its models, and save settings. Detection does not send questions or screenshots. To archive screenshots, choose a folder under Desktop settings, enable **Save screenshots to disk**, and save Desktop Settings. PNG files remain readable on disk; the archive stops saving at 200 MB while captures continue to attach with a visible warning.

[IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md) tracks unfinished capabilities explicitly. This release is not a claim of complete reference-product parity.

[REFERENCE_PARITY.md](REFERENCE_PARITY.md) records the latest HintLens/Evadus comparison, artifact identity, capture limitations and remaining reference features.

## What is implemented

- Public homepage, pricing from the configured Stripe Price, sign-up, sign-in, verification, password recovery, and account deletion.
- Separate cloud workspaces per user; sessions, history search, profiles, resume PDF/text import, notes, transcript context, Markdown responses, and image attachments.
- OpenAI, Groq, Gemini's compatible API, and Anthropic adapters. Provider/model IDs are editable. Model access and vision support depend on the provider account.
- DeepSeek's OpenAI-compatible API and a desktop-only OpenAI-compatible local model endpoint (for example, Ollama or LM Studio). Local model URLs are never sent to hosted AI routes.
- A built-in Electron browser with an isolated web-content session, configurable home page/search engine/default zoom, address/search bar, tabs, navigation history, find, downloads, popup handling, per-origin permission prompts, and a confirmed action to clear that browser's cookies/cache/site data. Browser cookies persist between app launches until cleared.
- Microphone, computer audio, and mixed recording in independently decodable 15-second segments; OpenAI/Groq transcription and audio-file import. Requires OS permissions and a provider key or funded hosted access.
- Selected-window/screen screenshots, a floating window shown without stealing focus (panel window hidden from Mission Control on macOS; the Windows application window is excluded from the taskbar and Alt+Tab and starts as a click-through overlay with `Shift+M` to restore interaction), opacity, always-on-top, and OS capture protection. Capture protection is a request to the operating system, not an invisibility guarantee; modern macOS ScreenCaptureKit applications can still capture protected windows.
- Native PDF and Markdown exports, workspace backups, explicit desktop upload/restore sync, and account-funded AI from the desktop when a local provider key is absent.
- Hosted plan allowances, atomic quota reservations, failure refunds, BYOK allowance bypass, Stripe Checkout, customer portal, verified webhooks, replay protection, and subscription expiry checks.
- Prepaid INR desktop plans (Hourly ₹100, Daily ₹200, 10-Day ₹1,000, Monthly ₹1,500) with Razorpay Checkout, server-side signature and webhook verification, automatic access expiry, refund revocation, a website purchase dashboard with live countdown and device revoke, and a token-gated operator console. See [docs/SUBSCRIPTIONS.md](docs/SUBSCRIPTIONS.md).
- Real installer downloads, SHA-256 manifests, and generated macOS/Windows installation scripts served by the hosted backend when the release files are present.
- macOS Apple Silicon and Intel / Windows x64 packaging configuration, plus browser/service and desktop CI workflows.

Free hosted allowances are up to 5 requests, 10 audio minutes, and 100,000 tokens per UTC day. Pro allows up to 500 requests, 120 audio minutes, and 2,000,000 tokens. The request and token limits both apply. Audio is metered from decoded duration with ffprobe. Tokens are conservatively reserved before generation and settled from provider usage when available. Canceled streams that produced output retain their reservation. Hosted models are restricted by the operator allowlist. Own provider keys bypass platform allowances and are billed by the provider.

Desktop sync explicitly replaces the selected destination after confirmation. Account-funded desktop AI also saves that session and its context to the account. Desktop API keys are never uploaded by workspace sync. In the hosted browser application, changes are saved directly to the signed-in user's workspace.

## Production deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) and [.env.example](.env.example). The Docker Compose configuration runs one app instance with a persistent volume and Caddy HTTPS. Do not horizontally replicate this file-backed workspace service without replacing storage/concurrency management.

The hosted service needs your domain, hosting/server access, transactional SMTP, Stripe keys/recurring Price/webhook secret, a durable encryption key, and optional operator-funded AI keys. None of these external accounts were created or funded by this project. Never put their credentials in chat or commit them.

## Build installers

```sh
npm run dist:mac
npm run dist:win:msi
```

The macOS command includes arm64 and x64 targets. On a Mac, run `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac` to produce the same unsigned local builds used here. Windows builds the standard installer `RuntimeHost-<version>-x64.msi` with `npm run dist:win:msi` on Windows (or the Windows CI job); it installs the LensDesk product with a `RuntimeHost.exe` application executable, and the Start-menu shortcut remains LensDesk. The previous portable ZIP (`npm run dist:win`, containing only `LensDesk.exe`) remains available as a fallback, and an optional NSIS installer can be built with `npm run dist:win:installer`. The website and `/downloads/windows` serve the MSI when present and fall back to the ZIP. See [Windows distribution](docs/WINDOWS_DISTRIBUTION.md) for the launch script and verification steps. These local artifacts skip code signing and notarization; configure a Developer ID and Windows publisher certificate before public distribution. The CI workflow builds artifacts but does not publish or charge anyone.

Global shortcuts default to `Shift+H` for hide/restore, `Shift+M` for click-through, `Cmd/Ctrl+Shift+L` for show/hide, `Cmd/Ctrl+Shift+S` for capture, `Cmd/Ctrl+Shift+O` for the floating window, and `Cmd/Ctrl+Shift+T` to start/stop auto-typing. The same configured shortcut hides and restores the window or starts and stops typing. In-app `Cmd/Ctrl+Shift+N` creates a session. Shortcuts can be customized in Desktop & shortcuts; registration can fail if another app owns a key combination. Because `Shift+H` and `Shift+M` are bare Shift combinations, they also fire while typing a capital H or M; rebind them in Desktop settings if that conflicts with your workflow.

Additional actions start unassigned: toggle browser, theme, opacity up/down, remove last/all pending images, stop answer, open/close shortcut settings, scroll answers, and move the window in four directions. Assign the combinations you want in Settings and save Desktop Settings. Window movement stays within the current display. The floating UI and guide show the saved bindings.

## Verification

```sh
npm test
npm run build
npm run test:browser
npm run test:desktop
npm run test:browser-desktop
npm run test:hosted-browser
npm run test:stream-browser
npm run test:packaged
npm run test:bundles
npm run test:windows-archive
npm run test:overlay-windows
npm audit
```

Browser scripts use `CHROME_PATH`, installed Chrome, or Playwright Chromium. Their accounts and desktop profiles are temporary. Backend tests run on the native OS with temporary stores and HTTP servers. AI and Stripe network calls are controlled test doubles; signed Stripe event verification uses the actual SDK. Live AI, live payments, email delivery through a real SMTP account, Windows runtime behavior, and live OS audio capture require their respective credentials/hardware and separate acceptance testing.

`test:browser` starts its own Vite/API processes on temporary ports with an isolated workspace; it does not require a running development server or edit your saved workspace.

## Boundaries

--- BOUND-01 (revised) ---
Scope: LensDesk renders a normal top-level window. It does not hook, patch,
inject into, or replace any other process. Nothing is installed into or removed
from the host OS. Every behaviour below changes only LensDesk's OWN process and
its OWN window, using documented Win32 / Cocoa / Electron APIs.

--- BOUND-02 (revised) ---
In scope and implemented:
  1. Own process identity fields (executable name + PE version resource fields)
  2. Own window extended styles (tool window, no-activate)
  3. Own window display affinity (capture exclusion)
  4. Own window Z-order (topmost)
  5. A system-wide read-only keyboard event listener (does not consume events,
     does not touch other processes)
None of the five modifies a third-party application. Therefore there is nothing
to conflict with.
