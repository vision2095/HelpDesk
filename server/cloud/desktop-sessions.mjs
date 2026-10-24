import { randomBytes, randomUUID, createHash } from "node:crypto";

// Desktop application sessions.
//
// An account may hold exactly ONE active desktop session across every
// macOS/Windows device. The rule is enforced by a partial UNIQUE index on
// the sessions table (user_id WHERE status='active') plus serialized
// BEGIN IMMEDIATE transactions, so racing logins can never create
// duplicate sessions.
//
// Sessions travel with short-lived access tokens and rotating refresh
// tokens. Presenting an already-used refresh token is a reuse event: the
// whole desktop session is revoked server-side and audited.

const hash = (value) => createHash("sha256").update(value).digest("hex");
const rawToken = () => randomBytes(32).toString("base64url");

function withCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createDesktopSessions({
  db,
  clock,
  audit,
  accessTokenTtlSeconds = 900,
  refreshTtlSeconds = 60 * 60 * 24 * 30,
  leaseTtlSeconds = 600,
}) {
  const nowSec = () => Math.floor(clock() / 1000);

  const insertRefresh = db.prepare(
    "INSERT INTO refresh_tokens(id,session_id,hash,previous_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)",
  );
  const insertAccess = db.prepare(
    "INSERT INTO access_tokens(hash,session_id,created_at,expires_at) VALUES(?,?,?,?)",
  );

  function issueTokens(sessionId) {
    const refresh = rawToken(),
      access = rawToken(),
      now = nowSec();
    insertRefresh.run(
      randomUUID(),
      sessionId,
      hash(refresh),
      null,
      now,
      now + refreshTtlSeconds,
    );
    insertAccess.run(hash(access), sessionId, now, now + accessTokenTtlSeconds);
    return { refreshToken: refresh, accessToken: access };
  }

  function revokeChildTokens(sessionId) {
    const at = nowSec();
    db.prepare(
      "UPDATE refresh_tokens SET revoked_at=? WHERE session_id=? AND revoked_at IS NULL",
    ).run(at, sessionId);
    db.prepare(
      "UPDATE access_tokens SET revoked_at=? WHERE session_id=? AND revoked_at IS NULL",
    ).run(at, sessionId);
  }

  function endSession(row, reason) {
    db.prepare(
      "UPDATE desktop_sessions SET status='revoked', revoked_at=? WHERE id=?",
    ).run(nowSec(), row.id);
    revokeChildTokens(row.id);
    audit?.(row.user_id, reason, { sessionId: row.id });
  }

  // Public views expose milliseconds, matching the entitlement model and
  // serverTimeMs conventions everywhere else.
  const publicSession = (row, at = nowSec()) => {
    return {
      userId: row.user_id,
      id: row.id,
      deviceLabel: row.device_label,
      os: row.os,
      appVersion: row.app_version,
      status: row.status,
      createdAt: row.created_at * 1000,
      lastSeen: row.last_seen * 1000,
      leaseUntil: row.lease_until * 1000,
      leaseLive: row.lease_until > at,
      revokedAt: row.revoked_at ? row.revoked_at * 1000 : null,
      replacedBy: row.replaced_by,
    };
  }

  function reuseError() {
    return withCode(
      "Security event: a refresh token was reused. For safety your desktop session was revoked.",
      "DESKTOP_SESSION_REUSED",
    );
  }

  // Reuse handling must run outside of an open transaction to open its
  // own write lock. It revokes the session (if still active) and audits
  // the attempt.
  function reuseRevocation(found) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const session = db
        .prepare("SELECT * FROM desktop_sessions WHERE id=?")
        .get(found.sessionId);
      if (session && session.status === "active")
        endSession(session, "desktop.token.reuse");
      else revokeChildTokens(found.sessionId);
      audit?.(found.userId, "desktop.token.reuse_attempt", {
        sessionId: found.sessionId,
        at: new Date(clock()).toISOString(),
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    // Atomically acquires the single active slot. With an existing live
    // session and takeover=false the caller is told to confirm takeover
    // explicitly. Device-supplied session ids are never trusted.
    // Returns { takeoverRequired, existing } without tokens in that case.
    acquire({ userId, deviceLabel = "Unknown device", os = "", appVersion = "", takeover = false }) {
      const now = nowSec();
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = db
          .prepare(
            "SELECT * FROM desktop_sessions WHERE user_id=? AND status='active'",
          )
          .get(userId);
        if (existing) {
          if (!takeover) {
            db.exec("COMMIT");
            return { takeoverRequired: true, existing: publicSession(existing) };
          }
          endSession(existing, "desktop.session.takeover");
        }
        const sessionId = randomUUID();
        db.prepare(
          `INSERT INTO desktop_sessions(
             id,user_id,device_label,os,app_version,status,
             created_at,last_seen,lease_until,revoked_at,replaced_by)
           VALUES(?,?,?,?,?, 'active', ?,?,?, NULL, NULL)`,
        ).run(
          sessionId,
          userId,
          String(deviceLabel).slice(0, 120) || "Unknown device",
          String(os).slice(0, 60),
          String(appVersion).slice(0, 40),
          now,
          now,
          now + leaseTtlSeconds,
        );
        const tokens = issueTokens(sessionId);
        audit?.(userId, "desktop.session.created", {
          sessionId,
          takeover: Boolean(existing),
        });
        db.exec("COMMIT");
        return {
          session: {
            id: sessionId,
            deviceLabel: String(deviceLabel).slice(0, 120) || "Unknown device",
            os: String(os).slice(0, 60),
            appVersion: String(appVersion).slice(0, 40),
            status: "active",
            createdAt: now,
            lastSeen: now,
            leaseUntil: now + leaseTtlSeconds,
            leaseLive: true,
            revokedAt: null,
            replacedBy: null,
          },
          ...tokens,
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    // Validates an access token and returns its live session summary.
    verifyAccess(raw) {
      if (!raw) return null;
      const row = db
        .prepare(
          `SELECT s.* FROM access_tokens a
           JOIN desktop_sessions s ON s.id=a.session_id
           WHERE a.hash=? AND a.expires_at>? AND a.revoked_at IS NULL
             AND s.status='active'`,
        )
        .get(hash(raw), nowSec());
      return row
        ? { userId: row.user_id, sessionId: row.id, session: publicSession(row) }
        : null;
    },
    // Validates a refresh token; null when unknown.
    verifyRefresh(raw) {
      if (!raw) return null;
      return db
        .prepare(
          `SELECT r.id AS rowId, r.expires_at, r.revoked_at AS refresh_revoked,
                  s.user_id AS userId, s.id AS sessionId, s.status AS sessionStatus
           FROM refresh_tokens r JOIN desktop_sessions s ON s.id=r.session_id
           WHERE r.hash=?`,
        )
        .get(hash(raw));
    },
    // Consumes a valid refresh token, extends the lease, and issues
    // successor tokens. Re-presenting a consumed or revoked token
    // revokes the entire desktop session before the error surfaces.
    rotate(raw) {
      if (!raw) throw withCode("Refresh token is missing.", "DESKTOP_REFRESH_INVALID");
      const found = this.verifyRefresh(raw);
      if (!found)
        throw withCode("Refresh token is invalid.", "DESKTOP_REFRESH_INVALID");
      db.exec("BEGIN IMMEDIATE");
      try {
        const claimed = db
          .prepare(
            "UPDATE refresh_tokens SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL",
          )
          .run(nowSec(), found.rowId);
        if (!claimed.changes) {
          db.exec("COMMIT");
          reuseRevocation(found);
          throw reuseError();
        }
        if (found.expires_at <= nowSec())
          throw withCode(
            "Your desktop session expired. Sign in again to continue.",
            "DESKTOP_REFRESH_EXPIRED",
          );
        const session = db
          .prepare("SELECT * FROM desktop_sessions WHERE id=?")
          .get(found.sessionId);
        if (!session || session.status !== "active")
          throw withCode(
            "Your desktop session was revoked. Sign in again to continue.",
            "DESKTOP_SESSION_REVOKED",
          );
        const now = nowSec();
        db.prepare(
          "UPDATE desktop_sessions SET last_seen=?, lease_until=? WHERE id=?",
        ).run(now, now + leaseTtlSeconds, session.id);
        // The successor inherits the original absolute expiry so a
        // stolen chain cannot renew access for a different user.
        const successor = rawToken();
        insertRefresh.run(
          randomUUID(),
          session.id,
          hash(successor),
          hash(raw),
          now,
          found.expires_at,
        );
        const access = rawToken();
        insertAccess.run(hash(access), session.id, now, now + accessTokenTtlSeconds);
        audit?.(session.user_id, "desktop.token.rotated", {
          sessionId: session.id,
        });
        db.exec("COMMIT");
        return {
          session: publicSession(
            {
              ...session,
              last_seen: now,
              lease_until: now + leaseTtlSeconds,
            },
            now,
          ),
          refreshToken: successor,
          accessToken: access,
        };
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {}
        throw error;
      }
    },
    // Extends a session's last-seen bookkeeping and lease. Callers
    // always re-check entitlements against the server clock separately.
    touch(sessionId) {
      const now = nowSec();
      db.prepare(
        "UPDATE desktop_sessions SET last_seen=?, lease_until=? WHERE id=? AND status='active'",
      ).run(now, now + leaseTtlSeconds, sessionId);
      return db
        .prepare("SELECT * FROM desktop_sessions WHERE id=?")
        .get(sessionId);
    },
    heartbeat(sessionId) {
      const row = this.touch(sessionId);
      return row && row.status === "active"
        ? { sessionId: row.id, leaseUntil: row.lease_until, lastSeen: row.last_seen, session: publicSession(row) }
        : null;
    },
    // Immediate server-side revocation: takeover, website device revoke,
    // password reset, suspension, and refund-driven logout.
    revoke(sessionId, reason = "") {
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db
          .prepare("SELECT * FROM desktop_sessions WHERE id=? AND status='active'")
          .get(sessionId);
        if (row)
          endSession(
            row,
            reason ? "desktop.session.revoked." + reason : "desktop.session.revoked",
          );
        db.exec("COMMIT");
        return { ok: Boolean(row) };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    // Revokes every active desktop session for the account.
    revokeForUser(userId, reason = "") {
      db.exec("BEGIN IMMEDIATE");
      try {
        const rows = db
          .prepare(
            "SELECT * FROM desktop_sessions WHERE user_id=? AND status='active'",
          )
          .all(userId);
        for (const row of rows)
          endSession(
            row,
            reason
              ? "desktop.session.revoked." + reason
              : "desktop.session.revoked",
          );
        db.exec("COMMIT");
        return rows.length;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    listForUser(userId, limit = 10) {
      return db
        .prepare(
          "SELECT * FROM desktop_sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT ?",
        )
        .all(userId, limit)
        .map((row) => publicSession(row));
    },
    countActive(userId) {
      return (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM desktop_sessions WHERE user_id=? AND status='active'",
          )
          .get(userId)?.count || 0
      );
    },
    summary(sessionId) {
      const row = db
        .prepare("SELECT * FROM desktop_sessions WHERE id=?")
        .get(sessionId);
      return row ? publicSession(row) : null;
    },
    metrics() {
      return {
        active:
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM desktop_sessions WHERE status='active'",
            )
            .get()?.count || 0,
        total:
          db.prepare("SELECT COUNT(*) AS count FROM desktop_sessions").get()
            ?.count || 0,
      };
    },
  };
}
