# Prepaid desktop subscriptions

LensDesk sells prepaid access time to the desktop application. Access is
enforced by the hosted service, not by the client: the desktop app only
renders what the server authorizes, and every protected operation is
re-checked against the server clock.

Website registration and payment are required. The desktop application has
**no registration form** — it only signs in to an existing, verified website
account that holds an active entitlement.

## Plans

| Plan    | Price (INR) | Access time       | Seconds   |
| ------- | ----------- | ----------------- | --------- |
| Hourly  | ₹100        | 1 hour            | 3,600     |
| Daily   | ₹200        | 24 hours          | 86,400    |
| 10-Day  | ₹1,000      | 10 days           | 864,000   |
| Monthly | ₹1,500      | 30 days / 1 month | 2,592,000 |

- Prices are tax-inclusive and charged in INR through Razorpay.
- There is no auto-renewal, no recurring mandate and no stored card.
- The 10-Day plan is highlighted by default.
- The catalog is configuration, not code. Override it with `PLANS_JSON`
  (see [Configuration](#configuration)); the server validates every entry
  and always charges the amount from the server-side catalog.

## Entitlement rules

An entitlement grants the half-open interval
`[activationTimestamp, expirationTimestamp)` in milliseconds. The server
clock is authoritative.

- **Purchase while active** extends from the current live expiration, so
  buying early never loses paid time.
- **Purchase after expiry** starts at the payment capture time returned by
  the gateway/verification, not at browser checkout open time.
- **Refund** of the full captured amount revokes the entitlement
  immediately. Partial refunds are audited but do not revoke access.
- **At or after expiration** authorization fails even if a background
  status sweep has not run yet. The sweep only updates cosmetic status
  labels; it never extends access.
- **Suspension, account deletion and password reset** revoke desktop
  sessions immediately.
- Money is only credited after server-side verification. A browser callback
  alone can never create access.

## One active desktop session

Each account may have exactly one active desktop session. This is enforced
by a partial unique database index (`desktop_sessions(user_id) WHERE
status='active'`) inside serialized `BEGIN IMMEDIATE` transactions, so two
racing logins cannot both win.

- Signing in on a second device returns HTTP 409 `TAKEOVER_REQUIRED` with
  the existing device's label, OS, app version and last-seen time.
- The user must explicitly confirm takeover; the previous session is
  revoked server-side and its tokens stop working.
- Access tokens are short-lived (15 minutes) and refresh tokens rotate on
  every use. Presenting an already-consumed refresh token is treated as
  theft: the whole desktop session is revoked and audited.
- The website account dashboard lists signed-in devices and can revoke
  them. Revocation takes effect on the next heartbeat.
- The desktop heartbeats every 60 seconds by default
  (`LENSDESK_HEARTBEAT_SECONDS`). A last authoritative server snapshot is
  honored for at most the offline grace period (`LENSDESK_OFFLINE_GRACE_SECONDS`,
  default 120 seconds); after that the workspace locks.
- Gate phases are `signed_out`, `active`, `offline`, `takeover` and
  `subscription_required` (reason `expired`, `revoked`, `suspended`,
  `offline` or `network`).
- When a heartbeat returns no entitlement, the desktop shows the lock
  overlay with the remaining-time/purchase message and keeps polling, so
  access unlocks as soon as a purchase is verified on the website.
- The lock overlay covers every desktop page except Account, Downloads,
  Settings and the operator console.

## Razorpay setup

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
`RAZORPAY_WEBHOOK_SECRET` in `.env`. All three are required for purchases;
without keys the website shows a clear "payments are not configured" error
and no order is created.

### Checkout

1. The signed-in website calls `purchase.checkout` with a `planId`.
2. The server creates a Razorpay order for the **server-side** amount and
   currency, with `notes: { userId, planId }`, and reuses one pending order
   per account and plan (the database has a partial unique index for this).
3. The browser opens Razorpay Checkout.js with that order.
4. On the checkout callback the browser sends `orderId`, `paymentId` and
   `signature` to `purchase.confirm`.
5. The server verifies the official HMAC-SHA256 checkout signature with the
   key secret, fetches the payment from the Razorpay API, and independently
   checks `status === "captured"`, amount, currency, account and plan notes.
   Only then is the entitlement activated — exactly once.
6. If the browser callback is lost, the website's "Restore purchases"
   action calls `purchase.reconcile`, which pulls authoritative gateway
   state for pending/failed orders and repairs local rows.

### Webhook

Point the Razorpay webhook at:

```
https://<your-domain>/api/purchase.webhook
```

The signature is verified over the **exact raw request body** with
HMAC-SHA256 using `RAZORPAY_WEBHOOK_SECRET` (`X-Razorpay-Signature`
header). Run the app behind a reverse proxy that forwards the body
unmodified; do not let middleware re-serialize JSON for this route.

Enable these events:

| Event              | Effect                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `payment.captured` | Activates the matching pending order (amount/currency/order checks).                                      |
| `payment.failed`   | Marks a still-pending order failed; the user can retry.                                                   |
| `refund.processed` | Full refund marks the payment refunded and revokes the entitlement now. Partial refunds are audited only. |

Other `refund.*` deliveries carrying a full-amount refund follow the same
path; enable `refund.processed` as the canonical event.

Every delivery is fingerprinted (SHA-256 of the raw body) and stored in
`payment_webhook_events`, so Razorpay retries and duplicate deliveries are
idempotent. Unknown orders are acknowledged without granting access.
`purchase.confirm` and the webhook both converge on the same
`verifyAndActivate` path, so a payment verified twice still yields one
entitlement.

### Test-mode checklist

1. Use `rzp_test_…` keys and a test webhook secret.
2. Buy each plan with Razorpay test cards; confirm the entitlement expires
   at exactly the plan duration.
3. Replay a captured webhook (same body) and confirm the response is
   accepted as a duplicate without extending access.
4. Refund a captured payment in the Razorpay dashboard; confirm the
   payment row becomes `refunded`, the entitlement becomes `revoked`, and
   an open desktop session locks on its next heartbeat.
5. Close the checkout tab after paying but before the callback; use
   "Restore purchases" and confirm the entitlement appears.
6. Verify the webhook route rejects a tampered body/signature with HTTP 400.

## Website dashboard and admin console

- `/?account=1` (also reachable as `/dashboard`) is the subscription
  dashboard: live server-anchored countdown, plan grid with "Add more time"
  on the current plan, purchase history, signed-in devices with revoke, and
  MFA/password/account controls.
- `/?admin` is the operator console. Set a long random `ADMIN_TOKEN`; when
  it is empty, all `/api/admin.*` endpoints return 404 and the console
  cannot unlock. The token is kept in memory only and sent as
  `Authorization: Bearer …` — never in a URL or browser storage.
- The console provides: service overview (accounts, verified, active/expired
  entitlements, payments, sessions, HTTP counters, uptime), user search,
  user detail (entitlements, payments, devices, security audit), grant
  entitlement, extend, set expiration to now, revoke, refund (gateway),
  suspend/unsuspend and revoke desktop sessions. Admin actions are written
  to `admin_audit`.

## Configuration

Add these to `.env` (see `.env.example`):

| Variable                         | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `PUBLIC_URL`                     | Public HTTPS origin; used for purchase URLs and cookies.        |
| `CLOUD_DATA_DIR`                 | SQLite database, workspaces and development outbox.             |
| `CLOUD_ENCRYPTION_KEY`           | 64 hex characters; encrypts stored provider keys. Back it up.   |
| `SMTP_*`                         | Verification, reset and receipt email.                          |
| `RAZORPAY_KEY_ID`                | Razorpay API key id.                                            |
| `RAZORPAY_KEY_SECRET`            | Razorpay key secret (checkout signature verification).          |
| `RAZORPAY_WEBHOOK_SECRET`        | Raw-body webhook HMAC secret.                                   |
| `PLANS_JSON`                     | Optional JSON array overriding the plan catalog.                |
| `PLAN_TAX_NOTE`                  | Optional default tax note for plans that omit one.              |
| `ADMIN_TOKEN`                    | Enables `/?admin` and `/api/admin.*`. Leave empty to disable.   |
| `TRUST_PROXY=1`                  | Only behind a proxy that overwrites `X-Forwarded-For`.          |
| `DOWNLOAD_DIRECTORY`             | Directory served for installer downloads (default `release`).   |
| `LENSDESK_HEARTBEAT_SECONDS`     | Desktop heartbeat cadence (default 60).                         |
| `LENSDESK_OFFLINE_GRACE_SECONDS` | Offline tolerance using the last server snapshot (default 120). |
| `STRIPE_*`                       | Existing hosted AI Pro billing; unaffected by prepaid plans.    |

`PLANS_JSON` example:

```json
[
  {
    "id": "hourly",
    "label": "Hourly",
    "priceMinor": 10000,
    "currency": "INR",
    "durationSeconds": 3600,
    "durationLabel": "1 hour",
    "taxNote": "Inclusive of applicable taxes.",
    "highlight": false
  }
]
```

Validation: lowercase slug id (2–40 chars), `priceMinor` 100–100,000,000,
currency exactly `INR`, duration 3,600–31,536,000 seconds. Plan changes are
read at server boot; restart after changing the catalog. Existing
entitlements keep their original expiration.

## Operational notes

- Serve over HTTPS in production; `NODE_ENV=production` requires an HTTPS
  `PUBLIC_URL`.
- Keep the host clock synchronized (NTP). Entitlements use the server clock.
- Back up `CLOUD_DATA_DIR` (especially `accounts.sqlite`) and
  `CLOUD_ENCRYPTION_KEY` together; losing the key makes stored provider
  keys unreadable.
- The current storage is file-backed SQLite for a single app instance. Do
  not horizontally replicate it without replacing the storage layer.
- Rate limits (per rolling 15 minutes): website login 50 per client
  identity (plus a 10-attempt per email/identity counter that clears after a
  successful sign-in), desktop login 20
  per identity, heartbeat 240 per account, checkout 20 per account,
  purchase confirmation 30 per identity.
- Prepaid plans and the legacy Stripe-hosted AI Pro subscription are
  independent: Stripe continues to bill hosted AI allowances; Razorpay
  grants desktop access time.

## Load test

`scripts/load-subscriptions.mjs` starts the real cloud server in-process
with a temporary database, seeds accounts/entitlements/desktop sessions
directly, then sends genuine HTTP requests through the production request
pipeline. Only seeding bypasses HTTP (so the measurement window is not
spent on 20k scrypt registrations).

```sh
npm run load:subscriptions
# or with explicit parameters:
node scripts/load-subscriptions.mjs --sessions=20000 --rounds=3 \
  --concurrency=100 --login-users=100 --login-rounds=3
```

Measured on 23 Oct 2026, Node v26.7.0, macOS arm64, 10 CPUs, loopback,
single process, `trustProxy=1`:

```
Seeded 20,000 accounts, 20,000 desktop sessions (monthly entitlements)
  in 0.68s · DB 22.6 MiB · RSS 112.1 MiB

auth.login (scrypt password verification)
  round 1: 100 requests, 0 failed, 0.66s, 151/s, p50 346ms, p95 633ms, p99 658ms
  round 2: 100 requests, 0 failed, 0.66s, 152/s, p50 343ms, p95 630ms, p99 655ms
  round 3: 100 requests, 0 failed, 0.66s, 152/s, p50 345ms, p95 632ms, p99 658ms

desktop.heartbeat (one request per distinct live desktop session)
  round 1: 20,000 requests, 0 failed, 4.78s, 4,181/s, p50 24ms, p95 31ms, p99 33ms
  round 2: 20,000 requests, 0 failed, 6.03s, 3,317/s, p50 28ms, p95 36ms, p99 40ms
  round 3: 20,000 requests, 0 failed, 6.19s, 3,230/s, p50 29ms, p95 40ms, p99 51ms

Heartbeat total: 60,000 requests in 17.01s → 3,527/s across all rounds
Resident memory after test: 511.7 MiB
```

Interpretation:

- 20,000 distinct live sessions each heartbeating every 60 seconds means
  roughly **334 heartbeats/s** at steady state; the measured single-process
  headroom is about 10× that at the third round.
- The first heartbeat round is faster because SQLite page cache and the
  token-session join are warm; later rounds include sustained lease
  updates and are the more conservative number.
- Login throughput is scrypt-bound (libuv thread pool, 4 threads by
  default). The p50 at 100 concurrent requests includes queueing; the
  steady-state per-request verification cost is roughly 30 ms on this
  machine. Login is intentionally not the hot path.
- These are local loopback numbers without TLS, a reverse proxy, or
  production network latency. Use them as a capacity sanity check, not a
  guarantee. Re-run on the actual host before sizing a deployment.

Limitations: the harness measures one Node process and the file-backed
SQLite database. It does not exercise Razorpay, SMTP, TLS termination or a
multi-node deployment.

## Verification

```sh
npm test                 # server, entitlement, payment, gate and UI unit tests
npm run build            # tsc + production renderer build
npm run test:reference   # desktop IPC/capture contract checks
npm run load:subscriptions
```

Relevant suites:

- `tests/entitlements.test.mjs` — extension, expiry, refund and clock rules.
- `tests/payments.test.mjs` — checkout, signature, webhook, idempotency.
- `tests/subscription-e2e.test.mjs` — full HTTP purchase-to-desktop flow
  with a mock Razorpay API and simulated clock.
- `tests/desktop-gate.test.mjs` — gate phases, takeover, refresh reuse,
  expiry, refund and suspension behavior.
- `tests/desktop-sessions.test.mjs` — single-session enforcement and token
  rotation.

Live Razorpay payments, real SMTP delivery and native Windows execution
require their respective accounts/hardware and separate acceptance testing.
macOS Electron and archive checks here are not native Windows execution.
