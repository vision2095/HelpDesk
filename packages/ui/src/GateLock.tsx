import React, { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from "lucide-react";

// Full-page lock shown whenever the desktop subscription gate denies
// access. Account, downloads, and settings pages stay reachable so the
// user can always sign out, sign in, or reach the website.

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${pad(minutes)}m ${pad(seconds)}s`;
}

async function openPurchase() {
  const result = await window.lens!.invoke("gate.purchase");
  if (!result?.url)
    throw new Error("The purchase page address is not configured.");
  await window.lens!.invoke("desktop.openExternal", { url: result.url });
}

export function GateLock({
  gate,
  navigate,
}: {
  gate: any;
  navigate: (page: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  // The gate snapshot carries server time at the last authoritative
  // check. Anchor it locally when a fresh snapshot arrives so the
  // displayed remaining time keeps ticking between heartbeats.
  const anchor = useRef({ serverTimeMs: 0, at: 0 });

  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  if (
    gate?.serverTimeMs &&
    gate.serverTimeMs !== anchor.current.serverTimeMs
  ) {
    anchor.current = { serverTimeMs: gate.serverTimeMs, at: Date.now() };
  }

  async function tryReconnect() {
    if (busy) return;
    setBusy(true);
    try {
      await window.lens!.invoke("gate.validate");
    } catch {
      // The gate snapshot itself carries the resulting phase.
    } finally {
      setBusy(false);
    }
  }

  const phase = gate?.phase || "signed_out";
  const reason = gate?.reason || "";
  const entitlement = gate?.entitlement;
  const elapsed =
    gate?.serverTimeMs && anchor.current.at
      ? Math.max(0, Date.now() - anchor.current.at)
      : 0;
  const remaining = entitlement
    ? entitlement.expirationTimestamp - (gate.serverTimeMs + elapsed)
    : 0;

  return (
    <div className="gate-lock" role="alert">
      <div className="gate-lock-box">
        <div className="gate-lock-icon">
          {phase === "offline" ? (
            <WifiOff size={26} />
          ) : phase === "takeover" ? (
            <ShieldAlert size={26} />
          ) : (
            <Lock size={26} />
          )}
        </div>
        <h2>
          {phase === "signed_out"
            ? "Sign in to continue"
            : phase === "subscription_required"
              ? "Your desktop access is paused"
              : phase === "takeover"
                ? "Active on another device"
                : "Connection paused"}
        </h2>
        <p className="gate-lock-text">
          {phase === "signed_out" &&
            "Use your LensDesk account to sign in. Accounts are created on the website."}
          {phase === "subscription_required" &&
            (reason === "expired"
              ? "The prepaid plan time has run out. Buy time again on the LensDesk website to pick up where you left off."
              : "Buy a prepaid plan on the LensDesk website — access starts as soon as payment is verified.")}
          {phase === "takeover" &&
            `${gate?.takeover?.deviceLabel || "Another device"} is currently signed in with this account. Open the account page to move the session here.`}
          {phase === "offline" &&
            "The LensDesk service can't be reached right now. The verified window has lapsed, so protected actions are paused until the connection returns."}
        </p>
        {entitlement && remaining > 0 && phase === "subscription_required" && (
          <div className="gate-lock-meta">
            {formatRemaining(remaining)} of plan time was left at the last
            verified check.
          </div>
        )}
        <div className="gate-lock-actions">
          {phase === "signed_out" && (
            <button className="button primary" onClick={() => void navigate("account")}>
              Sign in
            </button>
          )}
          {phase === "subscription_required" && (
            <>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void openPurchase().catch(() => {})}
              >
                <ExternalLink size={15} />
                Renew on the website
              </button>
              <button className="button secondary" onClick={() => void navigate("account")}>
                Account page
              </button>
            </>
          )}
          {phase === "takeover" && (
            <button className="button primary" onClick={() => void navigate("account")}>
              Resolve on account page
            </button>
          )}
          {phase === "offline" && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void tryReconnect()}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
              Try again
            </button>
          )}
        </div>
        <p className="gate-lock-note">
          Account, downloads, and settings stay available.
        </p>
      </div>
    </div>
  );
}
