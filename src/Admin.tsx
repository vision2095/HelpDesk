import React, { useEffect, useState } from "react";
import {
  Aperture,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  Database,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Users,
  X,
} from "lucide-react";

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

function timeAgo(value: unknown) {
  const ms = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!ms || Number.isNaN(ms)) return "—";
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

const DURATION_CHOICES: Array<[string, number]> = [
  ["1 hour", 3600],
  ["1 day", 86400],
  ["7 days", 604800],
  ["10 days", 864000],
  ["30 days (1 mo)", 2592000],
  ["90 days (3 mo)", 7776000],
  ["365 days (1 yr)", 31536000],
];

async function adminCall<T = any>(
  token: string,
  action: string,
  payload: Record<string, any> = {},
): Promise<T> {
  const res = await fetch("/api/cloud.action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error ||
        (res.status === 404
          ? "Admin access rejected or invalid token."
          : `Admin request failed (${res.status})`),
    );
  }
  return data as T;
}

export function Admin({ navigate }: { navigate?: (page: string) => void } = {}) {
  const [token, setToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberToken, setRememberToken] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "active" | "pro" | "unverified" | "suspended">("all");
  const [activeTab, setActiveTab] = useState<"users" | "grant" | "seats" | "payments">("users");
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [grantPlan, setGrantPlan] = useState("");
  const [grantNote, setGrantNote] = useState("");
  const [extendChoice, setExtendChoice] = useState("86400");

  // Custom Grant By Email state
  const [grantEmail, setGrantEmail] = useState("");
  const [grantDays, setGrantDays] = useState<number>(30);
  const [customGrantNote, setCustomGrantNote] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("lensdesk_admin_token") || sessionStorage.getItem("lensdesk_admin_token");
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
      localStorage.setItem("lensdesk_admin_token", token.trim());
      sessionStorage.setItem("lensdesk_admin_token", token.trim());
    }
    await loadAll(token.trim());
  }

  function lockConsole() {
    localStorage.removeItem("lensdesk_admin_token");
    sessionStorage.removeItem("lensdesk_admin_token");
    setToken("");
    setOverview(null);
    setUsers([]);
    setSelected(null);
    setDetail(null);
  }

  function exportUsersCSV() {
    if (!users.length) return;
    const headers = ["ID", "Email", "Name", "Verified", "State", "AccessUntil", "CreatedAt"];
    const rows = users.map((u) => [
      u.id,
      u.email,
      `"${(u.name || "").replace(/"/g, '""')}"`,
      u.verified ? "YES" : "NO",
      u.account_state,
      u.accessUntil ? new Date(u.accessUntil).toISOString() : "",
      u.created_at ? new Date(u.created_at).toISOString() : "",
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `helpdesk_users_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function openUser(userId: string) {
    setBusy(true);
    setError("");
    try {
      const result = await adminCall(token, "admin.user", { userId });
      setSelected(result.user);
      setDetail({
        entitlements: result.entitlements || [],
        desktopSessions: result.desktopSessions || [],
        payments: result.payments || [],
        audit: result.audit || [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load user details.");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<any>, successNotice: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(successNotice);
      if (selected) {
        await openUser(selected.id);
      }
      await loadAll(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGrantByEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!grantEmail.trim() || grantDays <= 0) return;
    await act(
      () =>
        adminCall(token, "admin.user.grantByEmail", {
          email: grantEmail.trim().toLowerCase(),
          days: grantDays,
          note: customGrantNote.trim() || undefined,
        }),
      `Successfully granted ${grantDays} day(s) of desktop access to ${grantEmail.trim()}!`,
    );
    setGrantEmail("");
    setCustomGrantNote("");
  }

  // Filtered Users
  const filteredUsers = users.filter((u) => {
    if (userFilter === "active") return u.account_state === "active";
    if (userFilter === "pro") return u.accessUntil && u.accessUntil > Date.now();
    if (userFilter === "unverified") return !u.verified;
    if (userFilter === "suspended") return u.account_state === "suspended";
    return true;
  });

  // ==========================================
  // 1. LOCK SCREEN (UNAUTHORIZED)
  // ==========================================
  if (!authorized) {
    return (
      <div className="admin-portal-standalone admin-vault-bg">
        <header className="admin-portal-header">
          <div className="admin-portal-header-inner">
            <div className="admin-portal-brand">
              <a href="/" onClick={(e) => { e.preventDefault(); navigate?.("home"); }}>
                <span className="admin-brand-mark">
                  <Aperture size={18} />
                </span>
                <span className="admin-brand-title">
                  HelpDesk<span className="brand-dot">.</span>
                </span>
              </a>
              <span className="admin-portal-badge secure">SECURE VAULT</span>
            </div>
            <div className="admin-portal-actions">
              <button
                type="button"
                className="admin-link-button"
                onClick={() => navigate?.("home")}
              >
                <ArrowLeft size={14} />
                Return to Site
              </button>
            </div>
          </div>
        </header>

        <div className="admin-lock-screen">
          <div className="admin-vault-ambient-glow" />
          <form className="admin-token-card-v2" onSubmit={firstSignIn}>
            <div className="admin-lock-header">
              <div className="admin-shield-orb">
                <ShieldCheck size={36} />
                <div className="admin-orb-pulse" />
              </div>
              <h2>Operator Control Vault</h2>
              <p>
                Restricted administrative zone. Enter your administrator key to access the control plane, inspect accounts, and manage subscriptions.
              </p>
            </div>

            <div className="admin-input-group">
              <label>Administrator Key</label>
              <div className="admin-password-wrapper">
                <Lock size={16} className="admin-input-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoFocus
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Enter administrator password"
                />
                <button
                  type="button"
                  className="admin-pwd-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="admin-checkbox-row">
              <label className="admin-checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberToken}
                  onChange={(e) => setRememberToken(e.target.checked)}
                />
                <span>Remember key on this device (Auto-login next time)</span>
              </label>
            </div>

            <button className="admin-button-primary-glow" disabled={busy || !token.trim()}>
              {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
              Authenticate & Unlock Vault
            </button>

            {error && (
              <div className="admin-alert-banner error">
                <ShieldAlert size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="admin-lock-footer-info">
              <div className="admin-badge-dot-live">
                <span className="live-dot" />
                <span>Neon PostgreSQL Cluster (Online)</span>
              </div>
              <p>Protected by SHA-256 Constant-Time Verification & IP Rate Limiting</p>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // 2. AUTHORIZED OPERATOR CONSOLE
  // ==========================================
  const totalPaidRevenue = overview.payments?.paid?.totalMinor ?? 0;
  const activeSeatsCount = overview.desktopSessions?.active ?? 0;
  const activeEntitlementsCount = overview.entitlements?.active ?? 0;
  const verifiedPercent = overview.users > 0 ? Math.round((overview.verified / overview.users) * 100) : 0;

  return (
    <div className="admin-portal-standalone admin-dashboard-bg">
      {/* Top Navbar */}
      <header className="admin-portal-header">
        <div className="admin-portal-header-inner">
          <div className="admin-portal-brand">
            <a href="/" onClick={(e) => { e.preventDefault(); navigate?.("home"); }}>
              <span className="admin-brand-mark">
                <Aperture size={18} />
              </span>
              <span className="admin-brand-title">
                HelpDesk<span className="brand-dot">.</span>
              </span>
            </a>
            <span className="admin-portal-badge live">OPERATOR LIVE</span>
          </div>

          <div className="admin-system-cluster-pill">
            <Database size={13} style={{ color: "var(--site-accent, #d8f56b)" }} />
            <span>Neon DB: <strong>nameless-fire-80985027</strong></span>
            <span className="pill-divider">·</span>
            <span className="live-dot" />
            <span>Online</span>
          </div>

          <div className="admin-portal-actions">
            <button
              type="button"
              className="admin-link-button"
              onClick={() => navigate?.("home")}
              title="View Public Site"
            >
              <ArrowLeft size={14} />
              Website
            </button>
            {users.length > 0 && (
              <button
                className="admin-btn-secondary"
                type="button"
                onClick={exportUsersCSV}
                title="Download all accounts as CSV"
              >
                <Download size={13} />
                Export CSV
              </button>
            )}
            <button
              className="admin-btn-secondary"
              type="button"
              disabled={busy}
              onClick={() => void loadAll()}
              title="Refresh database records"
            >
              <RefreshCw size={13} className={busy ? "spin" : ""} />
              Sync
            </button>
            <button
              className="admin-btn-danger"
              type="button"
              onClick={lockConsole}
              title="Lock Console & Clear Device Session"
            >
              <Lock size={13} />
              Lock
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="admin-portal-content">
        {/* Alerts / Banners */}
        {(error || notice) && (
          <div className={`admin-alert-banner ${error ? "error" : "success"}`}>
            {error ? <ShieldAlert size={18} /> : <CheckCircle2 size={18} />}
            <span style={{ flex: 1 }}>{error || notice}</span>
            <button className="admin-icon-close" onClick={() => { setError(""); setNotice(""); }}>
              <X size={15} />
            </button>
          </div>
        )}

        {/* Dashboard Title & Quick Stats */}
        <div className="admin-header-row">
          <div>
            <div className="admin-kicker">
              <span className="kicker-pulse" />
              PRODUCTION CONTROL SUITE
            </div>
            <h1 className="admin-hero-title">Service Operations<span>.</span></h1>
            <p className="admin-hero-sub">
              Monitor active accounts, issue custom entitlements, inspect desktop hardware seats, and audit security events.
            </p>
          </div>
          <div className="admin-uptime-chip">
            <Clock size={14} />
            <span>
              Uptime: <strong>{Math.floor((overview.uptimeSeconds ?? 0) / 3600)}h {Math.floor(((overview.uptimeSeconds ?? 0) % 3600) / 60)}m</strong>
            </span>
          </div>
        </div>

        {/* KPI Stat Grid */}
        <div className="admin-kpi-grid">
          <div className="admin-kpi-card">
            <div className="kpi-icon-wrap lime">
              <Users size={20} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Total Accounts</span>
              <div className="kpi-number-wrap">
                <span className="kpi-value">{overview.users ?? 0}</span>
                <span className="kpi-sub-pill">{verifiedPercent}% Verified</span>
              </div>
            </div>
          </div>

          <div className="admin-kpi-card">
            <div className="kpi-icon-wrap cyan">
              <Laptop size={20} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Active Desktop Seats</span>
              <div className="kpi-number-wrap">
                <span className="kpi-value">{activeSeatsCount}</span>
                <span className="kpi-sub-pill cyan">Live Leased</span>
              </div>
            </div>
          </div>

          <div className="admin-kpi-card">
            <div className="kpi-icon-wrap emerald">
              <Sparkles size={20} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Active Entitlements</span>
              <div className="kpi-number-wrap">
                <span className="kpi-value">{activeEntitlementsCount}</span>
                <span className="kpi-sub-pill emerald">Coverage Active</span>
              </div>
            </div>
          </div>

          <div className="admin-kpi-card">
            <div className="kpi-icon-wrap amber">
              <CreditCard size={20} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Paid In (INR)</span>
              <div className="kpi-number-wrap">
                <span className="kpi-value">{inr(totalPaidRevenue)}</span>
                <span className="kpi-sub-pill amber">Settled</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="admin-tab-bar">
          <button
            className={`admin-tab-btn ${activeTab === "users" ? "active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            <Users size={15} />
            User Accounts ({users.length})
          </button>
          <button
            className={`admin-tab-btn ${activeTab === "grant" ? "active" : ""}`}
            onClick={() => setActiveTab("grant")}
          >
            <Sparkles size={15} />
            Instant Subscription Grant
          </button>
          <button
            className={`admin-tab-btn ${activeTab === "seats" ? "active" : ""}`}
            onClick={() => setActiveTab("seats")}
          >
            <Laptop size={15} />
            Desktop Seats & Telemetry
          </button>
          <button
            className={`admin-tab-btn ${activeTab === "payments" ? "active" : ""}`}
            onClick={() => setActiveTab("payments")}
          >
            <CreditCard size={15} />
            Payments & Plans
          </button>
        </div>

        {/* TAB 1: USER ACCOUNTS */}
        {activeTab === "users" && (
          <div className="admin-card-v2">
            <div className="admin-card-header">
              <div className="admin-card-title-group">
                <h3>Directory of Accounts</h3>
                <span className="admin-counter-pill">{filteredUsers.length} shown</span>
              </div>

              {/* Search & Filter Controls */}
              <div className="admin-filter-bar">
                <div className="admin-filter-pills">
                  {(["all", "active", "pro", "unverified", "suspended"] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={`admin-filter-tag ${userFilter === filter ? "active" : ""}`}
                      onClick={() => setUserFilter(filter)}
                    >
                      {filter.toUpperCase()}
                    </button>
                  ))}
                </div>

                <form
                  className="admin-search-box"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loadAll(token, query);
                  }}
                >
                  <Search size={14} className="search-icon" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by email or name..."
                    aria-label="Search users"
                  />
                  {query && (
                    <button
                      type="button"
                      className="search-clear"
                      onClick={() => {
                        setQuery("");
                        void loadAll(token, "");
                      }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </form>
              </div>
            </div>

            <div className="admin-table-container">
              <table className="admin-table-v2">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Verification</th>
                    <th>Status</th>
                    <th>Access Horizon</th>
                    <th>Joined</th>
                    <th style={{ textAlign: "right" }}>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const initials = (user.name || user.email || "U")
                      .slice(0, 2)
                      .toUpperCase();
                    const hasLiveAccess = user.accessUntil && user.accessUntil > Date.now();

                    return (
                      <tr
                        key={user.id}
                        className={selected?.id === user.id ? "row-selected" : ""}
                        onClick={() => void openUser(user.id)}
                      >
                        <td>
                          <div className="admin-user-cell">
                            <div className={`admin-avatar ${hasLiveAccess ? "pro" : ""}`}>
                              {initials}
                            </div>
                            <div className="admin-user-meta">
                              <span className="user-email-text">{user.email}</span>
                              <span className="user-name-text">{user.name || "No name set"}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          {user.verified ? (
                            <span className="admin-status-badge verified">
                              <CheckCircle2 size={12} /> Verified
                            </span>
                          ) : (
                            <span className="admin-status-badge unverified">
                              Unverified
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`admin-status-badge ${user.account_state}`}>
                            <span className="status-dot" />
                            {user.account_state}
                          </span>
                        </td>
                        <td>
                          {hasLiveAccess ? (
                            <div className="admin-access-horizon live">
                              <Sparkles size={12} />
                              <span>{when(user.accessUntil)}</span>
                            </div>
                          ) : (
                            <span className="admin-muted-horizon">No active license</span>
                          )}
                        </td>
                        <td>
                          <span className="admin-time-sub">{timeAgo(user.created_at)}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="admin-table-inspect-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void openUser(user.id);
                            }}
                          >
                            <span>Inspect</span>
                            <ChevronRight size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredUsers.length && (
                    <tr>
                      <td colSpan={6} className="admin-empty-table-row">
                        <Users size={32} />
                        <p>No user accounts match the current filter or search criteria.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: INSTANT CUSTOM GRANT */}
        {activeTab === "grant" && (
          <div className="admin-card-v2 admin-grant-panel">
            <div className="admin-card-header">
              <div className="admin-card-title-group">
                <h3>
                  <Sparkles size={18} style={{ color: "var(--site-accent, #d8f56b)" }} />
                  Instant Desktop License Grant
                </h3>
                <span className="admin-badge-neon">Zero Latency Activation</span>
              </div>
            </div>
            <p className="admin-panel-description">
              Grant custom desktop workstation access directly by user email address. If the user already has active coverage, the new days will seamlessly stack on top of their remaining expiration date without resetting their session.
            </p>

            <form onSubmit={handleGrantByEmail} className="admin-grant-form-v2">
              <div className="admin-form-grid-3">
                <div className="admin-input-group">
                  <label>Target Account Email</label>
                  <input
                    type="email"
                    required
                    placeholder="user@organization.com"
                    value={grantEmail}
                    onChange={(e) => setGrantEmail(e.target.value)}
                  />
                </div>
                <div className="admin-input-group">
                  <label>Granted Duration (Days)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={3650}
                    value={grantDays}
                    onChange={(e) => setGrantDays(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
                <div className="admin-input-group">
                  <label>Operator Audit Note</label>
                  <input
                    type="text"
                    placeholder="e.g. VIP onboarding / Manual invoice settlement"
                    value={customGrantNote}
                    maxLength={300}
                    onChange={(e) => setCustomGrantNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="admin-presets-wrap">
                <span className="preset-label">Quick Duration Presets:</span>
                {[
                  { label: "1 Day Pass", days: 1 },
                  { label: "7 Days Sprint", days: 7 },
                  { label: "10 Days", days: 10 },
                  { label: "30 Days (1 Month)", days: 30 },
                  { label: "90 Days (Quarterly)", days: 90 },
                  { label: "365 Days (Annual)", days: 365 },
                ].map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    className={`admin-preset-chip ${grantDays === p.days ? "active" : ""}`}
                    onClick={() => setGrantDays(p.days)}
                  >
                    +{p.label}
                  </button>
                ))}
              </div>

              <div className="admin-form-actions-right">
                <button
                  type="submit"
                  className="admin-button-primary-glow"
                  disabled={busy || !grantEmail.trim()}
                >
                  <Sparkles size={15} />
                  Authorize {grantDays} Day{grantDays === 1 ? "" : "s"} Desktop Access
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: DESKTOP SEATS & TELEMETRY */}
        {activeTab === "seats" && (
          <div className="admin-card-v2">
            <div className="admin-card-header">
              <div className="admin-card-title-group">
                <h3>Active Desktop Workstation Leases</h3>
                <span className="admin-counter-pill">{activeSeatsCount} concurrent</span>
              </div>
            </div>
            <p className="admin-panel-description">
              Live heartbeat telemetry from native Windows (C++20 / Direct3D 11) and macOS desktop hosts. Seats are protected with strict single-device concurrency and advisory locks.
            </p>

            <div className="admin-table-container">
              <table className="admin-table-v2">
                <thead>
                  <tr>
                    <th>Host Metric</th>
                    <th>Hardware / OS</th>
                    <th>App Version</th>
                    <th>Heartbeat Status</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.desktopSessions?.active > 0 ? (
                    <tr>
                      <td>
                        <strong>LensDesk Hardware Runner</strong>
                      </td>
                      <td>Windows / macOS Native</td>
                      <td>v2.0.0 (Production)</td>
                      <td>Every 60s Active</td>
                      <td>
                        <span className="admin-status-badge active">
                          <span className="status-dot" /> Live Active
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={5} className="admin-empty-table-row">
                        <Laptop size={32} />
                        <p>No active desktop workstations currently executing heartbeats.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: PAYMENTS & PLANS */}
        {activeTab === "payments" && (
          <div className="admin-card-v2">
            <div className="admin-card-header">
              <div className="admin-card-title-group">
                <h3>Configured Access Plans & Financial Summary</h3>
                <span className="admin-badge-neon">Razorpay / Stripe Live</span>
              </div>
            </div>

            <div className="admin-plans-catalog-grid">
              {plans.map((p) => (
                <div key={p.id} className="admin-plan-card">
                  <div className="plan-card-top">
                    <h4>{p.label}</h4>
                    <span className="plan-price-tag">{inr(p.priceMinor)}</span>
                  </div>
                  <div className="plan-duration-badge">
                    <Clock size={12} />
                    <span>Duration: {p.durationLabel || `${Math.floor(p.durationSeconds / 86400)} days`}</span>
                  </div>
                  <p className="plan-tax-note">{p.taxNote || "Tax inclusive"}</p>
                </div>
              ))}
            </div>

            <div className="admin-financial-stats-row">
              <div className="stat-pill">
                <span>Paid Total:</span>
                <strong>{inr(overview.payments?.paid?.totalMinor ?? 0)}</strong>
              </div>
              <div className="stat-pill">
                <span>Refunded Total:</span>
                <strong style={{ color: "#f59e0b" }}>{inr(overview.payments?.refunded?.totalMinor ?? 0)}</strong>
              </div>
              <div className="stat-pill">
                <span>Failed Transactions:</span>
                <strong style={{ color: "#f87171" }}>{overview.payments?.failed ?? 0}</strong>
              </div>
            </div>
          </div>
        )}

        {/* USER DETAIL MODAL / DRAWER */}
        {selected && detail && (
          <div className="admin-drawer-backdrop" onClick={() => { setSelected(null); setDetail(null); }}>
            <div className="admin-drawer-container" onClick={(e) => e.stopPropagation()}>
              <div className="admin-drawer-header">
                <div className="admin-drawer-title">
                  <div className="admin-avatar pro large">
                    {(selected.name || selected.email).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h2>{selected.email}</h2>
                    <span className="drawer-subtitle">User ID: {selected.id}</span>
                  </div>
                </div>
                <button
                  className="admin-drawer-close"
                  onClick={() => { setSelected(null); setDetail(null); }}
                  title="Close Inspector"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="admin-drawer-content">
                {/* Operator Actions Bar */}
                <div className="admin-drawer-quick-actions">
                  {selected.account_state === "active" ? (
                    <button
                      className="admin-action-btn danger"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => adminCall(token, "admin.user.suspend", { userId: selected.id, reason: "Suspended by operator" }),
                          "Account has been suspended and all sessions revoked.",
                        )
                      }
                    >
                      <Ban size={14} /> Suspend Account
                    </button>
                  ) : (
                    <button
                      className="admin-action-btn success"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => adminCall(token, "admin.user.unsuspend", { userId: selected.id }),
                          "Account has been reactivated.",
                        )
                      }
                    >
                      <Undo2 size={14} /> Reactivate Account
                    </button>
                  )}

                  <button
                    className="admin-action-btn"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => adminCall(token, "admin.desktop.revoke", { userId: selected.id }),
                        "All desktop workstation seats revoked.",
                      )
                    }
                  >
                    <Laptop size={14} /> Revoke Desktop Seats
                  </button>

                  <button
                    className="admin-action-btn"
                    disabled={busy}
                    onClick={() => {
                      const newPass = window.prompt(`Enter new password for ${selected.email} (min 6 characters):`, "12345678");
                      if (!newPass) return;
                      if (newPass.length < 6) {
                        alert("Password must be at least 6 characters.");
                        return;
                      }
                      void act(
                        () => adminCall(token, "admin.user.resetPassword", { userId: selected.id, newPassword: newPass }),
                        `Password updated for ${selected.email}.`,
                      );
                    }}
                  >
                    <KeyRound size={14} /> Reset Password
                  </button>

                  <button
                    className="admin-action-btn danger"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Permanently delete account "${selected.email}"? All data will be wiped.`)) return;
                      void act(
                        async () => {
                          await adminCall(token, "admin.user.delete", { userId: selected.id });
                          setSelected(null);
                          setDetail(null);
                        },
                        `User account "${selected.email}" deleted.`,
                      );
                    }}
                  >
                    <Trash2 size={14} /> Delete Account
                  </button>
                </div>

                {/* Grant Entitlement Box */}
                <div className="admin-drawer-box">
                  <h4>Grant Custom Plan to this User</h4>
                  <div className="admin-drawer-grant-row">
                    <select
                      value={grantPlan || plans[0]?.id || ""}
                      onChange={(e) => setGrantPlan(e.target.value)}
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
                      className="admin-button-primary-glow"
                      disabled={busy || !plans.length || !(grantPlan || plans[0]?.id)}
                      onClick={() =>
                        void act(
                          () =>
                            adminCall(token, "admin.entitlement.grant", {
                              userId: selected.id,
                              planId: grantPlan || plans[0].id,
                              note: grantNote,
                            }),
                          "Entitlement granted successfully.",
                        )
                      }
                    >
                      Grant
                    </button>
                  </div>
                </div>

                {/* Entitlements Table */}
                <div className="admin-drawer-box">
                  <h4>Active & Past Entitlements ({detail.entitlements.length})</h4>
                  <table className="admin-table-v2 mini">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Coverage Period</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.entitlements.map((row: any) => (
                        <tr key={row.id}>
                          <td><strong>{row.planId}</strong></td>
                          <td>{when(row.activationTimestamp)} → {when(row.expirationTimestamp)}</td>
                          <td>
                            <span className={`admin-status-badge ${row.subscriptionStatus}`}>
                              {row.subscriptionStatus} {row.expired ? "(expired)" : ""}
                            </span>
                          </td>
                          <td>
                            <div className="admin-mini-actions">
                              <select
                                value={extendChoice}
                                onChange={(e) => setExtendChoice(e.target.value)}
                              >
                                {DURATION_CHOICES.map(([label, seconds]) => (
                                  <option key={seconds} value={String(seconds)}>
                                    + {label}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="admin-mini-btn"
                                onClick={() =>
                                  void act(
                                    () => adminCall(token, "admin.entitlement.extend", { entitlementId: row.id, seconds: Number(extendChoice) }),
                                    "Extended successfully.",
                                  )
                                }
                              >
                                Extend
                              </button>
                              <button
                                className="admin-mini-btn danger"
                                onClick={() =>
                                  void act(
                                    () => adminCall(token, "admin.entitlement.revoke", { entitlementId: row.id, reason: "Revoked by admin" }),
                                    "Revoked.",
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
                        <tr><td colSpan={4} className="admin-empty-table-row mini">No entitlements found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Desktop Sessions Table */}
                <div className="admin-drawer-box">
                  <h4>Registered Desktop Sessions ({detail.desktopSessions.length})</h4>
                  <table className="admin-table-v2 mini">
                    <thead>
                      <tr>
                        <th>Device Label</th>
                        <th>Platform</th>
                        <th>Last Active</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.desktopSessions.map((s: any) => (
                        <tr key={s.id}>
                          <td><strong>{s.deviceLabel || "Workstation"}</strong></td>
                          <td>{s.os || "Desktop"} v{s.appVersion || "2.0.0"}</td>
                          <td>{when(s.lastSeen * 1000)}</td>
                          <td>
                            <span className={`admin-status-badge ${s.status === "active" ? "active" : "failed"}`}>
                              {s.status}
                            </span>
                          </td>
                          <td>
                            {s.status === "active" && (
                              <button
                                className="admin-mini-btn danger"
                                onClick={() =>
                                  void act(
                                    () => adminCall(token, "admin.desktop.revokeSession", { sessionId: s.id }),
                                    "Disconnected desktop session.",
                                  )
                                }
                              >
                                Disconnect
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!detail.desktopSessions.length && (
                        <tr><td colSpan={5} className="admin-empty-table-row mini">No desktop sessions recorded.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Payments Table */}
                <div className="admin-drawer-box">
                  <h4>Billing & Invoices ({detail.payments.length})</h4>
                  <table className="admin-table-v2 mini">
                    <thead>
                      <tr>
                        <th>Date & Plan</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payments.map((row: any) => (
                        <tr key={row.id}>
                          <td>{when(row.createdAt * 1000)} · {row.planLabel || row.plan_id}</td>
                          <td><strong>{inr(row.amount_minor)}</strong></td>
                          <td>
                            <span className={`admin-status-badge ${row.status}`}>{row.status}</span>
                          </td>
                          <td>
                            {["paid", "created"].includes(row.status) && (
                              <button
                                className="admin-mini-btn danger"
                                onClick={() =>
                                  void act(
                                    () => adminCall(token, "admin.payment.refund", { paymentId: row.id, reason: "Refunded from admin console" }),
                                    "Payment refunded and coverage revoked.",
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
                        <tr><td colSpan={4} className="admin-empty-table-row mini">No payment records found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Security Audit Log */}
                <div className="admin-drawer-box">
                  <h4>Security & Event Audit (Last 25)</h4>
                  <ul className="admin-audit-stream">
                    {detail.audit.slice(0, 25).map((row: any, i: number) => (
                      <li key={i} className="audit-stream-item">
                        <span className="audit-dot" />
                        <span className="audit-event-name">{row.event}</span>
                        <span className="audit-time">{when(row.createdAt)}</span>
                      </li>
                    ))}
                    {!detail.audit.length && (
                      <li className="admin-empty-table-row mini">No security events recorded.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
