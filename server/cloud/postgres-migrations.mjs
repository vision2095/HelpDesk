import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const PG_MIGRATIONS = [
  {
    id: "0001-lensdesk-master-schema",
    run: async (client) => {
      // 1. Users
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          password TEXT NOT NULL,
          verified BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          account_state TEXT NOT NULL DEFAULT 'active',
          stripe_customer TEXT UNIQUE,
          subscription_status TEXT DEFAULT 'free',
          subscription_id TEXT,
          subscription_expires BIGINT DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      `);

      // 2. Devices (Verified Logical Devices)
      await client.query(`
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device_label TEXT NOT NULL DEFAULT 'Unknown device',
          platform TEXT NOT NULL DEFAULT 'web',
          fingerprint TEXT,
          trusted BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, revoked_at);
      `);

      // 3. Sessions (Web and Desktop tokens/sessions)
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
          token_hash TEXT UNIQUE NOT NULL,
          scope TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT 'Unknown session',
          ip TEXT,
          user_agent TEXT,
          created_at BIGINT NOT NULL,
          last_seen BIGINT NOT NULL,
          expires_at BIGINT NOT NULL,
          revoked_at BIGINT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, scope, expires_at, revoked_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);
      `);

      // 4. Device Pairings (Same-PC Web + Desktop verification)
      await client.query(`
        CREATE TABLE IF NOT EXISTS device_pairings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          web_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          desktop_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          paired_at BIGINT NOT NULL,
          verified BOOLEAN NOT NULL DEFAULT TRUE,
          pairing_code TEXT,
          CONSTRAINT uq_user_device UNIQUE(user_id, device_id)
        );
        CREATE INDEX IF NOT EXISTS idx_pairings_device ON device_pairings(device_id);
      `);

      // 5. Desktop Seats (Single Active Desktop Seat per user)
      await client.query(`
        CREATE TABLE IF NOT EXISTS desktop_seats (
          user_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
          device_label TEXT NOT NULL DEFAULT 'Desktop device',
          os TEXT NOT NULL DEFAULT '',
          app_version TEXT NOT NULL DEFAULT '',
          acquired_at BIGINT NOT NULL,
          last_heartbeat BIGINT NOT NULL,
          lease_until BIGINT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE INDEX IF NOT EXISTS idx_desktop_seats_session ON desktop_seats(session_id);
      `);

      // 6. Desktop Tokens (Access & Refresh token rotation with reuse detection)
      await client.query(`
        CREATE TABLE IF NOT EXISTS desktop_tokens (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          token_type TEXT NOT NULL,
          hash TEXT UNIQUE NOT NULL,
          previous_hash TEXT,
          created_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL,
          consumed_at BIGINT,
          revoked_at BIGINT
        );
        CREATE INDEX IF NOT EXISTS idx_dt_session ON desktop_tokens(session_id, token_type);
      `);

      // 7. Work Sessions (Active Work & Interview Mode Protection)
      await client.query(`
        CREATE TABLE IF NOT EXISTS work_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'active',
          started_at BIGINT NOT NULL,
          last_active_at BIGINT NOT NULL,
          lease_until BIGINT NOT NULL,
          interview_mode BOOLEAN NOT NULL DEFAULT FALSE
        );
        CREATE INDEX IF NOT EXISTS idx_work_sessions_user ON work_sessions(user_id, state);
      `);

      // 8. Plans
      await client.query(`
        CREATE TABLE IF NOT EXISTS plans (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          price_minor INTEGER NOT NULL,
          currency TEXT NOT NULL,
          duration_seconds INTEGER NOT NULL,
          duration_label TEXT NOT NULL,
          tax_note TEXT NOT NULL,
          highlight INTEGER NOT NULL DEFAULT 0
        );
      `);

      // 9. Payments
      await client.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plan_id TEXT NOT NULL REFERENCES plans(id),
          amount_minor INTEGER NOT NULL,
          currency TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'created',
          order_id TEXT UNIQUE,
          provider_payment_id TEXT UNIQUE,
          entitlement_id TEXT,
          receipt_emailed INTEGER NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);
      `);

      // 10. Payment Webhook Events
      await client.query(`
        CREATE TABLE IF NOT EXISTS payment_webhook_events (
          fingerprint TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          payment_id TEXT,
          received_at BIGINT NOT NULL
        );
      `);

      // 11. Entitlements
      await client.query(`
        CREATE TABLE IF NOT EXISTS entitlements (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plan_id TEXT NOT NULL REFERENCES plans(id),
          payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
          activation_timestamp BIGINT NOT NULL,
          expiration_timestamp BIGINT NOT NULL,
          subscription_status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_entitlements_user_active
          ON entitlements(user_id, subscription_status, expiration_timestamp);
      `);

      // 12. Security Events / Audit
      await client.query(`
        CREATE TABLE IF NOT EXISTS security_events (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          event TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          ip TEXT,
          user_agent TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id, created_at DESC);
      `);

      // 13. Login Limits (Brute-force protection)
      await client.query(`
        CREATE TABLE IF NOT EXISTS login_limits (
          identity TEXT PRIMARY KEY,
          count INTEGER DEFAULT 0,
          reset BIGINT NOT NULL
        );
      `);

      // 14. MFA
      await client.query(`
        CREATE TABLE IF NOT EXISTS mfa (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          secret BYTEA,
          pending BYTEA,
          pending_expires BIGINT NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 0,
          last_counter INTEGER NOT NULL DEFAULT -1
        );
        CREATE TABLE IF NOT EXISTS mfa_recovery (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          hash TEXT NOT NULL,
          PRIMARY KEY (user_id, hash)
        );
      `);

      // 15. Checkout Intents
      await client.query(`
        CREATE TABLE IF NOT EXISTS checkout_intents (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          idempotency_key TEXT NOT NULL,
          params TEXT NOT NULL,
          lease_until BIGINT NOT NULL DEFAULT 0,
          checkout_id TEXT,
          url TEXT,
          expires BIGINT NOT NULL
        );
      `);

      // 16. Admin Audit
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_audit (
          id TEXT PRIMARY KEY,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          target_user_id TEXT,
          detail TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // 17. Usage Quota
      await client.query(`
        CREATE TABLE IF NOT EXISTS usage (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          day TEXT NOT NULL,
          requests INTEGER DEFAULT 0,
          audio_seconds INTEGER DEFAULT 0,
          tokens INTEGER DEFAULT 0,
          PRIMARY KEY (user_id, day)
        );
      `);

      // Insert Default Prepaid Plans
      await client.query(`
        INSERT INTO plans(id, label, price_minor, currency, duration_seconds, duration_label, tax_note, highlight)
        VALUES
          ('hourly', 'Hourly Access', 10000, 'INR', 3600, '1 hour', 'Inclusive of applicable taxes.', 0),
          ('daily', 'Daily Pass', 20000, 'INR', 86400, '24 hours', 'Inclusive of applicable taxes.', 0),
          ('10-day', '10-Day Sprint', 100000, 'INR', 864000, '10 days', 'Inclusive of applicable taxes.', 0),
          ('monthly', 'Monthly Pro', 150000, 'INR', 2592000, '1 month', 'Inclusive of applicable taxes.', 1)
        ON CONFLICT (id) DO UPDATE SET
          label = EXCLUDED.label,
          price_minor = EXCLUDED.price_minor,
          currency = EXCLUDED.currency,
          duration_seconds = EXCLUDED.duration_seconds,
          duration_label = EXCLUDED.duration_label,
          tax_note = EXCLUDED.tax_note,
          highlight = EXCLUDED.highlight;
      `);
    },
  },
];

export async function runPostgresMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(128) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const appliedRows = await client.query("SELECT id FROM schema_migrations");
    const applied = new Set(appliedRows.rows.map((r) => r.id));

    for (const migration of PG_MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      console.log(`[PostgreSQL Migration] Applying: ${migration.id}`);
      await client.query("BEGIN");
      try {
        await migration.run(client);
        await client.query("INSERT INTO schema_migrations(id, applied_at) VALUES($1, NOW())", [migration.id]);
        await client.query("COMMIT");
        console.log(`[PostgreSQL Migration] Applied: ${migration.id}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

export async function importFromSqlite(pool, sqliteDir) {
  const sqlitePath = path.join(sqliteDir, "accounts.sqlite");
  if (!fs.existsSync(sqlitePath)) return;

  let sqliteDb;
  try {
    sqliteDb = new DatabaseSync(sqlitePath);
  } catch (err) {
    console.warn("[SQLite Import] Unable to open accounts.sqlite:", err.message);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Import Users
    try {
      const users = sqliteDb.prepare("SELECT * FROM users").all();
      for (const u of users) {
        const existing = await client.query(
          "SELECT id FROM users WHERE email = $1 OR id = $2 LIMIT 1",
          [u.email, u.id]
        );
        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE users SET
              name = COALESCE($1, name),
              password = COALESCE($2, password),
              verified = COALESCE($3, verified),
              subscription_status = COALESCE($4, subscription_status),
              subscription_expires = COALESCE($5, subscription_expires)
            WHERE id = $6`,
            [
              u.name,
              u.password,
              Boolean(u.verified),
              u.subscription_status || "free",
              u.subscription_expires || 0,
              existing.rows[0].id,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO users (id, email, name, password, verified, created_at, stripe_customer, subscription_status, subscription_id, subscription_expires)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT DO NOTHING`,
            [
              u.id,
              u.email,
              u.name,
              u.password,
              Boolean(u.verified),
              u.created_at || new Date().toISOString(),
              u.stripe_customer || null,
              u.subscription_status || "free",
              u.subscription_id || null,
              u.subscription_expires || 0,
            ]
          );
        }
      }
      if (users.length) console.log(`[SQLite Import] Imported ${users.length} users into PostgreSQL.`);
    } catch (err) {
      console.warn("[SQLite Import Users Warning]", err.message);
    }

    // 2. Import Entitlements
    try {
      const entitlements = sqliteDb.prepare("SELECT * FROM entitlements").all();
      for (const e of entitlements) {
        await client.query(
          `INSERT INTO entitlements (id, user_id, plan_id, payment_id, activation_timestamp, expiration_timestamp, subscription_status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            e.id,
            e.user_id,
            e.plan_id,
            e.payment_id || null,
            e.activation_timestamp,
            e.expiration_timestamp,
            e.subscription_status || "active",
            e.created_at || new Date().toISOString(),
            e.updated_at || new Date().toISOString(),
          ]
        );
      }
      if (entitlements.length) console.log(`[SQLite Import] Imported ${entitlements.length} entitlements.`);
    } catch {}

    // 3. Import Payments
    try {
      const payments = sqliteDb.prepare("SELECT * FROM payments").all();
      for (const p of payments) {
        await client.query(
          `INSERT INTO payments (id, user_id, plan_id, amount_minor, currency, status, order_id, provider_payment_id, entitlement_id, receipt_emailed, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [
            p.id,
            p.user_id,
            p.plan_id,
            p.amount_minor,
            p.currency,
            p.status,
            p.order_id || null,
            p.provider_payment_id || null,
            p.entitlement_id || null,
            p.receipt_emailed || 0,
            p.created_at,
            p.updated_at,
          ]
        );
      }
      if (payments.length) console.log(`[SQLite Import] Imported ${payments.length} payments.`);
    } catch {}

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[SQLite Import Failed]", err.message);
  } finally {
    try {
      sqliteDb.exec("PRAGMA foreign_keys = ON;");
    } catch {}
    client.release();
    try {
      sqliteDb.close();
    } catch {}
  }
}

export async function syncFromPostgresToSqlite(pool, sqliteDir) {
  const sqlitePath = path.join(sqliteDir, "accounts.sqlite");
  if (!fs.existsSync(sqlitePath)) return;

  let sqliteDb;
  try {
    sqliteDb = new DatabaseSync(sqlitePath);
  } catch (err) {
    console.warn("[Postgres->SQLite Sync] Unable to open accounts.sqlite:", err.message);
    return;
  }

  const client = await pool.connect();
  try {
    try {
      sqliteDb.exec("PRAGMA foreign_keys = OFF;");
    } catch {}

    // 1. Sync Users from Postgres into SQLite
    try {
      const usersRes = await client.query("SELECT * FROM users");
      const insertUser = sqliteDb.prepare(`
        INSERT INTO users (id, email, name, password, verified, created_at, stripe_customer, subscription_status, subscription_id, subscription_expires)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          email = excluded.email,
          name = excluded.name,
          password = excluded.password,
          verified = excluded.verified,
          subscription_status = excluded.subscription_status,
          subscription_expires = excluded.subscription_expires
      `);
      for (const u of usersRes.rows) {
        const existing = sqliteDb.prepare("SELECT id FROM users WHERE email = ? OR id = ? LIMIT 1").get(u.email, u.id);
        if (existing) {
          sqliteDb.prepare(`
            UPDATE users SET
              id = ?,
              email = ?,
              name = ?,
              password = ?,
              verified = ?,
              subscription_status = ?,
              subscription_expires = ?
            WHERE id = ?
          `).run(
            u.id,
            u.email,
            u.name || "",
            u.password,
            u.verified ? 1 : 0,
            u.subscription_status || "free",
            Number(u.subscription_expires || 0),
            existing.id
          );
        } else {
          insertUser.run(
            u.id,
            u.email,
            u.name || "",
            u.password,
            u.verified ? 1 : 0,
            u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString(),
            u.stripe_customer || null,
            u.subscription_status || "free",
            u.subscription_id || null,
            Number(u.subscription_expires || 0)
          );
        }
      }
      if (usersRes.rows.length) {
        console.log(`[Postgres->SQLite Sync] Synced ${usersRes.rows.length} users into SQLite.`);
      }
    } catch (err) {
      console.warn("[Postgres->SQLite Sync Users Warning]", err.message);
    }

    // 2. Sync Entitlements from Postgres into SQLite
    try {
      const entRes = await client.query("SELECT * FROM entitlements");
      const insertEnt = sqliteDb.prepare(`
        INSERT INTO entitlements (id, user_id, plan_id, payment_id, activation_timestamp, expiration_timestamp, subscription_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          subscription_status = excluded.subscription_status,
          expiration_timestamp = excluded.expiration_timestamp,
          updated_at = excluded.updated_at
      `);
      for (const e of entRes.rows) {
        insertEnt.run(
          e.id,
          e.user_id,
          e.plan_id,
          e.payment_id || null,
          Number(e.activation_timestamp),
          Number(e.expiration_timestamp),
          e.subscription_status || "active",
          e.created_at ? new Date(e.created_at).toISOString() : new Date().toISOString(),
          e.updated_at ? new Date(e.updated_at).toISOString() : new Date().toISOString()
        );
      }
      if (entRes.rows.length) {
        console.log(`[Postgres->SQLite Sync] Synced ${entRes.rows.length} entitlements into SQLite.`);
      }
    } catch (err) {
      console.warn("[Postgres->SQLite Sync Entitlements Warning]", err.message);
    }

    // 3. Sync Desktop Tokens & Seats from Postgres into SQLite
    try {
      const seatsRes = await client.query("SELECT * FROM desktop_seats");
      const insertSeat = sqliteDb.prepare(`
        INSERT INTO desktop_sessions (id, user_id, device_label, os, app_version, created_at, last_seen, lease_until, status, replaced_by, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL)
        ON CONFLICT (id) DO UPDATE SET
          last_seen = excluded.last_seen,
          lease_until = excluded.lease_until,
          status = 'active'
      `);
      for (const s of seatsRes.rows) {
        insertSeat.run(
          s.session_id,
          s.user_id,
          s.device_label || "LensDesk desktop",
          s.os || "",
          s.app_version || "",
          Number(s.created_at || Math.floor(Date.now() / 1000)),
          Number(s.last_heartbeat || Math.floor(Date.now() / 1000)),
          Number(s.lease_until || Math.floor(Date.now() / 1000) + 3600)
        );
      }

      const tokensRes = await client.query("SELECT * FROM desktop_tokens WHERE revoked_at IS NULL");
      const insertAccess = sqliteDb.prepare(`
        INSERT INTO access_tokens (hash, session_id, created_at, expires_at, revoked_at)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT (hash) DO NOTHING
      `);
      const insertRefresh = sqliteDb.prepare(`
        INSERT INTO refresh_tokens (id, session_id, hash, previous_hash, created_at, expires_at, consumed_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT (id) DO NOTHING
      `);
      for (const t of tokensRes.rows) {
        if (t.token_type === "access") {
          insertAccess.run(t.hash, t.session_id, Number(t.created_at), Number(t.expires_at));
        } else if (t.token_type === "refresh") {
          insertRefresh.run(t.id, t.session_id, t.hash, t.previous_hash || null, Number(t.created_at), Number(t.expires_at));
        }
      }
    } catch (err) {
      console.warn("[Postgres->SQLite Sync Tokens Warning]", err.message);
    }
  } catch (err) {
    console.error("[Postgres->SQLite Sync Failed]", err.message);
  } finally {
    try {
      sqliteDb.exec("PRAGMA foreign_keys = ON;");
    } catch {}
    client.release();
    try {
      sqliteDb.close();
    } catch {}
  }
}
