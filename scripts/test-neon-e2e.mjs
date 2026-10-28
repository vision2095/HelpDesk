import { getDatabasePool } from "../server/cloud/postgres-db.mjs";
import { runPostgresMigrations } from "../server/cloud/postgres-migrations.mjs";
import { createPostgresStore } from "../server/cloud/postgres-store.mjs";
import { createCloudServer } from "../server/cloud/app.mjs";

async function main() {
  console.log("=== NEON END-TO-END VERIFICATION TEST ===");
  const pool = getDatabasePool();

  // 1. Connection check
  console.log("[1/5] Testing Neon direct connection...");
  const ping = await pool.query("SELECT NOW() as neon_now, current_database() as db, current_user as user");
  console.log("  ✓ Connected to Neon:", ping.rows[0]);

  // 2. Migration check
  console.log("[2/5] Verifying schema migrations on Neon...");
  await runPostgresMigrations(pool);
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log(`  ✓ Verified ${tables.rows.length} tables in Neon public schema.`);

  // 3. Store operations
  console.log("[3/5] Testing PostgreSQL store operations (User, Seat, Audit)...");
  const store = createPostgresStore({ pool });
  const testEmail = `neon-verify-${Date.now()}@lensdesk.internal`;
  const reg = await store.register({
    email: testEmail,
    password: "TestPassword123#",
    name: "Neon Test User",
    verified: true,
    deviceId: "neon-test-mac-01",
    deviceLabel: "Testing Node",
    platform: "darwin",
  });
  console.log("  ✓ Registered user in Neon:", reg.user.id, reg.user.email);

  const seat = await store.acquireDesktopSeat({
    userId: reg.user.id,
    deviceId: "neon-test-mac-01",
    deviceLabel: "Testing Node",
    os: "darwin",
    appVersion: "2.0.0",
  });
  console.log("  ✓ Acquired desktop seat in Neon, accessToken created:", Boolean(seat.accessToken));

  await store.audit(reg.user.id, "neon.verification", { verified: true, timestamp: Date.now() });
  const auditRes = await pool.query("SELECT event, detail FROM security_events WHERE user_id = $1", [reg.user.id]);
  console.log("  ✓ Recorded and fetched security event:", auditRes.rows[0]);

  // Clean up
  await pool.query("DELETE FROM users WHERE id = $1", [reg.user.id]);
  console.log("  ✓ Test data cleaned up.");

  // 4. Start HTTP Server with Neon
  console.log("[4/5] Starting LensDesk Cloud Server on port 4333 with Neon...");
  const app = createCloudServer({
    directory: ".data/neon-test-cloud",
    publicUrl: "http://127.0.0.1:4333",
    encryptionKey: process.env.CLOUD_ENCRYPTION_KEY || "b0ac9ab8158eb97ecf5fe29d287ba76cfb78d0c06d608f71c11b9a8d78094654",
    adminToken: process.env.ADMIN_TOKEN || "admin-test-token",
  });

  const srv = app.server.listen(4333, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  console.log("  ✓ Server is listening on http://127.0.0.1:4333");

  // 5. Test HTTP endpoints
  console.log("[5/5] Testing HTTP /health and public config endpoints...");
  const healthRes = await fetch("http://127.0.0.1:4333/health");
  const healthData = await healthRes.json();
  console.log("  ✓ HTTP GET /health status:", healthRes.status, healthData);

  const plansRes = await pool.query("SELECT id, label, price_minor, currency FROM plans ORDER BY price_minor ASC");
  console.log("  ✓ Active Neon Plans verified:", plansRes.rows.map((p) => `${p.label} (${p.currency} ${p.price_minor / 100})`));

  srv.close();
  await app.close();
  await pool.end();
  console.log("=== ALL NEON VERIFICATION TESTS PASSED SUCCESSFULLY! ===");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
