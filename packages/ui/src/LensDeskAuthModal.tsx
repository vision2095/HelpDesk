import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cloud } from "./cloud";

export interface LensDeskAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void | Promise<void>;
}

export function LensDeskAuthModal({
  isOpen,
  onClose,
  onSuccess,
}: LensDeskAuthModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setPassword("");
    setChallenge("");
    setCode("");
    setConfigured(null);
    let live = true;
    void cloud("cloud.state")
      .then((info) => {
        if (live) {
          setConfigured(!info.configurationError);
          if (info.configurationError) setError(info.configurationError);
        }
      })
      .catch((err) => {
        if (live) {
          setConfigured(false);
          setError(
            err instanceof Error
              ? err.message
              : "The hosted service is unavailable. Configure its address on the account page.",
          );
        }
      });
    return () => {
      live = false;
    };
  }, [isOpen]);
  if (!isOpen) return null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await cloud(
        challenge ? "auth.mfa" : "auth.login",
        challenge
          ? { challenge, code: code.trim() }
          : { email: email.trim(), password },
      );
      setPassword("");
      if (result.mfaRequired) {
        setChallenge(result.challenge);
        setCode("");
        return;
      }
      const account = await cloud("cloud.state");
      if (!account.user)
        throw new Error(
          "The server did not establish a signed-in session. Retry sign-in.",
        );
      setChallenge("");
      setCode("");
      window.dispatchEvent(new CustomEvent("lensdesk:account-changed"));
      await onSuccess?.();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Sign-in failed. Retry your credentials.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lensdesk-modal-overlay hintlens-modal-overlay">
      <section
        className="lensdesk-auth-window hintlens-auth-window"
        role="dialog"
        aria-modal="true"
        aria-label="Sign in to LensDesk"
      >
        <button
          type="button"
          className="auth-close-btn"
          aria-label="Close sign in"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <div className="auth-header">
          <h2 className="logo-text">LensDesk</h2>
          <p className="auth-subtitle">
            {challenge ? "Verify your sign-in" : "Sign in to continue"}
          </p>
        </div>
        {error && (
          <div role="alert" className="auth-error-banner">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="auth-form">
          {challenge ? (
            <label className="auth-form-group">
              <span className="auth-label">Authenticator or recovery code</span>
              <input
                className="auth-input"
                aria-label="Authenticator or recovery code"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={busy}
                required
                minLength={6}
                maxLength={40}
                autoFocus
              />
            </label>
          ) : (
            <>
              <label className="auth-form-group">
                <span className="auth-label">Email</span>
                <input
                  aria-label="Sign in email"
                  type="email"
                  autoComplete="username"
                  className="auth-input"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                  required
                  maxLength={254}
                  autoFocus
                />
              </label>
              <label className="auth-form-group">
                <span className="auth-label">Password</span>
                <input
                  aria-label="Sign in password"
                  type="password"
                  autoComplete="current-password"
                  className="auth-input"
                  placeholder="Your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                  required
                  maxLength={128}
                />
              </label>
            </>
          )}
          <button
            type="submit"
            className="auth-primary-btn"
            disabled={busy || configured === false || configured === null}
          >
            {busy ? "Signing in…" : challenge ? "Verify" : "Log in"}
          </button>
          {challenge && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setChallenge("");
                setCode("");
                setError("");
              }}
            >
              Use email and password again
            </button>
          )}
        </form>
        <div className="auth-divider">
          <span>or</span>
        </div>
        <button type="button" className="auth-google-btn" disabled>
          Continue with Google — not configured
        </button>
        <p className="auth-footer-text">
          Google OAuth is unavailable in this service. Open the account page to
          configure a hosted service, register with email, or reset a password.
        </p>
      </section>
    </div>
  );
}
