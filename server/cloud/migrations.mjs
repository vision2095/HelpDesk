// Additive, versioned schema migrations for the LensDesk cloud database.
// Existing tables are never dropped or reshaped; new tables/columns are
// created idempotently so upgrades are safe for deployed instances.

const MIGRATIONS = [
  {
    id: "0001-plan-entitlement-payments",
    statements: [
      `CREATE TABLE IF NOT EXISTS plans(
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        price_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        duration_label TEXT NOT NULL,
        tax_note TEXT NOT NULL,
        highlight INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS payments(
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES plans(id),
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created'
          CHECK(status IN ('created','paid','failed','refunded')),
        order_id TEXT UNIQUE,
        provider_payment_id TEXT UNIQUE,
        entitlement_id TEXT,
        receipt_emailed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS payments_user ON payments(user_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS payment_webhook_events(
        fingerprint TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payment_id TEXT,
        received_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS entitlements(
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES plans(id),
        payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
        activation_timestamp INTEGER NOT NULL,
        expiration_timestamp INTEGER NOT NULL
          CHECK(expiration_timestamp > activation_timestamp),
        subscription_status TEXT NOT NULL DEFAULT 'active'
          CHECK(subscription_status IN ('active','expired','revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS entitlement_user_active
        ON entitlements(user_id, subscription_status, expiration_timestamp)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS entitlement_payment_unique
        ON entitlements(payment_id) WHERE payment_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS desktop_sessions(
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_label TEXT NOT NULL DEFAULT 'Unknown device',
        os TEXT NOT NULL DEFAULT '',
        app_version TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('active','revoked')),
        replaced_by TEXT,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        lease_until INTEGER NOT NULL,
        revoked_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS desktop_sessions_user
        ON desktop_sessions(user_id, status, last_seen DESC)`,
      // Single active desktop session per account, enforced by the
      // database itself across concurrent nodes and racing logins.
      `CREATE UNIQUE INDEX IF NOT EXISTS desktop_session_single_active
        ON desktop_sessions(user_id) WHERE status='active'`,
      `CREATE TABLE IF NOT EXISTS refresh_tokens(
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES desktop_sessions(id) ON DELETE CASCADE,
        hash TEXT UNIQUE NOT NULL,
        previous_hash TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        revoked_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS access_tokens(
        hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES desktop_sessions(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS admin_audit(
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user_id TEXT,
        detail TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    id: "0002-pending-order-unique",
    statements: [
      // Collapse historical duplicate pending orders before the partial
      // unique index applies (newest row per user+plan is kept). Paid,
      // failed, and refunded rows are untouched.
      `DELETE FROM payments
        WHERE status='created'
          AND rowid NOT IN (
            SELECT MAX(rowid) FROM payments WHERE status='created'
            GROUP BY user_id, plan_id
          )`,
      // A racing double-click may only ever leave one live checkout
      // order per account and plan, enforced by the database itself.
      `CREATE UNIQUE INDEX IF NOT EXISTS payments_single_pending
        ON payments(user_id, plan_id) WHERE status='created'`,
    ],
  },
];

export function applyMigrations(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const existing = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id),
  );
  for (const migration of MIGRATIONS) {
    if (existing.has(migration.id)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) db.exec(statement);
      db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
        migration.id,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
