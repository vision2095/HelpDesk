#!/usr/bin/env node
// Subscription load test.
//
// Runs the real cloud server in-process (same HTTP handler, SQLite schema,
// limiter and entitlement checks as production), seeds accounts, entitlements
// and desktop sessions directly into the database, then measures:
//
//   1. auth.login throughput (scrypt password verification per request)
//   2. desktop.heartbeat throughput and latency at 20,000 distinct live
//      desktop sessions, repeated for several rounds
//
// Seeding directly avoids spending the measurement window on 20k scrypt
// registrations; every request after seeding is a genuine HTTP request through
// the production request pipeline.
//
// Usage:
//   node scripts/load-subscriptions.mjs
//   node scripts/load-subscriptions.mjs --sessions=20000 --rounds=3 \
//     --concurrency=100 --login-users=100 --login-rounds=3
//   node scripts/load-subscriptions.mjs --json > load.json
//
// Options:
//   --sessions=N       desktop sessions to seed (default 20000)
//   --rounds=N         heartbeat rounds over every session (default 3)
//   --concurrency=N    in-flight HTTP requests (default 100)
//   --login-users=N    accounts used for the login test (default 100)
//   --login-rounds=N   login rounds (default 3)
//   --json             print one JSON document instead of a report
//   --keep             keep the temporary data directory
//
// Exit code is non-zero when any measured request fails.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
} from "node:crypto";
import { promisify } from "node:util";
import { createCloudServer } from "../server/cloud/app.mjs";

const scrypt = promisify(scryptCallback);
const PASSWORD = "load-test-password-123";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArgs(argv) {
  const option = (name, fallback, cast = Number) => {
    const asFlag = argv.find((value) => value.startsWith(`--${name}=`));
    if (asFlag) return cast(asFlag.slice(name.length + 3));
    const index = argv.indexOf(`--${name}`);
    if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--"))
      return cast(argv[index + 1]);
    return fallback;
  };
  const options = {
    sessions: option("sessions", 20000),
    rounds: option("rounds", 3),
    concurrency: option("concurrency", 100),
    loginUsers: option("login-users", 100),
    loginRounds: option("login-rounds", 3),
    json: argv.includes("--json"),
    keep: argv.includes("--keep"),
  };
  for (const [name, value] of Object.entries(options))
    if (typeof value === "number" && (!Number.isInteger(value) || value < 0))
      throw new Error(`--${name} must be a non-negative integer.`);
  if (options.sessions < 1) throw new Error("--sessions must be at least 1.");
  if (options.rounds < 1) throw new Error("--rounds must be at least 1.");
  if (options.concurrency < 1)
    throw new Error("--concurrency must be at least 1.");
  return options;
}

function percentile(sorted, value) {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((value / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function summarize(samples) {
  const values = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const elapsedMs =
    samples.reduce((latest, sample) => Math.max(latest, sample.finishedAt), 0) -
    samples.reduce(
      (earliest, sample) => Math.min(earliest, sample.startedAt),
      Infinity,
    );
  return {
    requests: samples.length,
    elapsedMs: Math.max(0, elapsedMs),
    throughput: elapsedMs > 0 ? (samples.length / elapsedMs) * 1000 : 0,
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.at(-1) || 0,
  };
}

function createHttpClient(baseUrl, agent) {
  return function post(action, { body = {}, token, headers = {} } = {}) {
    const payload = JSON.stringify(body);
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const request = http.request(
        new URL(`/api/${action}`, baseUrl),
        {
          method: "POST",
          agent,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            origin: baseUrl,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...headers,
          },
        },
        (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (raw += chunk));
          response.on("end", () => {
            let data = null;
            try {
              data = JSON.parse(raw);
            } catch {}
            resolve({
              status: response.statusCode,
              data,
              ms: performance.now() - startedAt,
              startedAt,
              finishedAt: performance.now(),
            });
          });
        },
      );
      request.setTimeout(30000, () =>
        request.destroy(new Error("request timed out after 30s")),
      );
      request.on("error", (error) =>
        resolve({
          status: 0,
          error: error.message,
          ms: performance.now() - startedAt,
          startedAt,
          finishedAt: performance.now(),
        }),
      );
      request.end(payload);
    });
  };
}

async function pool(items, concurrency, worker) {
  let cursor = 0;
  const samples = [];
  const failures = [];
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        const result = await worker(items[index], index);
        samples.push(result);
        if (result.status !== 200 || result.ok !== true)
          failures.push({
            index,
            status: result.status,
            error:
              result.error ||
              result.data?.error ||
              result.data?.code ||
              "unexpected response",
          });
      }
    },
  );
  await Promise.all(workers);
  return { samples, failures, summary: summarize(samples) };
}

async function seed(app, sessions) {
  const db = app.accounts.db;
  const startedAt = performance.now();
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(PASSWORD, salt, 64);
  const password = salt + ":" + derived.toString("hex");
  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const iso = new Date(nowMs).toISOString();
  const plan =
    app.plans.plans.find((candidate) => candidate.id === "monthly") ||
    app.plans.plans[0];
  if (!plan) throw new Error("No plans are configured.");

  const insertUser = db.prepare(
    "INSERT INTO users(id,email,name,password,verified,created_at) VALUES(?,?,?,?,1,?)",
  );
  const insertEntitlement = db.prepare(
    `INSERT INTO entitlements(
       id,user_id,plan_id,payment_id,activation_timestamp,expiration_timestamp,
       subscription_status,created_at,updated_at)
     VALUES(?,?,?,NULL,?,?,'active',?,?)`,
  );
  const insertSession = db.prepare(
    `INSERT INTO desktop_sessions(
       id,user_id,device_label,os,app_version,status,
       created_at,last_seen,lease_until,revoked_at,replaced_by)
     VALUES(?,?,?,?,?,'active',?,?,?,NULL,NULL)`,
  );
  const insertAccess = db.prepare(
    "INSERT INTO access_tokens(hash,session_id,created_at,expires_at,revoked_at) VALUES(?,?,?,?,NULL)",
  );

  const users = [];
  const accessTokens = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < sessions; index++) {
      const userId = randomUUID();
      const sessionId = randomUUID();
      const token = randomBytes(32).toString("base64url");
      users.push({ id: userId, email: `load-${index}@load.invalid` });
      accessTokens.push({ token, userId });
      insertUser.run(
        userId,
        `load-${index}@load.invalid`,
        `Load Test ${index}`,
        password,
        iso,
      );
      insertEntitlement.run(
        randomUUID(),
        userId,
        plan.id,
        nowMs - 1000,
        nowMs + 24 * 60 * 60 * 1000,
        iso,
        iso,
      );
      insertSession.run(
        sessionId,
        userId,
        `Load device ${index}`,
        "load-test",
        "0.0.0",
        nowSeconds,
        nowSeconds,
        nowSeconds + 600,
      );
      insertAccess.run(sha256(token), sessionId, nowSeconds, nowSeconds + 900);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  return {
    users,
    accessTokens,
    planId: plan.id,
    elapsedMs: performance.now() - startedAt,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "lensdesk-load-test-"),
  );
  const baseUrl = "http://127.0.0.1:4319";
  const app = createCloudServer({
    directory,
    publicUrl: baseUrl,
    encryptionKey: randomBytes(32).toString("hex"),
    trustProxy: true,
  });
  let agent;
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const port = app.server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    const post = createHttpClient(
      origin,
      (agent = new http.Agent({
        keepAlive: true,
        maxSockets: options.concurrency,
      })),
    );

    const seeded = await seed(app, options.sessions);
    // Move seeded pages into the main database file so the reported size is
    // stable and the measurement window does not pay for a checkpoint.
    app.accounts.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const dbBytes = ["accounts.sqlite", "accounts.sqlite-wal"].reduce(
      (total, name) => {
        try {
          return total + fs.statSync(path.join(directory, name)).size;
        } catch {
          return total;
        }
      },
      0,
    );
    const seedStats = {
      users: seeded.users.length,
      entitlements: seeded.users.length,
      desktopSessions: seeded.accessTokens.length,
      planId: seeded.planId,
      elapsedMs: seeded.elapsedMs,
      databaseBytes: dbBytes,
      residentBytes: process.memoryUsage().rss,
    };

    // Warm the HTTP stack, SQLite page cache and token lookup path with a
    // small number of distinct sessions before measuring.
    const warmup = seeded.accessTokens.slice(
      0,
      Math.min(200, seeded.accessTokens.length),
    );
    const warmupResult = await pool(
      warmup,
      Math.min(options.concurrency, warmup.length),
      async ({ token }) => {
        const response = await post("desktop.heartbeat", { token, body: {} });
        return {
          ...response,
          ok: response.status === 200 && response.data?.ok === true,
        };
      },
    );
    if (warmupResult.failures.length)
      throw new Error(
        "Warmup heartbeat failed: " + JSON.stringify(warmupResult.failures[0]),
      );

    const heartbeatRounds = [];
    const heartbeatSamples = [];
    for (let round = 1; round <= options.rounds; round++) {
      const result = await pool(
        seeded.accessTokens,
        Math.min(options.concurrency, seeded.accessTokens.length),
        async ({ token, userId }) => {
          const response = await post("desktop.heartbeat", { token, body: {} });
          const ok =
            response.status === 200 &&
            response.data?.ok === true &&
            Boolean(response.data?.entitlement) &&
            response.data?.entitlement?.userId === userId;
          return { ...response, ok };
        },
      );
      heartbeatSamples.push(...result.samples);
      heartbeatRounds.push({
        round,
        failures: result.failures.slice(0, 10),
        failureCount: result.failures.length,
        ...result.summary,
      });
      if (result.failures.length) break;
    }

    // Login throughput: real scrypt verification for real accounts. Each
    // request carries a unique X-Forwarded-For so the per-IP login limiter
    // behaves exactly as it would for distinct clients behind a proxy.
    const loginUsers = seeded.users.slice(
      0,
      Math.min(options.loginUsers, seeded.users.length),
    );
    const loginRounds = [];
    let identity = 0;
    for (let round = 1; round <= options.loginRounds; round++) {
      const requests = loginUsers.map((user) => {
        identity++;
        return {
          email: user.email,
          forwardedFor: `10.${(identity >> 16) & 255}.${(identity >> 8) & 255}.${identity & 255}`,
        };
      });
      const result = await pool(
        requests,
        Math.min(options.concurrency, requests.length),
        async ({ email, forwardedFor }) => {
          const response = await post("auth.login", {
            body: { email, password: PASSWORD },
            headers: { "x-forwarded-for": forwardedFor },
          });
          const ok =
            response.status === 200 &&
            response.data?.user?.email === email &&
            !response.data?.mfaRequired;
          return { ...response, ok };
        },
      );
      loginRounds.push({
        round,
        failures: result.failures.slice(0, 10),
        failureCount: result.failures.length,
        ...result.summary,
      });
      if (result.failures.length) break;
    }

    const heartbeatTotals = summarize(heartbeatSamples);
    const report = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      options,
      seed: seedStats,
      warmup: {
        requests: warmupResult.summary.requests,
        elapsedMs: warmupResult.summary.elapsedMs,
        throughput: warmupResult.summary.throughput,
      },
      authLogin: {
        users: loginUsers.length,
        rounds: loginRounds,
      },
      desktopHeartbeat: {
        distinctSessions: seeded.accessTokens.length,
        concurrency: Math.min(options.concurrency, seeded.accessTokens.length),
        rounds: heartbeatRounds,
        requests: heartbeatTotals.requests,
        elapsedMs: heartbeatTotals.elapsedMs,
        throughput: heartbeatTotals.throughput,
        p50: heartbeatTotals.p50,
        p95: heartbeatTotals.p95,
        p99: heartbeatTotals.p99,
      },
      residentBytesAfter: process.memoryUsage().rss,
    };
    const failures = [
      ...heartbeatRounds.flatMap((round) => round.failures),
      ...loginRounds.flatMap((round) => round.failures),
    ];
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report, failures);
    if (failures.length) process.exitCode = 1;
  } finally {
    agent?.destroy();
    await app.close();
    if (!options.keep) fs.rmSync(directory, { recursive: true, force: true });
    else console.log("Data directory kept at " + directory);
  }
}

function printReport(report, failures) {
  const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;
  const rate = (value) => `${Math.round(value).toLocaleString("en-US")}/s`;
  const ms = (value) => `${Math.round(value)}ms`;
  const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  console.log("LensDesk subscription load test");
  console.log(
    `Node ${report.node} · ${report.platform}/${report.arch} · ${report.cpus} CPUs`,
  );
  console.log(
    `Seeded ${report.seed.users.toLocaleString("en-US")} accounts, ` +
      `${report.seed.desktopSessions.toLocaleString("en-US")} desktop sessions ` +
      `(${report.seed.planId} entitlements) in ${seconds(report.seed.elapsedMs)} · ` +
      `DB ${mib(report.seed.databaseBytes)} · RSS ${mib(report.seed.residentBytes)}`,
  );
  const section = (title, rounds) => {
    console.log("\n" + title);
    for (const round of rounds) {
      console.log(
        `  round ${round.round}: ${round.requests.toLocaleString("en-US")} requests, ` +
          `${round.failureCount} failed, ${seconds(round.elapsedMs)}, ` +
          `${rate(round.throughput)}, p50 ${ms(round.p50)}, p95 ${ms(round.p95)}, p99 ${ms(round.p99)}`,
      );
    }
  };
  section(
    "auth.login — scrypt password verification over real accounts",
    report.authLogin.rounds,
  );
  section(
    "desktop.heartbeat — one request per distinct live desktop session",
    report.desktopHeartbeat.rounds,
  );
  const total = report.desktopHeartbeat;
  console.log(
    `\nHeartbeat total: ${total.requests.toLocaleString("en-US")} requests in ${seconds(total.elapsedMs)} ` +
      `→ ${rate(total.throughput)} across all rounds`,
  );
  if (failures.length) {
    console.log(`\n${failures.length} failed request(s); first 5:`);
    for (const failure of failures.slice(0, 5))
      console.log(
        `  #${failure.index} status=${failure.status} ${failure.error}`,
      );
  }
  console.log(
    `\nResident memory after test: ${mib(report.residentBytesAfter)}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
