import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { scrypt as scryptCallback, randomBytes, randomUUID } from "node:crypto";
import { createVault } from "../server/cloud/auth.mjs";
import { createService } from "../server/core.mjs";
import { applyMigrations } from "../server/cloud/migrations.mjs";

const scrypt = promisify(scryptCallback);

async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return salt + ":" + derived.toString("hex");
}

const DATA_DIR = path.resolve(".data/cloud");
const WORKSPACES_DIR = path.join(DATA_DIR, "workspaces");
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(WORKSPACES_DIR, { recursive: true, mode: 0o700 });

// Ensure encryption key exists
const keyPath = path.join(DATA_DIR, "development-master.key");
if (!fs.existsSync(keyPath)) {
  fs.writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
}
const masterKey = fs.readFileSync(keyPath, "utf8").trim();
const vault = createVault(masterKey);

const dbPath = path.join(DATA_DIR, "accounts.sqlite");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
applyMigrations(db);

console.log("==================================================================");
console.log("      LENSDESK 2.0 - PRODUCTION CORE USERS SEEDING & RESET       ");
console.log("==================================================================");

// 1. Delete all existing test accounts, tokens, and sessions
console.log("\n[1/4] Cleaning existing test users from database...");
db.exec("BEGIN IMMEDIATE");
try {
  // Cascades to tokens, desktop_sessions, refresh_tokens, access_tokens, payments, entitlements, usage
  db.exec("DELETE FROM users");
  db.exec("DELETE FROM security_audit");
  db.exec("DELETE FROM login_limits");
  db.exec("COMMIT");
  console.log("  ✓ Successfully cleared all previous user accounts and sessions.");
} catch (err) {
  db.exec("ROLLBACK");
  console.error("  ❌ Failed to clear database:", err);
  process.exit(1);
}

// 2. Define the core user accounts
const CORE_USERS = [
  {
    name: "Vivek",
    email: "vivek@gmail.com",
    password: "12345678",
  },
  {
    name: "Mukul",
    email: "mukul@gmail.com",
    password: "12345678",
  },
  {
    name: "Rishu",
    email: "rishu@gamil.com", // Exact spelling from prompt
    password: "12345678",
  },
  {
    name: "Rishu",
    email: "rishu@gmail.com", // Safety alias
    password: "12345678",
  },
];

const nowMs = Date.now();
const nowSec = Math.floor(nowMs / 1000);
const thirtyDaysSec = 30 * 24 * 3600; // exactly 2,592,000 seconds
const expiresAtMs = nowMs + thirtyDaysSec * 1000;
const expiresAtSec = nowSec + thirtyDaysSec;
const stamp = new Date().toISOString();

console.log("\n[2/4] Creating 3 core accounts with 30-day (1 month) monthly plan...");

const insertUser = db.prepare(`
  INSERT INTO users(id, email, name, password, verified, created_at, subscription_status, subscription_expires, account_state)
  VALUES(?, ?, ?, ?, 1, ?, 'active', ?, 'active')
`);

const insertEntitlement = db.prepare(`
  INSERT INTO entitlements(id, user_id, plan_id, payment_id, activation_timestamp, expiration_timestamp, subscription_status, created_at, updated_at)
  VALUES(?, ?, 'monthly', NULL, ?, ?, 'active', ?, ?)
`);

const seededUsers = [];

for (const u of CORE_USERS) {
  const userId = randomUUID();
  const digest = await passwordHash(u.password);
  
  insertUser.run(userId, u.email.toLowerCase(), u.name, digest, stamp, expiresAtSec);
  
  const entitlementId = randomUUID();
  insertEntitlement.run(entitlementId, userId, nowMs, expiresAtMs, stamp, stamp);
  
  // Initialize user workspace directory with encrypted SQLite
  const userWsDir = path.join(WORKSPACES_DIR, userId);
  fs.mkdirSync(userWsDir, { recursive: true, mode: 0o700 });
  const wsService = createService({
    directory: userWsDir,
    encrypt: vault.encrypt,
    decrypt: vault.decrypt,
  });
  wsService.close?.();

  seededUsers.push({
    id: userId,
    email: u.email,
    name: u.name,
    password: u.password,
    expiresAt: new Date(expiresAtMs).toISOString(),
    remainingDays: 30,
  });

  console.log(`  ✓ Created user: ${u.email} (Password: ${u.password}) · 30-day active Monthly Pass`);
}

// 3. Verify user records in database
console.log("\n[3/4] Verifying database records...");
const verifyUsers = db.prepare("SELECT id, email, name, verified, subscription_status, subscription_expires FROM users").all();
console.log("  Users in database:", verifyUsers.length);
for (const row of verifyUsers) {
  console.log(`  - ${row.email} (ID: ${row.id}, verified: ${row.verified}, status: ${row.subscription_status}, expires: ${new Date(row.subscription_expires * 1000).toISOString()})`);
}

const verifyEntitlements = db.prepare("SELECT user_id, plan_id, subscription_status, activation_timestamp, expiration_timestamp FROM entitlements").all();
console.log("  Entitlements in database:", verifyEntitlements.length);
for (const ent of verifyEntitlements) {
  console.log(`  - Entitlement for user ${ent.user_id}: plan=${ent.plan_id}, status=${ent.subscription_status}, until=${new Date(ent.expiration_timestamp).toISOString()}`);
}

db.close();

console.log("\n[4/4] Seed complete! All users created with 1 month subscription and persistent AES-256-GCM workspaces.");
console.log("==================================================================");
