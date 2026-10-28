import React, { useEffect, useState } from "react";
import {
  Download,
  Terminal,
  Copy,
  Check,
  ShieldCheck,
  Laptop,
  Sparkles,
} from "lucide-react";
import { PageNav } from "./PageNav";
import { cloud } from "./cloud";

interface HintLensDownloadsSectionProps {
  isDesktop?: boolean;
  onNavigate: (page: string) => void;
  user?: any;
}

export function HintLensDownloadsSection({
  isDesktop = false,
  onNavigate,
  user,
}: HintLensDownloadsSectionProps) {
  const [currentUser, setCurrentUser] = useState<any>(user || null);
  const [copiedPs, setCopiedPs] = useState(false);
  const [copiedSh, setCopiedSh] = useState(false);
  const [copiedGk, setCopiedGk] = useState(false);

  useEffect(() => {
    if (user !== undefined) {
      setCurrentUser(user);
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    const fetchUser = () => {
      cloud("cloud.state")
        .then((state) => {
          if (active) {
            setCurrentUser(state?.user || null);
          }
        })
        .catch(() => {});
    };

    if (user === undefined) {
      fetchUser();
    }

    window.addEventListener("lensdesk:account-changed", fetchUser);
    return () => {
      active = false;
      window.removeEventListener("lensdesk:account-changed", fetchUser);
    };
  }, [user]);

  const handleDownloadClick = (e: React.MouseEvent) => {
    if (!currentUser) {
      e.preventDefault();
      onNavigate("account");
    }
  };

  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "http://localhost:4319";

  const psCommand = `powershell -Command "irm ${origin}/hintlens-install.ps1 | iex"`;
  const shCommand = `curl -fsSL ${origin}/install.sh | bash`;
  const gkCommand = `xattr -cr /Applications/LensDesk.app`;

  const copyText = (text: string, type: "ps" | "sh" | "gk") => {
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    }
    if (type === "ps") {
      setCopiedPs(true);
      setTimeout(() => setCopiedPs(false), 2000);
    } else if (type === "sh") {
      setCopiedSh(true);
      setTimeout(() => setCopiedSh(false), 2000);
    } else {
      setCopiedGk(true);
      setTimeout(() => setCopiedGk(false), 2000);
    }
  };

  return (
    <div className="hl-downloads-page">
      <PageNav current="downloads" onNavigate={onNavigate} isDesktop={isDesktop} />

      <div className="page-heading">
        <div>
          <div className="site-kicker">
            <span />
            OFFICIAL DESKTOP CLIENTS
          </div>
          <h1>One window. Wherever you work<span>.</span></h1>
          <p>
            Get the official LensDesk desktop application for macOS and Windows, featuring hardware-accelerated stealth overlay and instant activation.
          </p>
        </div>
      </div>

      {!currentUser && (
        <div
          className="hl-auth-required-banner"
          style={{
            padding: "1rem 1.25rem",
            marginBottom: "1.75rem",
            background: "rgba(216, 245, 107, 0.08)",
            border: "1px solid rgba(216, 245, 107, 0.25)",
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <ShieldCheck size={22} style={{ color: "var(--site-accent, #d8f56b)", flexShrink: 0 }} />
            <div>
              <strong style={{ color: "var(--site-paper, #f0f4e9)", fontSize: "0.95rem" }}>
                Account Required to Download
              </strong>
              <p style={{ margin: "3px 0 0", color: "var(--site-dark-muted, #a5b09f)", fontSize: "0.85rem" }}>
                Please create an account or sign in before downloading the desktop application.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="hl-btn-download-primary"
            style={{ padding: "0.55rem 1.2rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
            onClick={() => onNavigate("account")}
          >
            Create Account / Sign In
          </button>
        </div>
      )}

      {/* 1. Manual Download (Windows) */}
      <div className="hl-download-card">
        <div className="hl-card-header">
          <div className="hl-card-icon-box">
            <Download size={22} />
          </div>
          <div className="hl-card-title-group">
            <h3>Manual Download (Windows)</h3>
            <p>Native stealth overlay (64-bit EXE / ZIP archive).</p>
          </div>
        </div>

        <div className="hl-card-actions">
          <a
            href="/api/v1/download/windows"
            className="hl-btn-download-primary"
            download="LensDeskApp.zip"
            onClick={handleDownloadClick}
          >
            <Download size={16} />
            Download for Windows
          </a>
          <span className="hl-badge-available">Available</span>
        </div>

        <p className="hl-card-note">
          Windows 11 and Windows 10 version 2004 or later supported with native stealth capture exclusion.
        </p>
      </div>

      {/* 2. Manual Download (macOS) */}
      <div className="hl-download-card">
        <div className="hl-card-header">
          <div className="hl-card-icon-box">
            <Laptop size={22} />
          </div>
          <div className="hl-card-title-group">
            <h3>Manual Download (macOS)</h3>
            <p>Native Apple Silicon (M1/M2/M3/M4) &amp; Intel DMG images.</p>
          </div>
        </div>

        <div className="hl-card-actions">
          <a
            href="/downloads/mac-arm64"
            className="hl-btn-download-primary"
            download="LensDesk-2.0.0-macOS-Apple-Silicon-arm64.dmg"
            onClick={handleDownloadClick}
          >
            <Download size={16} />
            Download for Apple Silicon
          </a>
          <a
            href="/downloads/mac-x64"
            className="hl-btn-download-secondary"
            download="LensDesk-2.0.0-macOS-Intel-x64.dmg"
            onClick={handleDownloadClick}
          >
            <Download size={16} />
            Download for Intel
          </a>
          <span className="hl-badge-available">Available</span>
        </div>

        <p className="hl-card-note">
          macOS 12 Monterey or later supported with native stealth capture exclusion.
        </p>

        <div
          className="hl-gatekeeper-helper"
          style={{
            marginTop: "1.25rem",
            padding: "0.85rem 1.1rem",
            background: "rgba(255, 255, 255, 0.03)",
            borderRadius: "10px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--site-accent, #d8f56b)" }}>
              macOS Gatekeeper Verification (If &ldquo;App is damaged / cannot open&rdquo;):
            </span>
            <button
              type="button"
              className={`hl-copy-action-btn ${copiedGk ? "is-copied" : ""}`}
              onClick={() => copyText(gkCommand, "gk")}
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem" }}
            >
              {copiedGk ? <Check size={12} /> : <Copy size={12} />}
              {copiedGk ? "Copied!" : "Copy Command"}
            </button>
          </div>
          <code style={{ display: "block", fontSize: "0.82rem", color: "#e2e8f0", background: "#090c0a", padding: "0.5rem 0.75rem", borderRadius: "6px" }}>
            {gkCommand}
          </code>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.78rem", color: "var(--site-dark-muted, #9aa698)" }}>
            Open Terminal, paste this command, and press Enter to clear the browser download quarantine.
          </p>
        </div>
      </div>

      {/* 3. Quick Install via PowerShell (Windows) */}
      <div className="hl-download-card">
        <div className="hl-card-header">
          <div className="hl-card-icon-box">
            <Terminal size={22} />
          </div>
          <div className="hl-card-title-group">
            <h3>Quick Install via PowerShell (Windows - Recommended)</h3>
            <p>
              Get LensDesk running in under 10 seconds. No manual extraction, no browser warnings &mdash; just one command.
            </p>
          </div>
        </div>

        <div className="hl-steps-container">
          <div className="hl-step-row">
            <div className="hl-step-num">1</div>
            <div className="hl-step-details">
              <h4 className="hl-step-heading">Open Command Prompt or PowerShell</h4>
              <p className="hl-step-desc">
                Press <span className="hl-kbd-pill">Win</span> +{" "}
                <span className="hl-kbd-pill">R</span>, type{" "}
                <span className="hl-kbd-pill">powershell</span>, and hit Enter. Or search
                for &ldquo;PowerShell&rdquo; in the Start menu.
              </p>
            </div>
          </div>

          <div className="hl-step-row">
            <div className="hl-step-num">2</div>
            <div className="hl-step-details">
              <h4 className="hl-step-heading">Paste the Command</h4>
              <p className="hl-step-desc">
                Copy the command below and paste it into your PowerShell window. Right-click to paste:
              </p>
              <div className="hl-code-terminal">
                <code>{psCommand}</code>
                <button
                  type="button"
                  className={`hl-copy-action-btn ${copiedPs ? "is-copied" : ""}`}
                  onClick={() => copyText(psCommand, "ps")}
                  aria-label="Copy PowerShell command"
                >
                  {copiedPs ? <Check size={14} /> : <Copy size={14} />}
                  {copiedPs ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>

          <div className="hl-step-row">
            <div className="hl-step-num">3</div>
            <div className="hl-step-details">
              <h4 className="hl-step-heading">Press Enter &amp; Done!</h4>
              <p className="hl-step-desc">
                Hit Enter. The installer will automatically download, extract, and
                set up LensDesk on your Desktop. A folder named LensDesk
                will appear when it&apos;s done.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Quick Install via Terminal (macOS) */}
      <div className="hl-download-card">
        <div className="hl-card-header">
          <div className="hl-card-icon-box">
            <Terminal size={22} />
          </div>
          <div className="hl-card-title-group">
            <h3>Quick Install via Terminal (macOS)</h3>
            <p>
              One-line terminal setup for macOS. Downloads, verifies checksum, installs
              to /Applications, and launches automatically.
            </p>
          </div>
        </div>

        <div className="hl-steps-container">
          <div className="hl-step-row">
            <div className="hl-step-num">1</div>
            <div className="hl-step-details">
              <h4 className="hl-step-heading">Open Terminal</h4>
              <p className="hl-step-desc">
                Press <span className="hl-kbd-pill">Cmd</span> +{" "}
                <span className="hl-kbd-pill">Space</span>, type{" "}
                <span className="hl-kbd-pill">Terminal</span>, and hit Enter.
              </p>
            </div>
          </div>

          <div className="hl-step-row">
            <div className="hl-step-num">2</div>
            <div className="hl-step-details">
              <h4 className="hl-step-heading">Paste &amp; Run</h4>
              <p className="hl-step-desc">
                Copy and paste the command below into your Terminal window:
              </p>
              <div className="hl-code-terminal">
                <code>{shCommand}</code>
                <button
                  type="button"
                  className={`hl-copy-action-btn ${copiedSh ? "is-copied" : ""}`}
                  onClick={() => copyText(shCommand, "sh")}
                  aria-label="Copy macOS terminal command"
                >
                  {copiedSh ? <Check size={14} /> : <Copy size={14} />}
                  {copiedSh ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>

          <div className="hl-step-row">
            <div className="hl-step-num">3</div>
            <div className="hl-step-details">
              <h4 className="hl-step-heading">Press Enter &amp; Done!</h4>
              <p className="hl-step-desc">
                Hit Enter. The script verifies signatures, installs to{" "}
                <span className="hl-kbd-pill">/Applications/LensDesk.app</span>,
                strips macOS quarantine flags, and opens the application immediately.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
