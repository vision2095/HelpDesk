import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRazorpayClient, createPayments } from "../server/cloud/payments.mjs";
import { createEntitlements } from "../server/cloud/entitlements.mjs";
import { loadPlans } from "../server/cloud/plans.mjs";
import { applyMigrations } from "../server/cloud/migrations.mjs";

const KEY_ID = "rzp_test_keyid12345",
  KEY_SECRET = "testsecretsecretsecret",
  WEBHOOK_SECRET = "whsec_secret_secretsecret";

// Local stand-in for Razorpay's public API. It keeps gateway state and
// signs exactly like the production gateway so integrations run against
// the real verification code paths.
async function fixture(t) {
  const orders = new Map();
  const payStore = new Map();
  let paySeq = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://mock");
      const auth = (req.headers.authorization || "").startsWith(
        "Basic " + Buffer.from(KEY_ID + ":" + KEY_SECRET).toString("base64"),
      );
      if (!auth) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "BAD_REQUEST", description: "bad auth" } }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/failing") {
        res.writeHead(503);
        res.end(JSON.stringify({ error: { code: "SERVER_ERROR", description: "down" } }));
        return;
      }
      if (req.method === "POST" && url.pathname.endsWith("/payments-stuck")) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: { code: "SERVER_ERROR", description: "stuck" } }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/missing-fields") {
        res.writeHead(201);
        res.end(JSON.stringify({ amount: 5 }));
        return;
      }
      const match = url.pathname.match(/^\/v1\/orders\/([^/]+)(\/payments)?$/);
      if (req.method === "POST" && url.pathname === "/v1/orders") {
        const id = "order_" + (orders.size + 1).toString(36).padStart(14, "0");
        orders.set(id, JSON.parse(raw));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id, ...JSON.parse(raw), status: "created" }));
        return;
      }
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
            JSON.stringify({ items: [...payStore.values()].filter((p) => p.order_id === match[1]) }),
          );
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ id: match[1], ...order, status: order.paid ? "paid" : "created" }));
        return;
      }
      const payMatch = url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
      if (req.method === "GET" && payMatch) {
        const payment = payStore.get(payMatch[1]);
        if (!payment) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: { code: "BAD_REQUEST", description: "no payment" } }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify(payment));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: { code: "BAD_REQUEST", description: "no route" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiBase = "http://127.0.0.1:" + server.address().port;

  const client = createRazorpayClient({
    keyId: KEY_ID,
    keySecret: KEY_SECRET,
    webhookSecret: WEBHOOK_SECRET,
    apiBase,
  });

  const db = new DatabaseSync(":memory:");
  let nowMs = 1770000000000;
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(
      id TEXT PRIMARY KEY,
      account_state TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO users VALUES('user-a','active');
  `);
  applyMigrations(db);
  const events = [];
  const plans = loadPlans({});
  const entitlements = createEntitlements({
    db,
    plans,
    clock: () => nowMs,
    audit: (userId, event, detail) => events.push({ userId, event, detail }),
  });
  let mailReceipts = [];
  const payments = createPayments({
    db,
    entitlements,
    plans,
    client,
    clock: () => nowMs,
    audit: (userId, event, detail) => events.push({ userId, event, detail }),
    mailReceipt: async (payment) => mailReceipts.push(payment),
  });

  // Simulates the gateway capturing a payment for an order, producing
  // the checkout callback signature the browser would receive.
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

  const webhookBody = (event, entity, extra = {}) =>
    JSON.stringify({ event, payload: { payment: { entity } }, ...extra });
  const webhook = (event, entity, extra) => {
    const raw = Buffer.from(webhookBody(event, entity, extra));
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    return payments.processWebhook(raw, signature);
  };
  // Razorpay refund deliveries wrap a refund object under
  // payload.refund.entity — the shape the production gateway sends.
  const webhookRefund = (refundEntity, event = "refund.processed") => {
    const raw = Buffer.from(
      JSON.stringify({ event, payload: { refund: { entity: refundEntity } } }),
    );
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    return payments.processWebhook(raw, signature);
  };

  const user = { id: "user-a", email: "a@x.test", verified: true };
  t.after(async () => {
    db.close();
    server.close();
  });
  return {
    db, client, payments, entitlements, orders, payStore, events,
    gatewayCapture, webhook, webhookBody, webhookRefund, mailReceipts: () => mailReceipts,
    setClock: (ms) => (nowMs = ms), nowMs: () => nowMs, user,
  };
}

test("checkout creates a paid order, activating exactly the purchased plan", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  assert.equal(checkout.amount, 10000);
  assert.equal(checkout.currency, "INR");
  assert.equal(checkout.keyId, KEY_ID);
  assert.equal(checkout.plan.durationLabel, "1 hour");
  assert.ok(checkout.orderId && checkout.paymentId);
  const { paymentId, signature } = f.gatewayCapture(checkout.orderId);
  const result = await f.payments.confirm({
    user: f.user,
    orderId: checkout.orderId,
    gatewayPaymentId: paymentId,
    signature,
  });
  assert.equal(result.status, "paid");
  assert.equal(result.entitlement.expirationTimestamp - result.entitlement.activationTimestamp, 3600 * 1000);
  assert.equal(f.entitlements.authorize("user-a").id, result.entitlement.id);
  assert.equal(f.mailReceipts().length, 1);
});

test("a forged or tampered checkout signature never grants access", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "daily" });
  const { paymentId } = f.gatewayCapture(checkout.orderId);
  await assert.rejects(
    () =>
      f.payments.confirm({
        user: f.user,
        orderId: checkout.orderId,
        gatewayPaymentId: paymentId,
        signature: createHmac("sha256", "wrong-secret")
          .update(checkout.orderId + "|" + paymentId)
          .digest("hex"),
      }),
    /could not be verified/,
  );
  assert.equal(f.entitlements.authorize("user-a"), null);
});

test("another user's checkout payment cannot activate someone else's account", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  const { paymentId, signature } = f.gatewayCapture(checkout.orderId);
  await assert.rejects(
    () =>
      f.payments.confirm({
        user: { id: "user-other", verified: true },
        orderId: checkout.orderId,
        gatewayPaymentId: paymentId,
        signature,
      }),
    /does not match your account/,
  );
  assert.equal(f.entitlements.authorize("user-a"), null);
  assert.equal(f.entitlements.horizon("user-a"), 0);
});

test("webhooks verify signatures, activate access, and reject replays", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "monthly" });
  const { entity, signature } = f.gatewayCapture(checkout.orderId);
  // Forged webhook: wrong secret => rejected.
  const forgedRaw = Buffer.from(f.webhookBody("payment.captured", entity));
  const forged = await f.payments.processWebhook(
    forgedRaw,
    createHmac("sha256", "another").update(forgedRaw).digest("hex"),
  );
  assert.match(forged.reason, /invalid_signature/);
  assert.equal(f.entitlements.authorize("user-a"), null);
  // Correct webhook activates.
  const applied = await f.webhook("payment.captured", entity);
  assert.equal(applied.applied, true);
  const first = f.entitlements.authorize("user-a");
  assert.equal(
    first.expirationTimestamp - first.activationTimestamp,
    30 * 24 * 3600 * 1000,
  );
  // Replay of the same webhook (duplicated delivery) changes nothing.
  const replay = await f.webhook("payment.captured", entity);
  assert.equal(replay.duplicate, true);
  const entitlementCount = f.db.prepare("SELECT COUNT(*) AS c FROM entitlements").get().c;
  assert.equal(entitlementCount, 1);
  // The checkout confirm arriving afterwards is idempotent.
  const confirm = await f.payments.confirm({
    user: f.user,
    orderId: checkout.orderId,
    gatewayPaymentId: entity.id,
    signature,
  });
  assert.equal(confirm.alreadyPaid, true);
  const finalCount = f.db.prepare("SELECT COUNT(*) AS c FROM entitlements").get().c;
  assert.equal(finalCount, 1);
});

test("failed payments do not grant access and marked failed via webhook", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  await f.webhook(
    "payment.failed",
    {
      id: "pay_failed1",
      order_id: checkout.orderId,
      amount: 10000,
      currency: "INR",
      status: "failed",
      notes: {},
    },
  );
  assert.equal(f.entitlements.authorize("user-a"), null);
  const row = f.db.prepare("SELECT status FROM payments WHERE order_id=?").get(checkout.orderId);
  assert.equal(row.status, "failed");
});

test("full refund webhook revokes access immediately", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  const { entity, signature } = f.gatewayCapture(checkout.orderId);
  const applied = await f.webhook("payment.captured", entity);
  assert.equal(applied.applied, true);
  assert.ok(f.entitlements.authorize("user-a"));
  const revoked = await f.webhookRefund({
    id: "rfnd_e2e1",
    payment_id: entity.id,
    amount: 10000,
    currency: "INR",
    status: "processed",
  });
  assert.equal(revoked.applied, true);
  assert.equal(f.entitlements.authorize("user-a"), null);
  assert.equal(f.entitlements.horizon("user-a"), 0);
  const row = f.db.prepare("SELECT status FROM payments WHERE order_id=?").get(checkout.orderId);
  assert.equal(row.status, "refunded");
});

test("partial refund is recorded but access continues", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "daily" });
  const { entity } = f.gatewayCapture(checkout.orderId);
  await f.webhook("payment.captured", entity);
  const partial = await f.webhookRefund({
    id: "rfnd_partial",
    payment_id: entity.id,
    amount: 100,
    currency: "INR",
    status: "processed",
  });
  assert.equal(partial.applied, true);
  assert.ok(f.entitlements.authorize("user-a"), "partial refund keeps access");
  const row = f.db.prepare("SELECT status FROM payments WHERE order_id=?").get(checkout.orderId);
  assert.equal(row.status, "paid");
});

test("a refund arriving before any capture is recorded but not applied", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  // The gateway refund references a payment id that was never confirmed
  // locally: nothing is flipped to refunded, no access is granted or lost.
  const result = await f.webhookRefund({
    id: "rfnd_unknown",
    payment_id: "pay_unknown",
    amount: 10000,
    currency: "INR",
    status: "processed",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.applied, false);
  assert.equal(result.reason, "unknown_payment");
  assert.equal(f.entitlements.authorize("user-a"), null);
  const row = f.db.prepare("SELECT status FROM payments WHERE order_id=?").get(checkout.orderId);
  assert.equal(row.status, "created", "pending row must stay pending");
  const recorded = f.db
    .prepare("SELECT COUNT(*) AS c FROM payment_webhook_events")
    .get().c;
  assert.equal(recorded, 1, "delivery is still recorded for replay protection");
});

test("legacy refund payloads (payment entity with payment_id) still apply", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  const { entity } = f.gatewayCapture(checkout.orderId);
  await f.webhook("payment.captured", entity);
  const applied = await f.webhook("refund.processed", {
    ...entity,
    payment_id: entity.id,
  });
  assert.equal(applied.applied, true);
  assert.equal(f.entitlements.authorize("user-a"), null);
});

test("verified payment amounts mismatching order are rejected", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  // Tamper: gateway recorded a captured payment with a smaller amount.
  const paymentId = "pay_tampered";
  f.payStore.set(paymentId, {
    id: paymentId,
    order_id: checkout.orderId,
    amount: 1,
    currency: "INR",
    status: "captured",
    notes: {},
  });
  const signature = createHmac("sha256", KEY_SECRET)
    .update(checkout.orderId + "|" + paymentId)
    .digest("hex");
  await assert.rejects(
    () =>
      f.payments.confirm({
        user: f.user,
        orderId: checkout.orderId,
        gatewayPaymentId: paymentId,
        signature,
      }),
    /not captured this payment yet|has not captured/,
  );
});

test("reconciliation repairs locally-dropped capture events", async (t) => {
  const f = await fixture(t);
  const checkout = await f.payments.createCheckout({ user: f.user, planId: "daily" });
  f.gatewayCapture(checkout.orderId);
  // Simulate a lost webhook: nothing locally recorded yet.
  assert.equal(f.entitlements.authorize("user-a"), null);
  const report = await f.payments.reconcile({ user: f.user });
  assert.equal(report.repaired, 1);
  assert.ok(f.entitlements.authorize("user-a"));
  assert.equal(f.entitlements.authorize("user-a").planId, "daily");
});

test("double-click creates one pending order and reuses it", async (t) => {
  const f = await fixture(t);
  const first = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  const second = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  assert.equal(first.paymentId, second.paymentId);
  assert.equal(first.orderId, second.orderId);
  f.setClock(f.nowMs() + 3600 * 1000); // past the pending-order reuse window
  const third = await f.payments.createCheckout({ user: f.user, planId: "hourly" });
  assert.notEqual(first.orderId, third.orderId);
  assert.notEqual(first.paymentId, third.paymentId);
  assert.ok(!third.reused);
});
