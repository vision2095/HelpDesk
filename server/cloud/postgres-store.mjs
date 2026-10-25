import {
  scrypt as scryptCallback,
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { getDatabasePool, transaction } from "./postgres-db.mjs";

const scrypt = promisify(scryptCallback);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const rawToken = () => randomBytes(32).toString("base64url");

function withCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createPostgresStore({
  pool = getDatabasePool(),
  clock = Date.now,
  plans,
  accessTokenTtlSeconds = 900,
  refreshTtlSeconds = 60 * 60 * 24 * 30,
  leaseTtlSeconds = 600,
} = {}) {
  const nowSec = () => Math.floor(clock() / 1000);
  const nowMs = () => Math.floor(clock());

  async function passwordHash(password) {
    const salt = randomBytes(16).toString("hex");
    const derived = await scrypt(password, salt, 64);
    return salt + ":" + derived.toString("hex");
  }

  async function verifyPassword(password, stored) {
    const [salt, digest] = (
      stored || "00000000000000000000000000000000:" + Buffer.alloc(64).toString("hex")
    ).split(":");
    const attempt = await scrypt(password, salt, 64);
    return timingSafeEqual(Buffer.from(digest, "hex"), attempt);
  }

  const safeUser = (row) =>
    row
      ? {
          id: row.id,
          email: row.email,
          name: row.name,
          verified: Boolean(row.verified),
          createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at?.toISOString?.() || new Date(row.created_at).toISOString(),
          subscriptionStatus: row.subscription_status,
          subscriptionExpires: Number(row.subscription_expires || 0),
        }
      : null;

  async function audit(userId, event, detail = {}) {
    try {
      const d = typeof detail === "string" ? detail : JSON.stringify(detail || {});
      await pool.query(
        "INSERT INTO security_events (id, user_id, event, detail, created_at) VALUES ($1, $2, $3, $4, NOW())",
        [randomUUID(), userId, event, d]
      );
    } catch (err) {
      console.warn("[Audit warning]", err.message);
    }
  }

  // --- DEVICE MANAGEMENT & PAIRING ---
  async function upsertDevice({ userId, deviceId, deviceLabel, platform, fingerprint }) {
    const id = deviceId || "dev_" + randomUUID();
    const label = (deviceLabel || "LensDesk Device").slice(0, 120);
    const plat = (platform || "web").slice(0, 60);

    const res = await pool.query(
      `INSERT INTO devices (id, user_id, device_label, platform, fingerprint, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         device_label = EXCLUDED.device_label,
         platform = EXCLUDED.platform,
         last_seen_at = NOW()
       RETURNING *`,
      [id, userId, label, plat, fingerprint || null]
    );
    return res.rows[0];
  }

  // --- SESSIONS & TOKEN ISSUANCE ---
  async function createSession({
    userId,
    scope = "web_session",
    label = "Unknown session",
    deviceId = null,
    ttl = 60 * 60 * 24 * 30,
    ip = null,
    userAgent = null,
  }) {
    const raw = rawToken();
    const tokenHash = hash(raw);
    const sessionId = randomUUID();
    const now = nowSec();
    const expiresAt = now + ttl;

    await pool.query(
      `INSERT INTO sessions (id, user_id, device_id, token_hash, scope, label, ip, user_agent, created_at, last_seen, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [sessionId, userId, deviceId, tokenHash, scope, label.slice(0, 255), ip, userAgent, now, now, expiresAt]
    );

    return { rawToken: raw, sessionId, expiresAt };
  }

  async function userForToken(raw, expectedScope = null) {
    if (!raw) return null;
    const tokenHash = hash(raw);
    const now = nowSec();

    let queryText = `
      SELECT u.*, s.id AS session_id, s.device_id, s.scope, s.label AS session_label, s.last_seen AS session_last_seen
      FROM users u
      JOIN sessions s ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > $2
        AND s.revoked_at IS NULL
    `;
    const params = [tokenHash, now];
    if (expectedScope) {
      queryText += " AND s.scope = $3";
      params.push(expectedScope);
    }

    const res = await pool.query(queryText, params);
    const row = res.rows[0];
    if (!row) return null;

    // Update last_seen throttled to once every 5 minutes
    if (now - Number(row.session_last_seen || 0) > 300) {
      pool.query("UPDATE sessions SET last_seen = $1 WHERE id = $2", [now, row.session_id]).catch(() => {});
      if (row.device_id) {
        pool.query("UPDATE devices SET last_seen_at = NOW() WHERE id = $1", [row.device_id]).catch(() => {});
      }
    }

    return row;
  }

  async function register({ email, password, name, verified = false, deviceId = null, deviceLabel = null, platform = null }) {
    email = email.toLowerCase();
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      throw new Error("This email is already registered. Sign in or reset your password.");
    }

    const userId = randomUUID();
    const digest = await passwordHash(password);

    await pool.query(
      "INSERT INTO users (id, email, name, password, verified, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
      [userId, email, name, digest, Boolean(verified)]
    );

    let device = null;
    if (deviceId) {
      device = await upsertDevice({ userId, deviceId, deviceLabel, platform });
    }

    const session = await createSession({
      userId,
      scope: "web_session",
      label: deviceLabel || "Web Browser",
      deviceId: device?.id || null,
    });

    const verifyToken = await createSession({
      userId,
      scope: "verify",
      label: "Email Verification",
      ttl: 86400,
    });

    const userRow = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    return {
      user: safeUser(userRow.rows[0]),
      token: session.rawToken,
      sessionId: session.sessionId,
      verificationToken: verifyToken.rawToken,
    };
  }

  async function login({ email, password }, identity, { issueToken = true, clientType = "web", deviceId = null, deviceLabel = null, platform = null } = {}) {
    const now = nowSec();
    // Rate limit check
    const lim = await pool.query("SELECT * FROM login_limits WHERE identity = $1", [identity]);
    const limitRow = lim.rows[0];
    if (limitRow && Number(limitRow.reset) < now) {
      await pool.query("DELETE FROM login_limits WHERE identity = $1", [identity]);
    } else if (limitRow && limitRow.count >= 10) {
      throw new Error("Too many sign-in attempts. Try again in 15 minutes.");
    }

    await pool.query(
      `INSERT INTO login_limits (identity, count, reset) VALUES ($1, 1, $2)
       ON CONFLICT (identity) DO UPDATE SET count = login_limits.count + 1`,
      [identity, now + 900]
    );

    const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    const userRow = userRes.rows[0];
    if (!userRow) {
      throw new Error("Email or password is incorrect.");
    }

    const ok = await verifyPassword(password, userRow.password);
    if (!ok) {
      throw new Error("Email or password is incorrect.");
    }

    if (userRow.account_state === "suspended") {
      const error = new Error("This account is suspended. Contact support for assistance.");
      error.code = "ACCOUNT_BLOCKED";
      throw error;
    }

    await pool.query("DELETE FROM login_limits WHERE identity = $1", [identity]);

    let session = null;
    let device = null;
    if (issueToken) {
      if (deviceId) {
        device = await upsertDevice({ userId: userRow.id, deviceId, deviceLabel, platform });
      }
      session = await createSession({
        userId: userRow.id,
        scope: clientType === "desktop" ? "desktop_runner" : "web_session",
        label: deviceLabel || (clientType === "desktop" ? "LensDesk desktop" : "Web browser"),
        deviceId: device?.id || null,
      });
      await audit(userRow.id, "session.signed_in", { clientType, deviceId });
    }

    return {
      user: safeUser(userRow),
      ...(session ? { token: session.rawToken, sessionId: session.sessionId } : {}),
    };
  }

  // --- SCOPED LOGOUT & DEVICE REVOCATION ---

  // Web normal logout: revokes only current session token. Desktop stays logged in!
  async function logoutSession(raw) {
    if (!raw) return false;
    const tokenHash = hash(raw);
    const now = nowSec();

    const res = await pool.query(
      "UPDATE sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL RETURNING user_id, id, scope, device_id",
      [now, tokenHash]
    );
    const s = res.rows[0];
    if (s) {
      // If this session held a desktop seat, release the seat
      await pool.query("DELETE FROM desktop_seats WHERE session_id = $1", [s.id]);
      await pool.query("UPDATE desktop_tokens SET revoked_at = $1 WHERE session_id = $2 AND revoked_at IS NULL", [now, s.id]);
      await pool.query("UPDATE work_sessions SET state = 'revoked' WHERE session_id = $1", [s.id]);
      await audit(s.user_id, "session.signed_out", { sessionId: s.id, scope: s.scope });
      return true;
    }
    return false;
  }

  // Remote logout specific PC (college computer scenario):
  // Revokes all sessions belonging to the specified deviceId immediately.
  async function revokeDevice(userId, deviceId) {
    const now = nowSec();
    return await transaction(async (client) => {
      // 1. Mark device revoked
      await client.query("UPDATE devices SET revoked_at = NOW() WHERE id = $1 AND user_id = $2", [deviceId, userId]);

      // 2. Find sessions for this device
      const sessions = await client.query(
        "SELECT id FROM sessions WHERE device_id = $1 AND user_id = $2 AND revoked_at IS NULL",
        [deviceId, userId]
      );
      const sessionIds = sessions.rows.map((r) => r.id);

      if (sessionIds.length > 0) {
        // Revoke all sessions
        await client.query("UPDATE sessions SET revoked_at = $1 WHERE id = ANY($2::text[])", [now, sessionIds]);
        // Release desktop seat if held by this device
        await client.query("DELETE FROM desktop_seats WHERE device_id = $1 AND user_id = $2", [deviceId, userId]);
        // Revoke desktop tokens
        await client.query("UPDATE desktop_tokens SET revoked_at = $1 WHERE session_id = ANY($2::text[]) AND revoked_at IS NULL", [now, sessionIds]);
        // Revoke work sessions
        await client.query("UPDATE work_sessions SET state = 'revoked' WHERE session_id = ANY($1::text[])", [sessionIds]);
      }

      await audit(userId, "device.revoked", { deviceId, sessionCount: sessionIds.length });
      return { revokedCount: sessionIds.length };
    });
  }

  // Log out other devices:
  // Revokes other devices. If current device has a paired desktop session, keeps paired desktop session alive!
  async function revokeOtherDevices(userId, currentSessionRaw) {
    const tokenHash = hash(currentSessionRaw);
    const now = nowSec();

    return await transaction(async (client) => {
      const cur = await client.query("SELECT id, device_id FROM sessions WHERE token_hash = $1", [tokenHash]);
      const currentSession = cur.rows[0];
      const currentSessionId = currentSession?.id;
      const currentDeviceId = currentSession?.device_id;

      // Find sessions to revoke:
      // Keep: currentSessionId, AND if currentDeviceId is present, any sessions matching currentDeviceId
      let queryText = "SELECT id, device_id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND id != $2";
      const params = [userId, currentSessionId || "none"];
      if (currentDeviceId) {
        queryText += " AND (device_id IS NULL OR device_id != $3)";
        params.push(currentDeviceId);
      }

      const rows = await client.query(queryText, params);
      const toRevoke = rows.rows.map((r) => r.id);

      if (toRevoke.length > 0) {
        await client.query("UPDATE sessions SET revoked_at = $1 WHERE id = ANY($2::text[])", [now, toRevoke]);
        // Release seats held by revoked sessions
        await client.query("DELETE FROM desktop_seats WHERE session_id = ANY($1::text[])", [toRevoke]);
        await client.query("UPDATE desktop_tokens SET revoked_at = $1 WHERE session_id = ANY($2::text[]) AND revoked_at IS NULL", [now, toRevoke]);
        await client.query("UPDATE work_sessions SET state = 'revoked' WHERE session_id = ANY($1::text[])", [toRevoke]);
      }

      await audit(userId, "sessions.revoked_others", { revokedCount: toRevoke.length });
      return { revokedCount: toRevoke.length };
    });
  }

  // Sign out everywhere:
  // Revokes all web sessions, all desktop sessions, clears desktop seat.
  async function revokeAll(userId) {
    const now = nowSec();
    return await transaction(async (client) => {
      await client.query("UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL", [now, userId]);
      await client.query("DELETE FROM desktop_seats WHERE user_id = $1", [userId]);
      await client.query("UPDATE devices SET revoked_at = NOW() WHERE user_id = $1", [userId]);
      await client.query(
        "UPDATE desktop_tokens SET revoked_at = $1 WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $2) AND revoked_at IS NULL",
        [now, userId]
      );
      await client.query("UPDATE work_sessions SET state = 'revoked' WHERE user_id = $1", [userId]);
      await audit(userId, "account.signed_out_everywhere");
      return true;
    });
  }

  // List all registered devices with their web and desktop sessions
  async function listDevices(userId, currentSessionToken = null) {
    const now = nowSec();
    let currentSessionId = null;
    let currentDeviceId = null;
    if (currentSessionToken) {
      const cur = await pool.query("SELECT id, device_id FROM sessions WHERE token_hash = $1", [hash(currentSessionToken)]);
      currentSessionId = cur.rows[0]?.id;
      currentDeviceId = cur.rows[0]?.device_id;
    }

    const devRes = await pool.query(
      `SELECT d.*,
              COUNT(s.id) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > $2) AS active_session_count
       FROM devices d
       LEFT JOIN sessions s ON d.id = s.device_id
       WHERE d.user_id = $1 AND d.revoked_at IS NULL
       GROUP BY d.id
       ORDER BY d.last_seen_at DESC`,
      [userId, now]
    );

    const activeSeatRes = await pool.query("SELECT * FROM desktop_seats WHERE user_id = $1", [userId]);
    const activeSeat = activeSeatRes.rows[0];

    const sessionsRes = await pool.query(
      `SELECT id, device_id, scope, label, ip, user_agent, created_at, last_seen, expires_at
       FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2
       ORDER BY last_seen DESC`,
      [userId, now]
    );

    const pairingsRes = await pool.query("SELECT * FROM device_pairings WHERE user_id = $1", [userId]);
    const pairingsMap = new Map(pairingsRes.rows.map((p) => [p.device_id, p]));

    const devices = devRes.rows.map((d) => {
      const devSessions = sessionsRes.rows.filter((s) => s.device_id === d.id);
      const isCurrentDevice = Boolean(currentDeviceId && currentDeviceId === d.id);
      const hasActiveDesktop = Boolean(activeSeat && activeSeat.device_id === d.id && activeSeat.lease_until > now);
      const pairing = pairingsMap.get(d.id);

      return {
        id: d.id,
        label: d.device_label,
        platform: d.platform,
        fingerprint: d.fingerprint,
        isCurrent: isCurrentDevice,
        isPaired: Boolean(pairing?.verified),
        hasDesktopSeat: hasActiveDesktop,
        desktopSeat: hasActiveDesktop ? activeSeat : null,
        lastSeenAt: d.last_seen_at,
        createdAt: d.created_at,
        sessions: devSessions.map((s) => ({
          id: s.id,
          scope: s.scope,
          label: s.label,
          ip: s.ip,
          userAgent: s.user_agent,
          isCurrent: s.id === currentSessionId,
          lastSeen: Number(s.last_seen) * 1000,
          createdAt: Number(s.created_at) * 1000,
        })),
      };
    });

    // Also collect unassigned sessions (not tied to a device)
    const unassigned = sessionsRes.rows.filter((s) => !s.device_id).map((s) => ({
      id: s.id,
      scope: s.scope,
      label: s.label,
      ip: s.ip,
      userAgent: s.user_agent,
      isCurrent: s.id === currentSessionId,
      lastSeen: Number(s.last_seen) * 1000,
      createdAt: Number(s.created_at) * 1000,
    }));

    return { devices, unassigned, activeSeat };
  }

  // --- SAME-PC DEVICE PAIRING ---
  async function pairDevice(userId, webSessionId, desktopDeviceId, pairingCode = null) {
    const now = nowSec();
    return await transaction(async (client) => {
      const dev = await client.query("SELECT * FROM devices WHERE id = $1 AND user_id = $2", [desktopDeviceId, userId]);
      if (!dev.rows[0]) {
        await client.query(
          "INSERT INTO devices (id, user_id, device_label, created_at, last_seen_at) VALUES ($1, $2, 'Paired Device', NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id",
          [desktopDeviceId, userId]
        );
      }

      await client.query(
        `INSERT INTO device_pairings (id, user_id, device_id, web_session_id, paired_at, verified, pairing_code)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)
         ON CONFLICT (user_id, device_id) DO UPDATE SET
           web_session_id = EXCLUDED.web_session_id,
           paired_at = EXCLUDED.paired_at,
           verified = TRUE`,
        [randomUUID(), userId, desktopDeviceId, webSessionId, now, pairingCode]
      );

      // Bind web session to this deviceId as well
      await client.query("UPDATE sessions SET device_id = $1 WHERE id = $2", [desktopDeviceId, webSessionId]);
      await audit(userId, "device.paired", { deviceId: desktopDeviceId, webSessionId });
      return { success: true, deviceId: desktopDeviceId };
    });
  }

  // --- SINGLE ACTIVE DESKTOP SEAT ENFORCEMENT ---
  async function acquireDesktopSeat({
    userId,
    deviceLabel = "LensDesk desktop",
    os = "",
    appVersion = "",
    takeover = false,
    deviceId = null,
  }) {
    const now = nowSec();
    const leaseUntil = now + leaseTtlSeconds;

    return await transaction(async (client) => {
      // Advisory transaction lock on user ID ensures serialization across concurrent processes before seat exists:
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);

      // Atomic row-level lock on user's seat: prevents ANY concurrent race condition!
      const seatRes = await client.query(
        "SELECT * FROM desktop_seats WHERE user_id = $1 FOR UPDATE",
        [userId]
      );
      const existing = seatRes.rows[0];

      // If a seat exists and is currently within its live lease
      if (existing && Number(existing.lease_until) > now) {
        // If it's already the same device and same session, simply extend lease
        if (existing.device_id && existing.device_id === deviceId) {
          await client.query(
            "UPDATE desktop_seats SET last_heartbeat = $1, lease_until = $2 WHERE user_id = $3",
            [now, leaseUntil, userId]
          );
          // Return tokens for existing session
          const accessTok = rawToken();
          const refreshTok = rawToken();
          await client.query(
            "INSERT INTO desktop_tokens (id, session_id, token_type, hash, created_at, expires_at) VALUES ($1, $2, 'access', $3, $4, $5)",
            [randomUUID(), existing.session_id, hash(accessTok), now, now + accessTokenTtlSeconds]
          );
          await client.query(
            "INSERT INTO desktop_tokens (id, session_id, token_type, hash, created_at, expires_at) VALUES ($1, $2, 'refresh', $3, $4, $5)",
            [randomUUID(), existing.session_id, hash(refreshTok), now, now + refreshTtlSeconds]
          );
          return {
            session: {
              id: existing.session_id,
              userId,
              deviceLabel: existing.device_label,
              os: existing.os,
              appVersion: existing.app_version,
              leaseLive: true,
              lastSeen: now * 1000,
            },
            accessToken: accessTok,
            refreshToken: refreshTok,
          };
        }

        // If from another computer/device and takeover wasn't requested:
        if (!takeover) {
          return {
            takeoverRequired: true,
            existing: {
              deviceLabel: existing.device_label,
              os: existing.os,
              appVersion: existing.app_version,
              createdAt: Number(existing.acquired_at) * 1000,
              lastSeen: Number(existing.last_heartbeat) * 1000,
              leaseLive: true,
            },
          };
        }

        // Takeover requested: Revoke previous desktop session and its tokens immediately!
        await client.query("UPDATE sessions SET revoked_at = $1 WHERE id = $2", [now, existing.session_id]);
        await client.query("UPDATE desktop_tokens SET revoked_at = $1 WHERE session_id = $2 AND revoked_at IS NULL", [now, existing.session_id]);
        await client.query("UPDATE work_sessions SET state = 'revoked' WHERE session_id = $1", [existing.session_id]);
        await audit(userId, "desktop.takeover", { previousSessionId: existing.session_id, previousDevice: existing.device_label });
      }

      // Upsert device
      let dev = null;
      if (deviceId) {
        dev = await upsertDevice({ userId, deviceId, deviceLabel, platform: os || "desktop" });
      }

      // Create new desktop session
      const newSessionId = randomUUID();
      const sessionHash = hash(rawToken());
      await client.query(
        `INSERT INTO sessions (id, user_id, device_id, token_hash, scope, label, created_at, last_seen, expires_at)
         VALUES ($1, $2, $3, $4, 'desktop_runner', $5, $6, $6, $7)`,
        [newSessionId, userId, dev?.id || null, sessionHash, deviceLabel.slice(0, 255), now, now + (30 * 86400)]
      );

      // Issue access and refresh tokens
      const accessToken = rawToken();
      const refreshToken = rawToken();

      await client.query(
        "INSERT INTO desktop_tokens (id, session_id, token_type, hash, created_at, expires_at) VALUES ($1, $2, 'access', $3, $4, $5)",
        [randomUUID(), newSessionId, hash(accessToken), now, now + accessTokenTtlSeconds]
      );
      await client.query(
        "INSERT INTO desktop_tokens (id, session_id, token_type, hash, created_at, expires_at) VALUES ($1, $2, 'refresh', $3, $4, $5)",
        [randomUUID(), newSessionId, hash(refreshToken), now, now + refreshTtlSeconds]
      );

      // Acquire the single seat in desktop_seats
      await client.query(
        `INSERT INTO desktop_seats (user_id, session_id, device_id, device_label, os, app_version, acquired_at, last_heartbeat, lease_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
         ON CONFLICT (user_id) DO UPDATE SET
           session_id = EXCLUDED.session_id,
           device_id = EXCLUDED.device_id,
           device_label = EXCLUDED.device_label,
           os = EXCLUDED.os,
           app_version = EXCLUDED.app_version,
           acquired_at = EXCLUDED.acquired_at,
           last_heartbeat = EXCLUDED.last_heartbeat,
           lease_until = EXCLUDED.lease_until`,
        [userId, newSessionId, dev?.id || null, deviceLabel, os, appVersion, now, leaseUntil]
      );

      return {
        session: {
          id: newSessionId,
          userId,
          deviceLabel,
          os,
          appVersion,
          leaseLive: true,
          lastSeen: now * 1000,
        },
        accessToken,
        refreshToken,
      };
    });
  }

  // Verify access token presented by desktop
  async function verifyDesktopAccess(tokenStr) {
    if (!tokenStr) return null;
    const tokenHash = hash(tokenStr);
    const now = nowSec();

    const res = await pool.query(
      `SELECT dt.*, s.user_id, s.id AS session_id, s.revoked_at AS session_revoked_at, s.device_id
       FROM desktop_tokens dt
       JOIN sessions s ON dt.session_id = s.id
       WHERE dt.hash = $1
         AND dt.token_type = 'access'
         AND dt.expires_at > $2
         AND dt.revoked_at IS NULL
         AND s.revoked_at IS NULL`,
      [tokenHash, now]
    );

    const row = res.rows[0];
    if (!row) return null;

    // Check if desktop seat is still active for this session
    const seatRes = await pool.query(
      "SELECT * FROM desktop_seats WHERE user_id = $1 AND session_id = $2",
      [row.user_id, row.session_id]
    );
    if (!seatRes.rows[0]) {
      // Seat was revoked or transferred to another device!
      return null;
    }

    return {
      userId: row.user_id,
      sessionId: row.session_id,
      deviceId: row.device_id,
    };
  }

  // Refresh desktop tokens with REUSE DETECTION
  async function refreshDesktopTokens({ refreshToken, deviceLabel = "", os = "", appVersion = "" }) {
    if (!refreshToken) throw withCode("Missing refresh token", "INVALID_TOKEN");
    const tokenHash = hash(refreshToken);
    const now = nowSec();

    // Check if this refresh token was already consumed outside the transaction (Token Reuse Detection!)
    const reuseCheck = await pool.query(
      "SELECT * FROM desktop_tokens WHERE hash = $1 AND consumed_at IS NOT NULL",
      [tokenHash]
    );
    if (reuseCheck.rows[0]) {
      // SECURITY ALERT: Refresh token reused! Revoke the whole session immediately!
      const badSessionId = reuseCheck.rows[0].session_id;
      await pool.query("UPDATE sessions SET revoked_at = $1 WHERE id = $2", [now, badSessionId]);
      await pool.query("UPDATE desktop_tokens SET revoked_at = $1 WHERE session_id = $2", [now, badSessionId]);
      await pool.query("DELETE FROM desktop_seats WHERE session_id = $1", [badSessionId]);
      throw withCode("Security event: Refresh token reused. Session revoked for safety.", "DESKTOP_SESSION_REUSED");
    }

    return await transaction(async (client) => {
      // Find active refresh token
      const tokenRes = await client.query(
        `SELECT dt.*, s.user_id, s.id AS session_id
         FROM desktop_tokens dt
         JOIN sessions s ON dt.session_id = s.id
         WHERE dt.hash = $1
           AND dt.token_type = 'refresh'
           AND dt.expires_at > $2
           AND dt.revoked_at IS NULL
           AND s.revoked_at IS NULL
         FOR UPDATE`,
        [tokenHash, now]
      );

      const activeToken = tokenRes.rows[0];
      if (!activeToken) {
        throw withCode("Refresh token is invalid or expired.", "INVALID_REFRESH_TOKEN");
      }

      const userId = activeToken.user_id;
      const sessionId = activeToken.session_id;

      // Check if user's seat is still valid for this session
      const seat = await client.query(
        "SELECT * FROM desktop_seats WHERE user_id = $1 AND session_id = $2 FOR UPDATE",
        [userId, sessionId]
      );
      if (!seat.rows[0]) {
        throw withCode("Desktop seat was revoked or taken over by another device.", "SEAT_REVOKED");
      }

      // Mark current refresh token as consumed
      await client.query("UPDATE desktop_tokens SET consumed_at = $1 WHERE id = $2", [now, activeToken.id]);

      // Issue new token pair
      const newAccessToken = rawToken();
      const newRefreshToken = rawToken();
      const leaseUntil = now + leaseTtlSeconds;

      await client.query(
        "INSERT INTO desktop_tokens (id, session_id, token_type, hash, created_at, expires_at) VALUES ($1, $2, 'access', $3, $4, $5)",
        [randomUUID(), sessionId, hash(newAccessToken), now, now + accessTokenTtlSeconds]
      );
      await client.query(
        "INSERT INTO desktop_tokens (id, session_id, token_type, hash, previous_hash, created_at, expires_at) VALUES ($1, $2, 'refresh', $3, $4, $5, $6)",
        [randomUUID(), sessionId, hash(newRefreshToken), tokenHash, now, now + refreshTtlSeconds]
      );

      // Extend seat lease
      await client.query(
        "UPDATE desktop_seats SET last_heartbeat = $1, lease_until = $2 WHERE user_id = $3",
        [now, leaseUntil, userId]
      );

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        sessionId,
        serverTimeMs: nowMs(),
      };
    });
  }

  // Desktop heartbeat: extends seat lease and work session lease
  async function desktopHeartbeat({ accessToken, interviewMode = false }) {
    const verified = await verifyDesktopAccess(accessToken);
    if (!verified) {
      throw withCode("Session invalid or revoked.", "UNAUTHORIZED");
    }

    const now = nowSec();
    const leaseUntil = now + leaseTtlSeconds;

    await pool.query(
      "UPDATE desktop_seats SET last_heartbeat = $1, lease_until = $2 WHERE user_id = $3 AND session_id = $4",
      [now, leaseUntil, verified.userId, verified.sessionId]
    );

    // Active work session protection:
    if (interviewMode) {
      await pool.query(
        `INSERT INTO work_sessions (id, user_id, session_id, state, started_at, last_active_at, lease_until, interview_mode)
         VALUES ($1, $2, $3, 'active', $4, $4, $5, TRUE)
         ON CONFLICT (id) DO UPDATE SET
           last_active_at = EXCLUDED.last_active_at,
           lease_until = EXCLUDED.lease_until,
           interview_mode = TRUE`,
        [verified.sessionId, verified.userId, verified.sessionId, now, leaseUntil + 3600]
      );
    }

    return { ok: true, serverTimeMs: nowMs(), leaseUntil: leaseUntil * 1000 };
  }

  // Desktop normal logout
  async function desktopLogout(accessToken) {
    if (!accessToken) return true;
    const verified = await verifyDesktopAccess(accessToken);
    if (!verified) return true;

    const now = nowSec();
    await transaction(async (client) => {
      await client.query("UPDATE sessions SET revoked_at = $1 WHERE id = $2", [now, verified.sessionId]);
      await client.query("UPDATE desktop_tokens SET revoked_at = $1 WHERE session_id = $2 AND revoked_at IS NULL", [now, verified.sessionId]);
      await client.query("DELETE FROM desktop_seats WHERE session_id = $1", [verified.sessionId]);
      await client.query("UPDATE work_sessions SET state = 'revoked' WHERE session_id = $1", [verified.sessionId]);
      await audit(verified.userId, "desktop.logout", { sessionId: verified.sessionId });
    });
    return true;
  }

  // --- ENTITLEMENTS & SUBSCRIPTIONS ---
  async function authorizeSubscription(userId) {
    const now = nowMs();
    // Check active entitlement
    const res = await pool.query(
      `SELECT * FROM entitlements
       WHERE user_id = $1
         AND subscription_status = 'active'
         AND expiration_timestamp > $2
       ORDER BY expiration_timestamp DESC
       LIMIT 1`,
      [userId, now]
    );

    const active = res.rows[0];
    if (!active) {
      // Mark any expired entitlements as 'expired'
      pool.query(
        "UPDATE entitlements SET subscription_status = 'expired' WHERE user_id = $1 AND subscription_status = 'active' AND expiration_timestamp <= $2",
        [userId, now]
      ).catch(() => {});
      return null;
    }

    return {
      id: active.id,
      userId: active.user_id,
      planId: active.plan_id,
      activationTimestamp: Number(active.activation_timestamp),
      expirationTimestamp: Number(active.expiration_timestamp),
      subscriptionStatus: active.subscription_status,
      active: true,
      remainingSeconds: Math.max(0, Math.floor((Number(active.expiration_timestamp) - now) / 1000)),
    };
  }

  async function subscriptionHorizon(userId) {
    const now = nowMs();
    const res = await pool.query(
      "SELECT MAX(expiration_timestamp) AS max_exp FROM entitlements WHERE user_id = $1 AND subscription_status = 'active'",
      [userId]
    );
    const maxExp = Number(res.rows[0]?.max_exp || 0);
    return {
      activeUntil: maxExp > now ? maxExp : null,
      active: maxExp > now,
    };
  }

  // Grant subscription (tamper-proof timestamps, stacking on existing active horizon)
  async function grantSubscription({ userId, planId, paymentId = null }) {
    const planRes = await pool.query("SELECT * FROM plans WHERE id = $1", [planId]);
    const plan = planRes.rows[0];
    if (!plan) throw new Error("Unknown subscription plan: " + planId);

    const now = nowMs();
    const horizon = await subscriptionHorizon(userId);
    const startMs = horizon.activeUntil ? Math.max(now, horizon.activeUntil) : now;
    const durationMs = Number(plan.duration_seconds) * 1000;
    const endMs = startMs + durationMs;

    const entId = randomUUID();
    await pool.query(
      `INSERT INTO entitlements (id, user_id, plan_id, payment_id, activation_timestamp, expiration_timestamp, subscription_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW())`,
      [entId, userId, planId, paymentId, startMs, endMs]
    );

    // Update user subscription_status and subscription_expires
    await pool.query(
      "UPDATE users SET subscription_status = 'active', subscription_expires = $1 WHERE id = $2",
      [endMs, userId]
    );

    await audit(userId, "subscription.granted", { planId, startMs, endMs, paymentId });
    return {
      id: entId,
      userId,
      planId,
      activationTimestamp: startMs,
      expirationTimestamp: endMs,
      subscriptionStatus: "active",
    };
  }

  // --- PASSWORD RESET ---
  async function requestPasswordReset(email) {
    const res = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    const user = res.rows[0];
    if (!user) return null;

    const token = await createSession({
      userId: user.id,
      scope: "reset",
      label: "Password Reset",
      ttl: 3600, // 1 hour
    });

    await audit(user.id, "password.reset_requested");
    return token.rawToken;
  }

  async function resetPasswordWithToken(rawTokenStr, newPassword) {
    const user = await userForToken(rawTokenStr, "reset");
    if (!user) throw withCode("Password reset link is invalid or expired.", "INVALID_TOKEN");

    const digest = await passwordHash(newPassword);
    const now = nowSec();

    await transaction(async (client) => {
      // 1. Update password
      await client.query("UPDATE users SET password = $1 WHERE id = $2", [digest, user.id]);
      // 2. Revoke reset token
      await client.query("UPDATE sessions SET revoked_at = $1 WHERE token_hash = $2", [now, hash(rawTokenStr)]);
      // 3. Security best practice: revoke all existing sessions to kick out any unauthorized clients!
      await client.query("UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL", [now, user.id]);
      await client.query("DELETE FROM desktop_seats WHERE user_id = $1", [user.id]);
      await audit(user.id, "password.reset_completed");
    });

    return true;
  }

  return {
    pool,
    safeUser,
    audit,
    passwordHash,
    verifyPassword,
    register,
    login,
    logoutSession,
    revokeDevice,
    revokeOtherDevices,
    revokeAll,
    listDevices,
    pairDevice,
    acquireDesktopSeat,
    verifyDesktopAccess,
    refreshDesktopTokens,
    desktopHeartbeat,
    desktopLogout,
    authorizeSubscription,
    subscriptionHorizon,
    grantSubscription,
    requestPasswordReset,
    resetPasswordWithToken,
    userForToken,
    createSession,
  };
}
