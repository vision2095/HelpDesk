import React, { useEffect, useState } from "react";
import {
  Download,
  Monitor,
  Terminal,
  Copy,
  Check,
  ShieldCheck,
  Laptop,
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
    <div className="content-page hl-downloads-page">
      <PageNav current="downloads" onNavigate={onNavigate} isDesktop={isDesktop} />

      <div className="hl-downloads-header">
        <h1 className="hl-downloads-title">Downloads</h1>
        <p className="hl-downloads-subtitle">
          Get the Hintlens desktop overlay and connect it to your account.
        </p>
      </div>

      {!currentUser && (
        <div
          className="hl-auth-required-banner"
          style={{
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            background: "rgba(234, 179, 8, 0.12)",
            border: "1px solid rgba(234, 179, 8, 0.35)",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <ShieldCheck size={22} style={{ color: "#eab308", flexShrink: 0 }} />
            <div>
              <strong style={{ color: "#fef08a", fontSize: "0.95rem" }}>
                Account Required to Download
              </strong>
              <p style={{ margin: "3px 0 0", color: "#fef9c3", fontSize: "0.85rem" }}>
                Please create an account or sign in before downloading the desktop application.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="hl-btn-download-primary"
            style={{ padding: "0.5rem 1.1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
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
            <p>Native stealth overlay (64-bit).</p>
          </div>
        </div>

        <div className="hl-card-actions">
          <a
            href="/api/v1/download/windows"
            className="hl-btn-download-primary"
            download="HintlensApp.zip"
            onClick={handleDownloadClick}
          >
            <Download size={16} />
            Download for Windows
          </a>
          <span className="hl-badge-available">Available</span>
        </div>

        <p className="hl-card-note">
          Windows 11, Windows 10 version 2004 or later is supported.
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

        <div className="hl-gatekeeper-helper" style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#93c5fd" }}>
              macOS Gatekeeper Fix (If &ldquo;App is damaged / cannot open&rdquo;):
            </span>
            <button
              type="button"
              className={`hl-copy-action-btn ${copiedGk ? "is-copied" : ""}`}
              onClick={() => copyText(gkCommand, "gk")}
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
            >
              {copiedGk ? <Check size={12} /> : <Copy size={12} />}
              {copiedGk ? "Copied!" : "Copy Command"}
            </button>
          </div>
          <code style={{ display: "block", fontSize: "0.8rem", color: "#e2e8f0", background: "rgba(0,0,0,0.3)", padding: "0.4rem 0.6rem", borderRadius: "4px" }}>
            {gkCommand}
          </code>
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.75rem", color: "#94a3b8" }}>
            Open Terminal, paste this command, and press Enter to clear the browser download quarantine.
          </p>
        </div>
      </div>

      {/* 3. Quick Install via PowerShell (Windows - EXACTLY LIKE HINTLENS) */}
      <div className="hl-download-card">
        <div className="hl-card-header">
          <div className="hl-card-icon-box">
            <Terminal size={22} />
          </div>
          <div className="hl-card-title-group">
            <h3>Quick Install via PowerShell (Recommended)</h3>
            <p>
              Get HintLens running in under 10 seconds. No downloads page, no browser
              warnings - just one command.
            </p>
          </div>
        </div>

        <div className="hl-steps-container">
          <div className="hl-step-row">
            <div className="hl-step-num">1</div>
            <div className="hl-step-details">
              <h4 className="hl-step-heading">Open Command Prompt</h4>
              <p className="hl-step-desc">
                Press <span className="hl-kbd-pill">Win</span> +{" "}
                <span className="hl-kbd-pill">R</span>, type{" "}
                <span className="hl-kbd-pill">cmd</span>, and hit Enter. Or search
                for &ldquo;Command Prompt&rdquo; or powershell in the Start menu.
              </p>
            </div>
          </div>

          <div className="hl-step-row">
            <div className="hl-step-num">2</div>
            <div className="hl-step-details">
              <h4 className="hl-step-heading">Paste the Command</h4>
              <p className="hl-step-desc">
                Copy the command below and paste it into your Command Prompt window.
                Right-click to paste.
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
                set up Hintlens on your Desktop. A folder named Hintlens-Software
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

      {/* 5. macOS Gatekeeper Note */}
      <div className="hl-download-card" style={{ borderColor: "rgba(245, 158, 11, 0.3)" }}>
        <div className="hl-card-header">
          <div className="hl-card-icon-box" style={{ color: "#f59e0b" }}>
            <ShieldCheck size={22} />
          </div>
          <div className="hl-card-title-group">
            <h3 style={{ color: "#d97706" }}>macOS Gatekeeper Fix</h3>
            <p>
              If macOS ever displays &ldquo;LensDesk is damaged and can&apos;t be
              opened&rdquo; or blocks it on first download, run this command in
              Terminal:
            </p>
          </div>
        </div>

        <div className="hl-code-terminal">
          <code>{gkCommand}</code>
          <button
            type="button"
            className={`hl-copy-action-btn ${copiedGk ? "is-copied" : ""}`}
            onClick={() => copyText(gkCommand, "gk")}
            aria-label="Copy Gatekeeper command"
          >
            {copiedGk ? <Check size={14} /> : <Copy size={14} />}
            {copiedGk ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
