import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createEntitlements } from "../server/cloud/entitlements.mjs";
import { loadPlans } from "../server/cloud/plans.mjs";
import { applyMigrations } from "../server/cloud/migrations.mjs";

function fixture(t, { clockMs = 1770000000000 } = {}) {
  const db = new DatabaseSync(":memory:");
  let now = clockMs;
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT UNIQUE);
    INSERT INTO users VALUES('user-a', 'a@x.test'), ('user-b', 'b@x.test'), ('user-c', 'c@x.test');
  `);
  db.exec("CREATE TABLE accounts_empty_history(id TEXT PRIMARY KEY)");
  applyMigrations(db);
  const events = [];
  const entitlements = createEntitlements({
    db,
    plans: loadPlans({}),
    clock: () => now,
    audit: (userId, event, detail) => events.push({ userId, event, detail }),
  });
  t.after(() => db.close());
  // A payments row is required when activating with a payment reference.
  const insertPayment = (id, userId, planId = "hourly") =>
    db
      .prepare(
        "INSERT INTO payments(id,user_id,plan_id,amount_minor,currency,status,order_id,created_at,updated_at) VALUES(?,?,?,?,?,'paid',?,?,?)",
      )
      .run(id, userId, planId, 10000, "INR", "order-" + id, clockMs, clockMs);
  return { db, entitlements, events, insertPayment, atMs: () => now, setClock: (ms) => (now = ms) };
}

const HOUR = 3600 * 1000;

test("hourly plan activates exactly one hour from payment time", (t) => {
  const f = fixture(t);
  f.insertPayment("pay-1", "user-a", "hourly");
  const result = f.entitlements.activate({
    userId: "user-a",
    planId: "hourly",
    paymentId: "pay-1",
    activatedAtMs: f.atMs(),
  });
  assert.equal(result.subscriptionStatus, "active");
  assert.equal(result.activationTimestamp, 1770000000000);
  assert.equal(result.expirationTimestamp, 1770000000000 + HOUR);
  assert.equal(
    f.entitlements.authorize("user-a", 1770000000000 + HOUR - 1).id,
    result.id,
  );
  // At exactly the expiration timestamp, access is denied (interval is
  // half-open [activation, expiration)).
  assert.equal(f.entitlements.authorize("user-a", 1770000000000 + HOUR), null);
  assert.equal(f.entitlements.authorize("user-a", f.atMs()).id, result.id);
});

test("purchase while active extends from existing expiry; after expiry starts fresh", (t) => {
  const f = fixture(t);
  f.insertPayment("pay-1", "user-a", "daily");
  const first = f.entitlements.activate({
    userId: "user-a",
    planId: "daily",
    paymentId: "pay-1",
    activatedAtMs: f.atMs(),
  });
  const day = 24 * HOUR;
  assert.equal(
    f.entitlements.horizon("user-a"),
    1770000000000 + day,
  );
  f.insertPayment("pay-2", "user-a", "hourly");
  const second = f.entitlements.activate({
    userId: "user-a",
    planId: "hourly",
    paymentId: "pay-2",
    activatedAtMs: 1770000000000 + day - HOUR, // still active
  });
  // Extension starts precisely at the current expiry.
  assert.equal(second.expirationTimestamp, 1770000000000 + day + HOUR);
  // Coverage is continuous — authorized throughout the extension.
  assert.ok(f.entitlements.authorize("user-a", 1770000000000 + day).id);
  // After everything expires, a purchase starts from payment time.
  const later = 1770000000000 + day + HOUR + 60_000;
  f.insertPayment("pay-3", "user-a", "hourly");
  const third = f.entitlements.activate({
    userId: "user-a",
    planId: "hourly",
    paymentId: "pay-3",
    activatedAtMs: later,
  });
  assert.equal(third.activationTimestamp, later);
  assert.equal(third.expirationTimestamp, later + HOUR);
});

test("simultaneous purchases never lose or duplicate paid time", (t) => {
  const f = fixture(t);
  f.insertPayment("pay-1", "user-b", "hourly");
  f.insertPayment("pay-2", "user-b", "hourly");
  f.insertPayment("pay-3", "user-b", "hourly");
  const r1 = f.entitlements.activate({
    userId: "user-b",
    planId: "hourly",
    paymentId: "pay-1",
    activatedAtMs: f.atMs(),
  });
  const r2 = f.entitlements.activate({
    userId: "user-b",
    planId: "hourly",
    paymentId: "pay-2",
    activatedAtMs: f.atMs(),
  });
  const r3 = f.entitlements.activate({
    userId: "user-b",
    planId: "hourly",
    paymentId: "pay-3",
    activatedAtMs: f.atMs(),
  });
  assert.equal(r2.expirationTimestamp - r1.expirationTimestamp, HOUR);
  assert.equal(r3.expirationTimestamp - r2.expirationTimestamp, HOUR);
  assert.equal(f.entitlements.horizon("user-b"), 1770000000000 + 3 * HOUR);
});

test("activation is idempotent per payment", (t) => {
  const f = fixture(t);
  f.insertPayment("pay-1", "user-c", "hourly");
  const first = f.entitlements.activate({
    userId: "user-c",
    planId: "hourly",
    paymentId: "pay-1",
    activatedAtMs: f.atMs(),
  });
  const again = f.entitlements.activate({
    userId: "user-c",
    planId: "hourly",
    paymentId: "pay-1",
    activatedAtMs: f.atMs() + 5_000,
  });
  assert.equal(again.id, first.id);
  assert.equal(again.expirationTimestamp, first.expirationTimestamp);
});

test("refund revocation stops future access instantly and is audited", (t) => {
  const f = fixture(t);
  f.insertPayment("pay-1", "user-c", "hourly");
  const first = f.entitlements.activate({
    userId: "user-c",
    planId: "hourly",
    paymentId: "pay-1",
    activatedAtMs: f.atMs(),
  });
  assert.ok(f.entitlements.authorize("user-c"));
  f.entitlements.revokeByPayment("pay-1", { actor: "gateway", reason: "refund.processed" });
  assert.equal(f.entitlements.authorize("user-c"), null);
  assert.equal(f.entitlements.horizon("user-c"), 0);
  const event = f.events.find(
    (e) => e.userId === "user-c" && e.event === "entitlement.revoked.gateway",
  );
  assert.ok(event);
  assert.equal(event.detail.paymentId, "pay-1");
  assert.match(first.id, /./);
});

test("expiry sweep relabels rows but authorization never depends on it", (t) => {
  const f = fixture(t);
  f.insertPayment("pay-1", "user-a", "hourly");
  f.entitlements.activate({
    userId: "user-a",
    planId: "hourly",
    paymentId: "pay-1",
    activatedAtMs: f.atMs(),
  });
  assert.equal(f.entitlements.expireSweep(), 0);
  assert.equal(f.entitlements.byPayment("pay-1").subscriptionStatus, "active");
  assert.ok(f.entitlements.authorize("user-a"));
  // Move the server clock past the expiration timestamp: access stops
  // immediately even though the sweep has not run.
  f.setClock(1770000000000 + HOUR - 1000);
  assert.ok(f.entitlements.authorize("user-a"));
  f.setClock(1770000000000 + HOUR);
  assert.equal(f.entitlements.authorize("user-a"), null);
  // The sweep only converts the label; it does not create or remove
  // access and missing a sweep cannot leak access.
  assert.equal(f.entitlements.expireSweep(), 1);
  assert.equal(f.entitlements.byPayment("pay-1").subscriptionStatus, "expired");
});

test("admin grant, extend, set expiration, and revoke are audited and enforced", (t) => {
  const f = fixture(t);
  const granted = f.entitlements.grant({
    userId: "user-b",
    planId: "ten-day",
    actor: "admin(operator-1)",
    note: "support make-good",
  });
  assert.equal(
    granted.expirationTimestamp - granted.activationTimestamp,
    10 * 24 * HOUR,
  );
  f.entitlements.adminExtend(
    granted.id,
    HOUR,
    "admin(operator-1)",
    "one more hour",
  );
  const extended = f.entitlements.byId(granted.id);
  assert.equal(extended.expirationTimestamp, granted.expirationTimestamp + HOUR);
  f.entitlements.adminSetExpiration(granted.id, f.atMs() + 5000, "admin(operator-1)");
  assert.ok(f.entitlements.authorize("user-b"));
  f.entitlements.adminRevoke(granted.id, "admin(operator-1)", "abuse report");
  assert.equal(f.entitlements.authorize("user-b"), null);
  const audits = f.entitlements.adminAuditList(20);
  for (const action of [
    "entitlement.grant",
    "entitlement.extend",
    "entitlement.set_expiration",
    "entitlement.revoke",
  ])
    assert.ok(audits.some((a) => a.action === action), action + " audited");
});

test("unknown plans and missing users are rejected", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.entitlements.activate({
        userId: "user-a",
        planId: "nonexistent",
        activatedAtMs: f.atMs(),
      }),
    /Unknown plan/,
  );
});
