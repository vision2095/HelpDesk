import { randomUUID } from "node:crypto";
export function createBilling({ accounts, stripe, priceId, origin }) {
  const db = accounts.db;
  for (const [name, sql] of [
    ["subscription_event_created", "INTEGER NOT NULL DEFAULT 0"],
    ["subscription_started", "INTEGER NOT NULL DEFAULT 0"],
    ["account_state", "TEXT NOT NULL DEFAULT 'active'"],
  ])
    if (
      !db
        .prepare("PRAGMA table_info(users)")
        .all()
        .some((c) => c.name === name)
    )
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${sql}`);
  db.exec(
    `CREATE TABLE IF NOT EXISTS checkout_intents(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, idempotency_key TEXT NOT NULL, params TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, checkout_id TEXT, url TEXT, expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS billing_audit(id TEXT PRIMARY KEY,user_id TEXT,event TEXT NOT NULL,created_at TEXT NOT NULL);`,
  );
  const now = () => Math.floor(Date.now() / 1000);
  function audit(userId, event) {
    db.prepare("INSERT INTO billing_audit VALUES(?,?,?,?)").run(
      randomUUID(),
      userId,
      event,
      new Date().toISOString(),
    );
  }
  async function checkout(user) {
    if (!stripe || !priceId)
      throw new Error(
        "Subscriptions are not configured. Ask the service operator to connect Stripe.",
      );
    if (!user.verified)
      throw new Error("Verify your email before subscribing.");
    db.exec("BEGIN IMMEDIATE");
    let intent;
    try {
      const fresh = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
      if (!fresh || fresh.account_state !== "active")
        throw new Error("Account deletion is in progress.");
      if (["active", "trialing"].includes(fresh.subscription_status))
        throw new Error(
          "You already have a subscription. Use Manage subscription.",
        );
      intent = db
        .prepare("SELECT * FROM checkout_intents WHERE user_id=?")
        .get(user.id);
      if (intent?.url && intent.expires > now()) {
        db.exec("COMMIT");
        return { url: intent.url };
      }
      if (intent?.lease_until > now())
        throw new Error(
          "Checkout is already being prepared. Try again shortly.",
        );
      if (!intent || intent.expires <= now()) {
        const params = {
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          client_reference_id: user.id,
          ...(fresh.stripe_customer
            ? { customer: fresh.stripe_customer }
            : { customer_email: fresh.email }),
          subscription_data: { metadata: { userId: user.id } },
          success_url: origin + "/?billing=success",
          cancel_url: origin + "/?billing=cancelled",
          allow_promotion_codes: true,
        };
        db.prepare(
          "INSERT INTO checkout_intents(user_id,idempotency_key,params,expires) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET idempotency_key=excluded.idempotency_key,params=excluded.params,expires=excluded.expires,checkout_id=NULL,url=NULL,lease_until=0",
        ).run(user.id, randomUUID(), JSON.stringify(params), now() + 86400);
        intent = db
          .prepare("SELECT * FROM checkout_intents WHERE user_id=?")
          .get(user.id);
      }
      db.prepare(
        "UPDATE checkout_intents SET lease_until=? WHERE user_id=?",
      ).run(now() + 60, user.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    try {
      const result = await stripe.checkout.sessions.create(
        JSON.parse(intent.params),
        { idempotencyKey: intent.idempotency_key },
      );
      if (!result.url || !/^https:\/\/checkout\.stripe\.com\//.test(result.url))
        throw new Error("Checkout did not return a valid payment URL.");
      db.prepare(
        "UPDATE checkout_intents SET checkout_id=?,url=?,expires=?,lease_until=0 WHERE user_id=? AND idempotency_key=?",
      ).run(
        result.id || null,
        result.url,
        result.expires_at || now() + 1800,
        user.id,
        intent.idempotency_key,
      );
      audit(user.id, "checkout.created");
      return { url: result.url };
    } catch (error) {
      db.prepare(
        "UPDATE checkout_intents SET lease_until=0 WHERE user_id=? AND idempotency_key=?",
      ).run(user.id, intent.idempotency_key);
      throw error;
    }
  }
  function applySubscription(
    userId,
    sub,
    { eventCreated = now(), allowReplacement = false } = {},
  ) {
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId);
    if (!user) return false;
    const customer =
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    if (user.stripe_customer && customer !== user.stripe_customer) return false;
    if (eventCreated < user.subscription_event_created) return false;
    if (user.subscription_id && user.subscription_id !== sub.id) {
      if (!allowReplacement) return false;
      if (["active", "trialing", "past_due"].includes(user.subscription_status))
        return false;
      if (sub.created && sub.created < user.subscription_started) return false;
    }
    const expires =
      sub.current_period_end || sub.items?.data?.[0]?.current_period_end || 0;
    db.prepare(
      "UPDATE users SET stripe_customer=?,subscription_status=?,subscription_id=?,subscription_expires=?,subscription_event_created=?,subscription_started=? WHERE id=?",
    ).run(
      customer || null,
      sub.status,
      sub.id,
      expires,
      eventCreated,
      sub.created || user.subscription_started || eventCreated,
      userId,
    );
    return true;
  }
  async function processEvent(event) {
    if (db.prepare("SELECT id FROM events WHERE id=?").get(event.id))
      return { duplicate: true };
    let sub,
      userId,
      allowReplacement = false;
    if (
      event.type === "checkout.session.completed" &&
      event.data.object.mode === "subscription"
    ) {
      const session = event.data.object;
      userId = session.client_reference_id;
      allowReplacement = true;
      if (session.subscription)
        sub = await stripe.subscriptions.retrieve(
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id,
        );
    } else if (
      [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type)
    ) {
      sub =
        event.type === "customer.subscription.deleted"
          ? event.data.object
          : await stripe.subscriptions.retrieve(event.data.object.id);
      const customer =
        typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      userId =
        db.prepare("SELECT id FROM users WHERE stripe_customer=?").get(customer)
          ?.id || sub.metadata?.userId;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      if (db.prepare("SELECT id FROM events WHERE id=?").get(event.id)) {
        db.exec("COMMIT");
        return { duplicate: true };
      }
      const applied = Boolean(
        sub &&
        userId &&
        applySubscription(userId, sub, {
          eventCreated: event.created || now(),
          allowReplacement,
        }),
      );
      db.prepare("INSERT INTO events VALUES(?,?)").run(
        event.id,
        new Date().toISOString(),
      );
      if (applied && event.type === "checkout.session.completed")
        db.prepare("DELETE FROM checkout_intents WHERE user_id=?").run(userId);
      if (userId)
        audit(
          userId,
          `webhook.${event.type}.${applied ? "applied" : "ignored"}`,
        );
      db.exec("COMMIT");
      return { applied };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  async function reconcile(userId) {
    if (!stripe) throw new Error("Billing is not configured.");
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId);
    if (!user?.subscription_id) return { changed: false };
    const sub = await stripe.subscriptions.retrieve(user.subscription_id);
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT * FROM users WHERE id=?").get(userId);
      if (
        !current ||
        current.subscription_id !== user.subscription_id ||
        current.subscription_event_created !==
          user.subscription_event_created ||
        current.account_state !== "active"
      ) {
        db.exec("COMMIT");
        return { changed: false, superseded: true };
      }
      const changed = applySubscription(userId, sub, {
        eventCreated: user.subscription_event_created,
      });
      audit(userId, "subscription.reconciled");
      db.exec("COMMIT");
      return { changed };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return { checkout, processEvent, reconcile, audit };
}
