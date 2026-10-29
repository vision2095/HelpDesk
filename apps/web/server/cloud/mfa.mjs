import { TOTP, Secret } from "otpauth";
import { randomBytes, createHash } from "node:crypto";
export function createMfa({ accounts, vault, clock = () => Date.now() }) {
  const db = accounts.db;
  db.exec(
    `CREATE TABLE IF NOT EXISTS mfa(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,secret BLOB,pending BLOB,pending_expires INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 0,last_counter INTEGER NOT NULL DEFAULT -1);CREATE TABLE IF NOT EXISTS mfa_recovery(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,hash TEXT NOT NULL,PRIMARY KEY(user_id,hash));`,
  );
  const get = (id) => db.prepare("SELECT * FROM mfa WHERE user_id=?").get(id);
  const otp = (secret, email) =>
    new TOTP({
      issuer: "LensDesk",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
  const digest = (id, code) =>
    createHash("sha256")
      .update(id + ":" + code.replace(/[-\s]/g, "").toUpperCase())
      .digest("hex");
  function check(secret, code, lastCounter = -1) {
    if (!/^\d{6}$/.test(code))
      throw new Error("Enter a valid authenticator or recovery code.");
    const totp = otp(secret, "account"),
      delta = totp.validate({ token: code, window: 1, timestamp: clock() });
    const counter = totp.counter({ timestamp: clock() }) + (delta ?? 0);
    if (delta === null || counter <= lastCounter)
      throw new Error(
        "Authenticator code is invalid or already used. Wait for a new code.",
      );
    return counter;
  }
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    status(userId) {
      const row = get(userId);
      return {
        enabled: Boolean(row?.enabled),
        recoveryCodesRemaining: db
          .prepare("SELECT count(*) AS count FROM mfa_recovery WHERE user_id=?")
          .get(userId).count,
      };
    },
    begin(user) {
      if (get(user.id)?.enabled)
        throw new Error(
          "MFA is already enabled. Disable it before replacing your authenticator.",
        );
      const secret = new Secret({ size: 20 }).base32;
      db.prepare(
        "INSERT INTO mfa(user_id,pending,pending_expires) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending=excluded.pending,pending_expires=excluded.pending_expires",
      ).run(user.id, vault.encrypt(secret), clock() + 600000);
      return {
        secret,
        uri: otp(secret, user.email).toString(),
        expiresAt: clock() + 600000,
      };
    },
    confirm(userId, code) {
      return transaction(() => {
        const row = get(userId);
        if (!row?.pending || row.pending_expires < clock() || row.enabled)
          throw new Error("Authenticator setup expired. Start again.");
        const counter = check(vault.decrypt(Buffer.from(row.pending)), code);
        db.prepare(
          "UPDATE mfa SET secret=pending,pending=NULL,pending_expires=0,enabled=1,last_counter=? WHERE user_id=?",
        ).run(counter, userId);
        db.prepare("DELETE FROM mfa_recovery WHERE user_id=?").run(userId);
        const recoveryCodes = Array.from({ length: 10 }, () =>
          randomBytes(10)
            .toString("hex")
            .toUpperCase()
            .match(/.{1,5}/g)
            .join("-"),
        );
        for (const recovery of recoveryCodes)
          db.prepare("INSERT INTO mfa_recovery VALUES(?,?)").run(
            userId,
            digest(userId, recovery),
          );
        accounts.audit(userId, "mfa.enabled");
        return { enabled: true, recoveryCodes };
      });
    },
    verify(userId, code) {
      return transaction(() => {
        const row = get(userId);
        if (!row?.enabled) throw new Error("MFA is not enabled.");
        if (/^\d{6}$/.test(code)) {
          const counter = check(
            vault.decrypt(Buffer.from(row.secret)),
            code,
            row.last_counter,
          );
          db.prepare("UPDATE mfa SET last_counter=? WHERE user_id=?").run(
            counter,
            userId,
          );
        } else {
          const result = db
            .prepare("DELETE FROM mfa_recovery WHERE user_id=? AND hash=?")
            .run(userId, digest(userId, code));
          if (!result.changes)
            throw new Error("Authenticator or recovery code is invalid.");
          accounts.audit(userId, "mfa.recovery_used");
        }
        return { ok: true };
      });
    },
    disable(userId) {
      transaction(() => {
        db.prepare("DELETE FROM mfa WHERE user_id=?").run(userId);
        db.prepare("DELETE FROM mfa_recovery WHERE user_id=?").run(userId);
        accounts.audit(userId, "mfa.disabled");
      });
      return { enabled: false };
    },
  };
}
