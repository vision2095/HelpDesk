import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  Cloud,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";
import { MfaSettings } from "./MfaSettings";
import { Security } from "./Security";
import { Access } from "./Access";
import { GateAccess } from "./GateAccess";
import { api } from "./api";
import { cloud } from "./cloud";
export function Account({
  onError,
  onNotice,
  onRestore,
  onLogout,
}: {
  onError: (e: unknown) => void;
  onNotice: (s: string) => void;
  onRestore: (state: any) => void;
  onLogout: () => void;
}) {
  const [info, setInfo] = useState<any>(null),
    [url, setUrl] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [mfaChallenge, setMfaChallenge] = useState(""),
    [mfaCode, setMfaCode] = useState(""),
    [name, setName] = useState(""),
    [mode, setMode] = useState<
      "login" | "register" | "reset" | "resetComplete"
    >(
      new URLSearchParams(location.search).has("reset")
        ? "resetComplete"
        : "login",
    ),
    [busy, setBusy] = useState(false),
    [price, setPrice] = useState<any>(null),
    [deletePassword, setDeletePassword] = useState(""),
    [showDelete, setShowDelete] = useState(false);
  const workInProgress = useRef(false);
  const desktop = Boolean(window.lens);
  async function refresh() {
    const value = await cloud("cloud.state");
    setInfo(value);
    if (value.configurationError) onError(new Error(value.configurationError));
    if (value.serverUrl) setUrl(value.serverUrl);
    if (value.user) {
      const p = await cloud("billing.price").catch(() => ({
        configured: false,
        unavailable: true,
      }));
      setPrice(p);
    }
    return value;
  }
  async function run(fn: () => Promise<void>) {
    if (workInProgress.current) return;
    workInProgress.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      workInProgress.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    run(async () => {
      await refresh();
      const token = new URLSearchParams(location.search).get("verify");
      if (token) {
        await cloud("auth.verify", { token });
        history.replaceState(null, "", location.pathname);
        await refresh();
        onNotice("Email verified. You can now use hosted AI.");
      }
    });
  }, []);
  async function authenticate(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      if (mode === "reset") {
        const r = await cloud("auth.reset.request", { email });
        onNotice(r.message);
        return;
      }
      if (mode === "resetComplete") {
        await cloud("auth.reset", {
          token: new URLSearchParams(location.search).get("reset"),
          password,
        });
        history.replaceState(null, "", location.pathname);
        setMode("login");
        setPassword("");
        onNotice("Password reset. Sign in with your new password.");
        return;
      }
      const result = await cloud(
        mfaChallenge
          ? "auth.mfa"
          : mode === "register"
            ? "auth.register"
            : "auth.login",
        mfaChallenge
          ? { challenge: mfaChallenge, code: mfaCode }
          : { email, password, name },
      );
      if (result.mfaRequired) {
        setMfaChallenge(result.challenge);
        setPassword("");
        return;
      }
      setMfaChallenge("");
      setMfaCode("");
      setPassword("");
      await refresh();
      try {
        onRestore(await api("state"));
      } catch {}
      onNotice(
        mode === "register"
          ? "Account created. Check your email to verify it."
          : "Signed in.",
      );
    });
  }
  async function openBilling(action: string) {
    const result = await cloud(action);
    if (!/^https:\/\/(checkout|billing)\.stripe\.com\//.test(result.url))
      throw new Error("The billing service returned an unsupported URL.");
    if (desktop) await api("desktop.openExternal", { url: result.url });
    else location.assign(result.url);
  }
  const formattedPrice =
    price?.configured && price.amount != null
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: price.currency.toUpperCase(),
        }).format(price.amount / 100) + ` / ${price.interval}`
      : "Price set by the service operator";
  return (
    <div className="content-page account-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONE WORKSPACE. WHEREVER YOU THINK.</div>
          <h1>A place for everything.</h1>
          <p>Your account, subscription, and cloud workspace.</p>
        </div>
        <Cloud size={40} strokeWidth={1} />
      </div>
      {desktop && (
        <section className="form-card server-connection">
          <div>
            <h2>Connect your hosted service</h2>
            <p>Enter the address where your LensDesk backend is deployed.</p>
          </div>
          <label>
            Server URL
            <input
              aria-label="Cloud server URL"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-lensdesk-domain.com"
            />
          </label>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const next = await api("cloud.configure", { url });
                setInfo(next);
                await cloud("cloud.public");
                await refresh();
                onNotice("Server connected. Sign in to continue.");
              })
            }
          >
            Connect server
          </button>
        </section>
      )}
      {!info?.user ? (
        desktop ? (
          // The desktop application signs in only; accounts are created on
          // the website and the single-device session is managed by the
          // subscription gate.
          <GateAccess
            onNotice={onNotice}
            onError={onError}
            onSignedIn={async () => {
              await refresh();
              try {
                onRestore(await api("state"));
              } catch {}
              window.dispatchEvent(new Event("lensdesk:account-changed"));
            }}
          />
        ) : (
        <div className="auth-layout">
          <section className="form-card auth-card">
            <div className="form-heading">
              <h2>
                <UserRound size={18} />
                {mode === "register"
                  ? "Create an account"
                  : mode === "reset" || mode === "resetComplete"
                    ? "Reset your password"
                    : "Welcome back"}
              </h2>
            </div>
            <form onSubmit={authenticate}>
              {mode === "register" && (
                <label>
                  Your name
                  <input
                    autoComplete="name"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              {mode !== "resetComplete" && (
                <label>
                  Email address
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              {mode !== "reset" && !mfaChallenge && (
                <label>
                  Password
                  <input
                    aria-label="Password"
                    type="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    required
                    minLength={8}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <span className="field-help password-help">
                    Use at least 12 characters.
                  </span>
                </label>
              )}
              {mfaChallenge && (
                <label>
                  Authenticator or recovery code
                  <input
                    aria-label="Sign-in verification code"
                    autoComplete="one-time-code"
                    required
                    value={mfaCode}
                    maxLength={40}
                    onChange={(e) => setMfaCode(e.target.value)}
                  />
                  <span className="field-help">
                    Enter the current code from your authenticator, or an unused
                    recovery code.
                  </span>
                </label>
              )}
              {mfaChallenge && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setMfaChallenge("");
                    setMfaCode("");
                    setPassword("");
                  }}
                >
                  Use password again
                </button>
              )}
              <button className="button primary full-width" disabled={busy}>
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <KeyRound size={15} />
                )}{" "}
                {mfaChallenge
                  ? "Verify and sign in"
                  : mode === "register"
                    ? "Create account"
                    : mode === "reset"
                      ? "Email reset link"
                      : mode === "resetComplete"
                        ? "Set new password"
                        : "Sign in"}
              </button>
            </form>
            <div className="auth-links">
              <button
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setMode(mode === "register" ? "login" : "register");
                  setPassword("");
                  setMfaChallenge("");
                  setMfaCode("");
                }}
              >
                {mode === "register"
                  ? "Already have an account? Sign in"
                  : "New here? Create an account"}
              </button>
              <button
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setMode("reset");
                  setPassword("");
                  setMfaChallenge("");
                  setMfaCode("");
                }}
              >
                Forgot password?
              </button>
            </div>
          </section>
          <section className="account-intro">
            <span className="welcome-mark">
              <Cloud size={30} />
            </span>
            <h2>
              Your next thought.
              <br />
              On your next device.
            </h2>
            <p>
              Keep your sessions and profiles together. Use your own AI keys, or
              access the models funded by your subscription.
            </p>
            <div>
              <ShieldCheck size={16} />
              <span>API keys encrypted at rest</span>
            </div>
            <div>
              <RefreshCw size={16} />
              <span>Cloud workspace and desktop sync</span>
            </div>
            <div>
              <Mail size={16} />
              <span>Email verification and account recovery</span>
            </div>
          </section>
        </div>
        )
      ) : (
        <>
          <div className="account-summary form-card">
            <div className="avatar">{info.user.name[0].toUpperCase()}</div>
            <div>
              <h2>{info.user.name}</h2>
              <p>{info.user.email}</p>
            </div>
            <span className="connection-badge connected">
              {info.plan === "pro" ? "Pro plan" : "Free plan"}
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await cloud("auth.logout");
                  setInfo(await cloud("cloud.state"));
                  onLogout();
                  onNotice(
                    result.serverRevoked === false
                      ? "Signed out on this device. Server session revocation could not be confirmed."
                      : "Signed out.",
                  );
                })
              }
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
          {!info.user.verified && (
            <div className="verification-banner">
              <Mail size={20} />
              <div>
                <strong>Verify your email to use hosted AI.</strong>
                <p>Open the link in your inbox to activate provider access.</p>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await cloud("auth.resend");
                    onNotice("Verification email sent.");
                  })
                }
              >
                Resend email
              </button>
              <button
                className="icon-button"
                title="Refresh account"
                aria-label="Refresh account"
                onClick={() =>
                  run(async () => {
                    await refresh();
                  })
                }
              >
                <RefreshCw size={17} />
              </button>
            </div>
          )}
          <Access
            onNotice={onNotice}
            onError={onError}
            email={info.user.email}
            desktop={desktop}
            purchaseUrl={info.purchaseUrl}
            onChanged={async () => {
              try {
                onRestore(await api("state"));
              } catch {}
              await refresh();
            }}
          />
          <div className="settings-grid">
            <section className="form-card">
              <div className="form-heading">
                <h2>
                  <Cloud size={18} />
                  Cloud workspace
                </h2>
                <span className="local-tag">
                  {desktop ? "Sync on demand" : "Saved to your account"}
                </span>
              </div>
              <p>
                {desktop
                  ? "Upload this device’s sessions and profiles, or restore the workspace saved to your account. Each sync replaces the destination workspace."
                  : "Your sessions, profiles, and preferences are saved directly to your account. Sign in from another browser or connect the desktop app to access them."}
              </p>
              <div className="sync-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (
                        !window.confirm(
                          "Replace the cloud workspace with this device’s current sessions, profiles, and settings? API keys are not transferred.",
                        )
                      )
                        return;
                      await cloud("cloud.push", await api("backup"));
                      onNotice("Cloud workspace updated.");
                    })
                  }
                >
                  <Upload size={16} />
                  {desktop ? "Upload this device" : "Save cloud snapshot"}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (
                        !window.confirm(
                          "Replace this workspace with the saved cloud workspace? A local backup will be kept.",
                        )
                      )
                        return;
                      const restored = await api(
                        "backup.restore",
                        await cloud("cloud.pull"),
                      );
                      onRestore(restored);
                      if (desktop) await api("desktop.appearance");
                      onNotice("Cloud workspace restored.");
                    })
                  }
                >
                  <Download size={16} />
                  {desktop ? "Restore from cloud" : "Reload cloud workspace"}
                </button>
              </div>
              <p className="field-help">
                Backups include your conversation text and attached screenshots.
                They do not transfer API keys between devices.
              </p>
            </section>
            <section className="form-card">
              <div className="form-heading">
                <h2>More room to think</h2>
                <span className="ai-badge">PRO</span>
              </div>
              <div className="plan-price">{formattedPrice}</div>
              <p>
                {info.limits.requests} hosted AI requests and{" "}
                {Math.floor(info.limits.audioSeconds / 60)} minutes of
                transcription per day on your current plan.
              </p>
              {info.plan !== "pro" && (
                <p className="pro-benefits">
                  Pro includes {info.planOptions.pro.requests} hosted requests
                  and {Math.floor(info.planOptions.pro.audioSeconds / 60)}{" "}
                  minutes of transcription per day.
                </p>
              )}
              <p className="field-help">
                {(info.usage.tokens || 0).toLocaleString()} /{" "}
                {(info.limits.tokens || 0).toLocaleString()} tokens used or
                reserved today. Canceled answers may still incur provider usage.
              </p>
              <div className="usage-meter">
                <span>
                  {info.usage.requests} / {info.limits.requests} requests today
                </span>
                <progress
                  value={Math.min(info.usage.requests, info.limits.requests)}
                  max={info.limits.requests}
                />
              </div>
              <p className="field-help">
                Your own provider keys bypass the hosted usage allowance. Usage
                is still recorded. Transcription time is estimated from
                recording size.
              </p>
              <div className="sync-actions">
                <button
                  className="button primary"
                  disabled={busy || !info.billingConfigured}
                  onClick={() =>
                    run(() =>
                      openBilling(
                        info.plan === "pro"
                          ? "billing.portal"
                          : "billing.checkout",
                      ),
                    )
                  }
                >
                  {info.plan === "pro"
                    ? "Manage subscription"
                    : "Upgrade with Stripe"}
                  <ExternalLink size={14} />
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    run(async () => {
                      await refresh();
                      onNotice("Subscription refreshed.");
                    })
                  }
                >
                  <RefreshCw size={14} />
                  Refresh status
                </button>
              </div>
              {!info.billingConfigured && (
                <p className="field-help billing-note">
                  The service operator needs to connect Stripe before payments
                  can open.
                </p>
              )}
            </section>
          </div>
          <MfaSettings onError={onError} onNotice={onNotice} />
          <Security onError={onError} onNotice={onNotice} onLogout={onLogout} />
          <section className="form-card account-danger">
            <div>
              <h2>Delete your cloud account</h2>
              <p>
                This removes your cloud sessions, stored keys, and account, and
                cancels an active subscription. Local device data remains.
              </p>
            </div>
            {!showDelete ? (
              <button
                className="text-button danger-text"
                onClick={() => setShowDelete(true)}
              >
                Delete account
              </button>
            ) : (
              <>
                <label>
                  Confirm your password
                  <input
                    aria-label="Password to delete account"
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                  />
                </label>
                <button
                  className="button danger"
                  disabled={busy || deletePassword.length < 12}
                  onClick={() =>
                    run(async () => {
                      if (
                        !window.confirm(
                          "Permanently delete this cloud account and its data?",
                        )
                      )
                        return;
                      await cloud("account.delete", {
                        password: deletePassword,
                      });
                      setInfo(await cloud("cloud.state"));
                      setDeletePassword("");
                      onLogout();
                      onNotice("Cloud account deleted.");
                    })
                  }
                >
                  Permanently delete account
                </button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
