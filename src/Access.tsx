import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  CreditCard,
  ExternalLink,
  Loader2,
  LogOut,
  Monitor,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import { cloud } from "./cloud";

// Prepaid Razorpay checkout. The signature for every confirmation is
// verified server-side; this component only relays what the gateway
// produced.

const RAZORPAY_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let razorpayPromise: Promise<any> | null = null;

function loadRazorpay(): Promise<any> {
  const existing = (window as any).Razorpay;
  if (existing) return Promise.resolve(existing);
  if (!razorpayPromise) {
    razorpayPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = RAZORPAY_SRC;
      script.async = true;
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.remove();
        razorpayPromise = null;
        reject(
          new Error(
            "Could not load Razorpay payment service. Your browser or ad-blocker (such as Brave Shields or uBlock) is blocking checkout.razorpay.com. Please pause your ad-blocker or check your internet connection.",
          ),
        );
      };
      // A blocked CDN must not leave the button spinning forever.
      const timer = setTimeout(fail, 12000);
      script.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve((window as any).Razorpay);
      };
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }
  return razorpayPromise;
}

function inr(amountMinor: number) {
  return (
    "₹" +
    (amountMinor / 100).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
    })
  );
}

function formatCountdown(remainingMs: number) {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatWhen(ms: number) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function relative(ms: number) {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + " min ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " h ago";
  return formatWhen(ms);
}

function emitAccountChanged() {
  window.dispatchEvent(new Event("lensdesk:account-changed"));
}

export function Access({
  onNotice,
  onError,
  email,
  desktop,
  purchaseUrl,
  onChanged,
}: {
  onNotice: (message: string) => void;
  onError: (e: unknown) => void;
  email?: string;
  desktop: boolean;
  purchaseUrl?: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loadError, setLoadError] = useState("");
  const [busyPlan, setBusyPlan] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [revoking, setRevoking] = useState("");
  const [revokingAll, setRevokingAll] = useState(false);
  const [tick, setTick] = useState(0);
  const loadedAt = useRef(0);
  const mounted = useRef(true);

  async function refresh() {
    const next = await cloud("account.entitlement");
    if (!mounted.current) return next;
    loadedAt.current = Date.now();
    setData(next);
    setLoadError("");
    return next;
  }

  useEffect(() => {
    mounted.current = true;
    refresh().catch(() => {
      if (mounted.current) setLoadError("Could not load subscription status.");
    });
    const timer = setInterval(() => setTick((v) => v + 1), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);

  function reopen(pending: () => Promise<unknown>) {
    // after a successful purchase/confirmAction everyone refreshes.
    return pending().then(async () => {
      await refresh();
      onChanged?.();
      emitAccountChanged();
    });
  }

  async function openPurchaseWebsite() {
    const url = purchaseUrl || "";
    if (!url) throw new Error("The purchase page address is not configured.");
    if (!/^https:\/\/.+/.test(url))
      throw new Error("The purchase page address is not available.");
    await api("desktop.openExternal", { url });
  }

  async function purchase(plan: any) {
    setBusyPlan(plan.id);
    try {
      if (desktop) {
        // Purchases happen on the website only; open the dashboard there.
        await openPurchaseWebsite();
        onNotice("Opening the LensDesk website to complete your purchase.");
        return;
      }
      if (data?.paymentConfigured === false) {
        try {
          const res = await cloud("purchase.devActivate", { planId: plan.id });
          await refresh();
          onChanged?.();
          emitAccountChanged();
          onNotice(res.message || `Activated ${plan.label} plan!`);
          return;
        } catch (err: any) {
          throw new Error(
            err?.message ||
              "Payment gateway is not connected. An admin can grant subscription time from the /admin portal.",
          );
        }
      }
      const checkout = await cloud("purchase.checkout", { planId: plan.id });
      const Razorpay = await loadRazorpay();
      const checkoutOptions = {
        key: checkout.keyId,
        order_id: checkout.orderId,
        amount: checkout.amount,
        currency: checkout.currency,
        name: "LensDesk",
        description: `${checkout.plan.label} — ${checkout.plan.durationLabel}`,
        prefill: email ? { email } : {},
        theme: { color: "#3262d8" },
        modal: {
          ondismiss: () => {
            setBusyPlan("");
            onNotice(
              "Checkout closed without payment. If you already paid, use “Restore my payment” below.",
            );
          },
        },
        handler: (result: Record<string, string>) => {
          const finish = async () => {
            setBusyPlan("");
            try {
              const confirmed = await cloud("purchase.confirm", {
                orderId: result.razorpay_order_id,
                paymentId: result.razorpay_payment_id,
                signature: result.razorpay_signature,
              });
              await refresh();
              onChanged?.();
              emitAccountChanged();
              onNotice(
                confirmed.alreadyPaid
                  ? "This payment was already applied to your account."
                  : `Payment verified. ${checkout.plan.label} access is active.`,
              );
            } catch {
              onNotice(
                "Payment received — verification will complete automatically. Use “Restore my payment” if it does not.",
              );
            }
          };
          void finish();
        },
      };
      const rzp = new Razorpay(checkoutOptions);
      // The modal takes over from here; done/confirm callbacks reset the
      // busy flag and refresh the authoritative snapshot.
      setBusyPlan("");
      rzp.open();
    } catch (e) {
      setBusyPlan("");
      onError(e);
    }
  }

  async function attemptReconcile() {
    setReconciling(true);
    try {
      const result = await cloud("purchase.reconcile", {});
      await refresh();
      onChanged?.();
      emitAccountChanged();
      onNotice(
        result.repaired
          ? `Restored ${result.repaired} payment${result.repaired === 1 ? "" : "s"} from the gateway.`
          : "No gateway payments were waiting to be restored.",
      );
    } catch (e) {
      onError(e);
    } finally {
      setReconciling(false);
    }
  }

  async function revokeDevice(id: string) {
    setRevoking(id);
    try {
      await cloud("account.desktop.revoke", { id });
      await refresh();
      onChanged?.();
      onNotice("The desktop device can no longer use this account.");
    } catch (e) {
      onError(e);
    } finally {
      setRevoking("");
    }
  }

  async function revokeAllDevices() {
    if (
      !window.confirm(
        "Are you sure you want to log out from all desktop devices? All active desktop sessions will end immediately.",
      )
    ) {
      return;
    }
    setRevokingAll(true);
    try {
      const res = await cloud("account.desktop.revokeAll", {});
      await refresh();
      onChanged?.();
      onNotice(
        res?.revokedCount
          ? `Logged out ${res.revokedCount} desktop device${res.revokedCount === 1 ? "" : "s"}.`
          : "All desktop devices were logged out.",
      );
    } catch (e) {
      onError(e);
    } finally {
      setRevokingAll(false);
    }
  }

  const entitlement = data?.entitlement;
  const horizon = data?.horizon || 0;
  // Live remaining time derives from the authoritative server snapshot
  // plus locally elapsed time, so device clock skew cannot fake a
  // longer countdown between refreshes.
  const serverOffset =
    data && loadedAt.current ? loadedAt.current - (data.serverTimeMs || 0) : 0;
  const nowMs = Date.now() - serverOffset;
  const remaining = entitlement ? entitlement.expirationTimestamp - nowMs : 0;
  const active = Boolean(entitlement && remaining > 0);
  const chained = horizon > (entitlement?.expirationTimestamp || 0);
  const pendingPayments = (data?.history || []).filter((row: any) =>
    ["created", "failed"].includes(row.status),
  );
  const currentDevice = data?.desktop;

  if (!data)
    return (
      <section className="form-card access-card">
        {loadError ? (
          <div className="access-pending">
            <AlertTriangle size={16} />
            <p>{loadError}</p>
            <button
              className="button secondary"
              onClick={() => void refresh().catch(() => {})}
            >
              <RefreshCw size={15} />
              Retry
            </button>
          </div>
        ) : (
          <p className="muted">Loading your subscription…</p>
        )}
      </section>
    );

  return (
    <>
      <section className="form-card access-card">
        <div className="form-heading">
          <h2>
            <Clock size={18} />
            Desktop access
          </h2>
          {!desktop && (
            <button
              className="text-button"
              disabled={reconciling}
              onClick={() =>
                void refresh().then(() => {
                  onNotice("Subscription status refreshed.");
                })
              }
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          )}
        </div>
        {active ? (
          <div className="access-status active">
            <div className="access-countdown">
              <span className="access-countdown-label">
                {desktop ? "Time remaining" : "Access time remaining"}
              </span>
              <span className="access-countdown-value" key={tick}>
                {formatCountdown(remaining)}
              </span>
            </div>
            <div className="access-meta">
              <div>
                <strong>Plan</strong>
                <span>{entitlement.planId}</span>
              </div>
              <div>
                <strong>Active since</strong>
                <span>{formatWhen(entitlement.activationTimestamp)}</span>
              </div>
              <div>
                <strong>Expires</strong>
                <span>{formatWhen(entitlement.expirationTimestamp)}</span>
              </div>
              {chained && (
                <div>
                  <strong>Paid until</strong>
                  <span>{formatWhen(horizon)}</span>
                </div>
              )}
            </div>
            {chained && (
              <p className="field-help">
                Newer purchases extend your access from this expiry — you keep
                every paid minute.
              </p>
            )}
          </div>
        ) : (
          <div className="access-status none">
            <AlertTriangle size={20} />
            <div>
              <strong>No active access.</strong>
              <p>
                Choose a prepaid plan below. Access starts as soon as your
                payment is verified, and never renews automatically.
              </p>
            </div>
          </div>
        )}
        {pendingPayments.length > 0 && (
          <div className="access-pending">
            <RotateCcw size={16} />
            <p>
              A recent payment is waiting to be confirmed with the payment
              gateway.
            </p>
            <button
              className="button secondary"
              disabled={reconciling}
              onClick={() => void attemptReconcile()}
            >
              {reconciling ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <RotateCcw size={15} />
              )}
              Restore my payment
            </button>
          </div>
        )}
      </section>

      <section className="form-card access-card">
        <div className="form-heading">
          <h2>
            <CreditCard size={18} />
            Prepaid plans
          </h2>
        </div>
        <p className="field-help">
          Prices include applicable taxes. Plans never auto-renew — when time
          runs out you decide again.
        </p>
        {data.paymentConfigured === false && (
          <div
            style={{
              margin: "12px 0 16px",
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(216, 245, 107, 0.08)",
              border: "1px solid rgba(216, 245, 107, 0.25)",
              color: "var(--site-ink, #f3f5ed)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: "var(--site-accent, #d8f56b)" }}>
              Payment Gateway in Setup/Test Mode:
            </strong>{" "}
            Razorpay API keys are not yet configured in <code>.env</code>. You can click any plan below to activate it instantly in test mode, or have an Admin grant access from the Admin Portal.
          </div>
        )}
        <div className="access-plan-grid">
          {(data.plans || []).map((plan: any) => {
            const isCurrent = active && entitlement.planId === plan.id;
            return (
              <div
                key={plan.id}
                className={`access-plan${plan.highlight ? " highlight" : ""}`}
              >
                {plan.highlight && (
                  <span className="access-plan-tag">POPULAR</span>
                )}
                <h3>{plan.label}</h3>
                <div className="access-plan-price">
                  <span className="price-num">{inr(plan.priceMinor)}</span>
                  <span className="price-period">{plan.durationLabel}</span>
                </div>
                <p className="access-plan-tax">{plan.taxNote}</p>
                <button
                  className={`button ${plan.highlight ? "primary" : "secondary"} full-width`}
                  disabled={busyPlan === plan.id}
                  onClick={() => void purchase(plan)}
                >
                  {busyPlan === plan.id ? (
                    <Loader2 size={15} className="spin" />
                  ) : isCurrent ? (
                    <Check size={15} />
                  ) : (
                    <CreditCard size={15} />
                  )}
                  {data.paymentConfigured === false
                    ? "Activate plan (Test Mode)"
                    : isCurrent
                      ? "Add more time"
                      : "Buy plan"}
                </button>
              </div>
            );
          })}
          {!data.plans?.length && (
            <p className="muted">
              Plans are not configured on this server yet.
            </p>
          )}
        </div>
        {desktop && (
          <div className="access-web-note">
            <ExternalLink size={14} />
            <p>
              Purchases complete on the LensDesk website
              {purchaseUrl ? "" : " once a server is connected"}.
            </p>
            {purchaseUrl && (
              <button
                className="text-button"
                onClick={() => void openPurchaseWebsite()}
              >
                Open purchase page
              </button>
            )}
          </div>
        )}
      </section>

      <section className="form-card access-card">
        <div className="form-heading">
          <h2>
            <Monitor size={18} />
            Purchase history
          </h2>
        </div>
        {data.history?.length ? (
          <table className="access-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Plan</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Access ends</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((row: any) => (
                <tr key={row.id}>
                  <td>{formatWhen(row.createdAt)}</td>
                  <td>{row.planLabel || row.planId}</td>
                  <td>
                    {inr(row.amountMinor)} {row.currency}
                  </td>
                  <td>
                    <span className={`payment-badge ${row.status}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>{formatWhen(row.entitlementExpiration || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No purchases yet.</p>
        )}
      </section>

      <section className="form-card access-card">
        <div className="form-heading">
          <h2>
            <Monitor size={18} />
            Signed-in desktop devices
          </h2>
          {data.desktops?.length > 0 && (
            <button
              className="button secondary danger-text"
              type="button"
              disabled={revokingAll}
              onClick={() => void revokeAllDevices()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                padding: "6px 12px",
              }}
            >
              {revokingAll ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <LogOut size={13} />
              )}
              Log out from all devices
            </button>
          )}
        </div>
        <p className="field-help">
          Hourly and Daily plans allow 1 active desktop login at a time. Monthly plans allow up to 2 active logins simultaneously.
          Revoking a device ends its desktop session immediately.
        </p>
        {data.desktops?.length ? (
          <ul className="access-devices">
            {data.desktops.map((device: any) => (
              <li
                key={device.id}
                className={device.id === currentDevice?.id ? "current" : ""}
              >
                <div className="access-device-line">
                  <strong>{device.deviceLabel || "Desktop device"}</strong>
                  <span className="device-os">
                    {[device.os, device.appVersion].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="access-device-side">
                  <span className="muted">{relative(device.lastSeen)}</span>
                  {device.id === currentDevice?.id ? (
                    <span className="connection-badge connected">
                      {desktop ? "This device" : "Online now"}
                    </span>
                  ) : device.status === "active" ? (
                    revoking === device.id ? (
                      <span className="device-confirm">
                        <button
                          className="text-button danger"
                          onClick={() => void revokeDevice(device.id)}
                        >
                          <Trash2 size={13} />
                          Confirm revoke
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setRevoking("")}
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        className="text-button"
                        title="Revoke this device's desktop session"
                        onClick={() => setRevoking(device.id)}
                      >
                        Revoke
                      </button>
                    )
                  ) : (
                    <span className="device-badge">ended</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No desktop sign-ins yet.</p>
        )}
      </section>
      <p className="access-footnote">
        <ShieldCheck size={13} />
        Payments are verified by the LensDesk server with gateway signatures —
        never by the browser alone.
      </p>
    </>
  );
}
