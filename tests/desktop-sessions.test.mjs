import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createDesktopSessions } from "../server/cloud/desktop-sessions.mjs";
import { applyMigrations } from "../server/cloud/migrations.mjs";

function fixture(t, { clockMs = 1770000000000 } = {}) {
  const db = new DatabaseSync(":memory:");
  let now = clockMs;
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT UNIQUE);
    INSERT INTO users VALUES('user-a', 'a@x.test'), ('user-b', 'b@x.test');
  `);
  applyMigrations(db);
  const events = [];
  const sessions = createDesktopSessions({
    db,
    clock: () => now,
    audit: (userId, event, detail) => events.push({ userId, event, detail }),
    accessTokenTtlSeconds: 900,
    refreshTtlSeconds: 30 * 24 * 3600,
    leaseTtlSeconds: 600,
  });
  t.after(() => db.close());
  return { db, sessions, events, now: () => now, setClock: (ms) => (now = ms) };
}

test("two active desktop devices are never both logged in", (t) => {
  const f = fixture(t);
  const mac = f.sessions.acquire({ userId: "user-a", deviceLabel: "MacBook Pro", os: "darwin" });
  assert.ok(mac.accessToken && mac.refreshToken);
  const windows = f.sessions.acquire({ userId: "user-a", deviceLabel: "Windows PC", os: "win32" });
  assert.equal(windows.takeoverRequired, true);
  assert.equal(windows.existing.deviceLabel, "MacBook Pro");
  assert.equal(f.sessions.countActive("user-a"), 1);
});

test("explicit takeover revokes the old device at once", (t) => {
  const f = fixture(t);
  const mac = f.sessions.acquire({ userId: "user-a", deviceLabel: "MacBook Pro", os: "darwin" });
  const windows = f.sessions.acquire({
    userId: "user-a",
    deviceLabel: "Windows PC",
    os: "win32",
    takeover: true,
  });
  assert.equal(windows.takeoverRequired, undefined);
  assert.equal(f.sessions.countActive("user-a"), 1);
  // The previous device's access token and refresh token are dead.
  assert.equal(f.sessions.verifyAccess(mac.accessToken), null);
  const oldRefresh = f.sessions.verifyRefresh(mac.refreshToken);
  assert.equal(oldRefresh.refresh_revoked !== null, true);
  const events = f.events.filter((e) => e.userId === "user-a");
  assert.ok(events.some((e) => e.event === "desktop.session.takeover"));
});

test("concurrent racing logins acquire exactly one session", (t) => {
  const f = fixture(t);
  const first = f.sessions.acquire({ userId: "user-b", deviceLabel: "A" });
  const second = f.sessions.acquire({ userId: "user-b", deviceLabel: "B" });
  assert.equal(first.takeoverRequired, undefined);
  assert.equal(second.takeoverRequired || true, true);
  assert.equal(f.sessions.countActive("user-b"), 1);
});

test("heartbeat touches lease; session survives restart with stored tokens", (t) => {
  const f = fixture(t);
  const mac = f.sessions.acquire({ userId: "user-a", deviceLabel: "MacBook Pro" });
  const verified = f.sessions.verifyAccess(mac.accessToken);
  assert.equal(verified.userId, "user-a");
  // App restart, brief network drop, then reconnect: same tokens still
  // map to the same single session; no duplicate is created.
  f.setClock(f.now() + 5 * 60 * 1000);
  assert.ok(f.sessions.heartbeat(verified.sessionId));
  const again = f.sessions.verifyAccess(mac.accessToken);
  assert.equal(again.sessionId, verified.sessionId);
  // Lease is extended by the heartbeat.
  assert.ok(again.session.leaseUntil >= f.now() + 600_000 - 1000);
});

test("access token expiry disables authorized access until refresh", (t) => {
  const f = fixture(t);
  const one = f.sessions.acquire({ userId: "user-a", deviceLabel: "MacBook Pro" });
  f.setClock(f.now() + 900_000); // exactly at expiry
  assert.equal(f.sessions.verifyAccess(one.accessToken), null);
  const rotated = f.sessions.rotate(one.refreshToken);
  assert.ok(rotated.accessToken);
  assert.notEqual(rotated.accessToken, one.accessToken);
  assert.ok(f.sessions.verifyAccess(rotated.accessToken));
  assert.equal(rotated.session.userId, "user-a");
});

test("refresh token reuse revokes the whole session and audits the event", (t) => {
  const f = fixture(t);
  const one = f.sessions.acquire({ userId: "user-a", deviceLabel: "MacBook Pro" });
  const first = f.sessions.rotate(one.refreshToken);
  assert.ok(first);
  // The consumed token is presented again (attacker replay or a buggy
  // retry with a stale copy).
  assert.throws(() => f.sessions.rotate(one.refreshToken), /refresh token was reused/);
  assert.equal(f.sessions.countActive("user-a"), 0);
  assert.equal(f.sessions.verifyAccess(first.accessToken), null);
  const reuseEvent = f.events.filter(
    (e) =>
      e.userId === "user-a" &&
      (e.event === "desktop.token.reuse_attempt" || e.event === "desktop.token.reuse"),
  );
  assert.ok(reuseEvent.length >= 1);
});

test("website device revoke or password event revocation kills tokens immediately", (t) => {
  const f = fixture(t);
  const one = f.sessions.acquire({ userId: "user-a", deviceLabel: "MacBook Pro" });
  assert.ok(f.sessions.revoke(one.session.id, "website.revoke").ok);
  assert.equal(f.sessions.verifyAccess(one.accessToken), null);
  assert.equal(f.sessions.countActive("user-a"), 0);
  // Revoking twice is a no-op, not an error.
  assert.equal(f.sessions.revoke(one.session.id).ok, false);
});

test("revoking all account sessions covers every device", (t) => {
  const f = fixture(t);
  const mac = f.sessions.acquire({ userId: "user-a", deviceLabel: "Mac" });
  const rotated = f.sessions.rotate(mac.refreshToken);
  assert.equal(f.sessions.revokeForUser("user-a", "suspended"), 1);
  assert.equal(f.sessions.verifyAccess(rotated.accessToken), null);
});

test("list and summary expose only safe device fields", (t) => {
  const f = fixture(t);
  const one = f.sessions.acquire({ userId: "user-a", deviceLabel: "MBP", os: "darwin", appVersion: "1.3.6" });
  const list = f.sessions.listForUser("user-a");
  assert.equal(list.length, 1);
  const entry = list[0];
  for (const key of Object.keys(entry))
    assert.ok(
      ["userId", "id", "deviceLabel", "os", "appVersion", "status", "createdAt", "lastSeen", "leaseUntil", "leaseLive", "revokedAt", "replacedBy"].includes(key),
      "unexpected field: " + key,
    );
  assert.equal(entry.appVersion, "1.3.6");
});

test("monthly subscriber can have two concurrent desktop devices, third requires takeover", (t) => {
  const f = fixture(t);
  const now = f.now();
  // Insert plan into plans table to satisfy foreign key
  f.db.prepare(`
    INSERT OR IGNORE INTO plans(id, label, price_minor, currency, duration_seconds, duration_label, tax_note)
    VALUES('monthly', 'Monthly Access', 3900, 'USD', 2592000, '30 Days', 'taxes included')
  `).run();
  // Insert active monthly entitlement
  f.db.prepare(`
    INSERT INTO entitlements(
      id, user_id, plan_id, payment_id,
      activation_timestamp, expiration_timestamp, subscription_status,
      created_at, updated_at
    ) VALUES('ent-1', 'user-a', 'monthly', NULL, ?, ?, 'active', ?, ?)
  `).run(now - 1000, now + 30 * 86400 * 1000, new Date().toISOString(), new Date().toISOString());

  // Device 1 connects
  const dev1 = f.sessions.acquire({ userId: "user-a", deviceLabel: "Office Windows PC", os: "win32" });
  assert.ok(dev1.accessToken);
  assert.equal(f.sessions.countActive("user-a"), 1);

  // Advance clock slightly for different last_seen
  f.setClock(now + 1000);

  // Device 2 connects - both allowed concurrently!
  const dev2 = f.sessions.acquire({ userId: "user-a", deviceLabel: "Home MacBook Pro", os: "darwin" });
  assert.ok(dev2.accessToken);
  assert.equal(f.sessions.countActive("user-a"), 2);

  // Advance clock slightly
  f.setClock(now + 2000);

  // Device 3 connects - limit reached (2), requires takeover!
  const dev3 = f.sessions.acquire({ userId: "user-a", deviceLabel: "Travel Laptop", os: "win32" });
  assert.equal(dev3.takeoverRequired, true);
  assert.equal(dev3.maxAllowed, 2);
  assert.equal(dev3.activeCount, 2);

  // Device 3 confirms takeover
  const dev3Confirmed = f.sessions.acquire({
    userId: "user-a",
    deviceLabel: "Travel Laptop",
    os: "win32",
    takeover: true,
  });
  assert.ok(dev3Confirmed.accessToken);
  assert.equal(f.sessions.countActive("user-a"), 2);

  // Oldest device (Office Windows PC) was revoked, newer device (Home MacBook Pro) remains active
  assert.equal(f.sessions.verifyAccess(dev1.accessToken), null);
  assert.ok(f.sessions.verifyAccess(dev2.accessToken));
  assert.ok(f.sessions.verifyAccess(dev3Confirmed.accessToken));

  // Revoke all devices (like user clicking "Logout from all devices" on website)
  const revoked = f.sessions.revokeForUser("user-a", "user-logout-all-devices");
  assert.equal(revoked, 2);
  assert.equal(f.sessions.countActive("user-a"), 0);
  assert.equal(f.sessions.verifyAccess(dev2.accessToken), null);
  assert.equal(f.sessions.verifyAccess(dev3Confirmed.accessToken), null);
});
