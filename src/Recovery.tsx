import React, { useEffect, useState } from "react";
import { api } from "./api";
import type { Session } from "./types";
export function Recovery({
  sessions,
  onRestore,
  onError,
}: {
  sessions: Session[];
  onRestore: () => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const [snapshots, setSnapshots] = useState<
      { id: string; createdAt: string }[]
    >([]),
    [selected, setSelected] = useState(""),
    [versions, setVersions] = useState<
      { version: number; updatedAt: string }[]
    >([]),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{
      action: string;
      payload: unknown;
      label: string;
    } | null>(null);
  async function load() {
    setSnapshots(await api("recovery.snapshots"));
  }
  useEffect(() => {
    load().catch(onError);
  }, []);
  useEffect(() => {
    setVersions([]);
    if (selected)
      api("history.list", { kind: "session", id: selected })
        .then(setVersions)
        .catch(onError);
  }, [selected]);
  async function restore() {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      await api(confirm.action, confirm.payload);
      await onRestore();
      await load();
      setSelected("");
      setConfirm(null);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-card" style={{ marginTop: 24 }}>
      <h2>Recovery & version history</h2>
      <p>
        Each item keeps its last 30 revisions. Workspace restores keep up to 10
        recovery snapshots. These copies count toward workspace storage and may
        contain previously deleted text.
      </p>
      <label>
        Session history
        <select
          aria-label="Recovery session"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a session</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      {selected && !versions.length && (
        <p>No earlier versions for this session.</p>
      )}
      {versions.map((v) => (
        <div className="toggle-row" key={v.version}>
          <span>
            Revision {v.version} · {new Date(v.updatedAt).toLocaleString()}
          </span>
          <button
            disabled={busy}
            className="text-button"
            onClick={() =>
              setConfirm({
                action: "history.restore",
                payload: { kind: "session", id: selected, version: v.version },
                label: `Restore revision ${v.version} of this session?`,
              })
            }
          >
            Restore revision {v.version}
          </button>
        </div>
      ))}
      <h3>Before previous workspace restores</h3>
      {!snapshots.length && <p>No workspace recovery snapshots yet.</p>}
      {snapshots.map((s) => (
        <div className="toggle-row" key={s.id}>
          <span>{new Date(s.createdAt).toLocaleString()}</span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              setConfirm({
                action: "recovery.restore",
                payload: { id: s.id },
                label:
                  "Replace this workspace with the selected recovery snapshot? A snapshot of the current workspace will be kept.",
              })
            }
          >
            Restore snapshot
          </button>
        </div>
      ))}
      {confirm && (
        <div role="alert">
          <p>{confirm.label}</p>
          <button className="button primary" disabled={busy} onClick={restore}>
            {busy ? "Restoring…" : "Confirm restore"}
          </button>{" "}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
