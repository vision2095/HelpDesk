import React, { useEffect, useState } from "react";
import { PageNav } from "./PageNav";
import {
  Ban,
  ChevronRight,
  Download,
  Laptop,
  Loader2,
  Lock,
  Monitor,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";

// Operator console. Every request carries the ADMIN_TOKEN as a Bearer
// header; the server hash-compares it in constant time and hides the
// routes entirely when the token is absent. Nothing here is cached.

function inr(amountMinor: number) {
  return "₹" + (amountMinor / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

function when(value: unknown) {
  const ms = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!ms || Number.isNaN(ms)) return value ? String(value) : "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const DURATION_CHOICES: Array<[string, number]> = [
  ["1 hour", 3600],
  ["1 day", 86400],
  ["10 days", 864000],
  ["7 days", 604800],
  ["30 days", 2592000],
];

async function adminCall<T = any>(
  token: string,
  action: string,
  payload: unknown = {},
): Promise<T> {
  const response = await fetch(`/api/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "The admin token was rejected."
        : body.error || "Admin request failed.",
    );
  return body;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className={`admin-stat${tone ? ` ${tone}` : ""}`}>
      <span className="admin-stat-label">{label}</span>
      <span className="admin-stat-value">{value}</span>
    </div>
  );
}

export function Admin({ navigate }: { navigate?: (page: string) => void } = {}) {
  const [token, setToken] = useState("");
  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [grantPlan, setGrantPlan] = useState("");
  const [grantNote, setGrantNote] = useState("");
  const [extendChoice, setExtendChoice] = useState("86400");
  const [rememberToken, setRememberToken] = useState(true);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantDays, setGrantDays] = useState(30);
  const [customGrantNote, setCustomGrantNote] = useState("");

  async function handleGrantByEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    await act(
      () =>
        adminCall(token, "admin.user.grantByEmail", {
          email: grantEmail.trim(),
          days: Number(grantDays),
          note: customGrantNote.trim() || undefined,
        }),
      `Successfully granted ${grantDays} days of subscription to ${grantEmail.trim()}.`,
    );
    setGrantEmail("");
    setCustomGrantNote("");
  }

  useEffect(() => {
    const saved = sessionStorage.getItem("lensdesk_admin_token");
    if (saved) {
      setToken(saved);
      loadAll(saved);
    }
  }, []);

  const authorized = Boolean(token && overview !== null);

  async function loadAll(nextToken = token, search = query) {
    setBusy(true);
    setError("");
    try {
      const [ov, list] = await Promise.all([
        adminCall(nextToken, "admin.overview"),
        adminCall(nextToken, "admin.users", {
          query: search || undefined,
          limit: 100,
        }),
      ]);
      setOverview(ov);
      setUsers(list.users || []);
      const pub = await fetch("/api/cloud.public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then((r) => r.json());
      setPlans(pub.accessPlans || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Admin request failed.");
      if (overview === null) setOverview(null);
    } finally {
      setBusy(false);
    }
  }

  async function firstSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    if (rememberToken) {
      sessionStorage.setItem("lensdesk_admin_token", token.trim());
    }
    await loadAll(token.trim());
  }

  function lockConsole() {
    sessionStorage.removeItem("lensdesk_admin_token");
    setToken("");
    setOverview(null);
    setUsers([]);
    setSelected(null);
    setDetail(null);
  }

  function exportUsersCSV() {
    if (!users.length) return;
    const headers = [
      "ID",
      "Email",
      "Name",
      "Role",
      "Created At",
      "Last Active",
      "Subscription",
      "Suspended",
    ];
    const rows = users.map((u) => [
      `"${u.id || ""}"`,
      `"${u.email || ""}"`,
      `"${u.name || ""}"`,
      `"${u.role || ""}"`,
      `"${u.createdAt || ""}"`,
      `"${u.lastActiveAt || ""}"`,
      `"${u.subscription?.status || "None"}"`,
      `"${u.suspended ? "Yes" : "No"}"`,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lensdesk_admin_users_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function openUser(userId: string) {
    setBusy(true);
    setError("");
    try {
      const result = await adminCall(token, "admin.user", { userId });
      setSelected(result.user);
      setDetail(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the user.");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setNotice(message);
      await Promise.all([loadAll(), selected ? openUser(selected.id) : null]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!authorized)
    return (
      <div className="content-page admin-page">
        {navigate && <PageNav current="admin" onNavigate={navigate} />}
        <form className="form-card admin-token-card" onSubmit={firstSignIn}>
          <div className="form-heading">
            <h2>
              <Lock size={18} />
              Operator console
            </h2>
          </div>
          <label>
            Admin token
            <input
              type="password"
              autoFocus
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ADMIN_TOKEN"
            />
            <span className="field-help">
              The token is verified securely against the server and kept in session storage.
            </span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "10px 0 16px", fontSize: "12px", color: "var(--site-dark-muted, #9aa698)" }}>
            <input
              type="checkbox"
              id="admin-remember"
              checked={rememberToken}
              onChange={(e) => setRememberToken(e.target.checked)}
            />
            <label htmlFor="admin-remember" style={{ margin: 0, cursor: "pointer" }}>
              Remember token during this browser session
            </label>
          </div>
          <button className="button primary" disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}
            Unlock console
          </button>
          {error && <p className="admin-error">{error}</p>}
        </form>
      </div>
    );

  return (
    <div className="content-page admin-page">
      {navigate && <PageNav current="admin" onNavigate={navigate} />}
      <div className="page-heading">
        <div>
          <div className="site-kicker">
            <span />
            OPERATOR CONSOLE
          </div>
          <h1>Service control<span>.</span></h1>
          <p>Overview of accounts, desktop sessions, entitlements and payments.</p>
        </div>
        <div className="admin-header-actions">
          {users.length > 0 && (
            <button
              className="button secondary"
              type="button"
              onClick={exportUsersCSV}
            >
              <Download size={14} />
              Export CSV
            </button>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void loadAll()}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            className="button secondary danger-text"
            type="button"
            onClick={lockConsole}
          >
            <Lock size={14} />
            Lock Console
          </button>
        </div>
      </div>
      {(error || notice) && (
        <div className={`admin-banner${error ? " error" : ""}`}>
          {error || notice}
          <button className="text-button" onClick={() => { setError(""); setNotice(""); }}>
            Dismiss
          </button>
        </div>
      )}
      {(overview.users ?? 0) >= 0 && overview && (
        <div className="admin-stats">
          <Stat label="Users" value={overview.users} />
          <Stat label="Verified" value={overview.verified} />
          <Stat
            label="Active desktop sessions"
            value={overview.desktopSessions?.active ?? 0}
          />
          <Stat
            label="Live entitlements"
            value={overview.entitlements?.active ?? 0}
            tone="ok"
          />
          <Stat
            label="Expired"
            value={overview.entitlements?.expired ?? 0}
          />
          <Stat
            label="Revoked"
            value={overview.entitlements?.revoked ?? 0}
          />
          <Stat
            label="Paid in"
            value={inr(overview.payments?.paid?.totalMinor ?? 0)}
            tone="ok"
          />
          <Stat
            label="Refunded"
            value={inr(overview.payments?.refunded?.totalMinor ?? 0)}
            tone="warn"
          />
          <Stat label="Failed payments" value={overview.payments?.failed ?? 0} />
          <Stat
            label="Uptime"
            value={`${Math.floor((overview.uptimeSeconds ?? 0) / 3600)}h ${Math.floor(((overview.uptimeSeconds ?? 0) % 3600) / 60)}m`}
          />
        </div>
      )}
      {overview && (
        <table className="access-table admin-table">
          <thead>
            <tr>
              <th>Verified</th>
              <th>Suspended</th>
              <th>Deleting</th>
              <th>Entitlements active / expired / revoked</th>
              <th>Paid total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{overview.verified}</td>
              <td>
                {(overview.suspended || []).find((s: any) => s.account_state === "suspended")
                  ?.count ?? 0}
              </td>
              <td>
                {(overview.suspended || []).find((s: any) => s.account_state === "deleting")
                  ?.count ?? 0}
              </td>
              <td>
                {overview.entitlements?.active ?? 0} /{" "}
                {overview.entitlements?.expired ?? 0} /{" "}
                {overview.entitlements?.revoked ?? 0}
              </td>
              <td>{inr(overview.payments?.paid?.totalMinor ?? 0)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {/* Direct Custom Subscription Grant by Email */}
      <section className="form-card admin-grant-card" style={{ marginBottom: 24 }}>
        <div className="form-heading">
          <h2>
            <Sparkles size={17} style={{ color: "var(--site-accent, #d8f56b)" }} />
            Grant Custom Subscription by User Email
          </h2>
          <span className="local-tag">Instant Admin Activation</span>
        </div>
        <p style={{ marginBottom: 16 }}>
          Enter any user’s registered email address and assign any custom duration. If the account currently has active access, the days are automatically added to the remaining time without interrupting their license.
        </p>
        <form onSubmit={handleGrantByEmail} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            <label>
              User Email Address
              <input
                type="email"
                required
                placeholder="user@example.com"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
              />
            </label>
            <label>
              Subscription Days
              <input
                type="number"
                required
                min={1}
                max={3650}
                value={grantDays}
                onChange={(e) => setGrantDays(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </label>
            <label>
              Operator Note (Optional)
              <input
                type="text"
                placeholder="e.g. Special grant / support resolution"
                value={customGrantNote}
                maxLength={300}
                onChange={(e) => setCustomGrantNote(e.target.value)}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--site-dark-muted, #9aa698)" }}>Duration Presets:</span>
            {[
              { label: "1 Day", days: 1 },
              { label: "7 Days", days: 7 },
              { label: "10 Days", days: 10 },
              { label: "30 Days (Monthly)", days: 30 },
              { label: "90 Days (Quarterly)", days: 90 },
              { label: "365 Days (1 Year)", days: 365 },
            ].map((p) => (
              <button
                key={p.days}
                type="button"
                className={`quick-nav-pill ${grantDays === p.days ? "active" : ""}`}
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => setGrantDays(p.days)}
              >
                +{p.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button className="button primary" disabled={busy || !grantEmail.trim()}>
              <Sparkles size={14} />
              Grant {grantDays} Day{grantDays === 1 ? "" : "s"} of Desktop Access
            </button>
          </div>
        </form>
      </section>

      <section className="form-card">
        <div className="form-heading">
          <h2>
            <Search size={17} />
            Accounts
          </h2>
          <form
            className="admin-search"
            onSubmit={(e) => {
              e.preventDefault();
              void loadAll(token, query);
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search email or name"
              aria-label="Search users"
            />
            <button className="button secondary">Search</button>
          </form>
        </div>
        <table className="access-table admin-table">
          <thead>
            <tr>
              <th></th>
              <th>Email</th>
              <th>Name</th>
              <th>Status</th>
              <th>Access until</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={selected?.id === user.id ? "selected" : ""}>
                <td>
                  <button
                    className="text-button"
                    onClick={() => void openUser(user.id)}
                  >
                    <ChevronRight size={14} />
                    Open
                  </button>
                </td>
                <td>{user.email}</td>
                <td>{user.name}</td>
                <td>
                  <span className={`payment-badge ${user.account_state === "active" ? "paid" : user.account_state}`}>
                    {user.account_state}
                    {!user.verified && " · unverified"}
                  </span>
                </td>
                <td>{when(user.accessUntil)}</td>
                <td>{when(user.created_at)}</td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={6} className="muted">
                  No accounts match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {selected && detail && (
        <section className="form-card">
          <div className="form-heading">
            <h2>
              <ShieldCheck size={17} />
              {selected.email}
            </h2>
            <div className="admin-user-actions">
              {selected.account_state === "active" ? (
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        adminCall(token, "admin.user.suspend", {
                          userId: selected.id,
                          reason: "Suspended from admin console",
                        }),
                      "Account suspended and desktop sessions revoked.",
                    )
                  }
                >
                  <Ban size={13} />
                  Suspend
                </button>
              ) : (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        adminCall(token, "admin.user.unsuspend", {
                          userId: selected.id,
                        }),
                      "Account reactivated.",
                    )
                  }
                >
                  <Undo2 size={13} />
                  Unsuspend
                </button>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => adminCall(token, "admin.desktop.revoke", { userId: selected.id }),
                    "All desktop sessions for this account were revoked.",
                  )
                }
              >
                <Ban size={13} />
                Revoke desktop sessions
              </button>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Permanently delete account "${selected.email}"? This action cannot be undone. All user data, active sessions, and subscriptions will be deleted.`,
                    )
                  )
                    return;
                  void act(
                    async () => {
                      await adminCall(token, "admin.user.delete", { userId: selected.id });
                      setSelected(null);
                      setDetail(null);
                    },
                    `User account "${selected.email}" has been deleted.`,
                  );
                }}
              >
                <Trash2 size={13} />
                Delete Account
              </button>
            </div>
          </div>

          {/* Active Desktop Sessions for User */}
          <div style={{ margin: "20px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                <Laptop size={16} />
                Desktop Device Sessions ({detail.desktopSessions?.filter((s: any) => s.status === "active").length || 0} active)
              </h3>
              {detail.desktopSessions?.some((s: any) => s.status === "active") && (
                <button
                  className="button secondary danger-text"
                  style={{ fontSize: 12, padding: "4px 9px" }}
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => adminCall(token, "admin.desktop.revoke", { userId: selected.id }),
                      "All desktop sessions for this account were revoked.",
                    )
                  }
                >
                  <Ban size={13} />
                  Revoke All Devices
                </button>
              )}
            </div>
            <table className="access-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>OS / App</th>
                  <th>Last Active</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {detail.desktopSessions?.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.deviceLabel || "LensDesk Desktop"}</strong>
                      <span className="muted admin-id">{s.id.slice(0, 8)}</span>
                    </td>
                    <td>{s.os || "—"} · v{s.appVersion || "2.0.0"}</td>
                    <td>{when(s.lastSeen * 1000)}</td>
                    <td>
                      <span className={`payment-badge ${s.status === "active" ? "active" : "failed"}`}>
                        {s.status}
                      </span>
                    </td>
                    <td>
                      {s.status === "active" ? (
                        <button
                          className="text-button danger-text"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => adminCall(token, "admin.desktop.revokeSession", { sessionId: s.id }),
                              "Desktop session was disconnected.",
                            )
                          }
                        >
                          Disconnect
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(!detail.desktopSessions || !detail.desktopSessions.length) && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No desktop sessions recorded for this user.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-grant-row">
            <strong>Grant entitlement</strong>
            <select
              value={grantPlan || plans[0]?.id || ""}
              onChange={(e) => setGrantPlan(e.target.value)}
              aria-label="Plan to grant"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({inr(p.priceMinor)})
                </option>
              ))}
            </select>
            <input
              placeholder="Note (optional)"
              maxLength={300}
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
            />
            <button
              className="button secondary"
              disabled={busy || !plans.length || !(grantPlan || plans[0]?.id)}
              onClick={() =>
                void act(
                  () =>
                    adminCall(token, "admin.entitlement.grant", {
                      userId: selected.id,
                      planId: grantPlan || plans[0].id,
                      note: grantNote,
                    }),
                  "Entitlement granted.",
                )
              }
            >
              Grant
            </button>
          </div>

          <table className="access-table">
            <thead>
              <tr>
                <th>Entitlement</th>
                <th>Window</th>
                <th>Status</th>
                <th>Admin actions</th>
              </tr>
            </thead>
            <tbody>
              {detail.entitlements.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    {row.planId}
                    <span className="muted admin-id">{row.id.slice(0, 8)}</span>
                  </td>
                  <td>
                    {when(row.activationTimestamp)} → {when(row.expirationTimestamp)}
                  </td>
                  <td>
                    <span className={`payment-badge ${row.subscriptionStatus}`}>
                      {row.subscriptionStatus}
                      {row.expired ? " · expired" : ""}
                    </span>
                  </td>
                  <td>
                    <div className="admin-row-actions">
                      <select
                        value={extendChoice}
                        onChange={(e) => setExtendChoice(e.target.value)}
                        aria-label="Extend by"
                      >
                        {DURATION_CHOICES.map(([label, seconds]) => (
                          <option key={seconds} value={String(seconds)}>
                            + {label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              adminCall(token, "admin.entitlement.extend", {
                                entitlementId: row.id,
                                seconds: Number(extendChoice),
                              }),
                            "Entitlement extended.",
                          )
                        }
                      >
                        <RotateCcw size={13} />
                        Extend
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              adminCall(token, "admin.entitlement.setExpiration", {
                                entitlementId: row.id,
                                expirationMs: Math.max(
                                  Date.now(),
                                  row.activationTimestamp,
                                ),
                                reason: "Ended from admin console",
                              }),
                            "Access ends immediately.",
                          )
                        }
                        title="Set expiration to now (access ends immediately)"
                      >
                        End now
                      </button>
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              adminCall(token, "admin.entitlement.revoke", {
                                entitlementId: row.id,
                                reason: "Revoked from admin console",
                              }),
                            "Entitlement revoked.",
                          )
                        }
                      >
                        Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!detail.entitlements.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No entitlements.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <table className="access-table">
            <thead>
              <tr>
                <th>Payments</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {detail.payments.map((row: any) => (
                <tr key={row.id}>
                  <td>
                    {when(row.createdAt * 1000)} · {row.planLabel || row.plan_id}
                    <span className="muted admin-id">{String(row.id).slice(0, 8)}</span>
                  </td>
                  <td>{inr(row.amount_minor)}</td>
                  <td>
                    <span className={`payment-badge ${row.status}`}>{row.status}</span>
                  </td>
                  <td>
                    {["paid", "created"].includes(row.status) && (
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              adminCall(token, "admin.payment.refund", {
                                paymentId: row.id,
                                reason: "Refunded from admin console",
                              }),
                            "Payment refunded; coverage revoked immediately.",
                          )
                        }
                      >
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!detail.payments.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No payments.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="admin-columns">
            <div>
              <h3>Desktop devices</h3>
              <ul className="access-devices">
                {detail.desktopSessions.map((s: any) => (
                  <li key={s.id}>
                    <div className="access-device-line">
                      <strong>{s.deviceLabel}</strong>
                      <span className="device-os">{s.os || ""}</span>
                    </div>
                    <div className="access-device-side">
                      <span className="muted">{s.status}</span>
                    </div>
                  </li>
                ))}
                {!detail.desktopSessions.length && <li className="muted">None.</li>}
              </ul>
            </div>
            <div>
              <h3>Security audit</h3>
              <ul className="admin-audit">
                {detail.audit.slice(0, 25).map((row: any, i: number) => (
                  <li key={i}>
                    <span className="admin-audit-event">{row.event}</span>
                    <span className="muted">{when(row.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
