import React, { useEffect, useState } from "react";
import {
  Laptop,
  LogOut,
  ShieldCheck,
  Monitor,
  AlertCircle,
  AlertTriangle,
  KeyRound,
  RefreshCw,
  Clock,
  Globe,
  Smartphone,
} from "lucide-react";
import { cloud } from "./cloud";

function parseDeviceDetails(label?: string) {
  if (!label) return { name: "Web Browser", browser: "Web Browser", os: "Unknown Device", icon: "browser" };
  if (label === "LensDesk desktop") {
    return { name: "LensDesk Desktop App", browser: "Desktop App", os: "Desktop", icon: "desktop" };
  }
  let os = "Computer";
  let icon = "browser";
  if (/iPhone/i.test(label)) {
    os = "Apple iPhone";
    icon = "phone";
  } else if (/iPad/i.test(label)) {
    os = "Apple iPad";
    icon = "phone";
  } else if (/Android/i.test(label)) {
    os = "Android Device";
    icon = "phone";
  } else if (/Macintosh|Mac OS X/i.test(label)) {
    os = "Mac (macOS)";
    icon = "laptop";
  } else if (/Windows NT 10.0|Windows/i.test(label)) {
    os = "Windows PC";
    icon = "laptop";
  } else if (/Linux/i.test(label)) {
    os = "Linux PC";
    icon = "laptop";
  }

  let browser = "Web Browser";
  if (/Edg\//i.test(label)) browser = "Microsoft Edge";
  else if (/Chrome\//i.test(label)) browser = "Google Chrome / Brave";
  else if (/Firefox\//i.test(label)) browser = "Mozilla Firefox";
  else if (/Safari\//i.test(label) && !/Chrome\//i.test(label)) browser = "Apple Safari";

  return {
    name: `${browser} · ${os}`,
    browser,
    os,
    icon,
  };
}

function formatTime(timestamp?: number) {
  if (!timestamp) return "—";
  const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function timeAgo(timestamp?: number) {
  if (!timestamp) return "";
  const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function Security({
  onError,
  onNotice,
  onLogout,
}: {
  onError: (error: unknown) => void;
  onNotice: (text: string) => void;
  onLogout: () => void;
}) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [desktopSessions, setDesktopSessions] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [password, setPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [devices, audit] = await Promise.all([
      cloud("account.sessions"),
      cloud("account.audit"),
    ]);
    setSessions(devices.sessions || []);
    setDesktopSessions(devices.desktopSessions || []);
    setEvents(audit.events || []);
  }

  useEffect(() => {
    refresh().catch(onError);
  }, []);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  const activeDesktop = desktopSessions.filter((s) => s.status === "active");
  const totalLogins = sessions.length + activeDesktop.length;

  return (
    <div className="security-section-container" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Multi-Device Login Alert Banner */}
      {totalLogins >= 2 && (
        <div
          className="multi-login-alert"
          style={{
            padding: "14px 16px",
            borderRadius: 10,
            background: "rgba(245, 166, 35, 0.12)",
            border: "1px solid rgba(245, 166, 35, 0.4)",
            color: "var(--site-ink, #f3f5ed)",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <AlertTriangle size={20} color="#f5a623" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong style={{ fontSize: 14, color: "#f5a623" }}>
              {totalLogins} Active Logins Detected
            </strong>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--site-dark-muted, #d6ded2)", lineHeight: 1.5 }}>
              Aapka account ek sath <strong>{totalLogins} devices</strong> par logged in hai. Neeche har device ka naam aur login hone ka exact time diya gaya hai. Agar koi session aapka nahi hai, toh use turant Sign Out kar sakte hain.
            </p>
          </div>
        </div>
      )}

      {/* Dedicated Desktop Device Management Card */}
      <section className="form-card desktop-devices-card">
        <div className="form-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Laptop size={18} />
              Active Desktop App Devices ({activeDesktop.length})
            </h2>
            <p style={{ marginTop: 4 }}>
              Computers running the LensDesk native desktop overlay application.
            </p>
          </div>
          <button
            type="button"
            className="button secondary danger-text"
            disabled={busy || activeDesktop.length === 0}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    "Log out from all connected desktop devices? This will immediately disconnect every active desktop app instance.",
                  )
                )
                  return;
                const result = await cloud("account.desktop.revokeAll");
                onNotice(
                  `Successfully logged out of all desktop devices (${result.revokedCount || 0} session${result.revokedCount === 1 ? "" : "s"} ended).`,
                );
              })
            }
          >
            <LogOut size={14} />
            Log out from all desktop devices
          </button>
        </div>

        <div className="desktop-policy-banner" style={{ margin: "14px 0", padding: "10px 14px", borderRadius: 8, background: "rgba(216, 245, 107, 0.07)", border: "1px solid rgba(216, 245, 107, 0.2)", fontSize: 13, color: "var(--site-ink, #f3f5ed)" }}>
          <strong style={{ color: "var(--site-accent, #d8f56b)" }}>Device Limit Policy:</strong>{" "}
          1-Hour & 1-Day plans allow <strong>1 active desktop device</strong>. Monthly plans allow up to <strong>2 concurrent desktop devices</strong>.
        </div>

        <div className="desktop-sessions-list" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activeDesktop.map((ds) => {
            const loginFormatted = formatTime(ds.createdAt);
            const loginAgoStr = timeAgo(ds.createdAt);
            const lastActiveFormatted = formatTime(ds.lastSeen);
            const lastActiveAgoStr = timeAgo(ds.lastSeen);
            return (
              <div
                className="toggle-row desktop-device-row"
                key={ds.id}
                style={{
                  padding: "14px 16px",
                  borderRadius: 8,
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--site-dark-line, rgba(239, 245, 232, 0.12))",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 8,
                      background: "rgba(216, 245, 107, 0.12)",
                      display: "grid",
                      placeItems: "center",
                      color: "var(--site-accent, #d8f56b)",
                    }}
                  >
                    <Monitor size={18} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>{ds.deviceLabel || "LensDesk Desktop"}</strong>
                      <span
                        className="payment-badge active"
                        style={{ fontSize: 11, padding: "2px 7px" }}
                      >
                        Live Active
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--site-dark-muted, #9aa698)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: 12 }}>
                      <span>OS: {ds.os || "Desktop OS"} · v{ds.appVersion || "2.0.0"}</span>
                      <span>
                        <Clock size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                        <strong>Logged in:</strong> {loginFormatted} {loginAgoStr ? `(${loginAgoStr})` : ""}
                      </span>
                      <span>
                        <strong>Last active:</strong> {lastActiveFormatted} {lastActiveAgoStr ? `(${lastActiveAgoStr})` : ""}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="button secondary danger-text"
                  style={{ fontSize: 12, padding: "6px 12px" }}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!window.confirm(`Log out ${ds.deviceLabel || "this device"}?`)) return;
                      await cloud("account.desktop.revoke", { id: ds.id });
                      onNotice("Desktop session disconnected.");
                    })
                  }
                >
                  <LogOut size={13} />
                  Sign out
                </button>
              </div>
            );
          })}
          {activeDesktop.length === 0 && (
            <p style={{ color: "var(--site-dark-muted, #9aa698)", fontSize: 13, padding: "12px 0" }}>
              No desktop app sessions currently active. When you sign in from the LensDesk desktop app on Windows or macOS, your connected device will appear here.
            </p>
          )}
        </div>
      </section>

      {/* Browser Sessions & Password Management */}
      <section className="form-card">
        <div className="form-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={18} />
              Web Browser Logins & Devices ({sessions.length})
            </h2>
            <p style={{ marginTop: 4 }}>
              Active browsers logged into your LensDesk account.
            </p>
          </div>
        </div>

        <div style={{ margin: "14px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          {sessions.map((s) => {
            const dev = parseDeviceDetails(s.label);
            const loginFormatted = formatTime(s.createdAt);
            const loginAgoStr = timeAgo(s.createdAt);
            const lastActiveFormatted = formatTime(s.lastSeen);
            const lastActiveAgoStr = timeAgo(s.lastSeen);
            return (
              <div
                className="toggle-row session-device-row"
                key={s.id}
                style={{
                  padding: "14px 16px",
                  borderRadius: 8,
                  background: s.current ? "rgba(216, 245, 107, 0.05)" : "rgba(255, 255, 255, 0.03)",
                  border: s.current
                    ? "1px solid rgba(216, 245, 107, 0.25)"
                    : "1px solid var(--site-dark-line, rgba(239, 245, 232, 0.12))",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 8,
                      background: s.current ? "rgba(216, 245, 107, 0.15)" : "rgba(255, 255, 255, 0.06)",
                      display: "grid",
                      placeItems: "center",
                      color: s.current ? "var(--site-accent, #d8f56b)" : "var(--site-ink, #f3f5ed)",
                    }}
                  >
                    {dev.icon === "phone" ? (
                      <Smartphone size={18} />
                    ) : dev.icon === "laptop" ? (
                      <Laptop size={18} />
                    ) : (
                      <Globe size={18} />
                    )}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 14 }}>{dev.name}</strong>
                      {s.current ? (
                        <span className="payment-badge active" style={{ fontSize: 11, padding: "2px 8px" }}>
                          This Device (Current)
                        </span>
                      ) : (
                        <span
                          className="payment-badge"
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            background: "rgba(245, 166, 35, 0.15)",
                            color: "#f5a623",
                            border: "1px solid rgba(245, 166, 35, 0.3)",
                          }}
                        >
                          Another Device
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--site-dark-muted, #9aa698)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: 12 }}>
                      <span>
                        <Clock size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                        <strong>Logged in:</strong> {loginFormatted} {loginAgoStr ? `(${loginAgoStr})` : ""}
                      </span>
                      <span>
                        <strong>Last active:</strong> {lastActiveFormatted} {lastActiveAgoStr ? `(${lastActiveAgoStr})` : ""}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  className="button secondary danger-text"
                  style={{ fontSize: 12, padding: "6px 12px" }}
                  disabled={busy || s.current}
                  onClick={() =>
                    run(async () => {
                      if (!window.confirm(`Log out from ${dev.name}?`)) return;
                      const result = await cloud("account.session.revoke", {
                        id: s.id,
                      });
                      if (result.signedOut) onLogout();
                      else onNotice("Device signed out.");
                    })
                  }
                >
                  <LogOut size={13} />
                  {s.current ? "Current device" : "Sign out device"}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--site-dark-line, rgba(239, 245, 232, 0.12))" }}>
          <label>
            Current password
            <input
              aria-label="Current password for security"
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter current password"
            />
          </label>
          <button
            style={{ marginTop: 8 }}
            className="button secondary"
            disabled={busy || password.length < 8}
            onClick={() =>
              run(async () => {
                await cloud("account.sessions.revokeOthers", { password });
                setPassword("");
                onNotice("All other browser devices have been signed out.");
              })
            }
          >
            Sign out other web browsers
          </button>
        </div>

        <form
          style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--site-dark-line, rgba(239, 245, 232, 0.12))" }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await cloud("account.password", {
                password,
                newPassword: nextPassword,
              });
              setPassword("");
              setNextPassword("");
              onNotice("Password changed. Other sessions have been revoked.");
            });
          }}
        >
          <label>
            New password
            <input
              aria-label="New account password"
              type="password"
              autoComplete="new-password"
              value={nextPassword}
              minLength={8}
              maxLength={128}
              onChange={(e) => setNextPassword(e.target.value)}
              placeholder="Enter at least 8 characters"
            />
          </label>
          <p className="field-help" style={{ margin: "4px 0 12px" }}>
            Use at least 8 characters. Changing your password signs out other
            sessions and rotates this device’s session.
          </p>
          <button
            className="button secondary"
            disabled={busy || password.length < 8 || nextPassword.length < 8}
          >
            <KeyRound size={14} style={{ marginRight: 6 }} />
            Change password
          </button>
        </form>

        <details style={{ marginTop: 24, paddingTop: 12, borderTop: "1px solid var(--site-dark-line, rgba(239, 245, 232, 0.12))" }}>
          <summary style={{ cursor: "pointer", fontWeight: 550, color: "var(--site-ink, #f3f5ed)" }}>
            Recent security audit activity
          </summary>
          <div style={{ marginTop: 10 }}>
            {events.length ? (
              events.map((event, i) => (
                <p key={i} style={{ fontSize: 12, padding: "3px 0", color: "var(--site-dark-muted, #9aa698)" }}>
                  {event.event.replaceAll(".", " ")} ·{" "}
                  {new Date(event.createdAt).toLocaleString()}
                </p>
              ))
            ) : (
              <p style={{ fontSize: 12, color: "var(--site-dark-muted, #9aa698)" }}>No recent security events.</p>
            )}
          </div>
        </details>
      </section>
    </div>
  );
}
