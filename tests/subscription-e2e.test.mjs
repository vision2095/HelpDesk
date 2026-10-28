import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { TOTP, Secret } from "otpauth";
import { createCloudServer } from "../server/cloud/app.mjs";
import { createRazorpayClient } from "../server/cloud/payments.mjs";

const KEY_ID = "rzp_test_keyid12345",
  KEY_SECRET = "testsecretsecretsecret",
  WEBHOOK_SECRET = "whsec_e2e_secret";

// End-to-end acceptance: the real HTTP server, real database and real
// Razorpay verification paths with only the gateway API and the clock
// simulated in-process.

async function fixture(t) {
  const orders = new Map();
  const payStore = new Map();
  let paySeq = 0;
  const gateway = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://mock");
      if (!url.pathname.startsWith("/v1/")) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: { code: "BAD_REQUEST", description: "no route" } }));
        return;
      }
      const auth = (req.headers.authorization || "").startsWith(
        "Basic " + Buffer.from(KEY_ID + ":" + KEY_SECRET).toString("base64"),
      );
      if (!auth) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: { code: "BAD_REQUEST", description: "bad auth" } }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/orders") {
        const id = "order_" + (orders.size + 1).toString(36).padStart(14, "0");
        orders.set(id, JSON.parse(raw));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id, ...JSON.parse(raw), status: "created" }));
        return;
      }
      const match = url.pathname.match(/^\/v1\/orders\/([^/]+)(\/payments)?$/);
      if (req.method === "GET" && match) {
        const order = orders.get(match[1]);
        if (!order) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: { code: "BAD_REQUEST", description: "no order" } }));
          return;
        }
        if (match[2]) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              items: [...payStore.values()].filter((p) => p.order_id === match[1]),
            }),
          );
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ id: match[1], ...order, status: order.paid ? "paid" : "created" }));
        return;
      }
      const payMatch = url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
      if (req.method === "GET" && payMatch) {
        res.writeHead(200);
        res.end(JSON.stringify(payStore.get(payMatch[1]) || {}));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: { code: "BAD_REQUEST", description: "no route" } }));
    });
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-e2e-"));
  const emails = [];
  let nowMs = 1770000000000;
  const app = createCloudServer({
    directory,
    publicUrl: "https://lensdesk.test",
    encryptionKey: randomBytes(32).toString("hex"),
    adminToken: "e2e-admin-token",
    razorpayClient: createRazorpayClient({
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      apiBase: "http://127.0.0.1:" + gateway.address().port,
    }),
    clock: () => nowMs,
    mfaClock: () => nowMs,
    mailer: { sendMail: async (message) => emails.push(message) },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + app.server.address().port;

  t.after(async () => {
    await app.close();
    gateway.closeIdleConnections?.();
    gateway.closeAllConnections?.();
    await new Promise((resolve) => gateway.close(resolve));
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  });

  // clientHeader "desktop" mirrors the desktop app, "web" acts as the
  // browser carrying a website session token instead.
  async function call(action, payload = {}, token, clientHeader = "desktop") {
    const response = await fetch(url + "/api/" + action, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LensDesk-Client": clientHeader,
        Origin: url,
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }

  async function register(email = "person@example.com", { verify = true } = {}) {
    const response = await call("auth.register", {
      email,
      password: "long-test-password",
      name: "Test Person",
    });
    assert.equal(response.status, 200);
    const mail = emails.at(-1);
    const token = new URL(mail.text.match(/https:\/\/[^\s]+/)[0]).searchParams.get("verify");
    if (verify) assert.equal((await call("auth.verify", { token })).status, 200);
    return { userId: response.body.user.id, websiteToken: response.body.token, verifyToken: token };
  }

  // Captures a payment at the gateway and produces the exact signed
  // checkout callback a browser would hand back to us.
  function gatewayCapture(orderId) {
    const order = orders.get(orderId);
    assert.ok(order, "gateway has no such order");
    const paymentId = "pay_" + (++paySeq).toString(36).padStart(14, "0");
    const entity = {
      id: paymentId,
      order_id: orderId,
      amount: order.amount,
      currency: order.currency,
      status: "captured",
      notes: order.notes,
      method: "upi",
    };
    payStore.set(paymentId, entity);
    order.paid = true;
    const signature = createHmac("sha256", KEY_SECRET)
      .update(orderId + "|" + paymentId)
      .digest("hex");
    return { paymentId, signature, entity };
  }

  async function sendWebhook(event, entity, extra = {}) {
    const raw = JSON.stringify({ event, payload: { payment: { entity } }, ...extra });
    const response = await fetch(url + "/api/purchase.webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"),
      },
      body: raw,
    });
    return { status: response.status, body: await response.json() };
  }

  // Production refund events carry the refund object under
  // payload.refund.entity with a payment_id pointer.
  async function sendRefundWebhook(refundEntity) {
    const raw = JSON.stringify({
      event: "refund.processed",
      payload: { refund: { entity: refundEntity } },
    });
    const response = await fetch(url + "/api/purchase.webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"),
      },
      body: raw,
    });
    return { status: response.status, body: await response.json() };
  }

  function totpFor(secret) {
    return new TOTP({
      issuer: "LensDesk",
      label: "account",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
  }

  async function purchase(token, planId) {
    const checkout = await call("purchase.checkout", { planId }, token, "web");
    assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
    const capture = gatewayCapture(checkout.body.orderId);
    const confirm = await call(
      "purchase.confirm",
      { orderId: checkout.body.orderId, paymentId: capture.paymentId, signature: capture.signature },
      token,
      "web",
    );
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    return { checkout: checkout.body, capture, confirm: confirm.body };
  }

  return {
    app, url, call, register, gatewayCapture, sendWebhook, sendRefundWebhook,
    totpFor, purchase, emails,
    setClock: (ms) => (nowMs = ms),
    nowMs: () => nowMs,
    gateway: { orders, payStore },
  };
}

test("website purchase unlocks the desktop app and expiry locks it out until renewal", async (t) => {
  const f = await fixture(t);
  const account = await f.register();
  const token = account.websiteToken;

  // Public catalog: the four prepaid plans, no license keys anywhere.
  const pub = await f.call("cloud.public", {}, null, "web");
  assert.equal(pub.status, 200);
  assert.equal(pub.body.accessPlans.length, 4);
  assert.ok(pub.body.purchaseUrl.endsWith("/dashboard"));

  // Desktop sign-in with no active subscription must point to purchase.
  const locked = await f.call("desktop.login", {
    email: "person@example.com",
    password: "long-test-password",
    deviceLabel: "Mac Studio",
    os: "darwin",
    appVersion: "1.3.6",
  });
  assert.equal(locked.status, 403);
  assert.equal(locked.body.code, "SUBSCRIPTION_REQUIRED");
  assert.ok(locked.body.purchaseUrl);
  assert.equal(locked.body.subscription.entitlement, null);

  // The website buys a daily plan via the signed gateway round trip.
  const paid = await f.purchase(token, "daily");
  assert.equal(paid.checkout.amount, 20000);
  assert.equal(paid.checkout.currency, "INR");
  assert.equal(
    paid.confirm.entitlement.expirationTimestamp -
      paid.confirm.entitlement.activationTimestamp,
    24 * 3600 * 1000,
  );

  // Dashboard view: live entitlement, payment history attached.
  const state = await f.call("account.entitlement", {}, token, "web");
  assert.equal(state.status, 200);
  assert.equal(state.body.entitlement.planId, "daily");
  assert.equal(state.body.horizon, paid.confirm.entitlement.expirationTimestamp);
  const history = await f.call("purchase.history", {}, token, "web");
  assert.equal(history.body.history.length, 1);
  assert.equal(history.body.history[0].status, "paid");
  assert.equal(history.body.history[0].planLabel, "Daily");

  // Desktop sign-in now succeeds; a second device requires takeover.
  const desktop = await f.call("desktop.login", {
    email: "person@example.com",
    password: "long-test-password",
    deviceLabel: "Mac Studio",
    os: "darwin",
    appVersion: "1.3.6",
  });
  assert.equal(desktop.status, 200);
  assert.ok(desktop.body.accessToken && desktop.body.refreshToken);
  assert.equal(desktop.body.entitlement.planId, "daily");

  const second = await f.call("desktop.login", {
    email: "person@example.com",
    password: "long-test-password",
    deviceLabel: "Work PC",
    os: "win32",
    appVersion: "1.3.6",
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "TAKEOVER_REQUIRED");
  assert.equal(second.body.existing.deviceLabel, "Mac Studio");
  const takeover = await f.call("desktop.login", {
    email: "person@example.com",
    password: "long-test-password",
    deviceLabel: "Work PC",
    os: "win32",
    appVersion: "1.3.6",
    takeover: true,
  });
  assert.equal(takeover.status, 200);
  assert.ok(takeover.body.accessToken);

  // The first device died on takeover; its heartbeats are rejected.
  const oldBeat = await f.call("desktop.heartbeat", {}, desktop.body.accessToken);
  assert.equal(oldBeat.status, 401);

  // The live device synchronizes time and sees the lease.
  const beat = await f.call("desktop.heartbeat", {}, takeover.body.accessToken);
  assert.equal(beat.status, 200);
  assert.equal(beat.body.entitlement.planId, "daily");
  assert.ok(beat.body.leaseUntil > f.nowMs() / 1000);

  // Protected hosted action through a desktop token and entitlement.
  const save = await f.call("session.save", makeSession(), takeover.body.accessToken);
  assert.equal(save.status, 200);

  // Exactly 24 hours after activation access stops to the second:
  // at/after expiration means denied. The 15-minute access token has a
  // new leader in the refresh token, exactly like the desktop gate.
  f.setClock(f.nowMs() + 24 * 3600 * 1000);
  const deadBeat = await f.call("desktop.heartbeat", {}, takeover.body.accessToken);
  assert.equal(deadBeat.status, 401, "stale access token must re-authenticate");
  const refresh = await f.call(
    "desktop.refresh",
    { refreshToken: takeover.body.refreshToken },
  );
  assert.equal(refresh.status, 200);
  assert.equal(refresh.body.entitlement, null, "no active entitlement after expiry");
  const lockedOut = await f.call("session.save", makeSession(), refresh.body.accessToken);
  assert.equal(lockedOut.status, 403);
  assert.equal(lockedOut.body.code, "ENTITLEMENT_REQUIRED");

  // Renewal from the website an hour later starts access at payment
  // time (nothing was extended from the lapsed entitlement).
  f.setClock(f.nowMs() + 3600 * 1000);
  const renew = await f.purchase(token, "hourly");
  assert.equal(renew.confirm.entitlement.expirationTimestamp - renew.confirm.entitlement.activationTimestamp, 3600 * 1000);

  // The same device chain is restored with a fresh token rotation.
  const refresh2 = await f.call(
    "desktop.refresh",
    { refreshToken: refresh.body.refreshToken },
  );
  assert.equal(refresh2.status, 200);
  assert.equal(refresh2.body.entitlement.planId, "hourly");
  const back = await f.call("session.save", makeSession(), refresh2.body.accessToken);
  assert.equal(back.status, 200);

  // A full gateway refund revokes paid access immediately: Razorpay's
  // refund delivery carries payment_id inside payload.refund.entity.
  const refund = await f.sendRefundWebhook({
    id: "rfnd_e2e_1",
    payment_id: renew.capture.entity.id,
    amount: 10000,
    currency: "INR",
    status: "processed",
  });
  assert.equal(refund.status, 200);
  const afterRefund = await f.call("session.save", makeSession(), refresh2.body.accessToken);
  assert.equal(afterRefund.status, 403);
  const refundBeat = await f.call("desktop.heartbeat", {}, refresh2.body.accessToken);
  assert.equal(refundBeat.status, 200);
  assert.equal(refundBeat.body.entitlement, null);

  // Device list reflects one active session from the original account.
  const devices = await f.call("account.desktops", {}, token, "web");
  assert.equal(devices.status, 200);
  assert.equal(devices.body.devices.filter((d) => d.status === "active").length, 1);
  assert.ok(devices.body.devices.some((d) => d.status === "revoked"));

  // Exactly two payments: one paid-then-refunded, one expired paid day.
  const finalHistory = await f.call("purchase.history", {}, token, "web");
  assert.equal(finalHistory.body.history.length, 2);
  assert.deepEqual(
    finalHistory.body.history.map((row) => row.status).sort(),
    ["paid", "refunded"],
  );
  assert.ok(account.userId);
});

function makeSession() {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: "E2E session",
    mode: "general",
    profileId: "",
    createdAt: now,
    updatedAt: now,
    notes: "notes",
    transcript: "",
    messages: [],
    segments: [],
  };
}

test("unverified accounts can neither purchase nor reach the desktop app", async (t) => {
  const f = await fixture(t);
  const account = await f.register("ghost@example.com", { verify: false });
  const locked = await f.call("desktop.login", {
    email: "ghost@example.com",
    password: "long-test-password",
    deviceLabel: "PC",
  });
  assert.equal(locked.status, 400);
  assert.match(String(locked.body.error), /Verify your email/);
  const shop = await f.call("purchase.checkout", { planId: "hourly" }, account.websiteToken, "web");
  assert.equal(shop.status, 400);
  assert.match(String(shop.body.error), /Verify your email/);
});

test("MFA users sign in to the desktop app through the challenge path", async (t) => {
  const f = await fixture(t);
  const account = await f.register();
  await f.purchase(account.websiteToken, "daily");

  // Enable MFA on the website (password-confirmed setup + TOTP confirm).
  const begin = await f.call(
    "account.mfa.begin",
    { password: "long-test-password" },
    account.websiteToken,
    "web",
  );
  assert.equal(begin.status, 200);
  const setup = f.totpFor(begin.body.secret);
  const confirmCode = setup.generate({ timestamp: f.nowMs() });
  const enabled = await f.call(
    "account.mfa.confirm",
    { code: confirmCode },
    account.websiteToken,
    "web",
  );
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.recoveryCodes.length, 10);

  // Desktop login answers with the MFA challenge instead of tokens.
  const challenge = await f.call("desktop.login", {
    email: "person@example.com",
    password: "long-test-password",
    deviceLabel: "Mac Studio",
  });
  assert.equal(challenge.status, 200);
  assert.equal(challenge.body.mfaRequired, true);
  assert.ok(challenge.body.challenge);

  // The next code lands in a later time step so the authenticator
  // counter does not collide with the setup confirmation.
  f.setClock(f.nowMs() + 31 * 1000);
  const loginCode = setup.generate({ timestamp: f.nowMs() });
  const done = await f.call("desktop.mfa", {
    challenge: challenge.body.challenge,
    code: loginCode,
    deviceLabel: "Mac Studio",
    os: "darwin",
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.entitlement.planId, "daily");
  assert.ok(done.body.accessToken);
  const beat = await f.call("desktop.heartbeat", {}, done.body.accessToken);
  assert.equal(beat.status, 200);
  assert.equal(beat.body.entitlement.planId, "daily");
});

test("Suspensions and admin tools work end to end", async (t) => {
  const f = await fixture(t);
  const account = await f.register();
  await f.purchase(account.websiteToken, "hourly");
  const desktop = await f.call("desktop.login", {
    email: "person@example.com",
    password: "long-test-password",
    deviceLabel: "Mac Studio",
  });
  assert.equal(desktop.status, 200);

  // Admin endpoints vanish for missing and wrong bearer tokens.
  const noToken = await f.call("admin.overview", {}, null, "web");
  assert.equal(noToken.status, 404);
  const badToken = await fetch(f.url + "/api/admin.overview", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
    body: "{}",
  });
  assert.equal(badToken.status, 404);

  // Suspending the user kills the desktop session instantly.
  const adminCall = async (action, payload) => {
    const response = await fetch(f.url + "/api/" + action, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer e2e-admin-token",
      },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  };
  const suspend = await adminCall("admin.user.suspend", {
    userId: account.userId,
    reason: "chargeback investigation",
  });
  assert.equal(suspend.status, 200);
  assert.ok(suspend.body.desktopSessionsRevoked >= 1);
  const beat = await f.call("desktop.heartbeat", {}, desktop.body.accessToken);
  assert.equal(beat.status, 401);
  const blocked = await f.call("desktop.login", {
    email: "person@example.com",
    password: "long-test-password",
    deviceLabel: "Mac Studio",
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "ACCOUNT_BLOCKED");

  // Unsuspending with the live entitlement restores usable access.
  const unsuspend = await adminCall("admin.user.unsuspend", { userId: account.userId });
  assert.equal(unsuspend.status, 200);
  const again = await f.call("desktop.login", {
    email: "person@example.com",
    password: "long-test-password",
    deviceLabel: "Mac Studio",
    takeover: true,
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.entitlement.planId, "hourly");

  // Admin inspects the account; audit trail has the actions attached.
  const detail = await adminCall("admin.user", { userId: account.userId });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.user.email, "person@example.com");
  assert.ok(detail.body.desktopSessions.some((s) => s.status === "active"));
  assert.ok(
    detail.body.audit.some((row) => row.event === "account.suspended"),
    "suspension is audited",
  );

  // Admin grants 15 days of custom access by email
  const grantByEmail = await adminCall("admin.user.grantByEmail", {
    email: "person@example.com",
    days: 15,
    note: "Admin promotional grant",
  });
  assert.equal(grantByEmail.status, 200);
  assert.equal(grantByEmail.body.ok, true);
  assert.equal(grantByEmail.body.entitlement.days, 15);

  // User logs out from all desktop devices from website
  const revokeAll = await f.call("account.desktop.revokeAll", {}, account.websiteToken, "web");
  assert.equal(revokeAll.status, 200);
  assert.equal(revokeAll.body.ok, true);
  assert.ok(revokeAll.body.revokedCount >= 1);

  // Desktop heartbeat now returns 401
  const heartbeatAfterRevoke = await f.call("desktop.heartbeat", {}, again.body.accessToken);
  assert.equal(heartbeatAfterRevoke.status, 401);

  // Admin deletes user account permanently
  const deleteUser = await adminCall("admin.user.delete", { userId: account.userId });
  assert.equal(deleteUser.status, 200);
  assert.equal(deleteUser.body.ok, true);
  assert.equal(deleteUser.body.deleted, true);

  // User is gone from database
  const queryDeleted = await adminCall("admin.user", { userId: account.userId });
  assert.equal(queryDeleted.status, 400);
});

test("the purchase webhook endpoint activates, deduplicates, and rejects forgery over HTTP", async (t) => {
  const f = await fixture(t);
  const account = await f.register("hooked@example.com");
  const checkout = await f.call(
    "purchase.checkout",
    { planId: "ten-day" },
    account.websiteToken,
    "web",
  );
  assert.equal(checkout.status, 200);
  const capture = f.gatewayCapture(checkout.body.orderId);

  // A wrong signature never activates anything.
  const forged = await fetch(f.url + "/api/purchase.webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Razorpay-Signature": createHmac("sha256", "not-the-secret")
        .update("x")
        .digest("hex"),
    },
    body: "x",
  });
  assert.equal(forged.status, 400);

  // The real webhook activates access with no browser involvement.
  const applied = await f.sendWebhook("payment.captured", capture.entity);
  assert.equal(applied.status, 200);
  const desktop = await f.call("desktop.login", {
    email: "hooked@example.com",
    password: "long-test-password",
    deviceLabel: "Mac Studio",
  });
  assert.equal(desktop.status, 200);
  assert.equal(desktop.body.entitlement.planId, "ten-day");

  // Duplicated gateway delivery is safe: still 200, still one row.
  const replay = await f.sendWebhook("payment.captured", capture.entity);
  assert.equal(replay.status, 200);
  const rows = f.app.entitlements.listForUser(account.userId, 10);
  assert.equal(rows.length, 1);

  // Reconciliation from the dashboard finds nothing to repair.
  const reconcile = await f.call("purchase.reconcile", {}, account.websiteToken, "web");
  assert.equal(reconcile.status, 200);
  assert.deepEqual(reconcile.body, { checked: 0, repaired: 0 });
});

test("rate limiting answers 429 when hammered", async (t) => {
  const f = await fixture(t);
  const account = await f.register("hammer@example.com");
  let saw429 = false;
  for (let i = 0; i < 30; i++) {
    const response = await f.call(
      "purchase.checkout",
      { planId: "hourly" },
      account.websiteToken,
      "web",
    );
    if (response.status === 429) {
      saw429 = true;
      assert.match(String(response.body.error), /Too many requests/);
      break;
    }
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  assert.equal(saw429, true, "the checkout limiter must trip");
});
