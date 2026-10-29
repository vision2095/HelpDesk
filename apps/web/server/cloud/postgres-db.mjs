import pg from "pg";
const { Pool } = pg;

let pool = null;

export function getDatabasePool(connectionString) {
  if (pool) return pool;
  const url = connectionString || process.env.DATABASE_URL || "postgres://localhost:5432/lensdesk";
  const isLocal = url.includes("localhost") || url.includes("127.0.0.1");

  pool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: parseInt(process.env.PG_MAX_CONNECTIONS || "20", 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    console.error("[PostgreSQL Pool Error]", err.message);
  });

  return pool;
}

export async function query(text, params) {
  const p = getDatabasePool();
  return await p.query(text, params);
}

export async function transaction(callback) {
  const p = getDatabasePool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function withAdvisoryLock(lockKeyInt, callback) {
  const p = getDatabasePool();
  const client = await p.connect();
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [lockKeyInt]);
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function isReady() {
  try {
    const res = await query("SELECT 1 AS ready");
    return res.rows?.[0]?.ready === 1;
  } catch (err) {
    return false;
  }
}

export async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
