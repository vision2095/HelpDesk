import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from "node:crypto";

// Razorpay gateway client. The exchange of credentials happens over TLS;
// the checkout and webhook signature schemes below match Razorpay's
// published production integration so switching from sandbox/test keys to
// live keys is purely a configuration change.
export function createRazorpayClient({
  keyId,
  keySecret,
  webhookSecret,
  fetchImpl = globalThis.fetch,
  apiBase = "https://api.razorpay.com",
  clock = Date.now,
} = {}) {
  if (!keyId || !keySecret)
    throw new Error(
      "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable purchases.",
    );
  const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function call(path, { method = "GET", body, retries } = {}) {
    let delay = 250;
    let lastError = null;
    for (let attempt = 0; attempt <= (retries ?? 2); attempt++) {
      try {
        const response = await fetchImpl(apiBase + path, {
          method,
          headers: {
            Authorization: "Basic " + auth,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
        const text = await response.text();
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          throw Object.assign(
            new Error("The payment gateway returned an unreadable response."),
            { statusCode: response.status },
          );
        }
        if (!response.ok) {
          const error = new Error(
            data?.error?.description ||
              data?.error?.reason ||
              "The payment gateway rejected the request.",
          );
          error.statusCode = response.status;
          error.gatewayCode = data?.error?.code;
          throw error;
        }
        return data;
      } catch (error) {
        if (error?.name === "TimeoutError" || error?.name === "AbortError" || error?.statusCode >= 500 || error?.statusCode === undefined)
          lastError = error;
        else throw error;
      }
      await sleep(delay + Math.floor(Math.random() * 250)); // backoff + jitter
      delay *= 2;
    }
    throw lastError || new Error("The payment gateway is unreachable.");
  }
  function digest(expected, provided) {
    const expectedBuffer = Buffer.from(String(expected || "")),
      providedBuffer = Buffer.from(String(provided || ""));
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }
  return {
    keyId,
    webhookSecret,
    async createOrder(params) {
      const created = await call("/v1/orders", { method: "POST", body: params });
      if (!created?.id || created.amount !== params.amount || created.currency !== params.currency)
        throw new Error("The payment gateway returned an unexpected order.");
      return created;
    },
    async fetchOrder(orderId) {
      return call(`/v1/orders/${encodeURIComponent(orderId)}`);
    },
    async fetchPayment(paymentId) {
      return call(`/v1/payments/${encodeURIComponent(paymentId)}`);
    },
    async fetchOrderPayments(orderId) {
      const result = await call(
        `/v1/orders/${encodeURIComponent(orderId)}/payments?count=25`,
      );
      return (result?.items || []).filter(
        (item) => item?.id && item?.order_id === orderId,
      );
    },
    verifyCheckoutSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
      if (
        !/^[A-Za-z0-9_-]+$/.test(String(razorpay_order_id || "")) ||
        !/^[A-Za-z0-9_-]+$/.test(String(razorpay_payment_id || "")) ||
        !razorpay_signature
      )
        return false;
      const expected = createHmac("sha256", keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");
      return digest(expected, razorpay_signature);
    },
    verifyWebhookSignature(rawBody, signature) {
      if (!webhookSecret || !signature) return false;
      const expected = createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");
      return digest(expected, signature);
    },
  };
}

// Payment lifecycle: verified orders, signed webhooks, idempotent
// entitlement activation, deduplication, refunds, reconciliation.
export function createPayments({
  db,
  entitlements,
  plans,
  client,
  clock = Date.now,
  audit,
  mailReceipt,
  orderReuseSeconds = 1800,
} = {}) {
  // Row timestamps persist in whole seconds (matching the rest of the
  // storage layer); entitlement activation receives the millisecond clock.
  const now = () => Math.floor(clock() / 1000);
  const stamp = () => new Date().toISOString();
  const toMs = (t) => (t == null ? null : t > 1e12 ? t : t * 1000);
  const insertEvent = db.prepare(
    "INSERT INTO payment_webhook_events(fingerprint,event_type,payment_id,received_at) VALUES(?,?,?,?)",
  );
  const getPaymentByOrderId = db.prepare("SELECT * FROM payments WHERE order_id=?");
  const getPaymentByProviderId = db.prepare(
    "SELECT * FROM payments WHERE provider_payment_id=?",
  );

  async function mailReceiptBestEffort(payment) {
    if (!mailReceipt || payment.receipt_emailed) return;
    try {
      await mailReceipt(payment);
      db.prepare(
        "UPDATE payments SET receipt_emailed=1, updated_at=? WHERE id=?",
      ).run(now(), payment.id);
    } catch {
      // Receipt delivery is best-effort; never block activation.
    }
  }

  // Captures a payment into an entitlement. Only reached through
  // signature-verified checkout confirmations or direct gateway API
  // fetches (webhooks qualify only after their signature check).
  function verifyAndActivate(payment, { providerPaymentId, eventSource }) {
    if (payment.status === "paid") {
      const entitlement = entitlements.byPayment(payment.id);
      return {
        alreadyPaid: true,
        entitlement,
      };
    }
    if (payment.status === "refunded")
      throw new Error("This payment was refunded and cannot provide access.");
    db.exec("BEGIN IMMEDIATE");
    try {
      const fresh = db.prepare("SELECT * FROM payments WHERE id=?").get(payment.id);
      if (fresh.status === "paid" || fresh.status === "refunded") {
        const entitlement = entitlements.byPayment(fresh.id);
        db.exec("COMMIT");
        return { alreadyPaid: fresh.status === "paid", entitlement };
      }
      db.prepare(
        "UPDATE payments SET status='paid', provider_payment_id=?, updated_at=? WHERE id=?",
      ).run(providerPaymentId, now(), fresh.id);
      const plan = plans.get(fresh.plan_id);
      // Already inside this function's transaction: activation must not
      // open its own.
      const entitlement = entitlements.activate({
        userId: fresh.user_id,
        planId: fresh.plan_id,
        paymentId: fresh.id,
        activatedAtMs: clock(),
        source: eventSource,
        manageTx: false,
      });
      db.prepare(
        "UPDATE payments SET entitlement_id=?, updated_at=? WHERE id=?",
      ).run(entitlement.id, now(), fresh.id);
      audit?.(fresh.user_id, `payment.captured.${eventSource}`, {
        paymentId: fresh.id,
        planId: fresh.plan_id,
        amountMinor: fresh.amount_minor,
        entitlementId: entitlement.id,
      });
      db.exec("COMMIT");
      const updated = db.prepare("SELECT * FROM payments WHERE id=?").get(fresh.id);
      mailReceiptBestEffort({
        ...updated,
        planLabel: plan?.label || plan?.id,
        entitlement_expires: entitlement.expirationTimestamp,
      });
      return { paid: true, entitlement };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    keyConfigured: (c) => Boolean((c || client)?.keyId),
    // Authenticated order creation for a verified, active user.
    async createCheckout({ user, planId }) {
      if (!client)
        throw new Error(
          "Subscriptions are not configured. Ask the service operator to connect the payment provider.",
        );
      const plan = plans.get(planId);
      if (!plan) throw new Error("Choose a valid plan.");
      if (!user.verified)
        throw new Error("Verify your email before purchasing.");
      const freshUser = db
        .prepare("SELECT account_state FROM users WHERE id=?")
        .get(user.id);
      if (!freshUser || freshUser.account_state !== "active")
        throw new Error("This account cannot make a purchase.");
      // Reuse a fresh pending order so a double click cannot mint orders
      // (and so browser retries see one stable checkout payload).
      const recent = db
        .prepare(
          `SELECT * FROM payments
           WHERE user_id=? AND plan_id=? AND status='created' AND created_at>?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(user.id, plan.id, now() - orderReuseSeconds);
      if (recent)
        return {
          paymentId: recent.id,
          orderId: recent.order_id,
          amount: recent.amount_minor,
          currency: recent.currency,
          keyId: client.keyId,
          reused: true,
          plan: {
            id: plan.id,
            label: plan.label,
            priceMinor: plan.priceMinor,
            durationLabel: plan.durationLabel,
            taxNote: plan.taxNote,
          },
        };
      const paymentId = randomUUID();
      const order = await client.createOrder({
        amount: plan.priceMinor,
        currency: plan.currency,
        receipt: paymentId.slice(0, 40),
        notes: { userId: user.id, planId: plan.id },
        payment_capture: 1,
      });
      db.exec("BEGIN IMMEDIATE");
      try {
        // Abandoned checkouts stop blocking new ones: anything pending
        // older than the reuse window is marked failed inside this same
        // transaction, clearing the single pending-order slot.
        const abandoned = db
          .prepare(
            `UPDATE payments SET status='failed', updated_at=? WHERE user_id=? AND status='created' AND created_at<=?`,
          )
          .run(now(), user.id, now() - orderReuseSeconds);
        if (abandoned.changes)
          audit?.(user.id, "payment.order_abandoned", { count: abandoned.changes });
        // Racing double clicks serialize here: if another request just
        // inserted its pending row, return that ordered checkout and
        // leave this call's gateway order as an unpaid orphan that the
        // gateway expires on its own.
        const winner = db
          .prepare(
            "SELECT * FROM payments WHERE user_id=? AND plan_id=? AND status='created' AND created_at>?",
          )
          .get(user.id, plan.id, now() - orderReuseSeconds);
        if (winner) {
          db.exec("COMMIT");
          audit?.(user.id, "payment.order_reused", {
            paymentId: winner.id,
            orderId: winner.order_id,
            planId: plan.id,
          });
          return {
            paymentId: winner.id,
            orderId: winner.order_id,
            amount: winner.amount_minor,
            currency: winner.currency,
            keyId: client.keyId,
            reused: true,
            plan: {
              id: plan.id,
              label: plan.label,
              priceMinor: plan.priceMinor,
              durationLabel: plan.durationLabel,
              taxNote: plan.taxNote,
            },
          };
        }
        db.prepare(
          `INSERT INTO payments(id,user_id,plan_id,amount_minor,currency,status,order_id,provider_payment_id,entitlement_id,receipt_emailed,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          paymentId,
          user.id,
          plan.id,
          order.amount,
          order.currency,
          "created",
          order.id,
          null,
          null,
          0,
          now(),
          now(),
        );
        audit?.(user.id, "payment.order_created", {
          paymentId,
          orderId: order.id,
          planId: plan.id,
        });
        db.exec("COMMIT");
        return {
          paymentId,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          keyId: client.keyId,
          plan: {
            id: plan.id,
            label: plan.label,
            priceMinor: plan.priceMinor,
            durationLabel: plan.durationLabel,
            taxNote: plan.taxNote,
          },
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    // Confirms the official checkout callback. The signature proves the
    // gateway produced the (order_id, payment_id) pair; the payment row
    // then activates the entitlement exactly once.
    async confirm({ user, orderId, gatewayPaymentId, signature }) {
      if (!client)
        throw new Error("The payment provider is not configured.");
      if (!orderId || !gatewayPaymentId || !signature)
        throw new Error("The payment confirmation is incomplete.");
      const verified = client.verifyCheckoutSignature({
        razorpay_order_id: orderId,
        razorpay_payment_id: gatewayPaymentId,
        razorpay_signature: signature,
      });
      if (!verified)
        throw new Error(
          "The payment confirmation could not be verified. Your money was not captured by us; contact support if you were charged.",
        );
      const payment = getPaymentByOrderId.get(orderId);
      if (!payment || payment.user_id !== user.id)
        throw new Error("This payment does not match your account.");
      const gateway = await client.fetchPayment(gatewayPaymentId);
      if (
        gateway?.status !== "captured" ||
        gateway.amount !== payment.amount_minor ||
        gateway.currency !== payment.currency ||
        (gateway.notes?.userId && gateway.notes.userId !== payment.user_id) ||
        (gateway.notes?.planId && gateway.notes.planId !== payment.plan_id)
      )
        throw new Error(
          "The gateway has not captured this payment yet. Try again shortly or check your purchase history.",
        );
      const result = verifyAndActivate(payment, {
        providerPaymentId: gatewayPaymentId,
        eventSource: "checkout",
      });
      return { status: "paid", ...result };
    },
    // Signed webhook processing: replay-safe via fingerprint, with
    // state checks for delayed and out-of-order deliveries.
    async processWebhook(rawBody, signature) {
      if (!client?.webhookSecret)
        return { accepted: false, reason: "webhook_not_configured" };
      if (!client.verifyWebhookSignature(rawBody, signature))
        return { accepted: false, reason: "invalid_signature" };
      let event;
      try {
        event = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return { accepted: false, reason: "invalid_payload" };
      }
      const fingerprint = createHash("sha256").update(rawBody).digest("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        insertEvent.run(fingerprint, String(event?.event || "unknown"), null, now());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        if (String(error.message).includes("UNIQUE"))
          return { accepted: true, duplicate: true };
        throw error;
      }
      const entity = event?.payload?.payment?.entity;
      if (event?.event === "payment.captured" && entity?.id) {
        const payment = getPaymentByOrderId.get(entity.order_id || "");
        if (!payment || entity.amount !== payment.amount_minor || entity.currency !== payment.currency)
          return { accepted: true, applied: false, reason: "order_mismatch" };
        if (
          payment.provider_payment_id &&
          payment.provider_payment_id !== entity.id
        )
          return { accepted: true, applied: false, reason: "different_payment" };
        await verifyAndActivate(payment, {
          providerPaymentId: entity.id,
          eventSource: "webhook",
        });
        return { accepted: true, applied: true };
      }
      if (event?.event === "payment.failed" && entity?.order_id) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const payment = getPaymentByOrderId.get(entity.order_id);
          if (payment && payment.status === "created") {
            db.prepare(
              "UPDATE payments SET status='failed', updated_at=? WHERE id=?",
            ).run(now(), payment.id);
            audit?.(payment.user_id, "payment.failed", {
              paymentId: payment.id,
            });
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return { accepted: true, applied: true };
      }
      if (event?.event?.startsWith("refund.")) {
        // Razorpay refund deliveries carry the refund object under
        // payload.refund.entity (with a payment_id pointer); some
        // re-broadcasts place it under payload.payment.entity instead.
        const refund = event?.payload?.refund?.entity;
        const legacy = event?.payload?.payment?.entity;
        const gatewayPaymentId = refund?.payment_id || legacy?.id;
        const refundAmount =
          Number(refund?.amount ?? legacy?.amount) || 0;
        if (!gatewayPaymentId)
          return { accepted: true, applied: false, reason: "unhandled_event" };
        const payment = getPaymentByProviderId.get(gatewayPaymentId);
        if (!payment)
          return { accepted: true, applied: false, reason: "unknown_payment" };
        db.exec("BEGIN IMMEDIATE");
        try {
          if (payment.status === "paid" && refundAmount >= payment.amount_minor) {
            db.prepare(
              "UPDATE payments SET status='refunded', updated_at=? WHERE id=?",
            ).run(now(), payment.id);
            const rows = entitlements.revokeByPayment(payment.id, {
              actor: "gateway",
              reason: "refund.processed",
              manageTx: false,
            });
            audit?.(payment.user_id, "payment.refunded", {
              paymentId: payment.id,
              refundAmount,
              entitlementsRevoked: rows,
            });
          } else if (payment.status && payment.status !== "refunded" && refundAmount > 0) {
            audit?.(payment.user_id, "payment.partial_refund", {
              paymentId: payment.id,
              refundAmount,
            });
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return { accepted: true, applied: true };
      }
      return { accepted: true, applied: false, reason: "unhandled_event" };
    },
    // Pulls authoritative gateway state for a user's pending/failed
    // orders and repairs local rows (missed webhook recovery).
    async reconcile({ user, paymentId } = {}) {
      if (!client) throw new Error("The payment provider is not configured.");
      const rows = paymentId
        ? db
            .prepare("SELECT * FROM payments WHERE id=? AND user_id=?")
            .all(paymentId, user.id)
        : db
            .prepare(
              `SELECT * FROM payments WHERE user_id=? AND status IN ('created','failed') ORDER BY created_at DESC LIMIT 20`,
            )
            .all(user.id);
      let repaired = 0;
      for (const payment of rows) {
        try {
          const order = await client.fetchOrder(payment.order_id);
          if (order?.status !== "paid") {
            if (payment.status !== "failed" && order?.status === "cancelled")
              db.prepare(
                "UPDATE payments SET status='failed', updated_at=? WHERE id=? AND status='created'",
              ).run(now(), payment.id);
            continue;
          }
          const candidates = await client.fetchOrderPayments(payment.order_id);
          const captured = candidates.find(
            (item) =>
              item.status === "captured" &&
              item.amount === payment.amount_minor &&
              item.currency === payment.currency,
          );
          if (!captured) continue;
          verifyAndActivate(payment, {
            providerPaymentId: captured.id,
            eventSource: "reconcile",
          });
          repaired++;
        } catch {
          // Unreachable gateway: next reconciliation continues.
        }
      }
      if (repaired) audit?.(user.id, "payment.reconciled", { repaired });
      return { checked: rows.length, repaired };
    },
    history(user, limit = 30) {
      return db
        .prepare(
          `SELECT p.id, p.plan_id, p.amount_minor, p.currency, p.status,
                  p.created_at, p.updated_at, plan.label AS planLabel,
                  e.expiration_timestamp AS entitlementExpiration,
                  e.subscription_status AS entitlementStatus
           FROM payments p
           JOIN plans plan ON plan.id = p.plan_id
           LEFT JOIN entitlements e ON e.payment_id = p.id
           WHERE p.user_id=? ORDER BY p.created_at DESC, p.rowid DESC LIMIT ?`,
        )
        .all(user.id, limit)
        .map((row) => ({
          id: row.id,
          planId: row.plan_id,
          planLabel: row.planLabel,
          amountMinor: row.amount_minor,
          currency: row.currency,
          status: row.status,
          createdAt: toMs(row.created_at),
          updatedAt: toMs(row.updated_at),
          entitlementExpiration: row.entitlementExpiration,
          entitlementStatus: row.entitlementStatus,
        }));
    },
    adminList({ limit = 100, status, userId } = {}) {
      let sql = `SELECT p.*, plan.label AS planLabel FROM payments p JOIN plans plan ON plan.id=p.plan_id`;
      const where = [];
      const args = [];
      if (status) {
        where.push("p.status=?");
        args.push(status);
      }
      if (userId) {
        where.push("p.user_id=?");
        args.push(userId);
      }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY p.created_at DESC LIMIT ?";
      args.push(limit);
      return db
        .prepare(sql)
        .all(...args)
        .map((row) => ({
          ...row,
          createdAt: toMs(row.created_at),
          updatedAt: toMs(row.updated_at),
        }));
    },
    async adminRecordManualRefund({ paymentId, actor, reason }) {
      const payment = db.prepare("SELECT * FROM payments WHERE id=?").get(paymentId);
      if (!payment) throw new Error("Payment does not exist.");
      if (payment.status === "refunded")
        return { ok: true, alreadyRefunded: true };
      db.prepare(
        "UPDATE payments SET status='refunded', updated_at=? WHERE id=?",
      ).run(now(), paymentId);
      const rows = entitlements.revokeByPayment(paymentId, {
        actor: actor || "admin",
        reason,
      });
      audit?.(payment.user_id, "payment.manual_refund", {
        paymentId,
        reason,
        entitlementsRevoked: rows,
      });
      return { ok: true, entitlementsRevoked: rows };
    },
  };
}
