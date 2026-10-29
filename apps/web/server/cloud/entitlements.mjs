import { randomUUID } from "node:crypto";

// Authoritative subscription entitlement model.
//
// An entitlement row grants access for the UTC interval
// [activation_timestamp_ms, expiration_timestamp_ms). Authorization ALWAYS
// compares the exact timestamps with the server clock; the background
// sweep only tidies status labels and never decides authorization.
// Purchases made while entitlement is active extend from the latest live
// expiration. Purchases after expiry start from the payment activation
// time. Purchases serialize in BEGIN IMMEDIATE transactions so
// simultaneous payments can neither lose nor duplicate paid time.

export function createEntitlements({ db, plans, clock, audit }) {
  const nowMs = () => Math.floor(clock());
  const stamp = () => new Date().toISOString();

  // Central configuration is the single source of truth for plan prices
  // and durations. Rows are refreshed on boot for new purchases; existing
  // entitlement rows keep their original expiration forever.
  const upsertPlan = db.prepare(`
    INSERT INTO plans(id,label,price_minor,currency,duration_seconds,duration_label,tax_note,highlight)
    VALUES(@id,@label,@priceMinor,@currency,@durationSeconds,@durationLabel,@taxNote,@highlight)
    ON CONFLICT(id) DO UPDATE SET
      label=excluded.label, price_minor=excluded.price_minor,
      duration_seconds=excluded.duration_seconds,
      duration_label=excluded.duration_label, tax_note=excluded.tax_note,
      highlight=excluded.highlight
  `);
  for (const plan of plans.plans)
    upsertPlan.run({ ...plan, highlight: plan.highlight ? 1 : 0 });

  const publicRow = (row) => {
    const now = nowMs();
    return {
      id: row.id,
      userId: row.user_id,
      planId: row.plan_id,
      paymentId: row.payment_id,
      activationTimestamp: row.activation_timestamp,
      expirationTimestamp: row.expiration_timestamp,
      subscriptionStatus: row.subscription_status,
      started: Boolean(row.activation_timestamp <= now),
      expired: Boolean(row.expiration_timestamp <= now),
      remainingSeconds: Math.max(
        0,
        Math.floor((row.expiration_timestamp - now) / 1000),
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };

  return {
    adminAudit(actor, action, targetUserId, detail = "") {
      db.prepare(
        "INSERT INTO admin_audit VALUES(?,?,?,?,?,datetime('now'))",
      ).run(
        randomUUID(),
        String(actor).slice(0, 120),
        String(action).slice(0, 80),
        targetUserId || null,
        typeof detail === "string" && detail.startsWith("{")
          ? detail
          : JSON.stringify(detail),
      );
    },
    adminAuditList(limit = 100) {
      return db
        .prepare(
          "SELECT actor,action,target_user_id AS targetUserId,detail,created_at AS createdAt FROM admin_audit ORDER BY created_at DESC, rowid DESC LIMIT ?",
        )
        .all(limit);
    },
    // Grants access only for the exact UTC window covered by the row.
    authorize(userId, atMs = nowMs()) {
      const row = db
        .prepare(
          `SELECT * FROM entitlements
           WHERE user_id=? AND subscription_status='active'
             AND activation_timestamp<=? AND expiration_timestamp>?
           ORDER BY expiration_timestamp DESC LIMIT 1`,
        )
        .get(userId, atMs, atMs);
      return row ? publicRow(row) : null;
    },
    // Latest live coverage end (ms). Renewals and display may rely on it;
    // per-request authorization always re-reads authoritative rows.
    horizon(userId) {
      const row = db
        .prepare(
          `SELECT MAX(expiration_timestamp) AS expires FROM entitlements
           WHERE user_id=? AND subscription_status='active'
             AND expiration_timestamp>?`,
        )
        .get(userId, nowMs());
      return row?.expires || 0;
    },
    listForUser(userId, limit = 50) {
      return db
        .prepare(
          "SELECT * FROM entitlements WHERE user_id=? ORDER BY expiration_timestamp DESC LIMIT ?",
        )
        .all(userId, limit)
        .map(publicRow);
    },
    byPayment(paymentId) {
      const row = db
        .prepare("SELECT * FROM entitlements WHERE payment_id=?")
        .get(paymentId);
      return row ? publicRow(row) : null;
    },
    byId(id) {
      const row = db.prepare("SELECT * FROM entitlements WHERE id=?").get(id);
      return row ? publicRow(row) : null;
    },
    // Atomically activates verified access for a payment. Idempotent per
    // payment id; simultaneous purchases chain their intervals. Pass
    // manageTx:false when the caller already holds a transaction.
    activate({
      userId,
      planId,
      paymentId = null,
      activatedAtMs,
      source = "payment",
      manageTx = true,
    }) {
      const plan = plans.get(planId);
      if (!plan) throw new Error("Unknown plan.");
      const atMs = Math.floor(activatedAtMs);
      if (manageTx) db.exec("BEGIN IMMEDIATE");
      try {
        if (paymentId) {
          const existing = db
            .prepare("SELECT * FROM entitlements WHERE payment_id=?")
            .get(paymentId);
          if (existing) {
            if (manageTx) db.exec("COMMIT");
            return publicRow(existing);
          }
        }
        // Access starts at payment confirmation; when an entitlement is
        // already live, the new coverage extends the existing expiry.
        const live = db
          .prepare(
            `SELECT MAX(expiration_timestamp) AS expires FROM entitlements
             WHERE user_id=? AND subscription_status='active'
               AND expiration_timestamp>?`,
          )
          .get(userId, atMs);
        const base = Math.max(atMs, live?.expires || 0);
        const id = randomUUID(),
          created = stamp(),
          expiration = base + plan.durationSeconds * 1000;
        db.prepare(
          `INSERT INTO entitlements(
             id,user_id,plan_id,payment_id,
             activation_timestamp,expiration_timestamp,
             subscription_status,created_at,updated_at)
           VALUES(?,?,?,?,?,?, 'active', ?, ?)`,
        ).run(id, userId, plan.id, paymentId, base, expiration, created, created);
        audit?.(userId, `entitlement.activated.${source}`, {
          entitlementId: id,
          planId: plan.id,
          paymentId,
          activation: base,
          expiration,
        });
        if (manageTx) db.exec("COMMIT");
        return {
          id,
          userId,
          planId: plan.id,
          paymentId,
          activationTimestamp: base,
          expirationTimestamp: expiration,
          subscriptionStatus: "active",
          started: true,
          expired: false,
          remainingSeconds: Math.floor((expiration - atMs) / 1000),
          createdAt: created,
          updatedAt: created,
        };
      } catch (error) {
        if (manageTx) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // Transaction already torn down; nothing to undo.
          }
        }
        throw error;
      }
    },
    // Administrative grant — audited and chained exactly like a purchase.
    grant({ userId, planId, atMs = nowMs(), actor = "admin", note = "" }) {
      const result = this.activate({
        userId,
        planId,
        paymentId: null,
        activatedAtMs: atMs,
        source: "grant",
      });
      this.adminAudit(actor, "entitlement.grant", userId, {
        note,
        entitlementId: result.id,
        expiration: result.expirationTimestamp,
      });
      return result;
    },
    // Grant custom number of days by admin, extending live coverage seamlessly
    grantCustomDays({ userId, days, atMs = nowMs(), actor = "admin", note = "" }) {
      const at = Math.floor(atMs);
      const seconds = Math.max(1, Math.round(days * 86400));
      db.exec("BEGIN IMMEDIATE");
      try {
        const live = db
          .prepare(
            `SELECT MAX(expiration_timestamp) AS expires FROM entitlements
             WHERE user_id=? AND subscription_status='active'
               AND expiration_timestamp>?`,
          )
          .get(userId, at);
        const base = Math.max(at, live?.expires || 0);
        const id = randomUUID(),
          created = stamp(),
          expiration = base + seconds * 1000;
        const planId =
          days >= 30
            ? "monthly"
            : days >= 10
              ? "ten-day"
              : days >= 1
                ? "daily"
                : "hourly";
        db.prepare(
          `INSERT INTO entitlements(
             id,user_id,plan_id,payment_id,
             activation_timestamp,expiration_timestamp,
             subscription_status,created_at,updated_at)
           VALUES(?,?,?,?,?,?, 'active', ?, ?)`,
        ).run(
          id,
          userId,
          planId,
          null,
          base,
          expiration,
          created,
          created,
        );
        audit?.(userId, "entitlement.activated.custom_grant", {
          entitlementId: id,
          days,
          note,
          activation: base,
          expiration,
        });
        this.adminAudit(actor, "entitlement.grant_custom_days", userId, {
          days,
          note,
          entitlementId: id,
          expiration,
        });
        db.exec("COMMIT");
        return {
          id,
          userId,
          planId,
          activationTimestamp: base,
          expirationTimestamp: expiration,
          subscriptionStatus: "active",
          started: true,
          expired: false,
          remainingSeconds: Math.floor((expiration - at) / 1000),
          days,
        };
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    // Revoke access granted by a payment (verified refund or operator
    // correction). Tied rows are revoked and can never authorize again.
    revokeByPayment(paymentId, { actor = "system", reason = "", manageTx = true } = {}) {
      if (manageTx) db.exec("BEGIN IMMEDIATE");
      try {
        const rows = db
          .prepare(
            "SELECT * FROM entitlements WHERE payment_id=? AND subscription_status='active'",
          )
          .all(paymentId);
        const updated = stamp();
        for (const row of rows) {
          db.prepare(
            "UPDATE entitlements SET subscription_status='revoked', updated_at=? WHERE id=?",
          ).run(updated, row.id);
          audit?.(row.user_id, `entitlement.revoked.${actor}`, {
            entitlementId: row.id,
            paymentId,
            reason,
          });
        }
        if (manageTx) db.exec("COMMIT");
        return rows.length;
      } catch (error) {
        if (manageTx) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // Transaction already torn down; nothing to undo.
          }
        }
        throw error;
      }
    },
    // Cosmetic status maintenance. Authorization always checks exact
    // timestamps directly, so a delayed sweep cannot leak access.
    expireSweep() {
      return db
        .prepare(
          `UPDATE entitlements SET subscription_status='expired', updated_at=?
           WHERE subscription_status='active' AND expiration_timestamp<=?`,
        )
        .run(stamp(), nowMs()).changes;
    },
    adminExtend(entitlementId, milliseconds, actor = "admin", note = "") {
      if (!Number.isFinite(milliseconds) || milliseconds === 0)
        throw new Error("Extension is invalid.");
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db
          .prepare("SELECT * FROM entitlements WHERE id=?")
          .get(entitlementId);
        if (!row) throw new Error("Entitlement does not exist.");
        const changed = db
          .prepare(
            "UPDATE entitlements SET expiration_timestamp=?, updated_at=? WHERE id=? AND subscription_status IN ('active','expired')",
          )
          .run(row.expiration_timestamp + Math.floor(milliseconds), stamp(), entitlementId);
        if (!changed.changes) throw new Error("Entitlement cannot be extended.");
        this.adminAudit(actor, "entitlement.extend", row.user_id, {
          note,
          entitlementId,
          milliseconds,
        });
        db.exec("COMMIT");
        return { ok: true };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    adminSetExpiration(entitlementId, expirationMs, actor = "admin", reason = "") {
      if (!Number.isFinite(expirationMs) || expirationMs <= 0)
        throw new Error("Expiration is invalid.");
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db
          .prepare("SELECT * FROM entitlements WHERE id=?")
          .get(entitlementId);
        if (!row) throw new Error("Entitlement does not exist.");
        db.prepare(
          `UPDATE entitlements SET expiration_timestamp=?,
             subscription_status=CASE WHEN ?>activation_timestamp THEN 'active' ELSE 'expired' END,
             updated_at=?
           WHERE id=?`,
        ).run(Math.floor(expirationMs), expirationMs, stamp(), entitlementId);
        this.adminAudit(
          actor,
          "entitlement.set_expiration",
          row.user_id,
          { reason, entitlementId, expirationMs: Math.floor(expirationMs) },
        );
        db.exec("COMMIT");
        return { ok: true };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    adminRevoke(entitlementId, actor = "admin", reason = "") {
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db
          .prepare("SELECT * FROM entitlements WHERE id=?")
          .get(entitlementId);
        if (!row) throw new Error("Entitlement does not exist.");
        db.prepare(
          "UPDATE entitlements SET subscription_status='revoked', updated_at=? WHERE id=?",
        ).run(stamp(), entitlementId);
        audit?.(row.user_id, `entitlement.revoked.${actor}`, {
          entitlementId,
          reason,
        });
        this.adminAudit(actor, "entitlement.revoke", row.user_id, {
          reason,
          entitlementId,
        });
        db.exec("COMMIT");
        return { ok: true };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    adminList(userId) {
      return db
        .prepare(
          "SELECT * FROM entitlements WHERE user_id=? ORDER BY expiration_timestamp DESC LIMIT 200",
        )
        .all(userId)
        .map(publicRow);
    },
  };
}
