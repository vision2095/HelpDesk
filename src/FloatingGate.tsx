import React, { useEffect } from "react";
import {
  Aperture,
  Check,
  Loader2,
  Minus,
  ShieldCheck,
  X,
} from "lucide-react";
import { GateAccess } from "./GateAccess";

// The first desktop surface. No workspace content is mounted behind this
// screen; the floating assistant only exists after the subscription gate
// reports an authenticated, entitled device session.

type Props = {
  gate: any;
  notice?: string;
  onNotice: (message: string) => void;
  onError: (error: unknown) => void;
  onSignedIn: () => void;
  onHide: () => void;
  onQuit: () => void;
};

export function FloatingGate({
  gate,
  notice,
  onNotice,
  onError,
  onSignedIn,
  onHide,
  onQuit,
}: Props) {
  const phase = gate?.phase || "checking";
  const copy: Record<
    string,
    { eyebrow: string; title: string; description: string }
  > = {
    checking: {
      eyebrow: "DESKTOP ACCESS",
      title: "Opening LensDesk.",
      description: "Checking this device and your paid access.",
    },
    signed_out: {
      eyebrow: "DESKTOP ACCESS",
      title: "Sign in to your workspace.",
      description:
        "Use the account you created on the LensDesk website. Your plan and sessions stay tied to that account.",
    },
    takeover: {
      eyebrow: "ONE DEVICE AT A TIME",
      title: "This account is already open.",
      description:
        "Confirm the move here to sign the other desktop out, or leave it where it is.",
    },
    subscription_required: {
      eyebrow: "PLAN REQUIRED",
      title: "Your access needs a top-up.",
      description:
        "Buy prepaid time on the website. This window unlocks as soon as the payment is verified.",
    },
    offline: {
      eyebrow: "CONNECTION PAUSED",
      title: "Reconnect to continue.",
      description:
        "LensDesk could not verify this device. Protected features remain paused until the service is reachable.",
    },
  };
  const current =
    copy[phase] ||
    (phase === "active" && !gate?.entitlement
      ? {
          eyebrow: "PLAN REQUIRED",
          title: "Choose your access.",
          description:
            "This account has no remaining desktop time. Add a plan on the website to continue.",
        }
      : phase === "active"
        ? {
            eyebrow: "DESKTOP ACCESS",
            title: "Welcome back.",
            description: "Your desktop access is active and ready.",
          }
        : copy.checking);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      const isInput = Boolean(
        target?.closest("input,textarea,select,[contenteditable=true]"),
      );
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "h"
      ) {
        e.preventDefault();
        onHide();
        return;
      }
      if (
        !isInput &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === "h"
      ) {
        e.preventDefault();
        onHide();
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onHide]);

  return (
    <div className="floating-gate-shell">
      <div className="floating-gate-glow" aria-hidden="true" />
      <header className="floating-gate-titlebar">
        <div className="floating-gate-brand">
          <span className="floating-gate-mark">
            <Aperture size={16} />
          </span>
          <span>LensDesk</span>
          <small>Desktop</small>
        </div>
        <div className="floating-gate-window-actions">
          <button
            type="button"
            onClick={onHide}
            title="Hide LensDesk"
            aria-label="Hide LensDesk"
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            onClick={onQuit}
            title="Quit LensDesk"
            aria-label="Quit LensDesk"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <main className="floating-gate-content">
        <div className="floating-gate-intro">
          <div className="floating-gate-eyebrow">
            <span />
            {current.eyebrow}
          </div>
          <h1>{current.title}</h1>
          <p>{current.description}</p>
        </div>

        {phase === "checking" ? (
          <div className="floating-gate-loading">
            <Loader2 size={18} className="spin" />
            <span>Checking your desktop session…</span>
          </div>
        ) : (
          <GateAccess
            variant="floating"
            onNotice={onNotice}
            onError={onError}
            onSignedIn={onSignedIn}
          />
        )}

        {notice && (
          <div className="floating-gate-notice" role="status">
            <Check size={14} />
            <span>{notice}</span>
          </div>
        )}

        <div className="floating-gate-footer">
          <span>
            <ShieldCheck size={13} />
            Encrypted session · one active device
          </span>
          <span>Local data stays on this device.</span>
        </div>
      </main>
    </div>
  );
}
