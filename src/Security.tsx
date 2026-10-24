import React, { useEffect, useState } from "react";
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
  const [sessions, setSessions] = useState<any[]>([]),
    [events, setEvents] = useState<any[]>([]),
    [password, setPassword] = useState(""),
    [nextPassword, setNextPassword] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const [devices, audit] = await Promise.all([
      cloud("account.sessions"),
      cloud("account.audit"),
    ]);
    setSessions(devices.sessions);
    setEvents(audit.events);
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
    <section className="form-card" style={{ marginTop: 24 }}>
      <h2>Security & signed-in devices</h2>
      <p>
        Review account sessions and revoke access to a lost or shared device.
      </p>
      {sessions.map((s) => (
        <div className="toggle-row" key={s.id}>
          <div>
            <strong>
              {s.current
                ? "This device"
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
            {s.current ? "Current session" : "Revoke device"}
          </button>
        </div>
      ))}
      <label>
        Current password
        <input
          aria-label="Current password for security"
          type="password"
          autoComplete="current-password"
          value={password}
          maxLength={128}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button
        className="button secondary"
        disabled={busy || password.length < 12}
        onClick={() =>
          run(async () => {
            await cloud("account.sessions.revokeOthers", { password });
            setPassword("");
            onNotice("All other devices have been signed out.");
          })
        }
      >
        Sign out other devices
      </button>
      <form
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
          />
        </label>
        <p className="field-help">
          Use at least 8 characters. Changing your password signs out other
          sessions and rotates this device’s session.
        </p>
        <button
          className="button secondary"
          disabled={busy || password.length < 8 || nextPassword.length < 8}
        >
          Change password
        </button>
      </form>
      <details style={{ marginTop: 20 }}>
        <summary>Recent security activity</summary>
        {events.length ? (
          events.map((event, i) => (
            <p key={i}>
              {event.event.replaceAll(".", " ")} ·{" "}
              {new Date(event.createdAt).toLocaleString()}
            </p>
          ))
        ) : (
          <p>No recent security events.</p>
        )}
      </details>
    </section>
  );
}
