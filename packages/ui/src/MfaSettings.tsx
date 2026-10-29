import React, { useEffect, useState } from "react";
import { cloud } from "./cloud";
export function MfaSettings({
  onError,
  onNotice,
}: {
  onError: (error: unknown) => void;
  onNotice: (text: string) => void;
}) {
  const [status, setStatus] = useState<any>(null),
    [setup, setSetup] = useState<any>(null),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [recovery, setRecovery] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    cloud("account.mfa.status").then(setStatus).catch(onError);
  }, []);
  async function run(action: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await cloud(action, { password, code });
      if (action === "account.mfa.begin") {
        setSetup(result);
        setCode("");
      } else {
        setSetup(null);
        setPassword("");
        setCode("");
        if (result.recoveryCodes) setRecovery(result.recoveryCodes);
        setStatus(await cloud("account.mfa.status"));
        onNotice(
          action === "account.mfa.confirm"
            ? "Authenticator enabled. Save your recovery codes."
            : "Authenticator disabled. Other devices were signed out.",
        );
      }
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  function downloadCodes() {
    const url = URL.createObjectURL(
      new Blob(
        [
          `LensDesk recovery codes\nKeep these private. Each code works once.\n\n${recovery.join("\n")}\n`,
        ],
        { type: "text/plain" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "lensdesk-recovery-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!status) return null;
  return (
    <section className="form-card" style={{ marginTop: 24 }}>
      <h2>Authenticator verification</h2>
      <p>
        {status.enabled
          ? `Enabled · ${status.recoveryCodesRemaining} recovery codes remaining.`
          : "Add a second sign-in step using an authenticator app."}
      </p>
      {recovery.length > 0 ? (
        <div role="status">
          <h3>Save your recovery codes now</h3>
          <p>
            They will not be shown again. Keep them somewhere separate from this
            device.
          </p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{recovery.join("\n")}</pre>
          <button className="button secondary" onClick={downloadCodes}>
            Download recovery codes
          </button>{" "}
          <button className="text-button" onClick={() => setRecovery([])}>
            I saved my codes
          </button>
        </div>
      ) : setup ? (
        <div>
          <p>
            In your authenticator app, add an account manually, select
            time-based codes, and use this secret:
          </p>
          <code style={{ overflowWrap: "anywhere" }}>{setup.secret}</code>
          <p>
            Issuer: LensDesk · 6 digits · 30 seconds. Setup expires in 10
            minutes.
          </p>
          <label>
            Authenticator code
            <input
              aria-label="Authenticator setup code"
              autoComplete="one-time-code"
              inputMode="numeric"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || code.length !== 6}
            onClick={() => run("account.mfa.confirm")}
          >
            Enable authenticator
          </button>{" "}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setSetup(null);
              setCode("");
              setPassword("");
            }}
          >
            Cancel setup
          </button>
        </div>
      ) : (
        <div>
          <label>
            Password to manage authenticator
            <input
              aria-label="Password for authenticator settings"
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {status.enabled && (
            <label>
              Authenticator or recovery code
              <input
                aria-label="Code to disable authenticator"
                autoComplete="one-time-code"
                value={code}
                maxLength={40}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          <button
            className="button secondary"
            disabled={
              busy ||
              password.length < 12 ||
              (status.enabled && code.length < 6)
            }
            onClick={() =>
              run(status.enabled ? "account.mfa.disable" : "account.mfa.begin")
            }
          >
            {busy
              ? "Checking…"
              : status.enabled
                ? "Disable authenticator"
                : "Set up authenticator"}
          </button>
        </div>
      )}
    </section>
  );
}
