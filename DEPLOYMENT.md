# Deploy LensDesk

## Required configuration

1. Point a domain's A/AAAA records at the Docker host and allow incoming ports 80 and 443.
2. Copy `.env.example` to `.env`. Set `DOMAIN`, `PUBLIC_URL`, and a random persistent 32-byte `CLOUD_ENCRYPTION_KEY` encoded as 64 hexadecimal characters. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and save it in a secrets manager.
3. Set transactional email values: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Configure your sending domain with your email provider. Port 465 uses direct TLS; other ports use SMTP STARTTLS negotiation.
4. In Stripe, create a product and recurring Price. Set `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID`. Start with Stripe test mode.
5. Create a Stripe webhook endpoint at `https://YOUR_DOMAIN/api/billing.webhook` and subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. Set the endpoint's `STRIPE_WEBHOOK_SECRET`. Enable the customer portal in Stripe.
6. To fund hosted AI, set at least one operator provider key. Users may instead bring their own keys. Do not expose the server keys to the browser.
7. For prepaid desktop access, set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, and create a Razorpay webhook at `https://YOUR_DOMAIN/api/purchase.webhook` for `payment.captured`, `payment.failed` and `refund.processed`. Set a long random `ADMIN_TOKEN` to enable the operator console at `/?admin` (leave it empty to disable admin endpoints). The default catalog is Hourly ₹100 / Daily ₹200 / 10-Day ₹1,000 / Monthly ₹1,500, tax-inclusive, and can be overridden with `PLANS_JSON`. Full setup, rules and load-test numbers: [docs/SUBSCRIPTIONS.md](docs/SUBSCRIPTIONS.md).

## Start

```sh
docker compose up --build -d
docker compose logs --tail=100 app proxy
```

Caddy requests and renews TLS certificates. The app listens only inside the Compose network. `TRUST_PROXY=1` is set for this private Caddy-to-app connection; do not enable it for an app port directly exposed to the internet. Rate limits then use Caddy's forwarded client address.

The Compose named volume `workspace` contains account SQLite files, cloud workspaces, encrypted user keys, and backup files. Back up this whole volume consistently along with the encryption key. Without that key, saved API keys cannot be decrypted. Keep one app process/replica; SQLite storage requires a single host; multi-host replication is not implemented.

## Publish desktop installers

Build the macOS and Windows installers with the same app version. For version 1.2.0, the current release service expects:

- `release/LensDesk-1.2.0-arm64.dmg` (Apple Silicon)
- `release/LensDesk-1.2.0.dmg` (Intel)
- `release/RuntimeHost-1.2.0-x64.msi` (legacy `LensDesk-1.2.0-Windows-x64.zip` remains a fallback)

The matching ZIP archives are also built for both Mac architectures. Put the DMGs and Windows installer directly in the `release/` root; the Compose configuration mounts that directory read-only at `/releases`. The service reads the version from `package.json`; filenames must match that version. The public homepage lists only files that exist. Downloads are served at `/downloads/mac-arm64`, `/downloads/mac-x64`, and `/downloads/windows`. `cloud.public` returns the corresponding sizes and SHA-256 checksums.

The service also generates `/install.ps1` and `/install.sh` from actual files and checksums. These install **your LensDesk release**, not HintLens. They do not request administrator/root privileges. The Windows script runs the MSI installer silently and then opens LensDesk; the macOS script copies the app into the user's Applications directory. Signing/notarization remains necessary for a normal public installation experience.

Connect the desktop app under **Account & cloud**, using `https://YOUR_DOMAIN`, then sign in. Choose Upload this device or Restore from cloud deliberately: these replace the destination workspace and preserve an encrypted pre-restore recovery snapshot. When the desktop lacks a local provider key, it can use signed-in hosted access and save the relevant session to the account.

## Acceptance checks before taking payments

- Verify registration, actual email delivery, verification, password reset, and sign-out on the deployed HTTPS origin.
- Check a free account's AI request and transcription with the actual configured provider and model.
- Use a Stripe test card to complete Checkout, observe the signed webhook, and verify Pro status. Check cancellation and payment-failure behavior through the portal.
- Use Razorpay test mode to buy every prepaid plan on the deployed HTTPS origin; confirm the entitlement and live countdown, desktop sign-in, second-device takeover prompt, refund-driven lock on the next heartbeat, and that a replayed webhook is ignored. Confirm the admin console unlocks with `ADMIN_TOKEN` and records its audit actions.
- Confirm one user's sessions and keys cannot be accessed using another account.
- Test screenshots, microphone/system audio permissions, exports, and shortcuts on both macOS and Windows. Test Intel hardware if distributing an Intel build.
- Sign and notarize releases, then test the installers from a clean user account.
- Restore a backup onto an isolated host, using the saved encryption key.

The local integration tests cover the application boundaries and signed-webhook mechanics with controlled provider/Stripe responses. They do not establish that your production credentials, DNS, email domain, payment setup, or OS permissions are working.

## Operations

`GET /health` returns a small readiness response. The server applies HTTP-only, SameSite session cookies, Secure cookies and HSTS in production, origin checks on JSON mutations, hashed auth tokens, scrypt passwords, login throttling, verified-email gates for AI, and tenant-scoped workspace paths. Use a reverse-proxy request-size/rate policy appropriate to your traffic. The application caps JSON request bodies at 42 MB. The Razorpay webhook at `/api/purchase.webhook` verifies an HMAC over the exact raw body, so the proxy must forward that route without re-serializing JSON.

Account deletion removes cloud workspace files and auth records and cancels an active Stripe subscription. Stripe and AI providers maintain their own records according to their policies. Configure production logging, monitoring, backup retention, and your business's privacy/terms before launching publicly.
