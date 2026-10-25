// Subscription gate for the desktop application.
//
// Runs in the Electron main process and is the single arbiter of whether
// protected desktop operations may execute. Access state comes only from
// the server: authoritative entitlement snapshots delivered by
// desktop.login, desktop.heartbeat and desktop.refresh. Local clocks are
// used only as an offline-safety timer, never to decide access.
//
// Promise chain: valid credentials + verified email + active entitlement
// + available desktop session slot => authorized. Anything else maps to
// a distinct locked state the renderer can present:
//   signed_out | takeover_required | subscription_required | offline |
//   expired | revoked | suspended

const HEARTBEAT_MIN_MS = 15000;

function normalizeEntitlement(entitlement, serverTimeMs) {
  if (!entitlement) return null;
  return {
    planId: entitlement.planId,
    activationTimestamp: entitlement.activationTimestamp,
    expirationTimestamp: entitlement.expirationTimestamp,
    subscriptionStatus: entitlement.subscriptionStatus,
    remainingSeconds: entitlement.remainingSeconds,
    serverTimeMs,
  };
}

function gateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createSubscriptionGate({
  cloud,
  clock = Date.now,
  heartbeatSeconds = 60,
  offlineGraceSeconds = 120,
  onState = () => {},
  log = () => {},
}) {
  let timer = null;
  let heartbeating = false;
  let state = {
    phase: "signed_out", // signed_out | active | offline | takeover | subscription_required
    reason: "", // expired | revoked | suspended | offline | network | ""
    session: null,
    entitlement: null,
    serverTimeMs: 0,
    lastVerifiedAtMs: 0,
    user: null,
    purchaseUrl: "",
    takeover: null, // existing active device info awaiting user decision
  };

  function commit(patch = {}) {
    state = { ...state, ...patch };
    try {
      onState(view());
    } catch {}
  }

  // A locally-visible decision for protected dispatches. The golden
  // rule: when the phase is not exactly active, access is denied. The
  // permissive interval is derived from the last authoritative server
  // snapshot plus trusted elapsed time since that snapshot; a device
  // clock change cannot extend it.
  function authorizedNow() {
    if (state.phase !== "active" || !state.entitlement) return false;
    if (clock() - state.lastVerifiedAtMs > offlineGraceSeconds * 1000)
      return false;
    const elapsedSinceServer = clock() - state.entitlement.serverTimeMs;
    return (
      state.entitlement.remainingSeconds * 1000 - elapsedSinceServer > 0
    );
  }

  function view() {
    return {
      phase: state.phase,
      reason: state.reason,
      session: state.session,
      entitlement: state.entitlement,
      user: state.user,
      purchaseUrl: state.purchaseUrl,
      takeover: state.takeover,
      serverUrl: cloud.tokens().serverUrl,
      serverTimeMs: state.serverTimeMs,
      licenseValid: authorizedNow(),
    };
  }

  async function applyHeartbeat(data) {
    // Authoritative "no live coverage" answer: the subscription lapsed
    // or was revoked, but the session itself is still valid. The poll
    // continues so a renewal restores access automatically.
    if (!data.entitlement) {
      commit({
        phase: "subscription_required",
        reason: "expired",
        entitlement: null,
        serverTimeMs: data.serverTimeMs,
        lastVerifiedAtMs: clock(),
        session: data.session || state.session,
      });
      scheduleHeartbeat();
      return view();
    }
    commit({
      phase: "active",
      reason: "",
      entitlement: normalizeEntitlement(data.entitlement, data.serverTimeMs),
      serverTimeMs: data.serverTimeMs,
      lastVerifiedAtMs: clock(),
      session: data.session || state.session,
      purchaseUrl: data.serverUrl
        ? data.serverUrl + "/dashboard"
        : state.purchaseUrl,
    });
    scheduleHeartbeat();
    return view();
  }

  function scheduleHeartbeat() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (state.phase === "active" && authorizedNow()) {
        try {
          await heartbeat();
          return;
        } catch {
          return; // handled inside heartbeat()
        }
      }
      try {
        await validate();
      } catch {}
    }, Math.max(HEARTBEAT_MIN_MS, heartbeatSeconds * 1000));
    timer.unref?.();
  }

  function signOut(reason, detail = {}) {
    cloud.clearDesktopCredentials();
    if (timer) clearTimeout(timer);
    timer = null;
    commit({
      phase: "signed_out",
      reason,
      session: null,
      entitlement: null,
      lastVerifiedAtMs: 0,
      takeover: null,
      ...detail,
    });
  }

  async function validate() {
    // Full server validation pass used after restore, timers, and
    // reconnects. Combines account, session, and entitlement checks.
    if (!cloud.tokens().hasSession) {
      commit({ phase: "signed_out", reason: state.reason || "" });
      return view();
    }
    try {
      const data = await cloud.request("desktop.heartbeat", {});
      return applyHeartbeat(data);
    } catch (error) {
      return handleGateError(error);
    }
  }

  function handleGateError(error) {
    const status = error.status;
    const code = error.code;
    if (status === 401) {
      // The engine distinguishes expiration from rotation reuse; both
      // end in a forced sign-out, but reuse is a security event.
      signOut("revoked");
      if (code === "DESKTOP_SESSION_REUSED") log("desktop-token-reuse-revoked");
      return view();
    }
    if (status === 403 && code === "ACCOUNT_BLOCKED") {
      signOut("suspended");
      return view();
    }
    if (status === 403) {
      commit({ phase: "subscription_required", reason: "expired" });
      return view();
    }
    // Network or server trouble. Within the grace window the last
    // authoritative snapshot remains usable; beyond it, access pauses.
    if (clock() - state.lastVerifiedAtMs > offlineGraceSeconds * 1000)
      commit({ phase: "offline", reason: "network" });
    return view();
  }

  async function heartbeat() {
    if (heartbeating) return view();
    heartbeating = true;
    try {
      if (!cloud.tokens().hasSession) {
        commit({ phase: "signed_out" });
        return view();
      }
      const data = await cloud.request("desktop.heartbeat", {});
      return applyHeartbeat(data);
    } catch (error) {
      if (error.status === 401 && cloud.tokens().refreshToken) {
        // Short-lived access token may have lapsed between heartbeats.
        try {
          const rotated = await cloud.request("desktop.refresh", {
            refreshToken: cloud.tokens().refreshToken,
          });
          await applyHeartbeat(rotated);
          const data = await cloud.request("desktop.heartbeat", {});
          return applyHeartbeat(data);
        } catch (refreshError) {
          return handleGateError(refreshError);
        }
      }
      return handleGateError(error);
    } finally {
      heartbeating = false;
    }
  }

  async function login({ email, password, deviceLabel, os, appVersion, takeover }) {
    commit({ phase: "signed_out", reason: "" });
    try {
      const data = await cloud.request("desktop.login", {
        email,
        password,
        deviceLabel,
        os,
        appVersion,
        ...(takeover !== undefined ? { takeover } : {}),
      });
      if (data.mfaRequired) {
        commit({ phase: "signed_out", takeover: null });
        return { mfaRequired: true, challenge: data.challenge };
      }
      return startFromLogin(data);
    } catch (error) {
      if (error.status === 409 && error.code === "TAKEOVER_REQUIRED") {
        commit({ phase: "takeover", takeover: error.existing || error.current });
        return {
          takeoverRequired: true,
          existing: error.existing || error.current,
        };
      }
      if (error.status === 403 && error.code === "SUBSCRIPTION_REQUIRED") {
        commit({
          phase: "subscription_required",
          reason: "missing",
          purchaseUrl: error.purchaseUrl || state.purchaseUrl,
        });
        return { subscriptionRequired: true, purchaseUrl: state.purchaseUrl };
      }
      throw error;
    }
  }

  async function startFromLogin(data) {
    commit({
      phase: "active",
      reason: "",
      user: data.user,
      session: data.session,
      entitlement: normalizeEntitlement(data.entitlement, data.serverTimeMs),
      serverTimeMs: data.serverTimeMs,
      lastVerifiedAtMs: clock(),
      purchaseUrl: data.serverUrl ? data.serverUrl + "/dashboard" : state.purchaseUrl,
      takeover: null,
    });
    scheduleHeartbeat();
    return {
      session: data.session,
      entitlement: state.entitlement,
      user: data.user,
      serverUrl: data.serverUrl,
    };
  }

  async function completeMfa({ challenge, code, takeover }) {
    try {
      const data = await cloud.request("desktop.mfa", {
        challenge,
        code,
        ...(takeover !== undefined ? { takeover } : {}),
      });
      return startFromLogin(data);
    } catch (error) {
      if (error.status === 409 && error.code === "TAKEOVER_REQUIRED") {
        commit({ phase: "takeover", takeover: error.existing || error.current });
        return { takeoverRequired: true, existing: error.existing || error.current };
      }
      if (error.status === 403 && error.code === "SUBSCRIPTION_REQUIRED") {
        commit({
          phase: "subscription_required",
          reason: "missing",
          purchaseUrl: error.purchaseUrl || state.purchaseUrl,
        });
        return { subscriptionRequired: true, purchaseUrl: state.purchaseUrl };
      }
      throw error;
    }
  }

  async function logout() {
    try {
      await cloud.request("desktop.logout", {});
    } catch {}
    signOut("logout");
    return { ok: true };
  }

  function start() {
    // Restore a persisted session on boot: server decides everything.
    validate()
      .then((view) => {
        if (view.phase === "active") scheduleHeartbeat();
      })
      .catch(() => {});
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return {
    login,
    completeMfa,
    logout,
    validate,
    heartbeat,
    start,
    stop,
    view: () => view(),
    authorizedNow,
    // Protected ops dispatch call. Throws with a code the renderer can
    // translate into a clear user-facing state.
    assertAccess() {
      if (authorizedNow()) return;
      // A rejected sign-in attempt or lapsed subscription is reported
      // before the generic signed-out code so the renderer can route to
      // purchase, takeover, and recovery flows.
      if (state.phase === "subscription_required")
        throw gateError(
          "GATE_SUBSCRIPTION_REQUIRED",
          "No active subscription. Purchase or renew a plan on the website.",
        );
      if (state.phase === "takeover")
        throw gateError(
          "GATE_TAKEOVER_REQUIRED",
          "Another desktop device holds the active session.",
        );
      if (state.phase === "signed_out" || !cloud.tokens().hasSession)
        throw gateError("GATE_SIGNED_OUT", "Sign in to continue.");
      // Coverage that lapsed between server verifications reads as an
      // expired subscription, not as a generic sign-out.
      const lapsed =
        state.entitlement &&
        state.entitlement.remainingSeconds * 1000 -
          (clock() - state.entitlement.serverTimeMs) <=
          0;
      if (state.reason === "expired" || lapsed)
        throw gateError(
          "GATE_SUBSCRIPTION_REQUIRED",
          "No active subscription. Purchase or renew a plan on the website.",
        );
      if (state.phase === "offline")
        throw gateError(
          "GATE_OFFLINE",
          "Cannot reach the subscription server. Protected access is paused until the connection recovers.",
        );
      throw gateError("GATE_REQUIRES_SIGNIN", "Sign in to continue.");
    },
  };
}

module.exports = { createSubscriptionGate };
