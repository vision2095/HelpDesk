import { useEffect, useState } from "react";
import {
  Aperture,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronDown,
  CreditCard,
  Download,
  FileText,
  Globe2,
  History,
  Keyboard,
  Laptop,
  LockKeyhole,
  Menu,
  Monitor,
  MousePointer2,
  ScanLine,
  Server,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { cloud } from "./cloud";
import floatingPreview from "../resources/native-floating-preview.png";

interface HomeProps {
  navigate: (page: string) => void;
}

const BUILDS = [
  {
    key: "mac-arm64",
    platform: "macOS",
    variant: "Apple silicon",
    detail: "M-series Macs · DMG",
  },
  {
    key: "mac-x64",
    platform: "macOS",
    variant: "Intel",
    detail: "Intel Macs · DMG",
  },
  {
    key: "windows",
    platform: "Windows",
    variant: "64-bit",
    detail: "Windows 10 & 11 · ZIP",
  },
] as const;

function formatBytes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function formatPrice(plan: any) {
  const currency = plan?.currency || "INR";
  const amount = Number(plan?.priceMinor || 0) / 100;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function Home({ navigate }: HomeProps) {
  const [info, setInfo] = useState<any>(null);
  const [publicError, setPublicError] = useState(false);
  const [account, setAccount] = useState<any>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    cloud("cloud.public")
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch(() => {
        if (active) setPublicError(true);
      });
    cloud("cloud.state")
      .then((value) => {
        if (active) setAccount(value);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAccountReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const signedIn = Boolean(account?.user);
  const plans: any[] = Array.isArray(info?.accessPlans)
    ? info.accessPlans
    : [];
  const detectedBuilds = BUILDS.map((build) => {
    const artifact = info?.downloads?.[build.key];
    return artifact?.url ? { ...build, artifact } : null;
  }).filter(Boolean) as Array<
    (typeof BUILDS)[number] & { artifact: any }
  >;
  const fallbackBuilds = [
    {
      key: "windows",
      platform: "Windows",
      variant: "Setup Installer (Recommended)",
      detail: "Windows 10 & 11 · 64-bit EXE",
      artifact: {
        name: "LensDesk-Setup.exe",
        url: "/downloads/windows",
        version: "2.0.0",
        size: 1155422,
      },
    },
    {
      key: "windows-portable",
      platform: "Windows",
      variant: "Portable Archive",
      detail: "Windows 10 & 11 · 64-bit ZIP",
      artifact: {
        name: "LensDesk.zip",
        url: "/downloads/windows",
        version: "2.0.0",
        size: 1574800,
      },
    },
    {
      key: "mac-arm64",
      platform: "macOS",
      variant: "Apple silicon",
      detail: "M-series Macs (M1/M2/M3/M4) · DMG",
      artifact: {
        name: "LensDesk.dmg",
        url: "/downloads/mac-arm64",
        version: "2.0.0",
        size: 141429129,
      },
    },
    {
      key: "mac-x64",
      platform: "macOS",
      variant: "Intel",
      detail: "Intel Macs · DMG",
      artifact: {
        name: "LensDesk-Intel.dmg",
        url: "/downloads/mac-x64",
        version: "2.0.0",
        size: 148147539,
      },
    },
  ];
  const builds = detectedBuilds.length ? detectedBuilds : fallbackBuilds;
  const publicReady = Boolean(info) || publicError;
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const modifier = isMac ? "⌘" : "Ctrl";

  function jump(id: string) {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function workshop(page: string) {
    setMenuOpen(false);
    navigate(signedIn ? page : "account");
  }

  function openWorkspace() {
    setMenuOpen(false);
    navigate("workspace");
  }

  const handleDownloadClick = () => {
    // Direct instant download without blocking
  };

  return (
    <div className="lensdesk-site">
      <header className="site-nav">
        <div className="site-container site-nav-inner">
          <button
            type="button"
            className="site-brand"
            onClick={() =>
              window.scrollTo({ top: 0, behavior: "smooth" })
            }
            aria-label="LensDesk home"
          >
            <span className="site-brand-mark">
              <Aperture size={18} />
            </span>
            <span className="site-brand-word">
              lensdesk<span>.</span>
            </span>
          </button>

          <nav className="site-nav-links" aria-label="Primary">
            <a href="#product" onClick={() => setMenuOpen(false)}>
              Product
            </a>
            <button
              type="button"
              className="site-nav-text"
              onClick={() => {
                setMenuOpen(false);
                navigate("workspace");
              }}
            >
              Assistant
            </button>
            <button
              type="button"
              className="site-nav-text"
              onClick={() => {
                setMenuOpen(false);
                navigate("profiles");
              }}
            >
              Profiles
            </button>
            <button
              type="button"
              className="site-nav-text"
              onClick={() => {
                setMenuOpen(false);
                navigate("downloads");
              }}
            >
              Downloads
            </button>
            <button
              type="button"
              className="site-nav-text"
              onClick={() => {
                setMenuOpen(false);
                navigate("settings");
              }}
            >
              Settings
            </button>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>
              Pricing
            </a>
          </nav>

          <div className="site-nav-actions">
            <button
              type="button"
              className="site-nav-text"
              onClick={() => navigate("account")}
            >
              {signedIn ? "Account" : "Sign in"}
            </button>
            <button
              type="button"
              className="site-nav-button"
              onClick={openWorkspace}
            >
              Open Assistant
              <ArrowUpRight size={14} />
            </button>
          </div>

          <button
            type="button"
            className="site-menu-toggle"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {menuOpen && (
          <div className="site-mobile-menu">
            <a href="#product" onClick={() => setMenuOpen(false)}>
              Product
            </a>
            <button type="button" onClick={() => { setMenuOpen(false); navigate("workspace"); }}>
              Assistant Workspace
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); navigate("profiles"); }}>
              Interview Profiles
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); navigate("downloads"); }}>
              Desktop Downloads
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); navigate("settings"); }}>
              Settings
            </button>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>
              Pricing
            </a>
            <div className="site-mobile-menu-actions">
              <button type="button" onClick={() => navigate("account")}>
                {signedIn ? "Account & Cloud" : "Sign in"}
              </button>
              <button
                type="button"
                className="primary"
                onClick={openWorkspace}
              >
                Open Assistant
                <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
        )}
      </header>

      <main>
        <section className="site-hero">
          <div className="site-container site-hero-grid">
            <div className="site-hero-copy">
              <div className="site-kicker">
                <span />
                A focused AI workspace
              </div>
              <h1>
                Think clearly,
                <em>even in the middle of it.</em>
              </h1>
              <p className="site-hero-lede">
                LensDesk is one floating window for the question in front of
                you, the call you are on, and the answer you need to keep
                moving. No dashboard to manage while the moment is happening.
              </p>
              <div className="site-hero-actions">
                <a
                  className="site-button site-button-primary"
                  href="/downloads/windows"
                  download="LensDesk-Setup.exe"
                  onClick={handleDownloadClick}
                >
                  <Download size={16} />
                  Download for Windows
                </a>
                <a
                  className="site-button site-button-primary"
                  style={{ background: "#1868db", color: "#fff" }}
                  href="/downloads/mac-arm64"
                  download="LensDesk.dmg"
                  onClick={handleDownloadClick}
                >
                  <Download size={16} />
                  Download for MacOS
                </a>
                <button
                  type="button"
                  className="site-button site-button-quiet"
                  onClick={() => navigate("downloads")}
                >
                  All Downloads &amp; Guide
                </button>
              </div>
              <ul className="site-hero-facts">
                <li>
                  <Check size={13} /> One floating window
                </li>
                <li>
                  <Check size={13} /> macOS &amp; Windows
                </li>
                <li>
                  <Check size={13} /> Your models, your keys
                </li>
              </ul>
            </div>

            <figure className="site-hero-product">
              <div className="site-product-label">
                <span>
                  <i /> Actual interface
                </span>
                <span>Floating assistant</span>
              </div>
              <div className="site-product-stage">
                <img
                  src={floatingPreview}
                  alt="The LensDesk floating assistant open over a code editor, with a transcript, a question composer and capture controls."
                  width={2080}
                  height={1240}
                  loading="eager"
                />
              </div>
              <figcaption>
                The desktop application in floating mode. Every surface stays
                inside one window.
              </figcaption>
            </figure>
          </div>

          <div className="site-audiences">
            <div className="site-container site-audiences-inner">
              <span className="site-audiences-title">
                For the work between the lines
              </span>
              <div className="site-audiences-list">
                <span>Interviews</span>
                <span>Technical screens</span>
                <span>Customer calls</span>
                <span>Research</span>
                <span>Deep work</span>
              </div>
            </div>
          </div>
        </section>

        <section className="site-section site-product" id="product">
          <div className="site-container">
            <div className="site-section-heading">
              <div>
                <div className="site-kicker">
                  <span />
                  The workspace
                </div>
                <h2>Small on screen. Present in the moment.</h2>
              </div>
              <p>
                Built around one deliberate surface rather than a dashboard
                full of panels. Capture, context, models and answers stay
                within reach of the work.
              </p>
            </div>

            <div className="site-feature-grid">
              <article className="site-feature-card site-feature-lead">
                <div className="site-feature-lead-top">
                  <span className="site-feature-index">01 / ONE WINDOW</span>
                  <div className="site-feature-icon">
                    <Monitor size={19} />
                  </div>
                </div>
                <h3>The quietest window in the room.</h3>
                <p>
                  LensDesk opens as a single floating assistant and stays there.
                  Adjust opacity, move the window, or let mouse input pass
                  through to the application underneath. There is no second
                  workspace hiding behind it.
                </p>
                <div className="site-feature-meta">
                  <span>Always on top</span>
                  <span>Click-through mode</span>
                  <span>Adjustable opacity</span>
                </div>
              </article>

              <article className="site-feature-card site-shortcut-card">
                <div className="site-feature-card-head">
                  <div className="site-feature-icon">
                    <Keyboard size={18} />
                  </div>
                  <span className="site-feature-index">02 / SHORTCUTS</span>
                </div>
                <h3>Muscle memory, not menus.</h3>
                <p>
                  Wait for the moment you need, then use a key. Every shortcut
                  can be rebound in Settings.
                </p>
                <div className="site-key-list">
                  <div>
                    <kbd>{modifier}</kbd>
                    <kbd>⇧</kbd>
                    <kbd>S</kbd>
                    <span>Capture</span>
                  </div>
                  <div>
                    <kbd>⇧</kbd>
                    <kbd>H</kbd>
                    <span>Hide</span>
                  </div>
                  <div>
                    <kbd>{modifier}</kbd>
                    <kbd>⇧</kbd>
                    <kbd>T</kbd>
                    <span>Auto-type</span>
                  </div>
                  <div>
                    <kbd>⇧</kbd>
                    <kbd>M</kbd>
                    <span>Click-through</span>
                  </div>
                </div>
                <p className="site-key-note">
                  Defaults shown. Windows uses Ctrl in place of ⌘.
                </p>
              </article>

              <article className="site-feature-card">
                <div className="site-feature-icon">
                  <ScanLine size={18} />
                </div>
                <h3>Capture the moment.</h3>
                <p>
                  Take a region snip or a display capture and add it to the
                  session as image context, without leaving the conversation.
                </p>
              </article>

              <article className="site-feature-card">
                <div className="site-feature-icon">
                  <AudioLines size={18} />
                </div>
                <h3>Voice belongs in context.</h3>
                <p>
                  Record a microphone or system source, then work from the
                  transcript alongside screenshots and notes.
                </p>
              </article>

              <article className="site-feature-card">
                <div className="site-feature-icon">
                  <Sparkles size={18} />
                </div>
                <h3>Your model, your endpoint.</h3>
                <p>
                  Use a hosted provider or connect a local Ollama or LM Studio
                  endpoint. The choice stays in your settings.
                </p>
              </article>

              <article className="site-feature-card">
                <div className="site-feature-icon">
                  <Zap size={18} />
                </div>
                <h3>Type on your terms.</h3>
                <p>
                  Send the latest answer to the focused field at a deliberate
                  pace you choose, and stop it whenever you want.
                </p>
              </article>

              <article className="site-feature-card">
                <div className="site-feature-icon">
                  <Globe2 size={18} />
                </div>
                <h3>A browser beside the answer.</h3>
                <p>
                  Open reference material inside the floating assistant instead
                  of switching windows and losing the thread.
                </p>
              </article>

              <article className="site-feature-card">
                <div className="site-feature-icon">
                  <MousePointer2 size={18} />
                </div>
                <h3>Settings, still in the window.</h3>
                <p>
                  Choose models, transcription, appearance and shortcuts in the
                  same floating surface, without opening a second workspace.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="site-workflow" id="workflow">
          <div className="site-container">
            <div className="site-section-heading site-section-heading-inverse">
              <div>
                <div className="site-kicker">
                  <span />
                  The workflow
                </div>
                <h2>From the website to the moment, in three moves.</h2>
              </div>
              <p>
                The desktop stays small. The web workspace holds the archive,
                the context and the account details around it.
              </p>
            </div>
            <div className="site-steps">
              <article>
                <span className="site-step-number">01</span>
                <h3>Set up on the web</h3>
                <p>
                  Create an account, verify your email, and choose the plan
                  that fits your interview timeline.
                </p>
                <button type="button" onClick={() => navigate("account")}>
                  Open your account <ArrowRight size={14} />
                </button>
              </article>
              <article>
                <span className="site-step-number">02</span>
                <h3>Sign in once</h3>
                <p>
                  The desktop opens directly to sign-in. Your plan and this
                  device are verified before any protected surface appears.
                </p>
                <button type="button" onClick={() => jump("download")}>
                  Get the desktop app <ArrowRight size={14} />
                </button>
              </article>
              <article>
                <span className="site-step-number">03</span>
                <h3>Keep your context close</h3>
                <p>
                  Ask, capture, record, or click through. Reopen any session
                  later in the web workshop and pick up where you stopped.
                </p>
                <button type="button" onClick={() => workshop("sessions")}>
                  See session history <ArrowRight size={14} />
                </button>
              </article>
            </div>
          </div>
        </section>

        <section className="site-workshop" id="workshop">
          <div className="site-container site-workshop-grid">
            <div className="site-workshop-copy">
              <div className="site-kicker">
                <span />
                The web workshop
              </div>
              <h2>The archive lives on the web.</h2>
              <p>
                Session history, interview profiles and account management are
                part of the website, not extra screens inside the desktop
                window. Sign in once and the context travels with you.
              </p>
              <button
                type="button"
                className="site-button site-button-dark"
                onClick={openWorkspace}
              >
                {signedIn ? "Open the workspace" : "Sign in to the workshop"}
                <ArrowUpRight size={15} />
              </button>
              <p className="site-workshop-footnote">
                The desktop app stays focused on the live conversation. The
                web workspace keeps the long version.
              </p>
            </div>

            <div className="site-workshop-list">
              <article>
                <span className="site-workshop-icon">
                  <History size={18} />
                </span>
                <div>
                  <h3>Session history</h3>
                  <p>
                    Search, reopen, annotate and export past conversations.
                    Markdown and PDF export live here.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Open session history"
                  onClick={() => workshop("sessions")}
                >
                  <ArrowUpRight size={18} />
                </button>
              </article>
              <article>
                <span className="site-workshop-icon">
                  <UserRound size={18} />
                </span>
                <div>
                  <h3>Interview profiles</h3>
                  <p>
                    Keep resumes, role context and notes ready to reuse before
                    the next call.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Open interview profiles"
                  onClick={() => workshop("profiles")}
                >
                  <ArrowUpRight size={18} />
                </button>
              </article>
              <article>
                <span className="site-workshop-icon">
                  <CreditCard size={18} />
                </span>
                <div>
                  <h3>Account &amp; access</h3>
                  <p>
                    Manage membership plans, active devices, two-factor
                    authentication, downloads and security.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Open account settings"
                  onClick={() => workshop("account")}
                >
                  <ArrowUpRight size={18} />
                </button>
              </article>
            </div>
          </div>
        </section>

        <section className="site-section site-pricing" id="pricing">
          <div className="site-container">
            <div className="site-section-heading">
              <div>
                <div className="site-kicker">
                  <span />
                  Flexible Plans
                </div>
                <h2>Simple, transparent pricing. Instant activation.</h2>
              </div>
              <p>
                One active desktop device per account. Every plan includes the
                full floating overlay, real-time screen analysis, and AI assistant
                streaming. Secure checkout with instant desktop activation.
              </p>
            </div>

            {!publicReady ? (
              <div className="site-pricing-loading" aria-label="Loading plans">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} />
                ))}
              </div>
            ) : plans.length ? (
              <div className="site-plan-grid">
                {plans.map((plan) => (
                  <article
                    key={plan.id}
                    className={`site-plan-card${plan.highlight ? " is-highlighted" : ""}`}
                  >
                    {plan.highlight && (
                      <span className="site-plan-flag">Most chosen</span>
                    )}
                    <span className="site-plan-label">{plan.label}</span>
                    <div className="site-plan-price">
                      {formatPrice(plan)}
                      <small>{plan.durationLabel}</small>
                    </div>
                    <p>
                      Adds {plan.durationLabel} of desktop access. Existing
                      time is extended; nothing overlaps.
                    </p>
                    <ul>
                      <li>
                        <Check size={13} /> Full floating workspace
                      </li>
                      <li>
                        <Check size={13} /> One active device
                      </li>
                      <li>
                        <Check size={13} /> Session archive on the web
                      </li>
                    </ul>
                    <button
                      type="button"
                      className={
                        plan.highlight
                          ? "site-button site-button-accent"
                          : "site-button site-button-outline"
                      }
                      onClick={() => navigate("account")}
                    >
                      {signedIn ? "Add this plan" : "Choose this plan"}
                      <ArrowRight size={15} />
                    </button>
                    <small className="site-plan-tax">{plan.taxNote}</small>
                  </article>
                ))}
              </div>
            ) : (
              <div className="site-plans-unavailable">
                <LockKeyhole size={19} />
                <div>
                  <h3>Plans are updated in real time.</h3>
                  <p>
                    Sign in to your account to view available membership tiers and
                    activate instant desktop access.
                  </p>
                </div>
                <button
                  type="button"
                  className="site-button site-button-outline"
                  onClick={() => navigate("account")}
                >
                  Open account
                  <ArrowUpRight size={15} />
                </button>
              </div>
            )}

            <p className="site-pricing-note">
              All plans include full desktop stealth overlay, AI assistant streaming,
              and real-time capture. Secure checkout with instant desktop activation.
              Your own provider keys (OpenAI, Anthropic, Gemini) are billed directly by your chosen provider.
            </p>
          </div>
        </section>

        <section className="site-trust" id="security">
          <div className="site-container">
            <div className="site-trust-head">
              <div className="site-kicker">
                <span />
                Privacy &amp; control
              </div>
              <h2>Built to keep the boundaries visible.</h2>
            </div>
            <div className="site-trust-grid">
              <article>
                <span>
                  <LockKeyhole size={18} />
                </span>
                <h3>Keys in the OS vault</h3>
                <p>
                  Provider keys are encrypted with the operating system’s
                  credential store. LensDesk fails visibly if secure storage is
                  unavailable rather than saving plaintext.
                </p>
              </article>
              <article>
                <span>
                  <Server size={18} />
                </span>
                <h3>One active device</h3>
                <p>
                  A second sign-in requires an explicit takeover. The previous
                  desktop session is signed out; the account is not left open
                  on two machines.
                </p>
              </article>
              <article>
                <span>
                  <ShieldCheck size={18} />
                </span>
                <h3>Capture protection is a request</h3>
                <p>
                  LensDesk asks the OS to exclude its window from capture.
                  macOS, Windows and recording tools can behave differently, so
                  treat it as a safeguard, never a guarantee.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="site-download" id="download">
          <div className="site-container">
            <div className="site-section-heading site-section-heading-inverse">
              <div>
                <div className="site-kicker">
                  <span />
                  Download
                </div>
                <h2>One window. Wherever you work.</h2>
              </div>
              <p>
                Desktop builds for macOS and Windows. Sign in after installation
                with the same account you use on this website.
              </p>
            </div>

            {!signedIn && (
              <div
                style={{
                  padding: "1rem 1.25rem",
                  marginBottom: "2rem",
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
                  className="site-button site-button-light"
                  style={{ padding: "0.5rem 1.1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                  onClick={() => navigate("account")}
                >
                  Create Account / Sign In
                </button>
              </div>
            )}

            <div className="site-download-layout">
              <div className="site-download-main">
                {!publicReady ? (
                  <div className="site-download-grid">
                    {[0, 1, 2].map((item) => (
                      <div className="site-download-card is-loading" key={item} />
                    ))}
                  </div>
                ) : builds.length ? (
                  <>
                    <div
                      className={`site-download-grid${builds.length === 1 ? " is-single" : ""}`}
                    >
                      {builds.map((build) => (
                        <article className="site-download-card" key={build.key}>
                          <div className="site-download-card-top">
                            <span>
                              {build.key === "windows" ? (
                                <Laptop size={19} />
                              ) : (
                                <Aperture size={19} />
                              )}
                            </span>
                            <small>
                              {build.artifact.version
                                ? `v${build.artifact.version}`
                                : build.platform}
                            </small>
                          </div>
                          <h3>{build.platform}</h3>
                          <p>{build.variant}</p>
                          <div className="site-download-meta">
                            <span>{build.detail}</span>
                            {formatBytes(build.artifact.size) && (
                              <span>{formatBytes(build.artifact.size)}</span>
                            )}
                          </div>
                          <a
                            className="site-button site-button-light"
                            href={build.artifact.url}
                            download
                            onClick={handleDownloadClick}
                          >
                            <Download size={15} />
                            Download{" "}
                            {build.key === "windows"
                              ? "Setup (.exe)"
                              : build.key === "windows-portable"
                                ? "ZIP (.zip)"
                                : "DMG"}
                          </a>
                        </article>
                      ))}
                    </div>
                    <p className="site-download-note">
                      On macOS, open the DMG and move LensDesk to Applications.
                      On Windows, extract the entire ZIP before launching.
                      Permission prompts are expected for screen capture, audio
                      and auto-type.
                    </p>
                  </>
                ) : (
                  <div className="site-download-empty">
                    <span>
                      <Laptop size={22} />
                    </span>
                    <div>
                      <h3>Official Desktop Builds</h3>
                      <p>
                        Certified builds for macOS and Windows are ready for download.
                        Sign in to your account to download the installer directly.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="site-button site-button-accent"
                      onClick={() => navigate("account")}
                    >
                      {signedIn ? "Open your account" : "Sign in"}
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                )}
              </div>

              <aside className="site-download-aside">
                <div className="site-kicker">
                  <span />
                  Before you install
                </div>
                <h3>A few details for a clean first launch.</h3>
                <ol>
                  <li>
                    <span>01</span>
                    <div>
                      <strong>Match the build</strong>
                      <p>
                        Apple silicon and Intel Macs use separate DMGs. Windows
                        builds are 64-bit ZIP archives.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>02</span>
                    <div>
                      <strong>Expect permission prompts</strong>
                      <p>
                        Screen capture, microphone and auto-type each need the
                        operating system’s approval before they can work.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>03</span>
                    <div>
                      <strong>Sign in before you start</strong>
                      <p>
                        Access is verified before the floating workspace opens.
                        Use the account that holds your plan.
                      </p>
                    </div>
                  </li>
                </ol>
                <button
                  type="button"
                  className="site-download-aside-link"
                  onClick={() => navigate("account")}
                >
                  Account &amp; downloads
                  <ArrowUpRight size={14} />
                </button>
              </aside>
            </div>
          </div>
        </section>

        <section className="site-section site-faq" id="faq">
          <div className="site-container site-faq-grid">
            <div className="site-faq-heading">
              <div className="site-kicker">
                <span />
                Questions
              </div>
              <h2>What to know before you open the window.</h2>
              <p>
                Clear answers about access, data and the desktop surface. For
                anything account-specific, open the web workspace.
              </p>
              <button
                type="button"
                className="site-button site-button-outline"
                onClick={() => navigate("account")}
              >
                Visit your account
                <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="site-faq-list">
              <details className="site-faq-item" open>
                <summary>
                  What exactly is in the desktop app?
                  <ChevronDown size={18} />
                </summary>
                <p>
                  The desktop application is one floating workspace for the
                  assistant, a side-by-side browser, an interview layout and
                  settings. Session history, interview profiles, downloads and
                  account management live on this website.
                </p>
              </details>
              <details className="site-faq-item">
                <summary>
                  Do I need an account and a plan?
                  <ChevronDown size={18} />
                </summary>
                <p>
                  Yes. The desktop app securely connects to your LensDesk account
                  with an active plan. Create your account and choose your plan here on
                  the website to get started immediately.
                </p>
              </details>
              <details className="site-faq-item">
                <summary>
                  Can I use my own API keys?
                  <ChevronDown size={18} />
                </summary>
                <p>
                  You can connect supported hosted providers or a local model
                  endpoint in Settings. Provider usage is billed directly by
                  that provider. A desktop access plan is still required.
                </p>
              </details>
              <details className="site-faq-item">
                <summary>
                  Where are my sessions and profiles kept?
                  <ChevronDown size={18} />
                </summary>
                <p>
                  They are available in the signed-in web workspace. The desktop
                  keeps working context close; the website is the place to
                  search, edit, export and manage the archive.
                </p>
              </details>
              <details className="site-faq-item">
                <summary>
                  Does LensDesk hide itself from screen sharing?
                  <ChevronDown size={18} />
                </summary>
                <p>
                  It requests OS capture exclusion for the protected desktop
                  window. That is not guaranteed across every operating-system
                  version or recording tool, so do not rely on it to hide
                  activity. Opacity and placement are presentation controls, not
                  security controls.
                </p>
              </details>
              <details className="site-faq-item">
                <summary>
                  Which platforms are supported?
                  <ChevronDown size={18} />
                </summary>
                <p>
                  macOS on Apple silicon and Intel, plus Windows 64-bit. The
                  available packages on this page are read directly from the
                  workspace release manifest.
                </p>
              </details>
            </div>
          </div>
        </section>

        <section className="site-final-cta">
          <div className="site-container site-final-cta-inner">
            <div>
              <span className="site-kicker">
                <span />
                Keep the next answer close
              </span>
              <h2>Leave the dashboard behind.</h2>
            </div>
            <div className="site-final-actions">
              <button
                type="button"
                className="site-button site-button-dark"
                onClick={() => jump("download")}
              >
                Get LensDesk
                <ArrowRight size={16} />
              </button>
              <button
                type="button"
                className="site-button site-button-quiet"
                onClick={() => navigate("account")}
              >
                {signedIn ? "Open account" : "Create an account"}
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-container">
          <div className="site-footer-grid">
            <div className="site-footer-brand">
              <button
                type="button"
                className="site-brand site-brand-footer"
                onClick={() =>
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }
              >
                <span className="site-brand-mark">
                  <Aperture size={18} />
                </span>
                <span className="site-brand-word">
                  lensdesk<span>.</span>
                </span>
              </button>
              <p>
                A single floating workspace for the moments that ask for your
                full attention.
              </p>
              <div className="site-footer-platforms">
                <span>macOS</span>
                <span>Windows</span>
              </div>
            </div>

            <div className="site-footer-links">
              <h3>Product</h3>
              <a href="#product">Overview</a>
              <a href="#workflow">How it works</a>
              <a href="#pricing">Pricing</a>
              <a href="#download">Download</a>
            </div>

            <div className="site-footer-links">
              <h3>Workshop</h3>
              <button type="button" onClick={() => workshop("sessions")}>
                Session history
              </button>
              <button type="button" onClick={() => workshop("profiles")}>
                Interview profiles
              </button>
              <button type="button" onClick={() => navigate("account")}>
                Account &amp; access
              </button>
              <button type="button" onClick={openWorkspace}>
                Open workspace
              </button>
            </div>

            <div className="site-footer-links">
              <h3>Details</h3>
              <a href="#security">Privacy &amp; control</a>
              <a href="#faq">Questions</a>
              <button type="button" onClick={() => navigate("account")}>
                Sign in
              </button>
            </div>
          </div>

          <div className="site-footer-bottom">
            <span>
              © {new Date().getFullYear()} LensDesk. All rights reserved.
            </span>
            <span className="site-footer-note">
              <FileText size={13} /> Secure payment processing · Instant desktop activation
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
