import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAccounts } from "../server/cloud/auth.mjs";
import { createBilling } from "../server/cloud/billing.mjs";
async function fixture(t, stripe) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-billing-"));
  const accounts = createAccounts(directory);
  const billing = createBilling({
    accounts,
    stripe,
    priceId: "price_real",
    origin: "https://lensdesk.test",
  });
  t.after(() => {
    accounts.close();
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  });
  const registered = await accounts.register({
    email: "billing@example.com",
    password: "strong-test-password",
    name: "Billing",
  });
  accounts.verify(registered.verificationToken);
  const user = accounts.db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(registered.user.id);
  return { accounts, billing, user };
}
test("checkout retries reuse the same Stripe idempotency key and original parameters", async (t) => {
  const calls = [];
  const stripe = {
    checkout: {
      sessions: {
        create: async (params, options) => {
          calls.push({ params, options });
          if (calls.length === 1) throw new Error("Unknown network result");
          return { id: "cs_1", url: "https://checkout.stripe.com/safe" };
        },
      },
    },
  };
  const f = await fixture(t, stripe);
  await assert.rejects(f.billing.checkout(f.user), /Unknown network/);
  assert.equal(
    (await f.billing.checkout(f.user)).url,
    "https://checkout.stripe.com/safe",
  );
  assert.deepEqual(calls[0], calls[1]);
  await f.billing.checkout(f.user);
  assert.equal(calls.length, 2);
});
test("concurrent checkout requests cannot create two remote sessions", async (t) => {
  let release;
  let calls = 0;
  const f = await fixture(t, {
    checkout: {
      sessions: {
        create: () => {
          calls++;
          return new Promise((r) => (release = r));
        },
      },
    },
  });
  const first = f.billing.checkout(f.user);
  await assert.rejects(f.billing.checkout(f.user), /already being prepared/);
  release({ id: "cs_1", url: "https://checkout.stripe.com/one" });
  await first;
  assert.equal(calls, 1);
});
test("an old subscription deletion cannot disable a newer active subscription", async (t) => {
  const now = Math.floor(Date.now() / 1000);
  let current = {
    id: "sub_new",
    customer: "cus_user",
    status: "active",
    created: now,
    current_period_end: now + 10000,
  };
  const f = await fixture(t, {
    subscriptions: { retrieve: async () => current },
  });
  await f.billing.processEvent({
    id: "evt_new",
    created: now,
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "subscription",
        client_reference_id: f.user.id,
        subscription: "sub_new",
      },
    },
  });
  await f.billing.processEvent({
    id: "evt_old_delete",
    created: now + 1,
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_old",
        customer: "cus_user",
        status: "canceled",
        created: now - 100,
        current_period_end: now,
      },
    },
  });
  const user = f.accounts.db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(f.user.id);
  assert.equal(user.subscription_id, "sub_new");
  assert.equal(user.subscription_status, "active");
});
test("stale events are ignored and reconciliation repairs missed webhook state", async (t) => {
  const now = Math.floor(Date.now() / 1000);
  let sub = {
    id: "sub_1",
    customer: "cus_user",
    status: "active",
    created: now - 10,
    current_period_end: now + 1000,
  };
  const f = await fixture(t, { subscriptions: { retrieve: async () => sub } });
  await f.billing.processEvent({
    id: "evt_1",
    created: now,
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "subscription",
        client_reference_id: f.user.id,
        subscription: "sub_1",
      },
    },
  });
  await f.billing.processEvent({
    id: "evt_stale",
    created: now - 5,
    type: "customer.subscription.deleted",
    data: { object: { ...sub, status: "canceled" } },
  });
  assert.equal(
    f.accounts.db
      .prepare("SELECT subscription_status FROM users WHERE id=?")
      .get(f.user.id).subscription_status,
    "active",
  );
  sub = { ...sub, status: "past_due" };
  await f.billing.reconcile(f.user.id);
  assert.equal(
    f.accounts.db
      .prepare("SELECT subscription_status FROM users WHERE id=?")
      .get(f.user.id).subscription_status,
    "past_due",
  );
});

test("reconciliation cannot overwrite a webhook applied while the provider request is pending", async (t) => {
  let release;
  const f = await fixture(t, {
    subscriptions: {
      retrieve: () =>
        new Promise((r) => {
          release = r;
        }),
    },
  });
  f.accounts.db
    .prepare(
      "UPDATE users SET stripe_customer='cus_user',subscription_id='sub_current',subscription_status='active',subscription_event_created=100 WHERE id=?",
    )
    .run(f.user.id);
  const pending = f.billing.reconcile(f.user.id);
  f.accounts.db
    .prepare(
      "UPDATE users SET subscription_status='past_due',subscription_event_created=101 WHERE id=?",
    )
    .run(f.user.id);
  release({
    id: "sub_current",
    customer: "cus_user",
    status: "active",
    created: 1,
    current_period_end: 9999999999,
  });
  assert.equal((await pending).superseded, true);
  assert.equal(
    f.accounts.db
      .prepare("SELECT subscription_status FROM users WHERE id=?")
      .get(f.user.id).subscription_status,
    "past_due",
  );
});
