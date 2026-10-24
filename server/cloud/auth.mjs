import { DatabaseSync } from "node:sqlite";
import {
  scrypt as scryptCallback,
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
const scrypt = promisify(scryptCallback);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function createVault(masterKey) {
  const key = Buffer.from(masterKey, "hex");
  if (key.length !== 32)
    throw new Error(
      "CLOUD_ENCRYPTION_KEY must contain 64 hexadecimal characters.",
    );
  return {
    encrypt(text) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([
        iv,
        cipher.update(text, "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
    },
    decrypt(buffer) {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        buffer.subarray(0, 12),
      );
      decipher.setAuthTag(buffer.subarray(-16));
      return Buffer.concat([
        decipher.update(buffer.subarray(12, -16)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
export function createAccounts(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "accounts.sqlite"));
  db.exec(
    `PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,verified INTEGER DEFAULT 0,created_at TEXT NOT NULL,stripe_customer TEXT UNIQUE,subscription_status TEXT DEFAULT 'free',subscription_id TEXT,subscription_expires INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,expires INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS token_user ON tokens(user_id);CREATE TABLE IF NOT EXISTS usage(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL,requests INTEGER DEFAULT 0,audio_seconds INTEGER DEFAULT 0,PRIMARY KEY(user_id,day));CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS login_limits(identity TEXT PRIMARY KEY,count INTEGER DEFAULT 0,reset INTEGER NOT NULL);`,
  );
  if (
    !db
      .prepare("PRAGMA table_info(usage)")
      .all()
      .some((c) => c.name === "tokens")
  )
    db.exec("ALTER TABLE usage ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0");
  for (const [name, definition] of [
    ["session_id", "TEXT"],
    ["label", "TEXT NOT NULL DEFAULT 'Unknown device'"],
    ["created_at", "INTEGER NOT NULL DEFAULT 0"],
    ["last_seen", "INTEGER NOT NULL DEFAULT 0"],
  ]) {
    if (
      !db
        .prepare("PRAGMA table_info(tokens)")
        .all()
        .some((c) => c.name === name)
    )
      db.exec(`ALTER TABLE tokens ADD COLUMN ${name} ${definition}`);
  }
  for (const row of db
    .prepare("SELECT hash FROM tokens WHERE session_id IS NULL")
    .all())
    db.prepare("UPDATE tokens SET session_id=? WHERE hash=?").run(
      randomUUID(),
      row.hash,
    );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS session_identity ON tokens(session_id); CREATE TABLE IF NOT EXISTS security_audit(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,event TEXT NOT NULL,created_at TEXT NOT NULL);",
  );
  if (
    !db.prepare("PRAGMA table_info(security_audit)").all().some((c) => c.name === "detail")
  )
    db.exec("ALTER TABLE security_audit ADD COLUMN detail TEXT NOT NULL DEFAULT ''");
  function audit(userId, event, detail = {}) {
    db.prepare("INSERT INTO security_audit VALUES(?,?,?,?,?)").run(
      randomUUID(),
      userId,
      event,
      new Date().toISOString(),
      typeof detail === "string" ? detail : JSON.stringify(detail || {}),
    );
    db.prepare(
      "DELETE FROM security_audit WHERE user_id=? AND id NOT IN (SELECT id FROM security_audit WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100)",
    ).run(userId, userId);
  }
  db.prepare("DELETE FROM tokens WHERE expires<?").run(
    Math.floor(Date.now() / 1000),
  );
  db.prepare("DELETE FROM login_limits WHERE reset<?").run(
    Math.floor(Date.now() / 1000),
  );
  const safe = (row) =>
    row
      ? {
          id: row.id,
          email: row.email,
          name: row.name,
          verified: Boolean(row.verified),
          createdAt: row.created_at,
          subscriptionStatus: row.subscription_status,
          subscriptionExpires: row.subscription_expires,
        }
      : null;
  function token(userId, kind, ttl = 60 * 60 * 24 * 30) {
    const raw = randomBytes(32).toString("base64url");
    db.prepare(
      "INSERT INTO tokens(hash,user_id,kind,expires,session_id,created_at,last_seen) VALUES(?,?,?,?,?,?,?)",
    ).run(
      hash(raw),
      userId,
      kind,
      Math.floor(Date.now() / 1000) + ttl,
      randomUUID(),
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000),
    );
    return raw;
  }
  function userForToken(raw, kind = "session") {
    if (!raw) return null;
    const row = db
      .prepare(
        "SELECT u.* FROM users u JOIN tokens t ON u.id=t.user_id WHERE t.hash=? AND t.kind=? AND t.expires>?",
      )
      .get(hash(raw), kind, Math.floor(Date.now() / 1000));
    if (row && kind === "session")
      db.prepare(
        "UPDATE tokens SET last_seen=? WHERE hash=? AND last_seen<?",
      ).run(
        Math.floor(Date.now() / 1000),
        hash(raw),
        Math.floor(Date.now() / 1000) - 300,
      );
    return row || null;
  }
  async function passwordHash(password) {
    const salt = randomBytes(16).toString("hex"),
      derived = await scrypt(password, salt, 64);
    return salt + ":" + derived.toString("hex");
  }
  async function register({ email, password, name }) {
    email = email.toLowerCase();
    if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
      throw new Error(
        "This email is already registered. Sign in or reset your password.",
      );
    const id = randomUUID(),
      digest = await passwordHash(password);
    db.prepare(
      "INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)",
    ).run(id, email, name, digest, new Date().toISOString());
    return {
      user: safe(db.prepare("SELECT * FROM users WHERE id=?").get(id)),
      token: token(id, "session"),
      verificationToken: token(id, "verify", 86400),
    };
  }
  async function login(
    { email, password },
    identity,
    { issueToken = true } = {},
  ) {
    const now = Math.floor(Date.now() / 1000);
    let limit = db
      .prepare("SELECT * FROM login_limits WHERE identity=?")
      .get(identity);
    if (limit && limit.reset < now) {
      db.prepare("DELETE FROM login_limits WHERE identity=?").run(identity);
      limit = null;
    }
    if (limit?.count >= 10)
      throw new Error("Too many sign-in attempts. Try again in 15 minutes.");
    db.prepare(
      "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(identity) DO UPDATE SET count=count+1",
    ).run(identity, now + 900);
    const row = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(email.toLowerCase());
    const [salt, digest] = (
      row?.password ||
      "00000000000000000000000000000000:" + Buffer.alloc(64).toString("hex")
    ).split(":");
    const attempt = await scrypt(password, salt, 64);
    if (!row || !timingSafeEqual(Buffer.from(digest, "hex"), attempt))
      throw new Error("Email or password is incorrect.");
    if (row.account_state === "suspended") {
      const error = new Error(
        "This account is suspended. Contact support for assistance.",
      );
      error.code = "ACCOUNT_BLOCKED";
      throw error;
    }
    const latest = db
      .prepare("SELECT password FROM users WHERE id=?")
      .get(row.id);
    if (latest?.password !== row.password)
      throw new Error("Your password changed during sign-in. Try again.");
    db.prepare("DELETE FROM login_limits WHERE identity=?").run(identity);
    if (issueToken) audit(row.id, "session.signed_in");
    return {
      user: safe(row),
      ...(issueToken ? { token: token(row.id, "session") } : {}),
    };
  }
  function usage(userId) {
    return (
      db
        .prepare(
          "SELECT requests,audio_seconds AS audioSeconds,tokens FROM usage WHERE user_id=? AND day=?",
        )
        .get(userId, new Date().toISOString().slice(0, 10)) || {
        requests: 0,
        audioSeconds: 0,
        tokens: 0,
      }
    );
  }
  function reserve(userId, kind, amount, limit) {
    const day = new Date().toISOString().slice(0, 10),
      column =
        kind === "audio"
          ? "audio_seconds"
          : kind === "tokens"
            ? "tokens"
            : "requests";
    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      !Number.isFinite(limit) ||
      limit < 0
    )
      throw new Error("Invalid usage reservation.");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO usage(user_id,day) VALUES(?,?) ON CONFLICT DO NOTHING",
      ).run(userId, day);
      const result = db
        .prepare(
          `UPDATE usage SET ${column}=${column}+? WHERE user_id=? AND day=? AND ${column}+?<=?`,
        )
        .run(amount, userId, day, amount, limit);
      if (!result.changes)
        throw new Error(
          kind === "tokens"
            ? "Your daily token budget is used. Add your own provider key or try tomorrow."
            : kind === "audio"
              ? "Your daily transcription allowance is used. Upgrade or try tomorrow."
              : "Your daily AI allowance is used. Upgrade, add your own provider key, or try tomorrow.",
        );
      db.exec("COMMIT");
      let settled = false;
      const refund = () => {
        if (settled) return;
        settled = true;
        db.prepare(
          `UPDATE usage SET ${column}=MAX(0,${column}-?) WHERE user_id=? AND day=?`,
        ).run(amount, userId, day);
      };
      refund.settle = (actual) => {
        if (settled) return;
        settled = true;
        const measured =
          Number.isFinite(actual) && actual >= 0 ? Math.ceil(actual) : amount;
        db.prepare(
          `UPDATE usage SET ${column}=MAX(0,${column}-?+?) WHERE user_id=? AND day=?`,
        ).run(amount, measured, userId, day);
      };
      return refund;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    db,
    safe,
    register,
    login,
    token,
    userForToken,
    usage,
    reserve,
    audit,
    describeSession(raw, label) {
      db.prepare(
        "UPDATE tokens SET label=? WHERE hash=? AND kind='session'",
      ).run(String(label).slice(0, 150), hash(raw));
    },
    sessions(userId, raw) {
      return db
        .prepare(
          "SELECT session_id AS id,label,created_at AS createdAt,last_seen AS lastSeen,expires,hash FROM tokens WHERE user_id=? AND kind='session' AND expires>? ORDER BY last_seen DESC",
        )
        .all(userId, Math.floor(Date.now() / 1000))
        .map((row) => {
          const { hash: secret, ...safe } = row;
          return { ...safe, current: secret === hash(raw) };
        });
    },
    revokeSession(userId, id) {
      db.prepare(
        "DELETE FROM tokens WHERE user_id=? AND session_id=? AND kind='session'",
      ).run(userId, id);
      audit(userId, "session.revoked");
      return { ok: true };
    },
    revokeOthers(userId, raw) {
      db.prepare(
        "DELETE FROM tokens WHERE user_id=? AND kind='session' AND hash<>?",
      ).run(userId, hash(raw));
      audit(userId, "session.revoked_others");
      return { ok: true };
    },
    async changePassword(userId, oldDigest, password) {
      const digest = await passwordHash(password);
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db
          .prepare("SELECT password FROM users WHERE id=?")
          .get(userId);
        if (row?.password !== oldDigest)
          throw new Error("Your account changed. Sign in again.");
        db.prepare("UPDATE users SET password=? WHERE id=?").run(
          digest,
          userId,
        );
        db.prepare("DELETE FROM tokens WHERE user_id=?").run(userId);
        const raw = token(userId, "session");
        audit(userId, "password.changed");
        db.exec("COMMIT");
        return { token: raw };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    assertActive(userId) {
      const row = db
        .prepare("SELECT account_state FROM users WHERE id=?")
        .get(userId);
      if (!row || row.account_state === "active") return;
      const error =
        row.account_state === "suspended"
          ? new Error(
              "This account is suspended. Contact support for assistance.",
            )
          : new Error("Account deletion is in progress.");
      error.code = "ACCOUNT_BLOCKED";
      throw error;
    },
    logout: (raw) =>
      db.prepare("DELETE FROM tokens WHERE hash=?").run(hash(raw)),
    verify(raw) {
      const u = userForToken(raw, "verify");
      if (!u) throw new Error("Verification link is invalid or expired.");
      db.prepare("UPDATE users SET verified=1 WHERE id=?").run(u.id);
      db.prepare("DELETE FROM tokens WHERE hash=?").run(hash(raw));
      return { ok: true };
    },
    async reset(raw, password) {
      const u = userForToken(raw, "reset");
      if (!u) throw new Error("Reset link is invalid or expired.");
      const digest = await passwordHash(password);
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!userForToken(raw, "reset"))
          throw new Error("Reset link is invalid or expired.");
        db.prepare("UPDATE users SET password=? WHERE id=?").run(digest, u.id);
        db.prepare("DELETE FROM tokens WHERE user_id=?").run(u.id);
        audit(u.id, "password.reset");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { ok: true };
    },
    close: () => db.close(),
  };
}
