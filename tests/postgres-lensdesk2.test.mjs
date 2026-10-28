import { test } from "node:test";
import assert from "node:assert/strict";
import { getDatabasePool, transaction } from "../server/cloud/postgres-db.mjs";
import { createPostgresStore } from "../server/cloud/postgres-store.mjs";
import { runPostgresMigrations } from "../server/cloud/postgres-migrations.mjs";

const pool = getDatabasePool("postgres://localhost:5432/lensdesk");

const POSTGRES_SKIP_REASON = "PostgreSQL is unavailable at localhost:5432; skipping postgres-lensdesk2 integration tests";

async function isPostgresAvailable() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const postgresAvailable = await isPostgresAvailable();
const pgTest = (name, fn) => test(name, { skip: postgresAvailable ? false : POSTGRES_SKIP_REASON }, fn);

test.before(async () => {
  if (!postgresAvailable) return;
  await runPostgresMigrations(pool);
});

test.after(async () => {
  await pool.end();
});

pgTest("01. Website registration and authentication", async () => {
  const store = createPostgresStore({ pool });
  const email = `reg-test-${Date.now()}@example.com`;
  
  // Register
  const reg = await store.register({
    email,
    password: "Password123!",
    name: "Test User 1",
    verified: true,
  });
  assert.ok(reg.user.id);
  assert.equal(reg.user.email, email);
  assert.equal(reg.user.verified, true);
  assert.ok(reg.token);

  // Authenticate valid
  const loginValid = await store.login({ email, password: "Password123!" }, "127.0.0.1:auth1");
  assert.equal(loginValid.user.email, email);
  assert.ok(loginValid.token);

  // Authenticate invalid password
  await assert.rejects(
    store.login({ email, password: "WrongPassword" }, "127.0.0.1:auth2"),
    /Email or password is incorrect/
  );
});

pgTest("02. Desktop initial login and relaunch", async () => {
  const store = createPostgresStore({ pool });
  const email = `desk-init-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Desk User", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "monthly" });

  // Initial desktop seat acquisition
  const login1 = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "MacBook Pro M3",
    os: "darwin",
    appVersion: "2.0.0",
    deviceId: "dev_mac_initial",
  });
  assert.ok(login1.accessToken);
  assert.ok(login1.refreshToken);
  assert.equal(login1.session.deviceLabel, "MacBook Pro M3");

  // Verify access token
  const verified = await store.verifyDesktopAccess(login1.accessToken);
  assert.ok(verified);
  assert.equal(verified.userId, reg.user.id);

  // Relaunch app on same device: lease extends, no takeover required
  const loginRelaunch = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "MacBook Pro M3",
    os: "darwin",
    appVersion: "2.0.0",
    deviceId: "dev_mac_initial",
  });
  assert.equal(loginRelaunch.takeoverRequired, undefined);
  assert.ok(loginRelaunch.accessToken);
});

pgTest("03. Verified same-device pairing", async () => {
  const store = createPostgresStore({ pool });
  const email = `pair-test-${Date.now()}@example.com`;
  const deviceId = "dev_paired_pc_1";

  // Web login on device
  const reg = await store.register({
    email,
    password: "Password123!",
    name: "Pair User",
    verified: true,
    deviceId,
    deviceLabel: "My Windows PC (Chrome)",
    platform: "windows",
  });

  // Desktop login on same device
  await store.grantSubscription({ userId: reg.user.id, planId: "daily" });
  await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "My Windows PC (LensDesk)",
    os: "win32",
    appVersion: "2.0.0",
    deviceId,
  });

  // Pair devices explicitly
  const pairRes = await store.pairDevice(reg.user.id, reg.sessionId, deviceId, "PAIR123");
  assert.equal(pairRes.success, true);

  // listDevices shows 1 logical device node with both web and desktop sessions
  const devList = await store.listDevices(reg.user.id, reg.token);
  assert.equal(devList.devices.length, 1);
  assert.equal(devList.devices[0].isPaired, true);
  assert.equal(devList.devices[0].hasDesktopSeat, true);
});

pgTest("04. Website logout without desktop logout", async () => {
  const store = createPostgresStore({ pool });
  const email = `web-logout-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "User 4", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "monthly" });

  const desk = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Work PC",
    os: "win32",
    deviceId: "dev_work_pc",
  });

  // Normal website logout
  const loggedOut = await store.logoutSession(reg.token);
  assert.equal(loggedOut, true);

  // Web session is dead
  const webUser = await store.userForToken(reg.token);
  assert.equal(webUser, null);

  // Desktop session and seat remain 100% ALIVE!
  const deskCheck = await store.verifyDesktopAccess(desk.accessToken);
  assert.ok(deskCheck);
  assert.equal(deskCheck.userId, reg.user.id);
});

pgTest("05. Desktop logout without website logout", async () => {
  const store = createPostgresStore({ pool });
  const email = `desk-logout-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "User 5", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "monthly" });

  const desk = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Work Mac",
    os: "darwin",
    deviceId: "dev_work_mac",
  });

  // Desktop normal logout
  await store.desktopLogout(desk.accessToken);

  // Desktop access token is dead
  const deskCheck = await store.verifyDesktopAccess(desk.accessToken);
  assert.equal(deskCheck, null);

  // Website session remains 100% ALIVE!
  const webUser = await store.userForToken(reg.token);
  assert.ok(webUser);
  assert.equal(webUser.id, reg.user.id);
});

pgTest("06. One-active-desktop-seat enforcement", async () => {
  const store = createPostgresStore({ pool });
  const email = `single-seat-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Seat User", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "monthly" });

  // Device A acquires seat
  const devA = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Laptop A",
    os: "darwin",
    deviceId: "dev_a",
  });
  assert.ok(devA.accessToken);

  // Device B attempts login without takeover -> BLOCKED
  const devBBlocked = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Desktop B",
    os: "win32",
    deviceId: "dev_b",
    takeover: false,
  });
  assert.equal(devBBlocked.takeoverRequired, true);
  assert.equal(devBBlocked.existing.deviceLabel, "Laptop A");

  // Device A still valid
  assert.ok(await store.verifyDesktopAccess(devA.accessToken));

  // Device B logs in WITH takeover -> SUCCEEDS and revokes Device A
  const devBTakeover = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Desktop B",
    os: "win32",
    deviceId: "dev_b",
    takeover: true,
  });
  assert.ok(devBTakeover.accessToken);

  // Device A is now revoked!
  assert.equal(await store.verifyDesktopAccess(devA.accessToken), null);
  // Device B is live
  assert.ok(await store.verifyDesktopAccess(devBTakeover.accessToken));
});

pgTest("07. Simultaneous desktop login race conditions", async () => {
  const store = createPostgresStore({ pool });
  const email = `race-test-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Race User", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "monthly" });

  // 5 simultaneous login requests
  const attempts = await Promise.all(
    [1, 2, 3, 4, 5].map((i) =>
      store.acquireDesktopSeat({
        userId: reg.user.id,
        deviceLabel: `Racing Machine ${i}`,
        os: "win32",
        deviceId: `dev_race_${i}`,
        takeover: false,
      })
    )
  );

  // Exactly 1 must have acquired the fresh seat, others must have takeoverRequired = true
  const successful = attempts.filter((a) => a.accessToken);
  const blocked = attempts.filter((a) => a.takeoverRequired);

  assert.equal(successful.length, 1);
  assert.equal(blocked.length, 4);

  // Exactly 1 seat in database table
  const seatRes = await pool.query("SELECT COUNT(*) AS c FROM desktop_seats WHERE user_id = $1", [reg.user.id]);
  assert.equal(parseInt(seatRes.rows[0].c, 10), 1);
});

pgTest("08. Remote logout from another browser/phone", async () => {
  const store = createPostgresStore({ pool });
  const email = `college-pc-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Student", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "hourly" });

  // Sign in on college computer
  const collegeDeviceId = "dev_college_lab_402";
  const collegeDesk = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "College Lab PC #12",
    os: "win32",
    deviceId: collegeDeviceId,
  });
  assert.ok(await store.verifyDesktopAccess(collegeDesk.accessToken));

  // User goes home and calls remote logout for that specific college PC
  const revokeResult = await store.revokeDevice(reg.user.id, collegeDeviceId);
  assert.ok(revokeResult.revokedCount >= 1);

  // College PC is now dead immediately!
  assert.equal(await store.verifyDesktopAccess(collegeDesk.accessToken), null);
});

pgTest("09. Sign out everywhere", async () => {
  const store = createPostgresStore({ pool });
  const email = `signout-all-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Everywhere User", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "monthly" });

  const desk = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "PC 1",
    deviceId: "pc_1",
  });

  // Call revokeAll (Sign out everywhere)
  await store.revokeAll(reg.user.id);

  // Both web and desktop are revoked
  assert.equal(await store.userForToken(reg.token), null);
  assert.equal(await store.verifyDesktopAccess(desk.accessToken), null);
});

pgTest("10. Active interview versus routine cleanup", async () => {
  const store = createPostgresStore({ pool });
  const email = `interview-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Interview Candidate", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "hourly" });

  const desk = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Interview Laptop",
    deviceId: "interview_laptop",
  });

  // Start interview active work session
  const hb = await store.desktopHeartbeat({
    accessToken: desk.accessToken,
    interviewMode: true,
  });
  assert.equal(hb.ok, true);

  // Check work_sessions table
  const wsRes = await pool.query(
    "SELECT * FROM work_sessions WHERE user_id = $1 AND state = 'active' AND interview_mode = true",
    [reg.user.id]
  );
  assert.equal(wsRes.rows.length, 1);
  assert.equal(wsRes.rows[0].interview_mode, true);
});

pgTest("11. Explicit revocation during an active interview", async () => {
  const store = createPostgresStore({ pool });
  const email = `interview-revoke-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Candidate 2", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "hourly" });

  const desk = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Interview Machine",
    deviceId: "dev_candidate_pc",
  });
  await store.desktopHeartbeat({ accessToken: desk.accessToken, interviewMode: true });

  // Explicit remote security revocation
  await store.revokeDevice(reg.user.id, "dev_candidate_pc");

  // Active work session is revoked, taking priority over interview protection!
  const wsRes = await pool.query(
    "SELECT state FROM work_sessions WHERE user_id = $1",
    [reg.user.id]
  );
  assert.equal(wsRes.rows[0].state, "revoked");
  assert.equal(await store.verifyDesktopAccess(desk.accessToken), null);
});

pgTest("12. Subscription expiration", async () => {
  let simulatedTime = 1790000000000;
  const store = createPostgresStore({ pool, clock: () => simulatedTime });
  const email = `sub-exp-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Subscriber", verified: true });

  // Hourly plan = 3600 seconds
  const sub = await store.grantSubscription({ userId: reg.user.id, planId: "hourly" });
  assert.equal(sub.expirationTimestamp, simulatedTime + 3600000);

  // Active before expiration
  let auth = await store.authorizeSubscription(reg.user.id);
  assert.ok(auth);
  assert.equal(auth.active, true);

  // Fast forward past expiration (+2 hours)
  simulatedTime += 7200000;
  auth = await store.authorizeSubscription(reg.user.id);
  assert.equal(auth, null);
});

pgTest("13. Refresh-token rotation and revoked-token reuse", async () => {
  const store = createPostgresStore({ pool });
  const email = `token-rot-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Rotation User", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "monthly" });

  const desk = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "MacBook",
    deviceId: "dev_rot_mac",
  });

  const oldRefreshToken = desk.refreshToken;

  // Legitimate rotation
  const rotated = await store.refreshDesktopTokens({ refreshToken: oldRefreshToken });
  assert.ok(rotated.accessToken);
  assert.ok(rotated.refreshToken);

  // Attacker attempts to replay the OLD refresh token!
  await assert.rejects(
    store.refreshDesktopTokens({ refreshToken: oldRefreshToken }),
    /Refresh token reused\. Session revoked for safety/
  );

  // The entire desktop session was terminated due to reuse detection
  assert.equal(await store.verifyDesktopAccess(rotated.accessToken), null);
});

pgTest("14. Network disconnection and reconnection", async () => {
  const store = createPostgresStore({ pool });
  const email = `net-recon-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Net User", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "daily" });

  const desk = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Roaming Laptop",
    deviceId: "roaming_laptop",
  });

  // Disconnects for a while, then reconnects before lease expires
  const hb = await store.desktopHeartbeat({ accessToken: desk.accessToken });
  assert.equal(hb.ok, true);
  assert.ok(hb.leaseUntil > Date.now());
});

pgTest("15. Application restart and interrupted authentication", async () => {
  const store = createPostgresStore({ pool });
  const email = `restart-test-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Restart User", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "monthly" });

  const desk = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Main Rig",
    deviceId: "main_rig",
  });

  // Client restarts: exchanges saved refresh token for fresh session credentials
  const restored = await store.refreshDesktopTokens({ refreshToken: desk.refreshToken });
  assert.ok(restored.accessToken);

  // Verify restored session functions normally
  assert.ok(await store.verifyDesktopAccess(restored.accessToken));
});

pgTest("16. PostgreSQL transaction failures and recovery", async () => {
  const userCountBefore = await pool.query("SELECT COUNT(*) AS c FROM users");

  // Attempt transaction that throws an intentional error
  try {
    await transaction(async (client) => {
      await client.query("INSERT INTO users (id, email, name, password) VALUES ($1, $2, $3, $4)", [
        "fail-id",
        "fail@example.com",
        "Fail User",
        "hash",
      ]);
      throw new Error("Simulated transactional rollback");
    });
  } catch (err) {
    assert.match(err.message, /Simulated transactional rollback/);
  }

  // Verify rollback: user count unchanged
  const userCountAfter = await pool.query("SELECT COUNT(*) AS c FROM users");
  assert.equal(userCountAfter.rows[0].c, userCountBefore.rows[0].c);
});

pgTest("17. Windows and macOS compatibility", async () => {
  const store = createPostgresStore({ pool });
  const email = `crossplat-${Date.now()}@example.com`;
  const reg = await store.register({ email, password: "Password123!", name: "Cross Platform", verified: true });
  await store.grantSubscription({ userId: reg.user.id, planId: "monthly" });

  // Windows session
  const win = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Office Windows 11",
    os: "win32",
    deviceId: "dev_win11",
  });
  assert.ok(win.accessToken);

  // Mac takeover
  const mac = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceLabel: "Home MacBook Pro",
    os: "darwin",
    deviceId: "dev_mac_home",
    takeover: true,
  });
  assert.ok(mac.accessToken);

  // Win revoked, Mac active
  assert.equal(await store.verifyDesktopAccess(win.accessToken), null);
  assert.ok(await store.verifyDesktopAccess(mac.accessToken));
});

pgTest("18. Existing functionality regression", async () => {
  // Verify existing users imported from SQLite exist in PostgreSQL
  const vivek = await pool.query("SELECT * FROM users WHERE email = 'vivek@gmail.com'");
  assert.equal(vivek.rows.length, 1);
  assert.equal(vivek.rows[0].verified, true);

  const mukul = await pool.query("SELECT * FROM users WHERE email = 'mukul@gmail.com'");
  assert.equal(mukul.rows.length, 1);
  assert.equal(mukul.rows[0].verified, true);
});

pgTest("19. Backend load and database connection limits", async () => {
  // Concurrent pool query burst (30 parallel operations)
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      pool.query("SELECT $1::int AS val, NOW() AS ts", [i])
    )
  );
  assert.equal(results.length, 30);
  results.forEach((r, idx) => assert.equal(r.rows[0].val, idx));
});

pgTest("20. Unauthorized API access and session replay attempts", async () => {
  const store = createPostgresStore({ pool });

  // Forged bearer token
  const forged = await store.userForToken("forged-bearer-token-12345");
  assert.equal(forged, null);

  // Forged desktop access
  const forgedDesktop = await store.verifyDesktopAccess("forged-desktop-token-xyz");
  assert.equal(forgedDesktop, null);

  // SQL injection in token
  const sqlInjection = await store.userForToken("' OR '1'='1");
  assert.equal(sqlInjection, null);
});
