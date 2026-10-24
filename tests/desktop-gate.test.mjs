import { test } from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionGate } from "../desktop/subscription.cjs";

// A stand-in for desktop/cloud.cjs: scripted cloud answers plus the same
// token-persistence rules the real client applies for desktop actions.
function fixture({ clockStart = 1770000000000 } = {}) {
  let nowMs = clockStart;
  let tokens = {
    hasSession: false,
    token: "",
    refreshToken: "",
    desktopSessionId: "",
    tokenIssuedAt: 0,
    serverUrl: "https://srv.test",
  };
  const queue = [];
  const states = [];
  const cleared = [];// market: number of clearDesktopCredentials calls

  const httpError = (status, code, message, extra = {}) => {
    const error = new Error(message || "Cloud request failed.");
    error.status = status;
    error.code = code;
    Object.assign(error, extra);
    return error;
  };

  const gate = createSubscriptionGate({
    cloud: {
      tokens: () => ({ ...tokens }),
      clearDesktopCredentials: () => {
        cleared.push(clockStart);
        tokens = {
          hasSession: false,
          token: "",
          refreshToken: "",
          desktopSessionId: "",
          tokenIssuedAt: 0,
          serverUrl: tokens.serverUrl,
        };
      },
      replaceTokens: (patch) => {
        tokens = { ...tokens, ...patch, hasSession: Boolean(patch.token && patch.refreshToken) };
      },
      async request(action, payload) {
        const next = queue.shift();
        assert.ok(next, `unexpected cloud request: ${action}`);
        const result = await next(action, payload, tokens);
        // Mirror the real client: rotate-in persisted credentials.
        if (
          result &&
          typeof result === "object" &&
          result.accessToken &&
          ["desktop.login", "desktop.mfa", "desktop.refresh"].includes(action)
        ) {
          tokens = {
            ...tokens,
            hasSession: true,
            token: result.accessToken,
            refreshToken: result.refreshToken,
            desktopSessionId: result.session?.id || tokens.desktopSessionId,
            tokenIssuedAt: nowMs,
          };
        }
        return result;
      },
    },
    clock: () => nowMs,
    heartbeatSeconds: 3600, // timers must not fire in unit tests
    onState: (view) => states.push(view),
  });

  const loginData = (overrides = {}) => ({
    user: { id: "u1", email: "person@example.com", name: "Test" },
    session: { id: "s1", deviceLabel: "Mac", os: "darwin" },
    accessToken: "acc-1",
    refreshToken: "ref-1",
    serverUrl: "https://srv.test",
    serverTimeMs: nowMs,
    entitlement: {
      planId: "daily",
      activationTimestamp: nowMs,
      expirationTimestamp: nowMs + 86400000,
      subscriptionStatus: "active",
      remainingSeconds: 86400,
    },
    ...overrides,
  });

  return {
    gate,
    states,
    clearedCount: () => cleared.length,
    setClock: (ms) => (nowMs = ms),
    advance(ms) {
      nowMs += ms;
    },
    nowMs: () => nowMs,
    script: (step) => queue.push(step),
    httpError,
    loginData,
    tokens: () => ({ ...tokens }),
  };
}

test("successful login activates the gate and protects guarded calls", async (t) => {
  const f = fixture();
  const data = f.loginData();
  f.script(() => data);
  const view = await f.gate.login({
    email: "person@example.com",
    password: "pw",
    deviceLabel: "Mac",
  });
  assert.equal(view.session.id, "s1");
  assert.equal(f.gate.view().phase, "active");
  assert.equal(f.gate.view().entitlement.planId, "daily");
  assert.equal(f.tokens().token, "acc-1");
  assert.ok(f.gate.authorizedNow());
  assert.doesNotThrow(() => f.gate.assertAccess());
  f.gate.stop();
});

test("login without a subscription lands in the purchase state", async (t) => {
  const f = fixture();
  f.script((action) => {
    assert.equal(action, "desktop.login");
    throw f.httpError(403, "SUBSCRIPTION_REQUIRED", "No active subscription.", {
      purchaseUrl: "https://srv.test/dashboard",
    });
  });
  const result = await f.gate.login({
    email: "person@example.com",
    password: "pw",
  });
  assert.equal(result.subscriptionRequired, true);
  assert.equal(result.purchaseUrl, "https://srv.test/dashboard");
  assert.equal(f.gate.view().phase, "subscription_required");
  assert.throws(() => f.gate.assertAccess(), /No active subscription/);
  f.gate.stop();
});

test("a takeover conflict surfaces the other device and blocks until resolved", async (t) => {
  const f = fixture();
  f.script(() => {
    throw f.httpError(409, "TAKEOVER_REQUIRED", "In use elsewhere.", {
      existing: { deviceLabel: "Work PC", os: "win32", leaseLive: true },
    });
  });
  const result = await f.gate.login({
    email: "person@example.com",
    password: "pw",
  });
  assert.equal(result.takeoverRequired, true);
  assert.equal(result.existing.deviceLabel, "Work PC");
  assert.equal(f.gate.view().phase, "takeover");
  assert.equal(f.gate.view().takeover.deviceLabel, "Work PC");
  assert.throws(
    () => f.gate.assertAccess(),
    (error) => error.code === "GATE_TAKEOVER_REQUIRED",
  );
  // The user confirms takeover; the second answer proceeds.
  f.script(() => f.loginData());
  const active = await f.gate.login({
    email: "person@example.com",
    password: "pw",
    takeover: true,
  });
  assert.equal(active.session.id, "s1");
  assert.equal(f.gate.view().phase, "active");
  f.gate.stop();
});

test("MFA-protected accounts complete the challenge before activation", async (t) => {
  const f = fixture();
  f.script(() => ({ mfaRequired: true, challenge: "challenge-token-123456" }));
  const challenge = await f.gate.login({
    email: "person@example.com",
    password: "pw",
  });
  assert.equal(challenge.mfaRequired, true);
  assert.equal(f.gate.view().phase, "signed_out", "no tokens consumed yet");
  assert.equal(f.tokens().hasSession, false);
  f.script(() => f.loginData());
  const view = await f.gate.completeMfa({ challenge: "challenge-token-123456", code: "123456" });
  assert.equal(view.session.id, "s1");
  assert.equal(f.tokens().token, "acc-1");
  f.gate.stop();
});

test("heartbeats refresh the authoritative snapshot, expirations lock out", async (t) => {
  const f = fixture();
  f.script(() => f.loginData());
  await f.gate.login({ email: "person@example.com", password: "pw" });

  // One hour later the heartbeat reports a live snapshot.
  f.advance(3600 * 1000);
  f.script(() =>
    f.loginData({
      serverTimeMs: f.nowMs(),
      entitlement: {
        planId: "daily",
        activationTimestamp: f.nowMs() - 3600 * 1000,
        expirationTimestamp: f.nowMs() + 23 * 3600 * 1000,
        subscriptionStatus: "active",
        remainingSeconds: 23 * 3600,
      },
    }),
  );
  const beat = await f.gate.heartbeat();
  assert.equal(beat.phase, "active");
  assert.equal(beat.entitlement.remainingSeconds, 23 * 3600);

  // The paid window passes: authorization stops immediately, and the
  // next server confirmation flips the phase to the renewal screen.
  f.advance(24 * 3600 * 1000);
  assert.equal(f.gate.authorizedNow(), false);
  assert.throws(
    () => f.gate.assertAccess(),
    (error) => error.code === "GATE_SUBSCRIPTION_REQUIRED",
  );
  f.script(() => f.loginData({ entitlement: null, serverTimeMs: f.nowMs() }));
  const lapsed = await f.gate.heartbeat();
  assert.equal(lapsed.phase, "subscription_required");
  assert.equal(lapsed.reason, "expired");
  assert.throws(() => f.gate.assertAccess(), /No active subscription/);
  f.gate.stop();
});

test("an expired access token rotates via the refresh flow, not a sign-out", async (t) => {
  const f = fixture();
  f.script(() => f.loginData());
  await f.gate.login({ email: "person@example.com", password: "pw" });
  assert.equal(f.tokens().token, "acc-1");

  f.advance(20 * 60 * 1000); // past the 15-minute access token TTL
  f.script((action) => {
    assert.equal(action, "desktop.heartbeat");
    throw f.httpError(401, "DESKTOP_SESSION_REVOKED", "Token expired.");
  });
  f.script((action, payload) => {
    assert.equal(action, "desktop.refresh");
    assert.equal(payload.refreshToken, "ref-1");
    return f.loginData({ accessToken: "acc-2", refreshToken: "ref-2", serverTimeMs: f.nowMs() });
  });
  f.script((action) => {
    assert.equal(action, "desktop.heartbeat");
    return f.loginData({ accessToken: "acc-2", serverTimeMs: f.nowMs() });
  });
  const after = await f.gate.heartbeat();
  assert.equal(after.phase, "active");
  assert.equal(f.tokens().token, "acc-2");
  assert.equal(f.tokens().refreshToken, "ref-2");
  f.gate.stop();
});

test("reused refresh tokens revoke the whole session", async (t) => {
  const f = fixture();
  f.script(() => f.loginData());
  await f.gate.login({ email: "person@example.com", password: "pw" });
  assert.equal(f.tokens().hasSession, true);

  f.script((action) => {
    assert.equal(action, "desktop.heartbeat");
    throw f.httpError(401, "DESKTOP_SESSION_REVOKED", "Token expired.");
  });
  f.script(() => {
    throw f.httpError(
      401,
      "DESKTOP_SESSION_REUSED",
      "Your desktop session was revoked. Sign in again to continue.",
    );
  });
  const view = await f.gate.heartbeat();
  assert.equal(view.phase, "signed_out");
  assert.equal(view.reason, "revoked");
  assert.equal(f.tokens().hasSession, false);
  assert.equal(f.clearedCount(), 1);
  assert.throws(
    () => f.gate.assertAccess(),
    (error) => error.code === "GATE_SIGNED_OUT",
  );
  f.gate.stop();
});

test("server connectivity is granted a grace window, then pauses access", async (t) => {
  const f = fixture();
  f.script(() => f.loginData());
  await f.gate.login({ email: "person@example.com", password: "pw" });

  // Brief outage inside the 120-second grace: still usable.
  f.advance(60 * 1000);
  f.script(() => {
    throw new Error("socket hang up");
  });
  const stuck = await f.gate.heartbeat();
  assert.equal(stuck.phase, "active");
  assert.ok(f.gate.authorizedNow());
  assert.doesNotThrow(() => f.gate.assertAccess());

  // The outage persists past the grace window: access pauses.
  f.advance(120 * 1000);
  f.script(() => {
    throw new Error("ECONNREFUSED");
  });
  const offline = await f.gate.heartbeat();
  assert.equal(offline.phase, "offline");
  assert.equal(offline.reason, "network");
  assert.equal(f.gate.authorizedNow(), false);
  assert.throws(
    () => f.gate.assertAccess(),
    (error) => error.code === "GATE_OFFLINE",
  );

  // Reconnect validates immediately through the same call path.
  f.script(() => f.loginData({ serverTimeMs: f.nowMs() }));
  const recovered = await f.gate.validate();
  assert.equal(recovered.phase, "active");
  assert.ok(f.gate.authorizedNow());
  f.gate.stop();
});

test("suspension and revocation are distinct forced sign-outs", async (t) => {
  const suspended = fixture();
  suspended.script(() => suspended.loginData());
  await suspended.gate.login({ email: "person@example.com", password: "pw" });
  suspended.script(() => {
    throw suspended.httpError(403, "ACCOUNT_BLOCKED", "This account is suspended.");
  });
  const out = await suspended.gate.heartbeat();
  assert.equal(out.phase, "signed_out");
  assert.equal(out.reason, "suspended");
  assert.equal(suspended.clearedCount(), 1);
  suspended.gate.stop();

  const revoked = fixture();
  revoked.script(() => revoked.loginData());
  await revoked.gate.login({ email: "person@example.com", password: "pw" });
  revoked.script((action) => {
    assert.equal(action, "desktop.heartbeat");
    throw revoked.httpError(401, "DESKTOP_SESSION_REVOKED", "Revoked on the website.");
  });
  revoked.script(() => {
    throw revoked.httpError(
      401,
      "DESKTOP_SESSION_REVOKED",
      "Your desktop session was revoked. Sign in again to continue.",
    );
  });
  const rev = await revoked.gate.heartbeat();
  assert.equal(rev.phase, "signed_out");
  assert.equal(rev.reason, "revoked");
  assert.equal(revoked.clearedCount(), 1);
  revoked.gate.stop();
});

test("logout always returns the device slot and clean signed-out state", async (t) => {
  const f = fixture();
  f.script(() => f.loginData());
  await f.gate.login({ email: "person@example.com", password: "pw" });
  f.script((action) => {
    assert.equal(action, "desktop.logout");
    return { ok: true };
  });
  await f.gate.logout();
  assert.equal(f.gate.view().phase, "signed_out");
  assert.equal(f.tokens().hasSession, false);
  f.gate.stop();
});

test("restore-on-boot validates the persisted session before use", async (t) => {
  // Produce credentials as if restored from the encrypted cloud store.
  const seeded = fixture();
  seeded.script(() => seeded.loginData());
  await seeded.gate.login({ email: "person@example.com", password: "pw" });
  const tokens = seeded.tokens();
  seeded.gate.stop();

  // Boot path 1: the server confirms a live session and entitlement.
  const live = createSubscriptionGate({
    clock: () => live.nowMs,
    cloud: {
      tokens: () => ({ ...tokens, hasSession: true }),
      clearDesktopCredentials: () => {},
      replaceTokens: (patch) => Object.assign(tokens, patch),
      async request(action, payload) {
        assert.equal(action, "desktop.heartbeat");
        return {
          session: { id: "s1", deviceLabel: "Mac", os: "darwin" },
          serverUrl: "https://srv.test",
          serverTimeMs: live.nowMs,
          entitlement: {
            planId: "daily",
            activationTimestamp: live.nowMs - 60000,
            expirationTimestamp: live.nowMs + 86400000,
            subscriptionStatus: "active",
            remainingSeconds: 86400,
          },
        };
      },
    },
    heartbeatSeconds: 3600,
  });
  live.nowMs = 1770000000000 + 60 * 1000;
  live.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(live.view().phase, "active");
  assert.ok(live.authorizedNow());
  live.stop();

  // Boot path 2: the subscription lapsed while the app was closed; the
  // app must still open, but locked on the renewal screen.
  const locked = createSubscriptionGate({
    cloud: {
      tokens: () => ({ ...tokens }),
      clearDesktopCredentials: () => {},
      replaceTokens: () => {},
      async request() {
        const error = new Error("No active subscription.");
        error.status = 403;
        error.code = "SUBSCRIPTION_REQUIRED";
        error.purchaseUrl = "https://srv.test/dashboard";
        throw error;
      },
    },
    heartbeatSeconds: 3600,
  });
  locked.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(locked.view().phase, "subscription_required");
  locked.stop();
});
