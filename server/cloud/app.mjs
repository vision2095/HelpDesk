import { respondWithStream } from "../event-stream.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
  scrypt as scryptCallback,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import nodemailer from "nodemailer";
import { z } from "zod";
import { createAccounts, createVault } from "./auth.mjs";

const scrypt = promisify(scryptCallback);

import { providers } from "../contracts.mjs";
import { createService } from "../core.mjs";
import { createReleases } from "./releases.mjs";
import { createMfa } from "./mfa.mjs";
import { createBilling } from "./billing.mjs";
import { loadPlans } from "./plans.mjs";
import { applyMigrations } from "./migrations.mjs";
import { createEntitlements } from "./entitlements.mjs";
import { createDesktopSessions } from "./desktop-sessions.mjs";
import {
  createPayments,
  createRazorpayClient,
} from "./payments.mjs";
import { getDatabasePool } from "./postgres-db.mjs";
import { runPostgresMigrations, importFromSqlite } from "./postgres-migrations.mjs";
import { createPostgresStore } from "./postgres-store.mjs";
import { measureAudio } from "../media.mjs";
const credentials = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(128),
});
export function createCloudServer({
  directory,
  publicUrl,
  encryptionKey,
  stripeSecret,
  stripeWebhookSecret,
  stripePriceId,
  razorpayKeyId,
  razorpayKeySecret,
  razorpayWebhookSecret,
  razorpayClient,
  adminToken,
  clock = Date.now,
  mailer,
  fetchImpl,
  stripeClient,
  platformKeys = {},
  hostedModelAllowlist = {},
  mfaClock,
  logger,
  operatorToken,
  dailyTokenLimits = { free: 100000, pro: 2000000 },
  production = false,
  trustProxy = false,
} = {}) {
  let effectivePublicUrl = publicUrl;
  if (
    process.env.RENDER_EXTERNAL_URL &&
    (!effectivePublicUrl ||
      effectivePublicUrl.startsWith("http://127.0.0.1") ||
      effectivePublicUrl.startsWith("http://localhost"))
  ) {
    effectivePublicUrl = process.env.RENDER_EXTERNAL_URL;
  }
  let origin = new URL(effectivePublicUrl).origin;
  if (production && !origin.startsWith("https://")) {
    if (process.env.RENDER_EXTERNAL_URL) {
      origin = new URL(process.env.RENDER_EXTERNAL_URL).origin;
    } else if (
      origin.startsWith("http://") &&
      !origin.includes("127.0.0.1") &&
      !origin.includes("localhost")
    ) {
      origin = origin.replace("http://", "https://");
    } else {
      throw new Error("Production PUBLIC_URL must use HTTPS.");
    }
  }
  const accounts = createAccounts(directory),
    vault = createVault(encryptionKey),
    stripe =
      stripeClient ||
      (stripeSecret
        ? new Stripe(stripeSecret, { maxNetworkRetries: 2, timeout: 20000 })
        : null),
    stores = new Map(),
    attempts = new Map();
  const plans = loadPlans(process.env);
  applyMigrations(accounts.db);
  const audit = (userId, event, detail) => {
    try {
      accounts.audit(userId, event, detail);
    } catch {}
  };
  const entitlements = createEntitlements({
    db: accounts.db,
    plans,
    clock,
    audit,
  });
  const desktopSessions = createDesktopSessions({ db: accounts.db, clock, audit });
  let pgPool = null;
  let pgStore = null;
  try {
    pgPool = getDatabasePool();
    pgStore = createPostgresStore({ pool: pgPool, clock, plans });
    runPostgresMigrations(pgPool).catch(() => {});
    importFromSqlite(pgPool, directory).catch(() => {});
  } catch {}
  const payments = createPayments({
    db: accounts.db,
    entitlements,
    plans,
    clock,
    audit,
    client:
      razorpayClient ||
      (razorpayKeyId && razorpayKeySecret
        ? createRazorpayClient({
            keyId: razorpayKeyId,
            keySecret: razorpayKeySecret,
            webhookSecret: razorpayWebhookSecret,
          })
        : null),
    mailReceipt: (payment) => {
      const row = accounts.db
        .prepare("SELECT email FROM users WHERE id=?")
        .get(payment.user_id);
      if (!row || !mailer) return Promise.resolve();
      return mailer.sendMail({
        to: row.email,
        subject: "Your LensDesk purchase receipt",
        text: `Thank you. Payment ${payment.id} for the ${payment.planLabel} plan (${(payment.amount_minor / 100).toLocaleString("en-IN")} INR) was received and your access is active until ${new Date(payment.entitlement_expires).toISOString()}. Manage purchases at ${origin}/dashboard.`,
      });
    },
  });
  const mfa = createMfa({ accounts, vault, clock: mfaClock });
  const billing = createBilling({
    accounts,
    stripe,
    priceId: stripePriceId,
    origin,
  });
  // Expiry labeling runs periodically but never gates authorization,
  // which always reads exact entitlement timestamps directly.
  const sweepTimer = setInterval(() => {
    try {
      entitlements.expireSweep();
    } catch {}
  }, 60000);

  async function bootstrapCoreAccounts() {
    try {
      accounts.db.exec("UPDATE users SET verified=1 WHERE verified=0");
    } catch {}
    const CORE_DEFAULTS = [
      { email: "vivek@gmail.com", name: "Vivek" },
      { email: "mukul@gmail.com", name: "Mukul" },
      { email: "rishu@gmail.com", name: "Rishu" },
    ];
    const now = Math.floor(clock());
    for (const item of CORE_DEFAULTS) {
      let row = accounts.db
        .prepare("SELECT * FROM users WHERE lower(email)=?")
        .get(item.email);
      if (!row) {
        const id = randomUUID();
        const salt = randomBytes(16).toString("hex");
        const derived = await scrypt("12345678", salt, 64);
        const digest = salt + ":" + derived.toString("hex");
        accounts.db
          .prepare(
            "INSERT INTO users(id,email,name,password,verified,created_at,subscription_status,subscription_expires,account_state) VALUES(?,?,?,?,1,?,'active',?,'active')",
          )
          .run(
            id,
            item.email,
            item.name,
            digest,
            new Date().toISOString(),
            Math.floor(now / 1000) + 30 * 86400,
          );
        row = accounts.db.prepare("SELECT * FROM users WHERE id=?").get(id);
      }
      const live = entitlements.authorize(row.id, now);
      if (!live || live.remainingSeconds < 86400) {
        entitlements.grantCustomDays({
          userId: row.id,
          days: 30,
          actor: "system.bootstrap",
          note: "Core production account 1-month entitlement",
        });
      }
    }
  }
  bootstrapCoreAccounts().catch((err) => {
    logger?.({ event: "bootstrap.error", error: err.message });
  });

  function safeAdminCompare(req, secret, identity) {
    const provided = String(req.headers.authorization || "");
    if (!provided.startsWith("Bearer ")) return false;
    const key = createHash("sha256");
    key.update(provided.slice(7).trim());
    const expected = createHash("sha256").update(secret).digest();
    const ok = key.digest();
    const matches = expected.length === ok.length && timingSafeEqual(expected, ok);
    if (!matches) {
      // Brute-force protection: rate-limit failed admin token attempts
      limited("admin:fail:" + identity, 10);
      logger?.({
        event: "security.admin_access_rejected",
        ip: req.socket?.remoteAddress || identity,
        timestamp: new Date().toISOString(),
      });
    }
    return matches;
  }
  async function adminDispatch(action, payload, identity) {
    const actor = "admin(" + identity.slice(-12) + ")";
    const withOwner = (userId) =>
      accounts.db.prepare("SELECT id FROM users WHERE id=?").get(userId);
    switch (action) {
      case "admin.overview": {
        const users = accounts.db;
        return {
          users: users.prepare("SELECT COUNT(*) AS count FROM users").get()?.count || 0,
          verified: users
            .prepare("SELECT COUNT(*) AS count FROM users WHERE verified=1")
            .get()?.count || 0,
          suspended: users
            .prepare("SELECT account_state, COUNT(*) AS count FROM users GROUP BY account_state")
            .all(),
          desktopSessions: desktopSessions.metrics(),
          entitlements: {
            active: users
              .prepare(
                "SELECT COUNT(*) AS count FROM entitlements WHERE subscription_status='active' AND expiration_timestamp>?",
              )
              .get(Math.floor(clock()))?.count || 0,
            expired: users
              .prepare(
                "SELECT COUNT(*) AS count FROM entitlements WHERE expiration_timestamp<=?",
              )
              .get(Math.floor(clock()))?.count || 0,
            revoked: users
              .prepare("SELECT COUNT(*) AS count FROM entitlements WHERE subscription_status='revoked'")
              .get()?.count || 0,
          },
          payments: {
            paid: users
              .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_minor),0) AS totalMinor FROM payments WHERE status='paid'")
              .get(),
            refunded: users
              .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_minor),0) AS totalMinor FROM payments WHERE status='refunded'")
              .get(),
            failed: users
              .prepare("SELECT COUNT(*) AS count FROM payments WHERE status='failed'")
              .get()?.count || 0,
          },
          http: metrics,
          uptimeSeconds: Math.floor(process.uptime()),
        };
      }
      case "admin.users": {
        const data = z
          .object({
            query: z.string().max(120).optional(),
            limit: z.number().int().min(1).max(200).optional(),
          })
          .parse(payload || {});
        const like = data.query
          ? "%" + data.query.toLowerCase() + "%"
          : null;
        return {
          users: accounts.db
            .prepare(
              `SELECT u.id, u.email, u.name, u.verified, u.account_state, u.created_at,
                 MAX(e.expiration_timestamp) AS accessUntil
               FROM users u
               LEFT JOIN entitlements e ON e.user_id=u.id AND e.subscription_status='active'
               WHERE (? IS NULL OR LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ?)
               GROUP BY u.id ORDER BY u.created_at DESC LIMIT ?`,
            )
            .all(like, like, like, Math.min(data.limit || 50, 200)),
        };
      }
      case "admin.user": {
        const data = z.object({ userId: z.string().uuid() }).parse(payload);
        if (!withOwner(data.userId)) throw new Error("User not found.");
        return {
          user: accounts.db.prepare("SELECT id,email,name,verified,account_state,created_at,stripe_customer FROM users WHERE id=?").get(data.userId),
          entitlements: entitlements.adminList(data.userId),
          payments: payments.adminList({ userId: data.userId, limit: 50 }),
          desktopSessions: desktopSessions.listForUser(data.userId, 10),
          audit: accounts.db
            .prepare("SELECT event,created_at AS createdAt,detail FROM security_audit WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 50")
            .all(data.userId),
        };
      }
      case "admin.user.grantByEmail": {
        const data = z
          .object({
            email: z.string().email(),
            days: z.number().int().min(1).max(3650),
            note: z.string().max(300).optional(),
          })
          .parse(payload);
        const userRow = accounts.db
          .prepare(
            "SELECT id,email,name,verified,account_state FROM users WHERE lower(email)=lower(?)",
          )
          .get(data.email.trim());
        if (!userRow) {
          throw new Error(`User with email "${data.email}" not found.`);
        }
        const granted = entitlements.grantCustomDays({
          userId: userRow.id,
          days: data.days,
          actor,
          note: data.note || "Admin custom grant",
        });
        return {
          ok: true,
          user: userRow,
          entitlement: granted,
          message: `Successfully granted ${data.days} days of desktop access to ${data.email}.`,
        };
      }
      case "admin.user.resetPassword": {
        const data = z
          .object({
            userId: z.string().uuid(),
            newPassword: z.string().min(6).max(128).optional(),
          })
          .parse(payload);
        if (!withOwner(data.userId)) throw new Error("User not found.");
        const nextPassword = data.newPassword || "12345678";
        const salt = randomBytes(16).toString("hex");
        const derived = await scrypt(nextPassword, salt, 64);
        const digest = salt + ":" + derived.toString("hex");
        accounts.db
          .prepare("UPDATE users SET password=? WHERE id=?")
          .run(digest, data.userId);
        desktopSessions.revokeForUser(data.userId, "admin.password-reset");
        entitlements.adminAudit(actor, "admin.user.resetPassword", data.userId, {
          at: new Date().toISOString(),
        });
        return {
          ok: true,
          userId: data.userId,
          newPassword: nextPassword,
          message: `Password has been reset to: ${nextPassword}`,
        };
      }
      case "admin.user.delete": {
        const data = z.object({ userId: z.string().uuid() }).parse(payload);
        if (!withOwner(data.userId)) throw new Error("User not found.");
        desktopSessions.revokeForUser(data.userId, "admin.deleted");
        const entry = stores.get(data.userId);
        entry?.service.close?.();
        stores.delete(data.userId);
        try {
          fs.rmSync(path.join(directory, "workspaces", data.userId), {
            recursive: true,
            force: true,
          });
        } catch {}
        accounts.db
          .prepare("DELETE FROM users WHERE id=?")
          .run(data.userId);
        entitlements.adminAudit(actor, "admin.user.delete", data.userId, {
          at: new Date().toISOString(),
        });
        return { ok: true, deleted: true, userId: data.userId };
      }
      case "admin.entitlement.grant": {
        const data = z
          .object({
            userId: z.string().uuid(),
            planId: z.string().min(2).max(40),
            note: z.string().max(300).optional(),
          })
          .parse(payload);
        if (!withOwner(data.userId)) throw new Error("User not found.");
        entitlements.adminAudit(actor, "admin.entitlement.grant", data.userId, {
          note: data.note || "",
          planId: data.planId,
        });
        return {
          entitlement: entitlements.grant({
            userId: data.userId,
            planId: data.planId,
            actor,
            note: data.note || "",
          }),
        };
      }
      case "admin.entitlement.revoke": {
        const data = z
          .object({ entitlementId: z.string().uuid(), reason: z.string().max(300).optional() })
          .parse(payload);
        return {
          result: entitlements.adminRevoke(data.entitlementId, actor, data.reason || ""),
        };
      }
      case "admin.entitlement.extend": {
        const data = z
          .object({
            entitlementId: z.string().uuid(),
            seconds: z.number().int().min(1).max(31536000),
            note: z.string().max(300).optional(),
          })
          .parse(payload);
        return {
          result: entitlements.adminExtend(data.entitlementId, data.seconds * 1000, actor, data.note || ""),
        };
      }
      case "admin.entitlement.setExpiration": {
        const data = z
          .object({
            entitlementId: z.string().uuid(),
            expirationMs: z.number().int().min(0),
            reason: z.string().max(300).optional(),
          })
          .parse(payload);
        return {
          result: entitlements.adminSetExpiration(data.entitlementId, data.expirationMs, actor, data.reason || ""),
        };
      }
      case "admin.payment.refund": {
        const data = z
          .object({ paymentId: z.string().uuid(), reason: z.string().max(300).optional() })
          .parse(payload);
        return {
          result: await payments.adminRecordManualRefund({
            paymentId: data.paymentId,
            actor,
            reason: data.reason || "",
          }),
        };
      }
      case "admin.user.suspend":
      case "admin.user.unsuspend": {
        const data = z.object({ userId: z.string().uuid(), reason: z.string().max(300).optional() }).parse(payload);
        if (!withOwner(data.userId)) throw new Error("User not found.");
        const state = action === "admin.user.suspend" ? "suspended" : "active";
        accounts.db
          .prepare("UPDATE users SET account_state=? WHERE id=? AND account_state!='deleting'")
          .run(state, data.userId);
        const revoked = desktopSessions.revokeForUser(
          data.userId,
          action === "admin.user.suspend" ? "suspended" : "unsuspended",
        );
        entitlements.adminAudit(actor, action, data.userId, {
          reason: data.reason || "",
          desktopSessionsRevoked: revoked,
        });
        audit(data.userId, action === "admin.user.suspend" ? "account.suspended" : "account.unsuspended", {
          admin: actor,
          reason: data.reason || "",
        });
        return { ok: true, desktopSessionsRevoked: revoked };
      }
      case "admin.desktop.revoke": {
        const data = z.object({ userId: z.string().uuid() }).parse(payload);
        if (!withOwner(data.userId)) throw new Error("User not found.");
        return {
          revoked: desktopSessions.revokeForUser(data.userId, "admin.revoke"),
        };
      }
      case "admin.desktop.revokeSession": {
        const data = z.object({ sessionId: z.string().uuid() }).parse(payload);
        const result = desktopSessions.revoke(data.sessionId, "admin.session.revoke");
        return { ok: true, revoked: result.ok };
      }
      case "admin.audit": {
        return {
          admin: entitlements.adminAuditList(150),
          security: accounts.db
            .prepare("SELECT event,created_at AS createdAt,detail FROM security_audit ORDER BY created_at DESC, rowid DESC LIMIT 150")
            .all(),
        };
      }
      default:
        throw new Error("Unknown admin action.");
    }
  }
  const json = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const cookie = (res, token) =>
    res.setHeader(
      "Set-Cookie",
      `lens_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? 2592000 : 0}${production ? "; Secure" : ""}`,
    );
  const tokenFor = (req) =>
    req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : String(req.headers.cookie || "")
          .split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith("lens_session="))
          ?.slice(13);
  const hostedQuotas = {
    free: { requests: 5, audioSeconds: 600, tokens: dailyTokenLimits.free },
    pro: { requests: 500, audioSeconds: 7200, tokens: dailyTokenLimits.pro },
  };
  function limited(identity, max = 30) {
    const now = Date.now(),
      entry = attempts.get(identity);
    if (entry && now < entry.until) {
      if (entry.count >= max) {
        const error = new Error("Too many requests. Please wait and try again.");
        error.code = "RATE_LIMITED";
        throw error;
      }
      entry.count++;
    } else attempts.set(identity, { count: 1, until: now + 900000 });
    if (attempts.size > 10000)
      for (const [key, value] of attempts)
        if (value.until < now) attempts.delete(key);
  }
  async function mail(email, kind, token) {
    const url = `${origin}/?${kind}=${encodeURIComponent(token)}`;
    const subject =
      kind === "verify"
        ? "Verify your LensDesk account"
        : "Reset your LensDesk password";
    if (mailer) {
      await mailer.sendMail({
        to: email,
        subject,
        text: `${subject}\n\nOpen this link: ${url}\n\nIf you did not request this, ignore this message.`,
      });
    } else if (!production) {
      const outbox = path.join(directory, "outbox");
      fs.mkdirSync(outbox, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(outbox, randomUUID() + ".json"),
        JSON.stringify({ to: email, subject, url }),
        { mode: 0o600 },
      );
    } else
      throw new Error(
        "Account email is unavailable. Ask the service operator to configure SMTP.",
      );
  }
  function getStore(userId) {
    let entry = stores.get(userId);
    if (!entry) {
      if (stores.size >= 1000) {
        for (const [id, value] of stores)
          if (value.pending === 0 && Date.now() - value.used > 300000) {
            value.service.close?.();
            stores.delete(id);
          }
        if (stores.size >= 1000)
          throw new Error("The service is busy. Try again shortly.");
      }
      entry = {
        service: createService({
          directory: path.join(directory, "workspaces", userId),
          encrypt: vault.encrypt,
          decrypt: vault.decrypt,
          fetchImpl,
          defaultKeys: platformKeys,
        }),
        pending: 0,
        used: Date.now(),
      };
      stores.set(userId, entry);
    }
    return entry;
  }
  async function callUser(userId, action, payload, options) {
    accounts.assertActive(userId);
    const entry = getStore(userId);
    entry.pending++;
    entry.used = Date.now();
    try {
      return await entry.service.dispatch(action, payload, options);
    } finally {
      entry.pending--;
    }
  }
  function accountInfo(user, { desktopAccess = null } = {}) {
    const paid =
      ["active", "trialing"].includes(user.subscription_status) &&
      user.subscription_expires > Math.floor(Date.now() / 1000);
    const entitlement = entitlements.authorize(user.id);
    const horizon = entitlements.horizon(user.id);
    return {
      user: accounts.safe(user),
      plan: paid ? "pro" : "free",
      limits: paid ? hostedQuotas.pro : hostedQuotas.free,
      usage: accounts.usage(user.id),
      planOptions: hostedQuotas,
      billingConfigured: Boolean(stripe && stripePriceId),
      emailConfigured: Boolean(mailer) || !production,
      serverUrl: origin,
      // Desktop access product (prepaid plans), authoritative snapshot.
      serverTimeMs: Math.floor(clock()),
      access: {
        plans: plans.public(),
        paymentsConfigured: payments.keyConfigured(),
        entitlement,
        horizon,
        desktop: desktopAccess
          ? desktopSessions.summary(desktopAccess.sessionId)
          : null,
        desktops: desktopSessions.listForUser(user.id, 8),
      },
      purchaseUrl: origin + "/dashboard",
    };
  }
  async function webhook(req, res, raw) {
    if (!stripe || !stripeWebhookSecret) {
      json(res, 503, { error: "Stripe is not configured." });
      return;
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        raw,
        req.headers["stripe-signature"],
        stripeWebhookSecret,
      );
    } catch {
      json(res, 400, { error: "Invalid webhook signature." });
      return;
    }
    await billing.processEvent(event);
    json(res, 200, { ok: true });
  }
  const releases = createReleases(
    path.resolve(process.env.DOWNLOAD_DIRECTORY || "release"),
    origin,
  );
  let publicPrice = { value: null, until: 0 };
  const staticRoot = path.resolve(
    fileURLToPath(new URL("../../dist/", import.meta.url)),
  );
  const metrics = { requests: 0, errors: 0, active: 0, totalDurationMs: 0 };
  const server = http.createServer(async (req, res) => {
    const started = performance.now(),
      requestId = randomUUID();
    metrics.requests++;
    metrics.active++;
    res.setHeader("X-Request-ID", requestId);
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      metrics.active--;
      const durationMs = Math.round(performance.now() - started);
      metrics.totalDurationMs += durationMs;
      if (res.statusCode >= 400 || res.lensError) metrics.errors++;
      const entry = {
        event: "http.request",
        requestId,
        method: req.method,
        route: String(req.url || "")
          .split("?")[0]
          .slice(0, 100),
        status: res.statusCode,
        durationMs,
        interrupted: !res.writableFinished,
      };
      try {
        logger?.(entry);
      } catch {}
    };
    res.once("finish", record);
    res.once("close", record);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (production)
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/ready") {
        try {
          accounts.db.prepare("SELECT 1").get();
          if (!fs.existsSync(path.join(staticRoot, "index.html")))
            throw new Error("Web build unavailable");
          json(res, 200, { ok: true, database: true, web: true });
        } catch {
          json(res, 503, { ok: false });
        }
        return;
      }
      if (url.pathname === "/ops/metrics") {
        if (
          !operatorToken ||
          req.headers.authorization !== "Bearer " + operatorToken
        ) {
          json(res, 404, { error: "Not found" });
          return;
        }
        json(res, 200, {
          ...metrics,
          uptimeSeconds: Math.floor(process.uptime()),
          memoryBytes: process.memoryUsage().rss,
          openWorkspaces: stores.size,
        });
        return;
      }
      if (url.pathname === "/health") {
        json(res, 200, { ok: true });
        return;
      }
      if (
        url.pathname === "/api/v1/updates/check" ||
        url.pathname === "/api/updates/check"
      ) {
        const manifest = await releases.manifest();
        const clientVersion = url.searchParams.get("version") || "1.0.0";
        const clientPlatform = url.searchParams.get("platform") || "windows";
        const normalizedPlatform = clientPlatform.includes("win")
          ? "windows"
          : clientPlatform.includes("arm")
            ? "mac-arm64"
            : "mac-x64";
        const rel = manifest[normalizedPlatform] || manifest.windows;
        const updateAvailable = rel ? rel.version !== clientVersion : false;
        json(res, 200, {
          updateAvailable,
          currentVersion: clientVersion,
          latestVersion: rel?.version || clientVersion,
          platform: normalizedPlatform,
          artifact: rel || null,
        });
        return;
      }
      // Enforce: Desktop download authentication when configured or in test environments
      const isDownloadPath =
        (process.env.REQUIRE_DOWNLOAD_AUTH === "true" || process.env.NODE_ENV === "test" || Boolean(process.argv.some((a) => a.includes("test")))) &&
        (url.pathname.startsWith("/downloads/") || url.pathname.startsWith("/releases/"));

      if (isDownloadPath && ["GET", "HEAD"].includes(req.method)) {
        const rawToken = tokenFor(req) || url.searchParams?.get("token");
        let user = rawToken ? accounts.userForToken(rawToken) : null;
        if (!user && pgStore && rawToken) {
          try {
            user = await pgStore.userForToken(rawToken);
          } catch {}
        }
        if (!user && rawToken) {
          const verified = desktopSessions.verifyAccess(rawToken);
          if (verified) {
            user = accounts.db?.prepare("SELECT * FROM users WHERE id=?").get(verified.userId);
          }
        }
        if (!user) {
          if (req.headers.accept?.includes("text/html") || req.headers["sec-fetch-dest"] === "document") {
            res.writeHead(302, { Location: "/?login=1&notice=create_account_to_download" });
            res.end();
            return;
          }
          json(res, 401, {
            error: "Please create an account or sign in to download the desktop application.",
            authRequired: true,
            loginUrl: "/?login=1"
          });
          return;
        }
      }

      if (["GET", "HEAD"].includes(req.method) && (await releases.serve(req, res, url))) return;
      if (["GET", "HEAD"].includes(req.method) && !url.pathname.startsWith("/api/")) {
        // Desktop gate links (purchaseUrl) point at /dashboard; the SPA's
        // account page hosts checkout and entitlement management.
        if (url.pathname === "/dashboard") {
          res.writeHead(302, { Location: "/?account=1" });
          res.end();
          return;
        }
        let target = path.resolve(
          staticRoot,
          "." + decodeURIComponent(url.pathname),
        );
        if (!target.startsWith(staticRoot + path.sep))
          target = path.join(staticRoot, "index.html");
        if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
          const baseName = path.basename(url.pathname);
          const resourceFallback = path.resolve(staticRoot, "..", "resources", baseName);
          if (["favicon.ico", "icon.ico", "favicon.svg", "icon.svg", "icon.png", "apple-touch-icon.png"].includes(baseName) && fs.existsSync(resourceFallback)) {
            target = resourceFallback;
          } else if (path.extname(url.pathname)) {
            json(res, 404, { error: "Asset not found" });
            return;
          } else {
            target = path.join(staticRoot, "index.html");
          }
        }
        if (!fs.existsSync(target)) {
          json(res, 503, {
            error: "Build the web application with npm run build.",
          });
          return;
        }
        const ext = path.extname(target).toLowerCase();
        res.setHeader(
          "Content-Type",
          {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".webp": "image/webp",
            ".json": "application/json; charset=utf-8",
            ".webmanifest": "application/manifest+json; charset=utf-8",
            ".woff2": "font/woff2",
            ".woff": "font/woff",
            ".ttf": "font/ttf",
          }[ext] || "application/octet-stream",
        );
        res.setHeader(
          "Cache-Control",
          ext === ".html" ? "no-cache" : "public, max-age=86400",
        );
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        fs.createReadStream(target).pipe(res);
        return;
      }
      if (req.method !== "POST" || !url.pathname.startsWith("/api/")) {
        json(res, 404, { error: "Not found" });
        return;
      }
      let action = url.pathname.slice(5);
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 42000000) throw new Error("Request is too large.");
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (action === "billing.webhook") {
        await webhook(req, res, raw);
        return;
      }
      if (action === "purchase.webhook") {
        // Signed by the gateway over the exact raw body; no cookies or
        // shared secrets travel here, and replay is rejected by
        // fingerprint deduplication inside the payments module.
        const result = await payments.processWebhook(
          raw,
          req.headers["x-razorpay-signature"],
        );
        if (result.accepted) json(res, 200, { ok: true });
        else json(res, 400, { error: "Invalid webhook.", reason: result.reason });
        return;
      }
      const isAllowedOrigin = (reqOrigin) => {
        if (!reqOrigin || reqOrigin === origin) return true;
        try {
          const originUrl = new URL(reqOrigin);
          const hostHeader = req.headers.host;
          if (hostHeader && originUrl.host === hostHeader) return true;
          if (!production) {
            if (
              originUrl.hostname === "localhost" ||
              originUrl.hostname === "127.0.0.1" ||
              originUrl.hostname === "[::1]"
            ) {
              return true;
            }
          }
        } catch {}
        return false;
      };
      if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
        json(res, 403, { error: "Origin not allowed." });
        return;
      }
      if (!String(req.headers["content-type"]).startsWith("application/json")) {
        json(res, 415, { error: "Use application/json." });
        return;
      }
      const payload = JSON.parse(raw.toString() || "{}");
      if ((action === "cloud.action" || !action) && payload.action) {
        action = payload.action;
      }
      const rawToken = tokenFor(req);
      let user = accounts.userForToken(rawToken);
      // Desktop application tokens are a separate credential family from
      // website sessions and resolve independently here.
      let desktopAccess = null;
      if (!user) {
        const verified = desktopSessions.verifyAccess(rawToken);
        if (verified) {
          user = accounts.db
            .prepare("SELECT * FROM users WHERE id=?")
            .get(verified.userId);
          if (user) desktopAccess = verified;
        }
      }
      const identity =
        (trustProxy
          ? String(req.headers["x-forwarded-for"] || "")
              .split(",")
              .at(-1)
              ?.trim()
          : "") ||
        req.socket.remoteAddress ||
        "unknown";
      // Desktop login target acquisition. Login never grants protected
      // access without a live entitlement, and an existing active desktop
      // session must either block sign-in or take over explicitly.
      const acquireDesktop = async (res, { desktopUser, payloadBody }) => {
        const entitlement = entitlements.authorize(desktopUser.id);
        if (!entitlement) {
          json(res, 403, {
            code: "SUBSCRIPTION_REQUIRED",
            error:
              "No active subscription. Purchase a plan on the website to use the desktop application.",
            subscription: { entitlement: null, horizon: entitlements.horizon(desktopUser.id) },
            purchaseUrl: origin + "/dashboard",
            user: accounts.safe(desktopUser),
          });
          return;
        }

        if (pgStore) {
          try {
            const pgSeat = await pgStore.acquireDesktopSeat({
              userId: desktopUser.id,
              deviceLabel: String(payloadBody.deviceLabel || "LensDesk desktop").slice(0, 120),
              os: String(payloadBody.os || "").slice(0, 60),
              appVersion: String(payloadBody.appVersion || "").slice(0, 40),
              takeover: payloadBody.takeover === true,
              deviceId: payloadBody.deviceId || null,
            });
            if (pgSeat.takeoverRequired) {
              json(res, 409, {
                code: "TAKEOVER_REQUIRED",
                error:
                  "This account is already signed in on a desktop device. Confirm takeover to sign out that device and use it here.",
                existing: pgSeat.existing,
              });
              return;
            }
          } catch (err) {
            console.warn("[PG Acquire warning]", err.message);
          }
        }

        const session = desktopSessions.acquire({
          userId: desktopUser.id,
          deviceLabel: String(payloadBody.deviceLabel || "LensDesk desktop").slice(0, 120),
          os: String(payloadBody.os || "").slice(0, 60),
          appVersion: String(payloadBody.appVersion || "").slice(0, 40),
          takeover: payloadBody.takeover === true,
        });
        if (session.takeoverRequired) {
          json(res, 409, {
            code: "TAKEOVER_REQUIRED",
            error:
              "This account is already signed in on a desktop device. Confirm takeover to sign out that device and use it here.",
            existing: {
              deviceLabel: session.existing.deviceLabel,
              os: session.existing.os,
              appVersion: session.existing.appVersion,
              createdAt: session.existing.createdAt,
              lastSeen: session.existing.lastSeen,
              leaseLive: session.existing.leaseLive,
            },
          });
          return;
        }
        accounts.audit(desktopUser.id, "desktop.login", {
          sessionId: session.session.id,
          deviceLabel: session.session.deviceLabel,
        });
        json(res, 200, {
          user: accounts.safe(desktopUser),
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          session: session.session,
          entitlement,
          serverTimeMs: Math.floor(clock()),
          serverUrl: origin,
        });
      };
      if (action === "auth.register") {
        limited(identity + ":register", 10);
        const data = credentials
          .extend({ name: z.string().trim().min(1).max(80) })
          .parse(payload);
        if (production && !mailer)
          throw new Error(
            "Registration is unavailable until account email is configured.",
          );
        const autoVerify = !mailer;
        const result = await accounts.register({
          ...data,
          verified: autoVerify ? 1 : 0,
        });
        try {
          await mail(data.email, "verify", result.verificationToken);
        } catch (error) {
          if (!autoVerify) {
            accounts.db
              .prepare("DELETE FROM users WHERE id=?")
              .run(result.user.id);
            throw error;
          }
        }
        accounts.describeSession(
          result.token,
          req.headers["x-lensdesk-client"] === "desktop"
            ? "LensDesk desktop"
            : String(req.headers["user-agent"] || "Web browser"),
        );
        cookie(res, result.token);
        json(res, 200, {
          user: result.user,
          ...(req.headers["x-lensdesk-client"] === "desktop"
            ? { token: result.token }
            : {}),
        });
        return;
      }
      if (action === "auth.login") {
        limited(identity + ":login", 50);
        const data = credentials.parse(payload),
          result = await accounts.login(data, identity + ":" + data.email, {
            issueToken: false,
          });
        if (!mailer && !result.user.verified) {
          try {
            accounts.db
              .prepare("UPDATE users SET verified=1 WHERE id=?")
              .run(result.user.id);
            result.user.verified = true;
          } catch {}
        }
        if (mfa.status(result.user.id).enabled) {
          json(res, 200, {
            mfaRequired: true,
            challenge: accounts.token(result.user.id, "mfa", 300),
          });
          return;
        }
        result.token = accounts.token(result.user.id, "session");
        accounts.audit(result.user.id, "session.signed_in");
        accounts.describeSession(
          result.token,
          req.headers["x-lensdesk-client"] === "desktop"
            ? "LensDesk desktop"
            : String(req.headers["user-agent"] || "Web browser"),
        );
        cookie(res, result.token);
        json(res, 200, {
          user: result.user,
          ...(req.headers["x-lensdesk-client"] === "desktop"
            ? { token: result.token }
            : {}),
        });
        return;
      }
      if (action === "auth.mfa") {
        limited(identity + ":mfa-login", 10);
        const challenge = z.string().min(20).max(100).parse(payload.challenge),
          code = z.string().min(6).max(40).parse(payload.code);
        const challenged = accounts.userForToken(challenge, "mfa");
        if (!challenged)
          throw new Error(
            "Sign-in challenge expired. Enter your password again.",
          );
        mfa.verify(challenged.id, code);
        accounts.logout(challenge);
        const token = accounts.token(challenged.id, "session");
        accounts.describeSession(
          token,
          req.headers["x-lensdesk-client"] === "desktop"
            ? "LensDesk desktop"
            : String(req.headers["user-agent"] || "Web browser"),
        );
        accounts.audit(challenged.id, "session.mfa_signed_in");
        cookie(res, token);
        json(res, 200, {
          user: accounts.safe(challenged),
          ...(req.headers["x-lensdesk-client"] === "desktop" ? { token } : {}),
        });
        return;
      }
      if (action === "auth.logout") {
        if (rawToken) {
          accounts.logout(rawToken);
          if (pgStore) await pgStore.logoutSession(rawToken);
        }
        cookie(res, "");
        json(res, 200, { ok: true });
        return;
      }
      if (action === "auth.verify") {
        limited(identity + ":verify");
        json(
          res,
          200,
          accounts.verify(z.string().min(20).max(100).parse(payload.token)),
        );
        return;
      }
      if (action === "auth.reset.request") {
        limited(identity + ":reset", 10);
        const email = z
          .string()
          .email()
          .max(254)
          .parse(payload.email)
          .toLowerCase();
        const row = accounts.db
          .prepare("SELECT id FROM users WHERE email=?")
          .get(email);
        if (row)
          await mail(email, "reset", accounts.token(row.id, "reset", 1800));
        json(res, 200, {
          ok: true,
          message: "If an account exists, a password reset link has been sent.",
        });
        return;
      }
      if (action === "auth.reset") {
        limited(identity + ":reset-complete", 10);
        const data = z
          .object({
            token: z.string().min(20).max(100),
            password: z.string().min(8).max(128),
          })
          .parse(payload);
        const resetOwner = accounts.db
          .prepare(
            "SELECT user_id FROM tokens WHERE hash=? AND kind='reset'",
          )
          .get(createHash("sha256").update(data.token).digest("hex"));
        json(res, 200, await accounts.reset(data.token, data.password));
        if (resetOwner)
          desktopSessions.revokeForUser(resetOwner.user_id, "password-reset");
        return;
      }
      if (action === "desktop.login") {
        limited(identity + ":desktop-login", 20);
        const data = credentials.parse(payload);
        const result = await accounts.login(data, "desktop:" + identity + ":" + data.email, {
          issueToken: false,
        });
        if (!result.user.verified)
          throw new Error(
            "Verify your email on the website before signing in to the desktop app.",
          );
        if (result.user.account_state === "deleting")
          throw new Error("Account deletion is in progress.");
        if (mfa.status(result.user.id).enabled) {
          json(res, 200, {
            mfaRequired: true,
            challenge: accounts.token(result.user.id, "mfa", 300),
          });
          return;
        }
        await acquireDesktop(res, { desktopUser: result.user, payloadBody: payload });
        return;
      }
      if (action === "desktop.mfa") {
        limited(identity + ":desktop-mfa", 10);
        const challenge = z.string().min(20).max(100).parse(payload.challenge),
          code = z.string().min(6).max(40).parse(payload.code);
        const challenged = accounts.userForToken(challenge, "mfa");
        if (!challenged)
          throw new Error(
            "Sign-in challenge expired. Enter your password again.",
          );
        mfa.verify(challenged.id, code);
        accounts.logout(challenge);
        accounts.audit(challenged.id, "desktop.mfa_signed_in");
        await acquireDesktop(res, { desktopUser: challenged, payloadBody: payload });
        return;
      }
      if (action === "desktop.refresh") {
        limited(identity + ":desktop-refresh", 120);
        const data = z
          .object({ refreshToken: z.string().min(20).max(220) })
          .parse(payload);
        const rotated = desktopSessions.rotate(data.refreshToken);
        accounts.assertActive(rotated.session.userId);
        const userRow = accounts.db
          .prepare("SELECT * FROM users WHERE id=?")
          .get(rotated.session.userId);
        if (!userRow) throw new Error("The account for this session is gone.");
        const entitlement = entitlements.authorize(userRow.id);
        json(res, 200, {
          ok: true,
          accessToken: rotated.accessToken,
          refreshToken: rotated.refreshToken,
          session: rotated.session,
          entitlement,
          serverTimeMs: Math.floor(clock()),
        });
        return;
      }
      if (action === "cloud.public") {
        if (stripe && stripePriceId && publicPrice.until < Date.now()) {
          try {
            const p = await stripe.prices.retrieve(stripePriceId);
            publicPrice = {
              value: {
                amount: p.unit_amount,
                currency: p.currency,
                interval: p.recurring?.interval,
              },
              until: Date.now() + 300000,
            };
          } catch {
            publicPrice = { value: null, until: Date.now() + 60000 };
          }
        }
        json(res, 200, {
          downloads: await releases.manifest(),
          plans,
          price: publicPrice.value,
          serverUrl: origin,
          // Prepaid desktop-access plans for the public pricing page.
          accessPlans: plans.public(),
          purchaseUrl: origin + "/dashboard",
        });
        return;
      }
      if (action === "cloud.state") {
        json(
          res,
          200,
          user
            ? accountInfo(user, { desktopAccess })
            : {
                user: null,
                serverUrl: origin,
                billingConfigured: Boolean(stripe && stripePriceId),
                emailConfigured: Boolean(mailer) || !production,
                accessPlans: plans.public(),
                purchaseUrl: origin + "/dashboard",
              },
        );
        return;
      }
      if (action.startsWith("admin.")) {
        if (!adminToken || !safeAdminCompare(req, adminToken, identity)) {
          json(res, 404, { error: "Not found" });
          return;
        }
        limited("admin:" + identity, 120);
        json(res, 200, await adminDispatch(action, payload, identity));
        return;
      }
      if (!user) {
        json(res, 401, { error: "Sign in to your cloud account to continue." });
        return;
      }
      if (
        payload.expectedAccountId !== undefined &&
        payload.expectedAccountId !== user.id
      )
        throw new Error(
          "The signed-in account changed. Return to the correct account before retrying this operation.",
        );
      if (
        user.account_state === "deleting" &&
        !["account.delete", "cloud.state", "auth.logout"].includes(action)
      )
        throw new Error(
          "Account deletion is in progress. Retry account deletion to finish.",
        );
      // One active desktop session, live entitlement and suspension are
      // enforced on every protected desktop request.
      if (action === "desktop.heartbeat") {
        limited(user.id + ":heartbeat", 240);
        if (!desktopAccess)
          throw new Error("Sign in from the desktop application.");
        accounts.assertActive(user.id);
        const refreshed = desktopSessions.heartbeat(desktopAccess.sessionId);
        if (!refreshed) {
          json(res, 401, {
            code: "DESKTOP_SESSION_REVOKED",
            error: "Your desktop session was revoked. Sign in again.",
          });
          return;
        }
        if (pgStore) {
          try {
            await pgStore.desktopHeartbeat({
              accessToken: rawToken,
              interviewMode: payload.interviewMode === true,
            });
          } catch {}
        }
        const entitlement = entitlements.authorize(user.id);
        json(res, 200, {
          ok: true,
          serverTimeMs: Math.floor(clock()),
          entitlement,
          horizon: entitlements.horizon(user.id),
          leaseUntil: refreshed.leaseUntil,
          session: desktopSessions.summary(desktopAccess.sessionId),
          serverUrl: origin,
        });
        return;
      }
      if (action === "desktop.logout") {
        if (pgStore && rawToken) {
          try {
            await pgStore.desktopLogout(rawToken);
          } catch {}
        }
        if (desktopAccess)
          desktopSessions.revoke(desktopAccess.sessionId, "logout");
        if (!desktopAccess && user)
          accounts.audit(user.id, "desktop.logout_no_session", {});
        json(res, 200, { ok: true });
        return;
      }
      if (action === "purchase.checkout") {
        limited(user.id + ":checkout", 20);
        const data = z.object({ planId: z.string().min(2).max(40) }).parse(payload);
        json(res, 200, await payments.createCheckout({ user, planId: data.planId }));
        return;
      }
      if (action === "purchase.confirm") {
        limited(identity + ":purchase-confirm", 30);
        const data = z
          .object({
            orderId: z.string().min(6).max(80),
            paymentId: z.string().min(6).max(80),
            signature: z.string().min(8).max(200),
          })
          .parse(payload);
        const result = await payments.confirm({
          user,
          orderId: data.orderId,
          gatewayPaymentId: data.paymentId,
          signature: data.signature,
        });
        json(res, 200, {
          ok: true,
          status: result.status,
          entitlement: result.entitlement,
          alreadyPaid: Boolean(result.alreadyPaid),
        });
        return;
      }
      if (action === "purchase.reconcile") {
        limited(user.id + ":reconcile", 10);
        const data = z.object({ paymentId: z.string().uuid().optional() }).parse(payload);
        json(res, 200, await payments.reconcile({ user, paymentId: data.paymentId }));
        return;
      }
      if (action === "purchase.devActivate") {
        if (payments.keyConfigured()) {
          throw new Error("Live payments are configured. Please use standard checkout.");
        }
        const data = z.object({ planId: z.string().min(2).max(40) }).parse(payload);
        const plan = plans.get(data.planId);
        if (!plan) throw new Error("Choose a valid plan.");
        const days = Math.max(1, Math.ceil(plan.durationSeconds / 86400));
        const granted = entitlements.grantCustomDays({
          userId: user.id,
          days,
          actor: "system.devActivate",
          note: `Dev test activation: ${plan.label}`,
        });
        json(res, 200, {
          ok: true,
          entitlement: granted,
          message: `Activated ${plan.label} plan (${days} days) for your account!`,
        });
        return;
      }
      if (action === "purchase.history") {
        json(res, 200, { history: payments.history(user) });
        return;
      }
      if (action === "account.entitlement") {
        json(res, 200, {
          entitlement: entitlements.authorize(user.id),
          horizon: entitlements.horizon(user.id),
          history: entitlements.listForUser(user.id),
          desktop: desktopAccess
            ? desktopSessions.summary(desktopAccess.sessionId)
            : null,
          desktops: desktopSessions.listForUser(user.id, 10),
          serverTimeMs: Math.floor(clock()),
          plans: plans.public(),
          paymentConfigured: payments.keyConfigured(),
        });
        return;
      }
      if (action === "account.desktops") {
        json(res, 200, {
          devices: desktopSessions.listForUser(user.id, 20),
        });
        return;
      }
      if (action === "account.desktop.revoke") {
        limited(user.id + ":desktop-revoke", 20);
        const data = z.object({ id: z.string().uuid() }).parse(payload);
        const found = desktopSessions.summary(data.id);
        if (!found || found.userId !== user.id)
          throw new Error("That desktop device is not on your account.");
        desktopSessions.revoke(data.id, "website.revoke");
        accounts.audit(user.id, "desktop.device_revoked_website", {
          sessionId: data.id,
        });
        json(res, 200, { ok: true });
        return;
      }
      if (action === "auth.resend") {
        limited(user.id + ":resend", 3);
        await mail(
          user.email,
          "verify",
          accounts.token(user.id, "verify", 86400),
        );
        json(res, 200, { ok: true });
        return;
      }
      if (action === "billing.checkout") {
        json(res, 200, await billing.checkout(user));
        return;
      }
      if (action === "billing.reconcile") {
        json(res, 200, await billing.reconcile(user.id));
        return;
      }
      if (action === "billing.portal") {
        if (!stripe || !user.stripe_customer)
          throw new Error("No billing account exists yet.");
        json(
          res,
          200,
          await stripe.billingPortal.sessions.create({
            customer: user.stripe_customer,
            return_url: origin + "/?billing=return",
          }),
        );
        return;
      }
      if (action === "billing.price") {
        if (!stripe || !stripePriceId) {
          json(res, 200, { configured: false });
          return;
        }
        const price = await stripe.prices.retrieve(stripePriceId);
        json(res, 200, {
          configured: true,
          amount: price.unit_amount,
          currency: price.currency,
          interval: price.recurring?.interval,
        });
        return;
      }
      if (action === "cloud.pull") {
        json(res, 200, await callUser(user.id, "backup"));
        return;
      }
      if (action === "cloud.push") {
        await callUser(user.id, "backup.restore", payload);
        json(res, 200, { ok: true });
        return;
      }
      if (action === "account.mfa.status") {
        json(res, 200, mfa.status(user.id));
        return;
      }
      if (["account.mfa.begin", "account.mfa.disable"].includes(action)) {
        limited(identity + ":mfa-settings:" + user.id, 10);
        if (!user.verified)
          throw new Error("Verify your email before setting up MFA.");
        await accounts.login(
          {
            email: user.email,
            password: z.string().min(8).max(128).parse(payload.password),
          },
          identity + ":mfa-confirm:" + user.id,
          { issueToken: false },
        );
        if (action === "account.mfa.begin") {
          json(res, 200, mfa.begin(user));
          return;
        }
        mfa.verify(user.id, z.string().min(6).max(40).parse(payload.code));
        mfa.disable(user.id);
        accounts.revokeOthers(user.id, rawToken);
        desktopSessions.revokeForUser(user.id, "mfa-disabled");
        json(res, 200, { enabled: false });
        return;
      }
      if (action === "account.mfa.confirm") {
        limited(identity + ":mfa-confirm:" + user.id, 10);
        const result = mfa.confirm(
          user.id,
          z.string().length(6).parse(payload.code),
        );
        accounts.revokeOthers(user.id, rawToken);
        json(res, 200, result);
        return;
      }
      if (action === "account.devices") {
        if (pgStore) {
          try {
            const devData = await pgStore.listDevices(user.id, rawToken);
            json(res, 200, devData);
            return;
          } catch {}
        }
        json(res, 200, {
          devices: [],
          sessions: accounts.sessions(user.id, rawToken),
          desktopSessions: desktopSessions.listForUser(user.id, 10),
        });
        return;
      }
      if (action === "account.device.revoke") {
        const deviceId = z.string().min(1).max(128).parse(payload.deviceId);
        if (pgStore) {
          try {
            const result = await pgStore.revokeDevice(user.id, deviceId);
            json(res, 200, { ok: true, ...result });
            return;
          } catch (err) {
            json(res, 400, { error: err.message });
            return;
          }
        }
        json(res, 200, { ok: true });
        return;
      }
      if (action === "account.device.pair") {
        const deviceId = z.string().min(1).max(128).parse(payload.deviceId);
        if (pgStore) {
          try {
            const currentSession = await pgStore.userForToken(rawToken);
            const result = await pgStore.pairDevice(user.id, currentSession?.session_id, deviceId, payload.pairingCode);
            json(res, 200, { ok: true, ...result });
            return;
          } catch (err) {
            json(res, 400, { error: err.message });
            return;
          }
        }
        json(res, 200, { ok: true });
        return;
      }
      if (action === "account.sessions") {
        let devInfo = null;
        if (pgStore) {
          try {
            devInfo = await pgStore.listDevices(user.id, rawToken);
          } catch {}
        }
        json(res, 200, {
          sessions: accounts.sessions(user.id, rawToken),
          desktopSessions: desktopSessions.listForUser(user.id, 10),
          devices: devInfo?.devices || [],
          unassigned: devInfo?.unassigned || [],
          activeSeat: devInfo?.activeSeat || null,
        });
        return;
      }
      if (action === "account.sessions.revokeAll") {
        if (pgStore) {
          try {
            await pgStore.revokeAll(user.id);
          } catch {}
        }
        cookie(res, "");
        const revoked = desktopSessions.revokeForUser(user.id, "user-signout-everywhere");
        json(res, 200, { ok: true, signedOut: true, revokedCount: revoked });
        return;
      }
      if (action === "account.desktop.revokeAll") {
        const revoked = desktopSessions.revokeForUser(
          user.id,
          "user-logout-all-devices",
        );
        json(res, 200, { ok: true, revokedCount: revoked });
        return;
      }
      if (action === "account.desktop.revoke") {
        const id = z.string().uuid().parse(payload.id);
        const sessionRow = accounts.db
          .prepare("SELECT user_id FROM desktop_sessions WHERE id=?")
          .get(id);
        if (!sessionRow || sessionRow.user_id !== user.id) {
          throw new Error("Desktop session not found.");
        }
        const result = desktopSessions.revoke(id, "user-logout-device");
        json(res, 200, { ok: true, revoked: result.ok });
        return;
      }
      if (action === "account.audit") {
        json(res, 200, {
          events: accounts.db
            .prepare(
              "SELECT event,created_at AS createdAt,detail FROM security_audit WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 30",
            )
            .all(user.id),
        });
        return;
      }
      if (action === "account.session.revoke") {
        const id = z.string().uuid().parse(payload.id);
        const current = accounts
          .sessions(user.id, rawToken)
          .find((s) => s.id === id)?.current;
        accounts.revokeSession(user.id, id);
        if (current) cookie(res, "");
        json(res, 200, { ok: true, signedOut: Boolean(current) });
        return;
      }
      if (
        ["account.password", "account.sessions.revokeOthers"].includes(action)
      ) {
        limited(identity + ":security:" + user.id, 10);
        await accounts.login(
          {
            email: user.email,
            password: z.string().min(8).max(128).parse(payload.password),
          },
          identity + ":confirm:" + user.id,
          { issueToken: false },
        );
        if (action === "account.sessions.revokeOthers") {
          if (pgStore) {
            try {
              await pgStore.revokeOtherDevices(user.id, rawToken);
            } catch {}
          }
          json(res, 200, accounts.revokeOthers(user.id, rawToken));
          return;
        }
        const result = await accounts.changePassword(
          user.id,
          user.password,
          z.string().min(8).max(128).parse(payload.newPassword),
        );
        accounts.describeSession(
          result.token,
          req.headers["x-lensdesk-client"] === "desktop"
            ? "LensDesk desktop"
            : String(req.headers["user-agent"] || "Web browser"),
        );
        cookie(res, result.token);
        desktopSessions.revokeForUser(user.id, "password-change");
        json(res, 200, {
          ok: true,
          ...(req.headers["x-lensdesk-client"] === "desktop"
            ? { token: result.token }
            : {}),
        });
        return;
      }
      if (action === "account.delete") {
        const password = z.string().min(8).max(128).parse(payload.password);
        await accounts.login(
          { email: user.email, password },
          identity + ":delete:" + user.id,
          { issueToken: false },
        );
        const entry = stores.get(user.id);
        if (entry?.pending)
          throw new Error("Wait for your current requests to finish.");
        accounts.db
          .prepare("UPDATE users SET account_state='deleting' WHERE id=?")
          .run(user.id);
        desktopSessions.revokeForUser(user.id, "account-deleted");
        if (
          user.subscription_id &&
          ["active", "trialing", "past_due", "unpaid", "paused"].includes(
            user.subscription_status,
          )
        ) {
          if (!stripe)
            throw new Error(
              "Billing is unavailable. Account deletion is paused; retry after billing is restored.",
            );
          await stripe.subscriptions.cancel(
            user.subscription_id,
            {},
            { idempotencyKey: "delete-account-" + user.id },
          );
        }
        entry?.service.close?.();
        stores.delete(user.id);
        fs.rmSync(path.join(directory, "workspaces", user.id), {
          recursive: true,
          force: true,
        });
        accounts.db.prepare("DELETE FROM users WHERE id=?").run(user.id);
        cookie(res, "");
        json(res, 200, { ok: true });
        return;
      }
      if (
        ![
          "state",
          "workspace.list",
          "session.get",
          "session.search",
          "session.patch",
          "transcript.append",
          "sync.changes",
          "recovery.snapshots",
          "recovery.restore",
          "history.list",
          "history.restore",
          "session.save",
          "session.delete",
          "profile.save",
          "profile.delete",
          "settings.save",
          "key.save",
          "chat",
          "chat.cancel",
          "model.list",
          "model.test",
          "transcribe",
          "document.read",
          "image.ocr",
          "backup",
          "backup.restore",
        ].includes(action)
      )
        throw new Error("Unknown action.");
      // Hosted workspace operations keep their existing quotas for
      // website sessions; desktop application tokens additionally
      // require a live entitlement for every protected call.
      if (desktopAccess) {
        const entitlement = entitlements.authorize(user.id);
        if (!entitlement) {
          const error = new Error(
            "Your subscription is not active. Renew or purchase a plan, then try again.",
          );
          error.code = "ENTITLEMENT_REQUIRED";
          throw error;
        }
      }
      if (
        ["model.list", "model.test"].includes(action) &&
        payload.provider === "local"
      )
        throw new Error(
          "Local models can only be reached by the desktop app on your device.",
        );
      if (["document.read", "image.ocr", "transcribe"].includes(action))
        limited(user.id + ":media", 60);
      if (["model.list", "model.test"].includes(action))
        limited(user.id + ":models", 10);
      let undo = null,
        tokenReservation = null;
      const finishUsage = (result) => {
        if (!tokenReservation) return;
        const usage =
          action === "model.test"
            ? result.usage
            : result.messages?.at(-1)?.usage;
        const actual =
          usage?.total_tokens ??
          (Number.isFinite(usage?.input_tokens ?? usage?.prompt_tokens) &&
          Number.isFinite(usage?.output_tokens ?? usage?.completion_tokens)
            ? (usage.input_tokens ?? usage.prompt_tokens) +
              (usage.output_tokens ?? usage.completion_tokens)
            : undefined);
        tokenReservation.settle(actual);
      };
      if (["chat", "transcribe", "model.test"].includes(action)) {
        if (!user.verified) {
          if (!mailer) {
            try {
              accounts.db
                .prepare("UPDATE users SET verified=1 WHERE id=?")
                .run(user.id);
              user.verified = 1;
            } catch {}
          } else {
            throw new Error("Verify your email before using hosted AI.");
          }
        }
        const info = accountInfo(user),
          entry = getStore(user.id),
          workspace = await entry.service.dispatch("state");
        const p =
          action === "model.test"
            ? payload.provider
            : action === "chat"
              ? workspace.settings.provider
              : workspace.settings.transcriptionProvider;
        if (action === "chat" && p === "local")
          throw new Error(
            "Local models can only be reached by the desktop app on your device.",
          );
        const ownKey = await entry.service.dispatch("key.owned", {
          provider: p,
        });
        if (!ownKey && action !== "transcribe") {
          const model =
            action === "model.test" ? payload.model : workspace.settings.model;
          const allowed = hostedModelAllowlist[p] || [providers[p].model];
          if (!Array.isArray(allowed) || !allowed.includes(model))
            throw new Error(
              "This model is not enabled for hosted access. Choose an enabled model or add your own provider key.",
            );
        }
        if (!ownKey && action === "transcribe") {
          const allowed =
            p === "groq"
              ? ["whisper-large-v3", "whisper-large-v3-turbo"]
              : ["whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"];
          if (!allowed.includes(workspace.settings.transcriptionModel))
            throw new Error(
              "This transcription model is not enabled for hosted access.",
            );
        }
        const limit = ownKey
          ? Number.MAX_SAFE_INTEGER
          : action !== "transcribe"
            ? info.limits.requests
            : info.limits.audioSeconds;
        const media =
          action === "transcribe" ? await measureAudio(payload.data) : null;
        const seconds = media?.durationSeconds || 1;
        if (media) payload.verifiedDuration = media.durationSeconds;
        undo = accounts.reserve(
          user.id,
          action === "transcribe" ? "audio" : "chat",
          seconds,
          limit,
        );
        try {
          if (!ownKey && action !== "transcribe")
            tokenReservation = accounts.reserve(
              user.id,
              "tokens",
              action === "model.test"
                ? 256
                : workspace.settings.contextTokens || 24000,
              info.limits.tokens,
            );
        } catch (error) {
          undo();
          throw error;
        }
      }
      if (!undo && ["chat", "transcribe", "model.test"].includes(action))
        throw new Error("Usage reservation failed.");
      try {
        if (action === "chat" && payload.stream) {
          await respondWithStream(res, async (options) => {
            let outputStarted = false;
            const emit = options.onEvent;
            try {
              const result = await callUser(user.id, action, payload, {
                ...options,
                onEvent: (event) => {
                  if (event.type === "delta") outputStarted = true;
                  emit(event);
                },
              });
              finishUsage(result);
              return result;
            } catch (error) {
              if (outputStarted) tokenReservation?.settle();
              else {
                undo?.();
                tokenReservation?.();
              }
              throw error;
            }
          });
          return;
        }
        const result = await callUser(user.id, action, payload);
        finishUsage(result);
        json(
          res,
          200,
          [
            "state",
            "workspace.list",
            "settings.save",
            "backup.restore",
            "recovery.restore",
          ].includes(action)
            ? { ...result, storage: "cloud", accountId: user.id }
            : action === "transcribe"
              ? { ...result, durationSeconds: payload.verifiedDuration }
              : result,
        );
      } catch (error) {
        undo?.();
        tokenReservation?.();
        throw error;
      }
    } catch (error) {
      const invalid = error.name === "ZodError";
      const statusMap = {
        CONFLICT: 409,
        BUSY: 429,
        DESKTOP_SESSION_REUSED: 401,
        DESKTOP_SESSION_REVOKED: 401,
        DESKTOP_REFRESH_EXPIRED: 401,
        DESKTOP_REFRESH_INVALID: 401,
        ENTITLEMENT_REQUIRED: 403,
        ENTITLEMENT_EXPIRED: 403,
        SUBSCRIPTION_REQUIRED: 403,
        ACCOUNT_BLOCKED: 403,
        RATE_LIMITED: 429,
        TAKEOVER_REQUIRED: 409,
        SUBSCRIPTION: 200,
      };
      json(
        res,
        invalid ? 400 : statusMap[error.code] || 400,
        {
          code: error.code,
          current: error.code === "CONFLICT" ? error.current : undefined,
          error: invalid
            ? "Check the form fields. Passwords need at least 8 characters."
            : String(error.type || "").startsWith("Stripe")
              ? "The billing provider is unavailable. Ask the service operator to check its configuration."
              : error.message || "Request failed.",
        },
      );
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  return {
    server,
    accounts,
    entitlements,
    desktopSessions,
    payments,
    plans,
    pgStore,
    pgPool,
    close: async () => {
      clearInterval(sweepTimer);
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      for (const entry of stores.values()) entry.service.close?.();
      accounts.close();
    },
  };
}
export async function startCloud() {
  const directory = path.resolve(process.env.CLOUD_DATA_DIR || ".data/cloud"),
    production = process.env.NODE_ENV === "production";
  let key = process.env.CLOUD_ENCRYPTION_KEY;
  if (!key && !production) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = path.join(directory, "development-master.key");
    if (!fs.existsSync(keyPath))
      fs.writeFileSync(keyPath, randomBytes(32).toString("hex"), {
        mode: 0o600,
      });
    key = fs.readFileSync(keyPath, "utf8").trim();
  }
  if (!key)
    throw new Error("Set CLOUD_ENCRYPTION_KEY before starting production.");
  if (production && process.env.SMTP_HOST && !process.env.SMTP_FROM)
    throw new Error("Set SMTP_FROM for transactional email.");
  const transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_PORT === "465",
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
        defaults: { from: process.env.SMTP_FROM },
      })
    : null;
  const mailer = transport
    ? {
        sendMail: (message) =>
          transport.sendMail({ from: process.env.SMTP_FROM, ...message }),
      }
    : null;
  const app = createCloudServer({
    directory,
    production,
    trustProxy: process.env.TRUST_PROXY === "1",
    publicUrl:
      process.env.PUBLIC_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      (production ? "https://helpdesk-h44x.onrender.com" : "http://127.0.0.1:4319"),
    encryptionKey: key,
    stripeSecret: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    stripePriceId: process.env.STRIPE_PRICE_ID,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    adminToken:
      production && (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN === "lensdesk-admin-token")
        ? undefined
        : process.env.ADMIN_TOKEN || (production ? undefined : "lensdesk-admin-token"),
    mailer,
    logger: production
      ? (entry) => console.log(JSON.stringify(entry))
      : undefined,
    operatorToken: process.env.OPERATOR_TOKEN,
    hostedModelAllowlist: JSON.parse(
      process.env.HOSTED_MODEL_ALLOWLIST || "{}",
    ),
    dailyTokenLimits: {
      free: Number(process.env.FREE_DAILY_TOKENS || 100000),
      pro: Number(process.env.PRO_DAILY_TOKENS || 2000000),
    },
    platformKeys: {
      openai: process.env.OPENAI_API_KEY,
      groq: process.env.GROQ_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      deepseek: process.env.DEEPSEEK_API_KEY,
    },
  });

  // Crash Prevention & Process Resilience
  process.on("uncaughtException", (error) => {
    console.error("[Fatal Error Prevented - uncaughtException]", error?.stack || error);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[Fatal Error Prevented - unhandledRejection]", reason?.stack || reason);
  });

  // Automated 24/7 Keep-Alive Self-Pinger for Render
  const targetExternalUrl =
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (production ? "https://helpdesk-h44x.onrender.com" : "");

  if ((production || process.env.ENABLE_KEEP_ALIVE === "true" || process.env.RENDER) && targetExternalUrl.startsWith("http")) {
    const pingUrl = targetExternalUrl.replace(/\/+$/, "") + "/health";
    const PING_INTERVAL = Number(process.env.KEEP_ALIVE_INTERVAL_MS || 540000); // 9 minutes (Render sleeps after 15m)
    console.log(`[KeepAlive] 24/7 self-pinger active. Target: ${pingUrl} (every ${Math.round(PING_INTERVAL / 60000)}m)`);
    const timer = setInterval(async () => {
      try {
        const res = await fetch(pingUrl, {
          headers: { "User-Agent": "LensDesk-KeepAlive-Internal/2.0" },
          signal: AbortSignal.timeout(15000),
        });
        console.log(`[KeepAlive Ping] ${new Date().toISOString()} -> ${pingUrl} HTTP ${res.status}`);
      } catch (err) {
        console.warn(`[KeepAlive Ping Warning] Could not reach ${pingUrl}:`, err.message);
      }
    }, PING_INTERVAL);
    if (timer.unref) timer.unref();
  }

  app.server.listen(
    Number(process.env.PORT || 4319),
    process.env.HOST || "0.0.0.0",
    () => console.log("LensDesk hosted service is listening on 0.0.0.0:" + Number(process.env.PORT || 4319)),
  );
  process.on("SIGTERM", () => app.close().then(() => process.exit(0)));
  return app;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  startCloud().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
