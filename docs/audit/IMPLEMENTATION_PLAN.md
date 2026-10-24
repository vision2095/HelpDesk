# Remaining acceptance work

Windows and macOS only; Linux was explicitly withdrawn on 19 October 2026.

1. Execute the Windows ZIP on Windows and validate startup, permissions, physical shortcut conflicts, capture, browser, audio and deliberate typing in supported applications.
2. Validate the Intel Mac package on Intel hardware; Rosetta checks on Apple Silicon have narrower scope.
3. Supply authorized provider configuration for live AI and a real local model runtime for local inference acceptance. Never use leaked public keys.
4. Configure production hosting, SMTP, OAuth, Stripe and cloud storage, then exercise actual deployed account/subscription/sync flows.
5. Complete the missing features recorded in feature-ledger.json. Existing automated checks do not imply complete HintLens parity.
6. Configure publisher certificates and macOS notarization before public distribution.
