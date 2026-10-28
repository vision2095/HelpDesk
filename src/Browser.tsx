import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Plus,
  Globe,
  Search,
  Download,
  ExternalLink,
  House,
  Camera,
  ClipboardPaste,
  Lock,
} from "lucide-react";
import { api } from "./api";
type BrowserTab = {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  error: string;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
};
type BrowserState = {
  activeId: string | null;
  tabs: BrowserTab[];
  downloads: {
    id: string;
    name: string;
    received: number;
    total: number;
    state: string;
  }[];
};
export function WorkspaceBrowser({
  onError,
  onCaptureScreen,
  imagesCount = 0,
  bundleImages = [],
  bundleNote = "",
  onPasteSuccess,
}: {
  onError: (error: unknown) => void;
  onCaptureScreen?: () => void;
  imagesCount?: number;
  bundleImages?: string[];
  bundleNote?: string;
  onPasteSuccess?: () => void;
}) {
  const [state, setState] = useState<BrowserState>({
      activeId: null,
      tabs: [],
      downloads: [],
    }),
    [address, setAddress] = useState(""),
    [find, setFind] = useState(""),
    [showDownloads, setShowDownloads] = useState(false),
    [showFind, setShowFind] = useState(false);
  const viewport = useRef<HTMLDivElement>(null),
    addressInput = useRef<HTMLInputElement>(null),
    mounted = useRef(true),
    initializing = useRef(false);
  const tab = state.tabs.find((t) => t.id === state.activeId);
  const handlePasteBundle = async () => {
    if (!tab) return;
    try {
      await api("browser.pasteBundle", {
        images: bundleImages,
        note: bundleNote,
      });
      onPasteSuccess?.();
    } catch (error) {
      onError(error);
    }
  };
  const command = async (action: string, payload: object = {}) => {
    try {
      const result = await api<BrowserState>("browser." + action, payload);
      if (mounted.current) setState(result);
    } catch (error) {
      onError(error);
    }
  };
  const closeFind = () => {
    setShowFind(false);
    setFind("");
    void command("find", { text: "" }).then(() => command("focus"));
  };
  useEffect(() => {
    mounted.current = true;
    const unsub = window.lens?.onBrowserState?.((next) => {
      if (mounted.current) setState(next);
    });
    const focus = window.lens?.onBrowserFocusAddress?.(() => {
      addressInput.current?.focus();
      addressInput.current?.select();
    });
    const findFocus = window.lens?.onBrowserFocusFind?.(() =>
      setShowFind(true),
    );
    if (!initializing.current) {
      initializing.current = true;
      void command("state");
    }
    return () => {
      mounted.current = false;
      unsub?.();
      focus?.();
      findFocus?.();
      void api("browser.layout", { visible: false }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    setAddress(tab?.url || "");
  }, [tab?.url, tab?.id]);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = () => {
      if (!mounted.current) return;
      const r = node.getBoundingClientRect();
      void api("browser.layout", {
        visible: Boolean(tab),
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
      }).catch(onError);
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [tab?.id, showDownloads, showFind, tab?.error]);
  return (
    <section className="browser-page" aria-label="Workspace browser">
      <div className="browser-tabs" role="tablist" aria-label="Browser tabs">
        {state.tabs.map((t) => (
          <div
            className={
              "browser-tab " + (t.id === state.activeId ? "selected" : "")
            }
            key={t.id}
          >
            <button
              role="tab"
              aria-selected={t.id === state.activeId}
              onClick={() => command("select", { id: t.id })}
            >
              <Globe size={14} />
              <span>{t.loading ? "Loading…" : t.title}</span>
            </button>
            <button
              aria-label={"Close tab " + t.title}
              onClick={() => command("close", { id: t.id })}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          className="icon-button"
          aria-label="New browser tab"
          disabled={state.tabs.length >= 12}
          onClick={() => command("open")}
        >
          <Plus size={18} />
        </button>
      </div>
      <form
        className="browser-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          addressInput.current?.blur();
          void command(tab ? "navigate" : "open", { url: address }).then(() => {
            void command("focus");
          });
        }}
      >
        <button
          type="button"
          className="icon-button"
          aria-label="Browser home page"
          onClick={() => command("home")}
        >
          <House size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Browser back"
          disabled={!tab?.canGoBack}
          onClick={() => command("back")}
        >
          <ArrowLeft size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Browser forward"
          disabled={!tab?.canGoForward}
          onClick={() => command("forward")}
        >
          <ArrowRight size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={tab?.loading ? "Stop loading page" : "Reload page"}
          disabled={!tab}
          onClick={() => command(tab?.loading ? "stop" : "reload")}
        >
          <RotateCw size={17} />
        </button>
        <div className="browser-address-container">
          <span className="browser-address-badge" title={address?.startsWith("https://") ? "Secure HTTPS connection" : "LensDesk Secure Browser"}>
            <svg
              className="browser-address-logo"
              viewBox="0 0 1024 1024"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <rect width="1024" height="1024" rx="230" fill="#d9f56b" />
              <g
                transform="translate(512 512) scale(30) translate(-12 -12)"
                fill="none"
                stroke="#0d110d"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m14.31 8 5.74 9.94" />
                <path d="M9.69 8h11.48" />
                <path d="m7.38 12 5.74-9.94" />
                <path d="M9.69 16 3.95 6.06" />
                <path d="M14.31 16H2.83" />
                <path d="m16.62 12-5.74 9.94" />
              </g>
            </svg>
            {address?.startsWith("https://") && (
              <span title="Secure connection" className="browser-address-lock-wrap">
                <Lock size={11} className="browser-address-lock" />
              </span>
            )}
          </span>
          <input
            ref={addressInput}
            aria-label="Browser address or search"
            placeholder="Search or enter a web address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
        </div>
        <button className="button" type="submit">
          Go
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Find in page"
          disabled={!tab}
          onClick={() => setShowFind((v) => !v)}
        >
          <Search size={17} />
        </button>
        <select
          aria-label="Browser zoom"
          value={tab?.zoom || 1}
          disabled={!tab}
          onChange={(event) =>
            command("zoom", { factor: Number(event.target.value) })
          }
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 2.5].map((n) => (
            <option value={n} key={n}>
              {n * 100}%
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label="Browser downloads"
          aria-expanded={showDownloads}
          onClick={() => setShowDownloads((v) => !v)}
        >
          <Download size={17} />
        </button>
        {onCaptureScreen && (
          <button
            type="button"
            className="icon-button"
            aria-label="Capture screen for assistant"
            onClick={onCaptureScreen}
            title="Capture screenshot (Shift+S) for assistant"
            style={{ position: "relative" }}
          >
            <Camera size={17} />
            {imagesCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: "-2px",
                  right: "-2px",
                  background: "#38bdf8",
                  color: "#0f172a",
                  borderRadius: "10px",
                  fontSize: "9px",
                  fontWeight: "bold",
                  padding: "1px 4px",
                  lineHeight: "1",
                }}
              >
                {imagesCount}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="Paste screenshot bundle into active page"
          disabled={!tab || (bundleImages.length === 0 && !bundleNote)}
          onClick={handlePasteBundle}
          title={
            bundleImages.length > 0
              ? `Paste bundle (${bundleImages.length} screenshots) into ChatGPT / Claude / Gemini page (Ctrl+Shift+B)`
              : "Paste current notes into page (Ctrl+Shift+B)"
          }
          style={{ position: "relative" }}
        >
          <ClipboardPaste size={17} />
          {bundleImages.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: "-2px",
                right: "-2px",
                background: "#22c55e",
                color: "#0f172a",
                borderRadius: "10px",
                fontSize: "9px",
                fontWeight: "bold",
                padding: "1px 4px",
                lineHeight: "1",
              }}
            >
              {bundleImages.length}
            </span>
          )}
        </button>
      </form>
      {showFind && (
        <form
          className="browser-find"
          onSubmit={(event) => {
            event.preventDefault();
            void command("find", { text: find, next: true });
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeFind();
            }
          }}
        >
          <input
            autoFocus
            aria-label="Find text in page"
            value={find}
            onChange={(event) => {
              setFind(event.target.value);
              void command("find", { text: event.target.value });
            }}
          />
          <button className="button">Next</button>
          <button
            type="button"
            className="button"
            onClick={() =>
              command("find", { text: find, next: true, forward: false })
            }
          >
            Previous
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close find"
            onClick={closeFind}
          >
            <X size={16} />
          </button>
        </form>
      )}
      {showDownloads && (
        <div className="browser-downloads">
          <strong>Downloads</strong>
          {!state.downloads.length && (
            <p>
              No downloads this session. Files you save stay in your chosen
              folder.
            </p>
          )}
          {state.downloads.map((d) => (
            <div key={d.id}>
              <span>
                {d.name} — {d.state} ({Math.round(d.received / 1024)} /{" "}
                {Math.round(d.total / 1024)} KB)
              </span>
              {d.state === "progressing" && (
                <button
                  className="button"
                  onClick={() => command("download.cancel", { id: d.id })}
                >
                  Cancel download
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {tab?.error && (
        <div className="browser-error" role="alert">
          {tab.error}{" "}
          <button className="button" onClick={() => command("reload")}>
            Try again
          </button>
        </div>
      )}
      {!tab && (
        <div className="browser-empty">
          <Globe size={38} />
          <h2>Your browser, inside LensDesk.</h2>
          <p>
            Open a tab or enter an address above. Website sign-ins stay separate
            from your workspace.
          </p>
          <button className="button primary" onClick={() => command("open")}>
            Open browser tab <ExternalLink size={15} />
          </button>
        </div>
      )}
      <div
        className="browser-viewport"
        ref={viewport}
        hidden={!tab}
        tabIndex={-1}
        onClick={() => {
          void command("focus");
        }}
        onMouseDown={() => {
          void command("focus");
        }}
        aria-label="Web page viewport"
      />
      <div className="browser-footnote">
        {tab?.url.startsWith("http:")
          ? "HTTP connection — do not enter sensitive information."
          : "Websites use their own privacy policies and permissions."}{" "}
        Browsing does not send pages to AI.
      </div>
    </section>
  );
}
