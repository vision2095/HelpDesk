import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  RefreshCw,
  Server,
  ShieldCheck,
  WifiOff,
} from "lucide-react";

// Desktop sign-in card. Accounts are created on the website; the desktop
// application only signs in, enforces the single active device session,
// and defers purchases to the website's checkout.

const OFFICIAL_SERVER_URL = "https://helpdesk-h44x.onrender.com";

type GateView = {
  phase: string;
  reason: string;
  session: any;
  entitlement: any;
  user: any;
  purchaseUrl: string;
  takeover: any;
  serverUrl: string;
  serverTimeMs: number;
};

async function openPurchaseUrl() {
  const result = await window.lens!.invoke("gate.purchase");
  if (!result?.url) throw new Error("The purchase page address is not configured.");
  await window.lens!.invoke("desktop.openExternal", { url: result.url });
}

function relative(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function GateAccess({
  onNotice,
  onError,
  onSignedIn,
  variant = "card",
  allowServerConfig = false,
}: {
  onNotice: (message: string) => void;
  onError: (e: unknown) => void;
  onSignedIn: () => void;
  variant?: "card" | "floating";
  allowServerConfig?: boolean;
}) {
  const [view, setView] = useState<GateView>({
    phase: "signed_out",
    reason: "",
    session: null,
    entitlement: null,
    user: null,
    purchaseUrl: "https://helpdesk-h44x.onrender.com/pricing",
    takeover: null,
    serverUrl: OFFICIAL_SERVER_URL,
    serverTimeMs: Date.now(),
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [serverDraft, setServerDraft] = useState(OFFICIAL_SERVER_URL);
  const [editingServer, setEditingServer] = useState(false);
  const [serverBusy, setServerBusy] = useState(false);
  const pendingCredentials = useRef<{ email: string; password: string } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    const sanitizeGate = (v: any) => {
      if (!v) return v;
      const serverUrl =
        v.serverUrl &&
        !v.serverUrl.includes("example.com") &&
        !v.serverUrl.includes("example.org")
          ? v.serverUrl
          : OFFICIAL_SERVER_URL;
      return { ...v, serverUrl };
    };

    if (window.lens?.invoke) {
      window.lens
        .invoke("gate.state")
        .then((raw) => {
          if (!alive || !raw) return;
          const v = sanitizeGate(raw);
          setView(v);
          if (v?.serverUrl) setServerDraft(v.serverUrl);
        })
        .catch(() => {});
    }
    const off =
      window.lens?.onGate?.((raw) => {
        if (!alive || !raw) return;
        const v = sanitizeGate(raw);
        setView(v);
        if (v?.serverUrl) setServerDraft(v.serverUrl);
      }) ?? (() => {});
    return () => {
      alive = false;
      off();
    };
  }, []);

  function message(error: unknown) {
    return error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Something went wrong. Try again.";
  }

  function clearSecrets() {
    pendingCredentials.current = null;
    setPassword("");
    setFormError("");
  }

  async function reloadGate() {
    const next = await window.lens!.invoke("gate.state");
    setView(next);
    if (next?.serverUrl) setServerDraft(next.serverUrl);
    return next;
  }

  async function connectServer(e: React.FormEvent) {
    e.preventDefault();
    setServerBusy(true);
    setFormError("");
    try {
      let target = serverDraft.trim();
      if (!target || target.includes("example.com") || target.includes("example.org")) {
        target = OFFICIAL_SERVER_URL;
      }
      await window.lens!.invoke("cloud.configure", {
        url: target,
      });
      await reloadGate();
      setEditingServer(false);
      onNotice("Workspace connected. Sign in with your website account.");
    } catch (err) {
      setFormError(message(err));
      onError(err);
    } finally {
      setServerBusy(false);
    }
  }

  async function retryConnection() {
    setBusy(true);
    setFormError("");
    try {
      await window.lens!.invoke("gate.validate");
      await reloadGate();
      onNotice("Connection restored.");
    } catch (err) {
      setFormError(message(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (
        !view?.serverUrl ||
        view.serverUrl.includes("example.com") ||
        view.serverUrl.includes("example.org")
      ) {
        await window.lens!.invoke("cloud.configure", { url: OFFICIAL_SERVER_URL }).catch(() => {});
      }
      let result: any = null;
      try {
        result = await window.lens!.invoke("gate.login", {
          email,
          password,
        });
      } catch (loginErr) {
        const msg = message(loginErr);
        if (msg.includes("example.com") || msg.includes("Could not reach")) {
          // Auto-heal by ensuring connection to official cloud server and retrying
          await window.lens!.invoke("cloud.configure", { url: OFFICIAL_SERVER_URL });
          result = await window.lens!.invoke("gate.login", {
            email,
            password,
          });
        } else {
          throw loginErr;
        }
      }
      if (result?.mfaRequired) {
        setChallenge(result.challenge);
        setPassword("");
        setMfaCode("");
        onNotice("Enter the code from your authenticator app.");
        return;
      }
      if (result?.takeoverRequired) {
        // Credentials stay in an in-memory ref only until the takeover
        // decision completes; they are wiped on any other outcome.
        pendingCredentials.current = { email, password };
        setPassword("");
        onNotice(
          "This account is already signed in on a desktop device. Take over to move the session here.",
        );
        return;
      }
      if (result?.subscriptionRequired) {
        clearSecrets();
        await openPurchaseUrl();
        onNotice("Choose a prepaid plan on the LensDesk website to continue.");
        return;
      }
      clearSecrets();
      onSignedIn();
      onNotice(
        result?.entitlement
          ? "Signed in. Desktop access is active on this device."
          : "Signed in. Activate a plan on the website to use the desktop app.",
      );
    } catch (err) {
      setFormError(message(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function takeover() {
    const creds = pendingCredentials.current;
    if (!creds) return;
    setBusy(true);
    setFormError("");
    try {
      const result = await window.lens!.invoke("gate.login", {
        email: creds.email,
        password: creds.password,
        takeover: true,
      });
      if (result?.mfaRequired) {
        setChallenge(result.challenge);
        setMfaCode("");
        onNotice("Two-step verified: enter your authenticator code.");
        return;
      }
      if (result?.subscriptionRequired) {
        clearSecrets();
        await openPurchaseUrl();
        onNotice("Choose a prepaid plan on the LensDesk website to continue.");
        return;
      }
      if (result?.takeoverRequired) return; // blocked again by a newer device
      clearSecrets();
      onSignedIn();
      onNotice(
        "Signed in here. The previous device has been signed out of desktop access.",
      );
    } catch (err) {
      setFormError(message(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const result = await window.lens!.invoke("gate.mfa", {
        challenge,
        code: mfaCode,
        // Preserve the takeover decision from the login that raised MFA.
        ...(pendingCredentials.current ? { takeover: true } : {}),
      });
      if (result?.takeoverRequired) {
        onNotice(
          "This account is active on another device. Confirm the takeover to continue.",
        );
        return;
      }
      if (result?.subscriptionRequired) {
        setMfaCode("");
        setChallenge("");
        clearSecrets();
        await openPurchaseUrl();
        onNotice("Choose a prepaid plan on the LensDesk website to continue.");
        return;
      }
      setMfaCode("");
      setChallenge("");
      clearSecrets();
      onSignedIn();
      onNotice("Signed in. Desktop access is ready.");
    } catch (err) {
      setFormError(message(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setFormError("");
    try {
      await window.lens!.invoke("gate.logout");
      setChallenge("");
      setMfaCode("");
      clearSecrets();
      onNotice("Signed out of desktop access on this device.");
    } catch (err) {
      setFormError(message(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const floatingVariant = variant === "floating";
  const phase = view.phase || "signed_out";
  const entitlement = view.entitlement;
  let serverLabel = "";
  try {
    serverLabel = view.serverUrl ? new URL(view.serverUrl).host : "";
  } catch {
    serverLabel = view.serverUrl;
  }
  const showServerEditor =
    allowServerConfig && (editingServer || !view.serverUrl);

  return (
    <section
      className={
        floatingVariant ? "gate-card gate-card-floating" : "form-card gate-card"
      }
    >
      {!floatingVariant && (
        <div className="form-heading">
          <h2>
            <Monitor size={18} />
            Desktop device session
          </h2>
          {phase === "active" && (
            <span className="connection-badge connected">Active device</span>
          )}
        </div>
      )}
      {floatingVariant && <h2 className="sr-only">Desktop access</h2>}

      {formError && (
        <div className="gate-form-error" role="alert">
          <AlertTriangle size={15} />
          <span>{formError}</span>
        </div>
      )}

      {phase === "active" && (
        <>
          <div className="gate-summary">
            <div className="avatar">
              {(view.user?.name || view.user?.email || "U")[0].toUpperCase()}
            </div>
            <div>
              <h3>{view.user?.name || view.user?.email}</h3>
              <p className="muted">
                {view.user?.email} · {view.session?.deviceLabel}
              </p>
            </div>
          </div>
          {entitlement && (
            <div className="gate-access-line">
              <span>
                <strong>{entitlement.planId}</strong> access
              </span>
              <span>
                <strong>{relative(entitlement.remainingSeconds)}</strong>{" "}
                remaining
              </span>
            </div>
          )}
          <div className="gate-actions">
            <button
              className="button secondary"
              onClick={() => void openPurchaseUrl().catch(onError)}
            >
              <ExternalLink size={15} />
              Manage on website
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void signOut()}
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </>
      )}

      {phase === "takeover" && view.takeover && (
        <div className="gate-takeover">
          <AlertTriangle size={18} />
          <div>
            <strong>Signed in on another device</strong>
            <p className="muted">
              {view.takeover.deviceLabel || "A desktop device"}
              {view.takeover.os ? ` · ${view.takeover.os}` : ""} is currently
              using this account. Signing in here signs that device out.
            </p>
          </div>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void takeover()}
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <ShieldCheck size={15} />
            )}
            Use it here
          </button>
          <button
            className="text-button"
            onClick={() => {
              pendingCredentials.current = null;
              onNotice("Keep the existing device signed in. Nothing changed.");
            }}
          >
            Leave it signed in
          </button>
        </div>
      )}

      {(phase === "signed_out" ||
        (phase === "takeover" && !view.takeover)) && (
        <>
          {allowServerConfig && (
            <div className="gate-server">
              {!showServerEditor && view.serverUrl ? (
                <button
                  type="button"
                  className="gate-server-current"
                  onClick={() => setEditingServer(true)}
                  title="Change the workspace server address"
                >
                  <Server size={14} />
                  <span>{serverLabel}</span>
                  <small>Change</small>
                </button>
              ) : (
                <form className="gate-server-form" onSubmit={connectServer}>
                  <label>
                    Workspace address
                    <input
                      type="url"
                      required
                      autoComplete="url"
                      placeholder="https://helpdesk-h44x.onrender.com"
                      value={serverDraft}
                      onChange={(e) => setServerDraft(e.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={serverBusy}
                    type="submit"
                  >
                    {serverBusy ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <Server size={15} />
                    )}
                    Connect
                  </button>
                  {view.serverUrl && (
                    <p className="field-help">
                      Use the HTTPS address provided by your LensDesk administrator.
                    </p>
                  )}
                </form>
              )}
            </div>
          )}
          <form onSubmit={challenge ? verifyMfa : submit}>
            {challenge ? (
              <label>
                Authenticator or recovery code
                <input
                  autoFocus
                  autoComplete="one-time-code"
                  required
                  maxLength={40}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                />
                <span className="field-help">
                  Two-step verification is enabled for this account.
                </span>
              </label>
            ) : (
              <>
                <label>
                  Email address
                  <input
                    autoFocus
                    type="email"
                    autoComplete="username"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    minLength={8}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </>
            )}
            <button className="button primary full-width" disabled={busy}>
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <KeyRound size={15} />
              )}
              {challenge ? "Verify and sign in" : "Sign in"}
            </button>
            {challenge && (
              <button
                type="button"
                className="text-button gate-back"
                onClick={() => {
                  setChallenge("");
                  setMfaCode("");
                  setPassword("");
                  setFormError("");
                }}
              >
                Use password again
              </button>
            )}
          </form>
        </>
      )}

      {phase === "offline" && (
        <div className="gate-sub-required gate-offline">
          <WifiOff size={18} />
          <div>
            <strong>Connection paused</strong>
            <p className="muted">
              The LensDesk service can’t be reached, so protected features are
              paused until the connection returns.
            </p>
          </div>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void retryConnection()}
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            Try again
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void signOut()}
          >
            <LogOut size={15} />
            Sign out on this device
          </button>
        </div>
      )}

      {(phase === "subscription_required" ||
        (phase === "active" && !entitlement)) && (
        <div className="gate-sub-required">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {view.reason === "expired"
                ? "Your plan has expired."
                : "No active plan."}
            </strong>
            <p className="muted">
              Buy a prepaid plan on the LensDesk website — access starts as soon
              as the payment is verified.
            </p>
          </div>
          <button
            className="button primary"
            onClick={() => void openPurchaseUrl().catch(onError)}
          >
            <ExternalLink size={15} />
            Choose a plan
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void signOut()}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      )}

      {phase !== "active" && (
        <div className="gate-footnote">
          <ShieldCheck size={13} />
          <span>
            One device at a time.{" "}
            {view.serverUrl ? (
              <button
                className="text-link inline"
                onClick={() =>
                  window.lens!
                    .invoke("desktop.openExternal", {
                      url: view.serverUrl,
                    })
                    .catch(onError)
                }
              >
                Manage your account on the website
              </button>
            ) : (
              "Accounts are created on the website."
            )}
          </span>
        </div>
      )}
    </section>
  );
}
