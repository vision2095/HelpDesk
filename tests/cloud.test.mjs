import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { createCloudServer } from "../server/cloud/app.mjs";
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-cloud-")),
    emails = [];
  const app = createCloudServer({
    directory,
    publicUrl: "https://lensdesk.test",
    encryptionKey: randomBytes(32).toString("hex"),
    mailer: { sendMail: async (message) => emails.push(message) },
    fetchImpl: async () =>
      Response.json({
        choices: [{ message: { content: "A tested answer." } }],
        usage: { total_tokens: 32 },
      }),
    ...options,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + app.server.address().port;
  t.after(async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  async function call(action, payload = {}, token, headers = {}) {
    const response = await fetch(url + "/api/" + action, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LensDesk-Client": "desktop",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...headers,
      },
      body: JSON.stringify(payload),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  }
  async function register(email = "person@example.com") {
    const response = await call("auth.register", {
      email,
      password: "long-test-password",
      name: "Test Person",
    });
    assert.equal(response.status, 200);
    const mail = emails.at(-1);
    const token = new URL(
      mail.text.match(/https:\/\/[^\s]+/)[0],
    ).searchParams.get("verify");
    assert.equal((await call("auth.verify", { token })).status, 200);
    return response.body;
  }
  return { app, emails, directory, url, call, register };
}
const makeSession = () => {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: "Cloud session",
    mode: "general",
    profileId: "",
    createdAt: now,
    updatedAt: now,
    notes: "Private notes",
    transcript: "",
    messages: [],
  };
};
test("hosted registration, verified email, login, and per-account data isolation", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("state")).status, 401);
  assert.equal(
    (await f.call("cloud.state", {}, null, { Origin: "https://evil.test" }))
      .status,
    403,
  );
  const a = await f.register();
  const b = await f.register("other@example.com");
  const session = makeSession();
  await f.call("session.save", session, a.token);
  assert.equal(
    (await f.call("state", {}, a.token)).body.sessions[0].notes,
    "Private notes",
  );
  assert.equal((await f.call("state", {}, b.token)).body.sessions.length, 0);
  const login = await f.call("auth.login", {
    email: "PERSON@example.com",
    password: "long-test-password",
  });
  assert.equal(login.status, 200);
  assert.ok(login.headers.get("set-cookie").includes("HttpOnly"));
  assert.equal(
    (
      await f.call("auth.login", {
        email: "person@example.com",
        password: "incorrect-password",
      })
    ).status,
    400,
  );
  await f.call("auth.logout", {}, a.token);
  assert.equal((await f.call("state", {}, a.token)).status, 401);
});
test("hosted quota is reserved atomically, failed calls refunded, and BYOK bypasses plan allowance", async (t) => {
  const f = await fixture(t, { platformKeys: { openai: "platform-secret" } });
  const a = await f.register(),
    s = makeSession();
  await f.call("session.save", s, a.token);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await f.call(
          "chat",
          { sessionId: s.id, text: "Question " + i },
          a.token,
        )
      ).status,
      200,
    );
  assert.match(
    (await f.call("chat", { sessionId: s.id, text: "Over limit" }, a.token))
      .body.error,
    /allowance is used/,
  );
  await f.call("key.save", { provider: "openai", key: "own-secret" }, a.token);
  assert.equal(
    (await f.call("chat", { sessionId: s.id, text: "BYOK" }, a.token)).status,
    200,
  );
  const backup = (await f.call("backup", {}, a.token)).body;
  assert.equal(JSON.stringify(backup).includes("secret"), false);
  const bin = fs.readFileSync(
    path.join(f.directory, "workspaces", a.user.id, "workspace.sqlite"),
  );
  assert.equal(bin.includes(Buffer.from("own-secret")), false);
  assert.equal(
    (await f.call("cloud.state", {}, a.token)).body.usage.requests,
    6,
  );
});
test("failed AI requests do not consume allowance", async (t) => {
  const f = await fixture(t, {
    platformKeys: { openai: "key" },
    fetchImpl: async () =>
      Response.json({ error: { message: "Unavailable" } }, { status: 503 }),
  });
  const a = await f.register(),
    s = makeSession();
  await f.call("session.save", s, a.token);
  assert.equal(
    (await f.call("chat", { sessionId: s.id, text: "Question" }, a.token))
      .status,
    400,
  );
  assert.equal(
    (await f.call("cloud.state", {}, a.token)).body.usage.requests,
    0,
  );
});
test("unverified users cannot use hosted AI", async (t) => {
  const f = await fixture(t, { platformKeys: { openai: "key" } });
  const response = await f.call("auth.register", {
    email: "new@example.com",
    password: "long-test-password",
    name: "New",
  });
  const s = makeSession();
  await f.call("session.save", s, response.body.token);
  assert.match(
    (
      await f.call(
        "chat",
        { sessionId: s.id, text: "Question" },
        response.body.token,
      )
    ).body.error,
    /Verify your email/,
  );
});
test("password reset revokes old sessions and accepts only a one-use token", async (t) => {
  const f = await fixture(t),
    a = await f.register();
  await f.call("auth.reset.request", { email: a.user.email });
  const link = new URL(f.emails.at(-1).text.match(/https:\/\/[^\s]+/)[0]),
    token = link.searchParams.get("reset");
  assert.equal(
    (await f.call("auth.reset", { token, password: "new-long-password" }))
      .status,
    200,
  );
  assert.equal((await f.call("state", {}, a.token)).status, 401);
  assert.equal(
    (await f.call("auth.reset", { token, password: "another-password" }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.call("auth.login", {
        email: a.user.email,
        password: "new-long-password",
      })
    ).status,
    200,
  );
});
test("cloud sync validates backups and retains previous workspace before restore", async (t) => {
  const f = await fixture(t),
    a = await f.register();
  const backup = { version: 1, ...(await f.call("state", {}, a.token)).body };
  delete backup.keys;
  backup.sessions = [makeSession()];
  assert.equal((await f.call("cloud.push", backup, a.token)).status, 200);
  assert.equal(
    (await f.call("cloud.pull", {}, a.token)).body.sessions.length,
    1,
  );
  assert.equal(
    (await f.call("cloud.push", { version: 5, sessions: [] }, a.token)).status,
    400,
  );
  assert.equal(
    (await f.call("cloud.pull", {}, a.token)).body.sessions.length,
    1,
  );
});
test("Stripe checkout parameters, signed webhook activation, replay protection, and portal ownership", async (t) => {
  const sdk = new Stripe("sk_test_example");
  let checkout, portal;
  const secret = "whsec_testing",
    sub = {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      metadata: {},
    };
  const fake = {
    webhooks: sdk.webhooks,
    subscriptions: { retrieve: async () => sub, cancel: async () => ({}) },
    checkout: {
      sessions: {
        create: async (params) => {
          checkout = params;
          return { url: "https://checkout.stripe.com/test" };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params) => {
          portal = params;
          return { url: "https://billing.stripe.com/test" };
        },
      },
    },
    prices: {
      retrieve: async () => ({
        unit_amount: 1500,
        currency: "usd",
        recurring: { interval: "month" },
      }),
    },
  };
  const f = await fixture(t, {
      stripeClient: fake,
      stripeWebhookSecret: secret,
      stripePriceId: "price_operator",
    }),
    a = await f.register();
  assert.equal(
    (await f.call("billing.checkout", { priceId: "price_tampered" }, a.token))
      .status,
    200,
  );
  assert.equal(checkout.line_items[0].price, "price_operator");
  assert.equal(checkout.client_reference_id, a.user.id);
  const event = {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "subscription",
        client_reference_id: a.user.id,
        customer: "cus_1",
        subscription: "sub_1",
      },
    },
  };
  const raw = JSON.stringify(event),
    signature = Stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret,
    });
  for (let i = 0; i < 2; i++) {
    const r = await fetch(f.url + "/api/billing.webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: raw,
    });
    assert.equal(r.status, 200);
  }
  assert.equal(
    f.app.accounts.db.prepare("SELECT COUNT(*) AS count FROM events").get()
      .count,
    1,
  );
  assert.equal((await f.call("cloud.state", {}, a.token)).body.plan, "pro");
  await f.call("billing.portal", {}, a.token);
  assert.equal(portal.customer, "cus_1");
  assert.equal(
    (
      await fetch(f.url + "/api/billing.webhook", {
        method: "POST",
        headers: { "stripe-signature": "invalid" },
        body: raw,
      })
    ).status,
    400,
  );
});
test("account deletion requires password and removes cloud data and tokens", async (t) => {
  const f = await fixture(t),
    a = await f.register();
  await f.call("session.save", makeSession(), a.token);
  assert.equal(
    (
      await f.call(
        "account.delete",
        { password: "incorrect-password" },
        a.token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "account.delete",
        { password: "long-test-password" },
        a.token,
      )
    ).status,
    200,
  );
  assert.equal((await f.call("state", {}, a.token)).status, 401);
  assert.equal(
    fs.existsSync(path.join(f.directory, "workspaces", a.user.id)),
    false,
  );
});

test("browser login receives only an HTTP-only cookie, not a bearer token in JSON", async (t) => {
  const f = await fixture(t),
    user = await f.register();
  const response = await f.call(
    "auth.login",
    { email: user.user.email, password: "long-test-password" },
    null,
    { "X-LensDesk-Client": "browser" },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.token, undefined);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await f.call("state", {}, null, { Cookie: cookie })).status,
    200,
  );
});

test("account deletion never cancels a subscription while a request is in flight", async (t) => {
  let release, started;
  const ready = new Promise((r) => (started = r));
  let canceled = 0;
  const f = await fixture(t, {
    platformKeys: { openai: "key" },
    fetchImpl: () => {
      started();
      return new Promise((r) => (release = r));
    },
    stripeClient: {
      subscriptions: {
        cancel: async () => {
          canceled++;
        },
      },
    },
  });
  const user = await f.register(),
    session = makeSession();
  f.app.accounts.db
    .prepare(
      "UPDATE users SET subscription_id='sub_active',subscription_status='active',subscription_expires=? WHERE id=?",
    )
    .run(Math.floor(Date.now() / 1000) + 1000, user.user.id);
  await f.call("session.save", session, user.token);
  const answer = f.call(
    "chat",
    { sessionId: session.id, text: "Question" },
    user.token,
  );
  await ready;
  const deletion = await f.call(
    "account.delete",
    { password: "long-test-password" },
    user.token,
  );
  assert.equal(deletion.status, 400);
  assert.equal(canceled, 0);
  release(Response.json({ choices: [{ message: { content: "Done" } }] }));
  await answer;
});

test("device sessions are account-scoped and password rotation revokes old tokens", async (t) => {
  const f = await fixture(t);
  const first = await f.register("devices@example.com");
  const second = (
    await f.call("auth.login", {
      email: first.user.email,
      password: "long-test-password",
    })
  ).body;
  const other = await f.register("other-devices@example.com");
  let devices = await f.call("account.sessions", {}, first.token);
  assert.equal(devices.body.sessions.length, 2);
  const secondId = devices.body.sessions.find((s) => !s.current).id;
  assert.equal(JSON.stringify(devices.body).includes(second.token), false);
  await f.call("account.session.revoke", { id: secondId }, other.token);
  assert.equal(
    (await f.call("cloud.state", {}, second.token)).body.user.id,
    first.user.id,
  );
  await f.call("account.session.revoke", { id: secondId }, first.token);
  assert.equal((await f.call("cloud.state", {}, second.token)).body.user, null);
  assert.equal(
    (
      await f.call(
        "account.password",
        { password: "incorrect-password", newPassword: "new-long-password" },
        first.token,
      )
    ).status,
    400,
  );
  const rotated = await f.call(
    "account.password",
    { password: "long-test-password", newPassword: "new-long-password" },
    first.token,
  );
  assert.equal(rotated.status, 200);
  assert.ok(rotated.body.token);
  assert.equal((await f.call("cloud.state", {}, first.token)).body.user, null);
  assert.equal(
    (await f.call("cloud.state", {}, rotated.body.token)).body.user.id,
    first.user.id,
  );
  assert.equal(
    (
      await f.call("auth.login", {
        email: first.user.email,
        password: "long-test-password",
      })
    ).status,
    400,
  );
  const login = await f.call("auth.login", {
    email: first.user.email,
    password: "new-long-password",
  });
  assert.equal(login.status, 200);
  await f.call(
    "account.sessions.revokeOthers",
    { password: "new-long-password" },
    login.body.token,
  );
  assert.equal(
    (await f.call("cloud.state", {}, rotated.body.token)).body.user,
    null,
  );
  const audit = await f.call("account.audit", {}, login.body.token);
  assert.ok(audit.body.events.some((e) => e.event === "password.changed"));
});

test("hosted token reservations settle provider usage, enforce budgets, and restrict funded models", async (t) => {
  const f = await fixture(t, {
    platformKeys: { openai: "platform" },
    dailyTokenLimits: { free: 24000, pro: 48000 },
  });
  const a = await f.register(),
    s = makeSession();
  await f.call("session.save", s, a.token);
  assert.equal(
    (await f.call("chat", { sessionId: s.id, text: "Hello" }, a.token)).status,
    200,
  );
  assert.equal(
    (await f.call("cloud.state", {}, a.token)).body.usage.tokens,
    32,
  );
  const limited = await f.call(
    "chat",
    { sessionId: s.id, text: "Again" },
    a.token,
  );
  assert.match(limited.body.error, /token budget/);
  assert.equal(
    (await f.call("cloud.state", {}, a.token)).body.usage.requests,
    1,
  );
  const state = (await f.call("state", {}, a.token)).body;
  await f.call(
    "settings.save",
    { ...state.settings, model: "expensive-unapproved-model" },
    a.token,
  );
  assert.match(
    (await f.call("chat", { sessionId: s.id, text: "No" }, a.token)).body.error,
    /not enabled/,
  );
  await f.call("key.save", { provider: "openai", key: "own-key" }, a.token);
  assert.equal(
    (await f.call("chat", { sessionId: s.id, text: "BYOK" }, a.token)).status,
    200,
  );
  assert.equal(
    (await f.call("cloud.state", {}, a.token)).body.usage.tokens,
    32,
  );
});

test("MFA requires an encrypted authenticator, rejects replay and consumes recovery codes once", async (t) => {
  const { TOTP, Secret } = await import("otpauth");
  let now = Date.now();
  const f = await fixture(t, { mfaClock: () => now });
  const a = await f.register("mfa@example.com");
  const old = (
    await f.call("auth.login", {
      email: a.user.email,
      password: "long-test-password",
    })
  ).body;
  assert.equal(
    (await f.call("account.mfa.begin", { password: "wrong-password" }, a.token))
      .status,
    400,
  );
  const setup = await f.call(
    "account.mfa.begin",
    { password: "long-test-password" },
    a.token,
  );
  assert.equal(setup.status, 200);
  assert.ok(setup.body.secret);
  const totp = new TOTP({
    secret: Secret.fromBase32(setup.body.secret),
    digits: 6,
    period: 30,
  });
  const enabled = await f.call(
    "account.mfa.confirm",
    { code: totp.generate({ timestamp: now }) },
    a.token,
  );
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.recoveryCodes.length, 10);
  assert.equal((await f.call("cloud.state", {}, old.token)).body.user, null);
  const login = (
    await f.call("auth.login", {
      email: a.user.email,
      password: "long-test-password",
    })
  ).body;
  assert.equal(login.mfaRequired, true);
  assert.equal(login.token, undefined);
  assert.equal(
    (
      await f.call("auth.mfa", {
        challenge: login.challenge,
        code: totp.generate({ timestamp: now }),
      })
    ).status,
    400,
  );
  now += 31000;
  const verified = await f.call("auth.mfa", {
    challenge: login.challenge,
    code: totp.generate({ timestamp: now }),
  });
  assert.equal(verified.status, 200);
  assert.ok(verified.body.token);
  assert.equal(
    (
      await f.call("auth.mfa", {
        challenge: login.challenge,
        code: enabled.body.recoveryCodes[0],
      })
    ).status,
    400,
  );
  const challenge = (
    await f.call("auth.login", {
      email: a.user.email,
      password: "long-test-password",
    })
  ).body.challenge;
  const recovered = await f.call("auth.mfa", {
    challenge,
    code: enabled.body.recoveryCodes[0],
  });
  assert.equal(recovered.status, 200);
  const status = await f.call("account.mfa.status", {}, recovered.body.token);
  assert.equal(status.body.recoveryCodesRemaining, 9);
  assert.equal(JSON.stringify(status.body).includes(setup.body.secret), false);
  const again = (
    await f.call("auth.login", {
      email: a.user.email,
      password: "long-test-password",
    })
  ).body.challenge;
  assert.equal(
    (
      await f.call("auth.mfa", {
        challenge: again,
        code: enabled.body.recoveryCodes[0],
      })
    ).status,
    400,
  );
  for (const name of fs
    .readdirSync(f.directory)
    .filter((n) => n.startsWith("accounts.sqlite")))
    assert.equal(
      fs
        .readFileSync(path.join(f.directory, name))
        .includes(Buffer.from(setup.body.secret)),
      false,
    );
  const disabled = await f.call(
    "account.mfa.disable",
    { password: "long-test-password", code: enabled.body.recoveryCodes[1] },
    recovered.body.token,
  );
  assert.equal(disabled.status, 200);
  assert.ok(
    (
      await f.call("auth.login", {
        email: a.user.email,
        password: "long-test-password",
      })
    ).body.token,
  );
});

test("readiness and protected metrics expose no account credentials and correlate requests", async (t) => {
  const entries = [];
  const f = await fixture(t, {
    logger: (event) => entries.push(event),
    operatorToken: "private-operator-token",
  });
  const response = await fetch(f.url + "/health?token=never-log-this");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-request-id"), /^[\da-f-]{36}$/);
  assert.equal((await fetch(f.url + "/ops/metrics")).status, 404);
  const metrics = await fetch(f.url + "/ops/metrics", {
    headers: { Authorization: "Bearer private-operator-token" },
  }).then((r) => r.json());
  assert.ok(metrics.requests >= 3);
  assert.ok(metrics.memoryBytes > 0);
  const ready = await fetch(f.url + "/ready");
  assert.equal(
    ready.status,
    fs.existsSync(new URL("../dist/index.html", import.meta.url)) ? 200 : 503,
  );
  assert.ok(entries.some((e) => e.route === "/health"));
  assert.equal(JSON.stringify(entries).includes("never-log-this"), false);
  assert.equal(
    JSON.stringify(entries).includes("private-operator-token"),
    false,
  );
});

test("state retains hosted identity after settings saves and stale account audio is rejected", async (t) => {
  const f = await fixture(t),
    a = await f.register("scope-a@example.com"),
    b = await f.register("scope-b@example.com");
  const state = (await f.call("state", {}, a.token)).body;
  assert.equal(state.accountId, a.user.id);
  assert.equal(state.storage, "cloud");
  const saved = (
    await f.call(
      "settings.save",
      { ...state.settings, language: "Hindi" },
      a.token,
    )
  ).body;
  assert.equal(saved.accountId, a.user.id);
  assert.equal(saved.storage, "cloud");
  for (const action of ["transcribe", "transcript.append", "session.get"]) {
    const result = await f.call(
      action,
      { expectedAccountId: a.user.id },
      b.token,
    );
    assert.equal(result.status, 400);
    assert.match(result.body.error, /account changed/);
  }
  assert.equal(
    (await f.call("cloud.state", {}, b.token)).body.usage.audioSeconds,
    0,
  );
});

test("hosted AI rejects local-model endpoints instead of making server-side network requests", async (t) => {
  let upstreamCalls = 0;
  const f = await fixture(t, {
      fetchImpl: async () => {
        upstreamCalls++;
        return Response.json({
          choices: [{ message: { content: "should not be called" } }],
        });
      },
    }),
    a = await f.register("local-only@example.com"),
    state = (await f.call("state", {}, a.token)).body,
    s = makeSession();
  await f.call(
    "settings.save",
    {
      ...state.settings,
      provider: "local",
      model: "fixture-local-model",
      localBaseUrl: "http://127.0.0.1:11434/v1",
    },
    a.token,
  );
  await f.call("session.save", s, a.token);
  const answer = await f.call(
      "chat",
      { sessionId: s.id, text: "Hello" },
      a.token,
    ),
    list = await f.call("model.list", { provider: "local" }, a.token);
  assert.equal(answer.status, 400);
  assert.match(answer.body.error, /only be reached by the desktop app/);
  assert.equal(list.status, 400);
  assert.match(list.body.error, /only be reached by the desktop app/);
  const detection = await f.call("desktop.models.detect", {}, a.token);
  assert.equal(detection.status, 400);
  assert.match(detection.body.error, /Unknown action/);
  assert.equal(upstreamCalls, 0);
});
