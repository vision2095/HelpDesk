import React, { useEffect, useState } from "react";
import {
  Laptop,
  LogOut,
  ShieldCheck,
  Monitor,
  AlertCircle,
  KeyRound,
  RefreshCw,
  Clock,
} from "lucide-react";
import { cloud } from "./cloud";

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

  return (
    <div className="security-section-container" style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Dedicated Desktop Device Management Card */}
      <section className="form-card desktop-devices-card">
        <div className="form-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Laptop size={18} />
              Active Desktop Devices
            </h2>
            <p style={{ marginTop: 4 }}>
              Active computers running the LensDesk desktop overlay.
            </p>
          </div>
          <button
            type="button"
            className="button secondary danger-text"
            disabled={busy || desktopSessions.filter((s) => s.status === "active").length === 0}
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
            Log out from all devices
          </button>
        </div>

        <div className="desktop-policy-banner" style={{ margin: "14px 0", padding: "10px 14px", borderRadius: 8, background: "rgba(216, 245, 107, 0.07)", border: "1px solid rgba(216, 245, 107, 0.2)", fontSize: 13, color: "var(--site-ink, #f3f5ed)" }}>
          <strong style={{ color: "var(--site-accent, #d8f56b)" }}>Device Limit Policy:</strong>{" "}
          1-Hour & 1-Day plans allow <strong>1 active desktop device</strong>. Monthly plans allow up to <strong>2 concurrent desktop devices</strong>.
        </div>

        <div className="desktop-sessions-list" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {desktopSessions
            .filter((ds) => ds.status === "active")
            .map((ds) => (
              <div
                className="toggle-row desktop-device-row"
                key={ds.id}
                style={{
                  padding: "12px 14px",
                  borderRadius: 8,
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--site-dark-line, rgba(239, 245, 232, 0.12))",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
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
                      <strong>{ds.deviceLabel || "LensDesk Desktop"}</strong>
                      <span
                        className="payment-badge active"
                        style={{ fontSize: 11, padding: "2px 7px" }}
                      >
                        Live Active
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--site-dark-muted, #9aa698)", margin: "2px 0 0" }}>
                      OS: {ds.os || "Desktop OS"} · Version: {ds.appVersion || "2.0.0"} · Last active: {new Date(ds.lastSeen * 1000).toLocaleString()}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="button secondary danger-text"
                  style={{ fontSize: 12, padding: "5px 10px" }}
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
            ))}
          {desktopSessions.filter((ds) => ds.status === "active").length === 0 && (
            <p style={{ color: "var(--site-dark-muted, #9aa698)", fontSize: 13, padding: "12px 0" }}>
              No desktop app sessions currently active. When you sign in from the LensDesk desktop app on Windows or macOS, your connected device will appear here.
            </p>
          )}
        </div>
      </section>

      {/* Browser Sessions & Password Management */}
      <section className="form-card">
        <h2>
          <ShieldCheck size={18} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Web Browser Sessions
        </h2>
        <p>
          Review active web sessions and revoke access to unauthorized browsers.
        </p>
        <div style={{ margin: "14px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions.map((s) => (
            <div className="toggle-row" key={s.id}>
              <div>
                <strong>
                  {s.current
                    ? "This browser (Current session)"
                    : s.label === "LensDesk desktop"
                      ? "LensDesk desktop"
                      : "Web browser"}
                </strong>
                <p>
                  Last active {new Date(s.lastSeen * 1000).toLocaleString()} ·
                  expires {new Date(s.expires * 1000).toLocaleDateString()}
                </p>
              </div>
              <button
                className="text-button"
                disabled={busy || s.current}
                onClick={() =>
                  run(async () => {
                    const result = await cloud("account.session.revoke", {
                      id: s.id,
                    });
                    if (result.signedOut) onLogout();
                    else onNotice("Device signed out.");
                  })
                }
              >
                {s.current ? "Current session" : "Revoke session"}
              </button>
            </div>
          ))}
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
