import React, { useEffect, useRef, useState } from "react";
import {
  X,
  RotateCcw,
  Power,
  ChevronRight,
  ChevronDown,
  Trash2,
} from "lucide-react";
import type { Settings, Provider } from "./types";
import { api } from "./api";
import { cloud } from "./cloud";

export interface HintLensSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => Promise<unknown>;
  desktopPreferences?: any;
  onSaveDesktopPreferences?: (prefs: any) => Promise<void>;
  onRestart?: () => void;
  onQuit?: () => void;
  initialTab?: string;
  keys?: Record<string, boolean>;
  onRefresh?: () => unknown;
}

// These are LensDesk's defaults, not the customized prompt in the reference photo.
export const DEFAULT_HINTLENS_SYSTEM_PROMPT =
  "Give clear, practical answers. Explain your reasoning, state assumptions, and ask for clarification when needed.";
export const DEFAULT_HINTLENS_HOTKEYS: Record<string, string> = {
  toggle: "CommandOrControl+Shift+L",
  hide: "Shift+H",
  capture: "CommandOrControl+Shift+S",
  overlay: "CommandOrControl+Shift+O",
  hideAnswer: "CommandOrControl+Shift+A",
  autoType: "CommandOrControl+Shift+T",
  stopTyping: "CommandOrControl+Alt+Escape",
  clickThrough: "Shift+M",
  getAnswer: "",
  regionSnip: "",
  undo: "",
  clearBundle: "",
  clearChat: "",
  cancelAnswer: "",
  cycleProvider: "",
  cycleModel: "",
  browser: "",
  mouseMode: "",
  shortcuts: "",
  moveUp: "",
  moveDown: "",
  moveLeft: "",
  moveRight: "",
  scrollUp: "",
  scrollDown: "",
  stealth: "",
  theme: "",
  opacityUp: "Shift+I",
  opacityDown: "Shift+J",
  restart: "",
  quit: "",
  clearLastCapture: "",
  clearCaptures: "",
};
const tabs = [
  "Model",
  "Appearance",
  "Capture",
  "Typing",
  "Hotkeys",
  "Mouse",
  "Browser",
  "Local LLM",
  "Account",
];
const groups: Record<string, [string, string][]> = {
  "Core Actions": [
    ["getAnswer", "Get Answer"],
    ["capture", "Capture Screenshot"],
    ["regionSnip", "Select Screenshot Region"],
    ["undo", "Clear Last Screenshot"],
    ["clearBundle", "Clear Screenshot Bundle"],
    ["clearChat", "Clear Chat / Responses"],
    ["cancelAnswer", "Stop / Cancel Answer"],
    ["autoType", "Type / Stop Typing"],
    ["stopTyping", "Stop Typing"],
    ["cycleProvider", "Cycle AI Provider"],
    ["cycleModel", "Cycle AI Model"],
  ],
  "Browser Mode": [["browser", "Open / Close Browser"]],
  "Window Management": [
    ["toggle", "Show / Hide Window"],
    ["hide", "Hide / Restore Window"],
    ["overlay", "Toggle Floating Window"],
    ["hideAnswer", "Hide / Reveal Answer"],
    ["mouseMode", "Toggle Mouse Mode"],
    ["clickThrough", "Toggle Click Through"],
    ["shortcuts", "Open / Close Hotkey Settings"],
    ["moveUp", "Move Window Up"],
    ["moveDown", "Move Window Down"],
    ["moveLeft", "Move Window Left"],
    ["moveRight", "Move Window Right"],
    ["scrollUp", "Scroll Answer Up"],
    ["scrollDown", "Scroll Answer Down"],
  ],
  Appearance: [
    ["stealth", "Toggle OS Capture Protection Request"],
    ["theme", "Toggle Light / Dark Theme"],
    ["opacityUp", "Increase Background Opacity"],
    ["opacityDown", "Decrease Background Opacity"],
  ],
  Application: [
    ["restart", "Restart Application"],
    ["quit", "Quit Application"],
  ],
};
const defaultMouse = {
  enabled: false,
  trigger: "middle",
  size: 100,
  opacity: 85,
  holdMs: 0,
  style: "wheel",
  slots: 6,
  mappings: {
    1: "getAnswer",
    2: "capture",
    3: "autoType",
    4: "undo",
    5: "hide",
    6: "snip",
    7: "browser",
    8: "settings",
  } as Record<number, string>,
};
const providers: [Provider, string, string][] = [
  ["openai", "OpenAI (Fast - gpt-4o-mini)", "gpt-4o-mini"],
  ["groq", "Groq (Ultra-Fast - LLaMA 3.3)", "llama-3.3-70b-versatile"],
  ["gemini", "Google Gemini (Fast - 3.5-flash-lite)", "gemini-3.5-flash-lite"],
  ["anthropic", "Anthropic (Fast - Haiku 3.5)", "claude-3-5-haiku-20241022"],
  ["deepseek", "DeepSeek (V3 Chat)", "deepseek-chat"],
  ["local", "Local LLM", "llama3.2"],
];
const editableKeys: (keyof Settings)[] = [
  "provider",
  "model",
  "localBaseUrl",
  "systemPrompt",
  "theme",
  "opacity",
  "captureProtection",
  "cloudScreenshotSync",
  "interviewLayout",
  "lightTextColor",
  "darkTextColor",
];
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function HintLensSettingsModal({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  desktopPreferences,
  onSaveDesktopPreferences,
  onRestart,
  onQuit,
  initialTab = "Hotkeys",
  keys,
  onRefresh,
}: HintLensSettingsModalProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [draft, setDraft] = useState(settings);
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>(keys || {});
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [prefs, setPrefs] = useState<any>(desktopPreferences || null);
  const [baseline, setBaseline] = useState<any>(desktopPreferences || null);
  const [settingsBase, setSettingsBase] = useState(settings);
  const [recording, setRecording] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "Core Actions": true,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [account, setAccount] = useState<any>(null),
    [accountError, setAccountError] = useState("");
  const [appInfo, setAppInfo] = useState<any>(null),
    [archive, setArchive] = useState<any>(null);
  const [displays, setDisplays] = useState<any[]>([]);
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [servers, setServers] = useState<any[]>([]),
    [modelBusy, setModelBusy] = useState(false);
  const [localHost, setLocalHost] = useState("127.0.0.1"),
    [localPort, setLocalPort] = useState("11434");
  const [connectedUrl, setConnectedUrl] = useState(""),
    [localModels, setLocalModels] = useState<{ id: string; name?: string }[]>(
      [],
    ),
    [localModel, setLocalModel] = useState("");
  const [lightHex, setLightHex] = useState(
      settings.lightTextColor || "#24384c",
    ),
    [darkHex, setDarkHex] = useState(settings.darkTextColor || "#e2eaf5");
  const [updateInfo, setUpdateInfo] = useState<{
    updateAvailable?: boolean;
    latestVersion?: string;
    artifact?: any;
    error?: string;
    checked?: boolean;
  } | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{
    percent: number;
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!window.lens?.on) return;
    const offProgress = window.lens.on?.(
      "desktop.updater.progress",
      (data: any) => {
        setUpdateProgress(data);
      },
    );
    const offAvailable = window.lens.on?.(
      "desktop.updater.available",
      (data: any) => {
        setUpdateInfo({ ...data, checked: true });
      },
    );
    return () => {
      offProgress?.();
      offAvailable?.();
    };
  }, []);

  const handleCheckUpdate = async () => {
    if (!window.lens) {
      setUpdateInfo({
        updateAvailable: false,
        error: "Auto-updater is active in the desktop application.",
        checked: true,
      });
      return;
    }
    setUpdateChecking(true);
    setUpdateInfo(null);
    try {
      const res = await window.lens.invoke("desktop.updater.check");
      setUpdateInfo({ ...res, checked: true });
    } catch (err: any) {
      setUpdateInfo({
        updateAvailable: false,
        error: err.message || "Failed to check for updates.",
        checked: true,
      });
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!window.lens || !updateInfo?.artifact) return;
    try {
      setUpdateProgress({ percent: 1, status: "Starting download..." });
      await window.lens.invoke("desktop.updater.downloadAndInstall", {
        artifact: updateInfo.artifact,
      });
    } catch (err: any) {
      setUpdateProgress(null);
      setNotice("Update failed: " + (err.message || String(err)));
    }
  };
  const modelRequest = useRef(0);
  const desktop = Boolean(window.lens);
  const nativeAvailable = desktop && Boolean(prefs);
  const mouse = {
    ...defaultMouse,
    ...prefs?.mouse,
    mappings: { ...defaultMouse.mappings, ...prefs?.mouse?.mappings },
  };
  const browser = {
    homePage: "https://www.google.com/",
    searchEngine: "google",
    zoom: 1,
    ...prefs?.browser,
  };
  const autoType = {
    speed: "human",
    codeOnly: true,
    delaySeconds: 1,
    wpm: 65,
    jitter: 0,
    pauses: 0,
    ...prefs?.autoType,
  };
  const capture = { mode: "active", displayId: "", ...prefs?.capture };
  const archivePrefs = {
    enabled: false,
    directory: "",
    ...prefs?.captureArchive,
  };
  const hotkeys = { ...DEFAULT_HINTLENS_HOTKEYS, ...prefs?.shortcuts };
  const dirty =
    editableKeys.some((key) => draft[key] !== settingsBase[key]) ||
    lightHex !== (settingsBase.lightTextColor || "#24384c") ||
    darkHex !== (settingsBase.darkTextColor || "#e2eaf5") ||
    !same(prefs, baseline);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    setDraft(settings);
    setSettingsBase(settings);
    if (keys) setSavedKeys(keys);
    setKeyDraft("");
    setLightHex(settings.lightTextColor || "#24384c");
    setDarkHex(settings.darkTextColor || "#e2eaf5");
    setPrefs(desktopPreferences || null);
    setBaseline(desktopPreferences || null);
    setError("");
    setNotice("");
    setRecording(null);
    let live = true;
    void api("state")
      .then((st: any) => {
        if (live && st?.keys) {
          setSavedKeys(st.keys);
        }
      })
      .catch(() => {});
    if (desktop) {
      void api("desktop.preferences")
        .then((value) => {
          if (live) {
            setPrefs(value);
            setBaseline(value);
          }
        })
        .catch((err) => {
          if (live) setError(errorText(err));
        });
      void api("desktop.info")
        .then((value) => {
          if (live) setAppInfo(value);
        })
        .catch(() => {
          if (live) setAppInfo(null);
        });
      void api("desktop.displays")
        .then((value) => {
          if (live)
            setDisplays(Array.isArray(value) ? value : value.displays || []);
        })
        .catch((err) => {
          if (live) setError(errorText(err));
        });
      void api("desktop.captureArchive.status")
        .then((value) => {
          if (live) setArchive(value);
        })
        .catch(() => {
          if (live) setArchive(null);
        });
    }
    void cloud("cloud.state")
      .then((value) => {
        if (live) {
          setAccount(value);
          setAccountError("");
        }
      })
      .catch((err) => {
        if (live) {
          setAccount(null);
          setAccountError(errorText(err));
        }
      });
    try {
      const url = new URL(settings.localBaseUrl || "http://127.0.0.1:11434/v1");
      setLocalHost(url.hostname);
      setLocalPort(url.port || (url.protocol === "https:" ? "443" : "80"));
    } catch {
      /* editable server defaults remain visible */
    }
    return () => {
      live = false;
      modelRequest.current++;
    };
  }, [isOpen]);
  useEffect(() => {
    modelRequest.current++;
    setModels([]);
    setModelBusy(false);
  }, [draft.provider, draft.localBaseUrl]);
  if (!isOpen) return null;

  function patchPrefs(section: string, value: Record<string, unknown>) {
    setPrefs((old: any) => ({
      ...old,
      [section]: { ...old?.[section], ...value },
    }));
  }
  function changeSetting(patch: Partial<Settings>) {
    setDraft((old) => ({ ...old, ...patch }));
    setNotice("");
  }
  function close() {
    if (!dirty || window.confirm("Discard unsaved settings changes?"))
      onClose();
  }
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await run(async () => {
      if (!/^#[0-9a-f]{6}$/i.test(lightHex) || !/^#[0-9a-f]{6}$/i.test(darkHex))
        throw new Error(
          "Text colors must be a # followed by six hexadecimal digits.",
        );
      if (
        (draft.systemPrompt || "").length > 2000 &&
        draft.systemPrompt !== settingsBase.systemPrompt
      )
        throw new Error(
          "The edited system prompt must be at most 2,000 characters.",
        );
      const next = {
        ...draft,
        opacity: Math.max(0.1, Math.min(1, draft.opacity ?? 0.5)),
        lightTextColor: lightHex,
        darkTextColor: darkHex,
      };
      const patch = Object.fromEntries(
        editableKeys
          .filter((key) => next[key] !== settingsBase[key])
          .map((key) => [key, next[key]]),
      ) as Partial<Settings>;
      if (patch.opacity !== undefined) {
        patch.opacity = Math.max(0.1, Math.min(1, patch.opacity));
      }
      // Save native preferences first; registration errors reject without showing success.
      if (desktop && prefs && !same(prefs, baseline)) {
        if (onSaveDesktopPreferences) await onSaveDesktopPreferences(prefs);
        else await api("desktop.preferences.save", prefs);
        const saved = await api("desktop.preferences");
        setPrefs(saved);
        setBaseline(saved);
      }
      if (Object.keys(patch).length) await onSaveSettings(patch);
      setDraft(next);
      setSettingsBase(next);
      setNotice("Settings saved.");
      if (desktop) {
        await api("desktop.appearance").catch(() => {});
        setArchive(
          await api("desktop.captureArchive.status").catch(() => null),
        );
      }
    });
  }
  function record(action: string, event: React.KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(null);
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
    if (!(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) {
      setError("Include Control, Command, Shift, or Alt in the shortcut.");
      return;
    }
    const mapped: Record<string, string> = {
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      " ": "Space",
      "+": "Plus",
    };
    const parts = [
      event.ctrlKey && "Control",
      event.metaKey && "Command",
      event.altKey && "Alt",
      event.shiftKey && "Shift",
      mapped[event.key] ||
        (event.key.length === 1 ? event.key.toUpperCase() : event.key),
    ].filter(Boolean);
    const value = parts.join("+");
    const normalize = (key: string) =>
      key
        .toLowerCase()
        .replaceAll(
          "commandorcontrol",
          window.lens?.platform === "darwin" ? "command" : "control",
        )
        .replaceAll("cmd", "command")
        .replaceAll("ctrl", "control");
    if (
      Object.entries(hotkeys).some(
        ([key, old]) =>
          key !== action &&
          old &&
          normalize(old as string) === normalize(value),
      )
    ) {
      setError(
        "This shortcut is already assigned. Choose another combination.",
      );
      return;
    }
    patchPrefs("shortcuts", { [action]: value });
    setRecording(null);
    setError("");
  }
  async function loadModels() {
    const token = ++modelRequest.current;
    setModelBusy(true);
    setError("");
    try {
      const result = await api("model.list", {
        provider: draft.provider,
        localBaseUrl: draft.localBaseUrl,
      });
      if (modelRequest.current === token) {
        setModels(result.models || []);
        setNotice(`${result.models?.length || 0} available models returned.`);
      }
    } catch (err) {
      if (modelRequest.current === token) setError(errorText(err));
    } finally {
      if (modelRequest.current === token) setModelBusy(false);
    }
  }
  async function detect() {
    await run(async () => {
      const result = await api("desktop.models.detect");
      setServers(result.servers || []);
      setNotice(
        result.servers?.length
          ? "Choose a detected server, then a model. Detection has not changed your settings."
          : "No compatible local server was found. Start a server or enter its host and port.",
      );
    });
  }
  async function connect() {
    await run(async () => {
      if (!/^\d+$/.test(localPort) || +localPort < 1 || +localPort > 65535)
        throw new Error("Enter a port between 1 and 65,535.");
      if (!localHost.trim() || /[\s/@?#]/.test(localHost))
        throw new Error(
          "Enter a host name or IP address without a path or credentials.",
        );
      const host =
        localHost.includes(":") && !localHost.startsWith("[")
          ? `[${localHost}]`
          : localHost;
      const url = new URL(`http://${host}:${localPort}/v1`).href.replace(
        /\/$/,
        "",
      );
      const result = await api("model.list", {
        provider: "local",
        localBaseUrl: url,
      });
      setConnectedUrl(url);
      setLocalModels(result.models || []);
      setLocalModel(result.models?.[0]?.id || "");
      setNotice(
        `${result.models?.length || 0} models returned from ${url}. Choose Use selected model to update your settings.`,
      );
    });
  }
  const label = (title: string, child: React.ReactNode) => (
    <label className="form-group">
      <span className="hintlens-label">{title}</span>
      {child}
    </label>
  );
  const range = (
    title: string,
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
    suffix = "%",
  ) => (
    <label className="slider-control-group">
      <span className="slider-label">
        {title}: {value}
        {suffix}
      </span>
      <input
        aria-label={title}
        className="hintlens-range"
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={!nativeAvailable || busy}
      />
    </label>
  );

  return (
    <div className="hintlens-modal-overlay">
      <section
        className="hintlens-settings-window"
        role="dialog"
        aria-modal="true"
        aria-label="LensDesk Settings"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !recording) close();
        }}
      >
        <div className="hintlens-modal-titlebar">
          <span className="settings-title-text">⚙ Settings</span>
          <button
            type="button"
            className="hintlens-modal-close-btn"
            onClick={close}
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>
        <div className="hintlens-modal-body">
          <aside
            className="hintlens-nav-sidebar"
            aria-label="Settings sections"
          >
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab}
                className={`hintlens-nav-item ${activeTab === tab ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab);
                  setRecording(null);
                }}
              >
                {tab}
              </button>
            ))}
          </aside>
          <main className="hintlens-tab-content">
            {error && (
              <p role="alert" className="auth-error-banner">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {activeTab === "Model" && (
              <div className="hintlens-pane">
                <h3 className="pane-heading">Model</h3>
                <p className="pane-subtext">
                  Choose a provider and a model available to your account. Save
                  settings to apply changes.
                </p>
                {label(
                  "Provider",
                  <select
                    aria-label="AI provider"
                    className="hintlens-select"
                    value={draft.provider}
                    onChange={(event) => {
                      const provider = event.target.value as Provider;
                      changeSetting({
                        provider,
                        model:
                          providers.find(([id]) => id === provider)?.[2] ||
                          draft.model,
                      });
                    }}
                  >
                    {providers.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>,
                )}
                {draft.provider !== "local" &&
                  label(
                    "API key",
                    <div className="key-field">
                      <input
                        aria-label="API key"
                        type="password"
                        autoComplete="off"
                        className="hintlens-input"
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        placeholder={
                          savedKeys[draft.provider] || keys?.[draft.provider]
                            ? "Key saved · enter a replacement"
                            : "Paste your provider API key"
                        }
                      />
                      <button
                        type="button"
                        className="hintlens-btn secondary"
                        disabled={!keyDraft.trim() || busy || keyBusy}
                        onClick={() =>
                          run(async () => {
                            if (!keyDraft.trim()) return;
                            setKeyBusy(true);
                            try {
                              await api("key.save", {
                                provider: draft.provider,
                                key: keyDraft.trim(),
                              });
                              await onSaveSettings({
                                provider: draft.provider,
                                model:
                                  draft.model ||
                                  providers.find(
                                    ([id]) => id === draft.provider,
                                  )?.[2] ||
                                  "",
                              });
                              setSavedKeys((prev) => ({
                                ...prev,
                                [draft.provider]: true,
                              }));
                              setKeyDraft("");
                              if (onRefresh) {
                                await onRefresh();
                              }
                              setNotice(
                                `${
                                  providers.find(
                                    ([id]) => id === draft.provider,
                                  )?.[1] || draft.provider
                                } API key saved.`,
                              );
                            } finally {
                              setKeyBusy(false);
                            }
                          })
                        }
                      >
                        {keyBusy ? "Saving…" : "Save key"}
                      </button>
                    </div>,
                  )}
                {label(
                  "Model ID (auto-selected)",
                  <input
                    aria-label="Model ID"
                    className="hintlens-input"
                    value={
                      draft.model ||
                      providers.find(([id]) => id === draft.provider)?.[2] ||
                      ""
                    }
                    placeholder={
                      providers.find(([id]) => id === draft.provider)?.[2] ||
                      "Auto-selected"
                    }
                    maxLength={100}
                    onChange={(event) =>
                      changeSetting({ model: event.target.value })
                    }
                  />,
                )}
                <button
                  type="button"
                  className="hintlens-btn secondary"
                  disabled={modelBusy || busy}
                  onClick={loadModels}
                >
                  {modelBusy ? "Loading…" : "Load available models"}
                </button>
                {models.length > 0 &&
                  label(
                    "Available models",
                    <select
                      aria-label="Available models"
                      className="hintlens-select"
                      value={draft.model}
                      onChange={(event) =>
                        changeSetting({ model: event.target.value })
                      }
                    >
                      <option value={draft.model}>{draft.model}</option>
                      {models
                        .filter((model) => model.id !== draft.model)
                        .map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name || model.id}
                          </option>
                        ))}
                    </select>,
                  )}
                <button
                  type="button"
                  className="hintlens-btn secondary"
                  disabled={busy || modelBusy || !draft.model.trim()}
                  onClick={() =>
                    run(async () => {
                      const result = await api("model.test", {
                        provider: draft.provider,
                        model: draft.model,
                        localBaseUrl: draft.localBaseUrl,
                      });
                      setNotice(`Connection works: ${result.preview}`);
                    })
                  }
                >
                  Test selected model
                </button>
                <p className="field-hint">
                  Testing generates a small response and may use paid provider
                  quota. Local models run on the server you configure.
                </p>
                {label(
                  "System Prompt",
                  <textarea
                    aria-label="System Prompt"
                    className="hintlens-textarea"
                    rows={7}
                    maxLength={Math.max(2000, (settingsBase?.systemPrompt || "").length)}
                    value={draft.systemPrompt || ""}
                    onChange={(event) =>
                      changeSetting({ systemPrompt: event.target.value })
                    }
                  />,
                )}
                <div className="textarea-footer">
                  <span>
                    {(draft.systemPrompt || "").length} / 2000 characters
                    {(draft.systemPrompt || "").length > 2000 &&
                      " · existing longer prompt retained; edited prompts require 2,000 or fewer"}
                  </span>
                  <button
                    type="button"
                    className="reset-inline-btn"
                    onClick={() =>
                      changeSetting({
                        systemPrompt: DEFAULT_HINTLENS_SYSTEM_PROMPT,
                      })
                    }
                  >
                    <RotateCcw size={12} /> Reset to default
                  </button>
                </div>
              </div>
            )}
            {activeTab === "Appearance" && (
              <div className="hintlens-pane">
                <h3 className="pane-heading">Appearance</h3>
                {label(
                  "Theme",
                  <select
                    aria-label="Color theme"
                    className="hintlens-select"
                    value={draft.theme || "system"}
                    onChange={(event) =>
                      changeSetting({
                        theme: event.target.value as Settings["theme"],
                      })
                    }
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>,
                )}
                {label(
                  `Background opacity: ${Math.max(10, Math.round((draft.opacity ?? 0.5) * 100))}%`,
                  <input
                    aria-label="Background opacity"
                    type="range"
                    min={10}
                    max={100}
                    step={1}
                    value={Math.max(10, Math.round((draft.opacity ?? 0.5) * 100))}
                    onChange={(event) =>
                      changeSetting({
                        opacity: Math.max(
                          0.1,
                          Math.min(1, Number(event.target.value) / 100),
                        ),
                      })
                    }
                  />,
                )}
                <button
                  type="button"
                  className="reset-inline-btn"
                  onClick={() => changeSetting({ opacity: 1 })}
                >
                  Restore 100% opacity
                </button>
                <p className="field-hint">
                  Minimum opacity is 10%. Press Shift+I to increase or Shift+J to decrease.
                </p>
                <label className="checkbox-row">
                  <input
                    aria-label="OS capture protection request"
                    type="checkbox"
                    checked={draft.captureProtection}
                    onChange={(event) =>
                      changeSetting({ captureProtection: event.target.checked })
                    }
                  />{" "}
                  Request OS capture protection
                </label>
                <p className="field-hint">
                  Requests the operating system's window capture protection.
                  Recording apps and newer macOS capture APIs may still capture
                  this window.
                </p>
                {desktop && (
                  <>
                    <label className="checkbox-row">
                      <input
                        aria-label="Stealth mode (Hide from Dock / Taskbar)"
                        type="checkbox"
                        checked={Boolean(prefs?.stealthDock)}
                        onChange={(event) =>
                          setPrefs((old: any) => ({
                            ...old,
                            stealthDock: event.target.checked,
                          }))
                        }
                      />{" "}
                      Stealth Mode (Hide from Dock, App Switcher, and Taskbar)
                    </label>
                    <p className="field-hint">
                      Completely hides LensDesk from the macOS Dock, Cmd+Tab switcher, and Windows taskbar. Control via hotkeys or tray icon.
                    </p>
                  </>
                )}
                {label(
                  "Interview layout",
                  <select
                    aria-label="Interview layout"
                    className="hintlens-select"
                    value={draft.interviewLayout || "full"}
                    onChange={(event) =>
                      changeSetting({
                        interviewLayout: event.target
                          .value as Settings["interviewLayout"],
                      })
                    }
                  >
                    <option value="full">Full</option>
                    <option value="compact">Compact</option>
                  </select>,
                )}
                <p className="hintlens-help-text">
                  Compact narrows the interview window to a single-line transcript with full-width answers. Applies to interview mode only.
                </p>
                <div className="color-pickers-row">
                  {(["light", "dark"] as const).map((theme) => {
                    const value = theme === "light" ? lightHex : darkHex;
                    const setValue =
                      theme === "light" ? setLightHex : setDarkHex;
                    const valid = /^#[0-9a-f]{6}$/i.test(value);
                    return (
                      <div key={theme} className="color-picker-box">
                        <span>
                          {theme === "light"
                            ? "Light mode text"
                            : "Dark mode text"}
                        </span>
                        <input
                          aria-label={`${theme} text color picker`}
                          type="color"
                          value={
                            valid
                              ? value
                              : theme === "light"
                                ? "#24384c"
                                : "#e2eaf5"
                          }
                          onChange={(event) => {
                            setValue(event.target.value);
                            changeSetting({
                              [theme === "light"
                                ? "lightTextColor"
                                : "darkTextColor"]: event.target.value,
                            });
                          }}
                        />
                        <input
                          aria-label={`${theme} text hex color`}
                          className="hex-input"
                          value={value}
                          maxLength={7}
                          aria-invalid={!valid}
                          onChange={(event) => {
                            setValue(event.target.value);
                            if (/^#[0-9a-f]{6}$/i.test(event.target.value))
                              changeSetting({
                                [theme === "light"
                                  ? "lightTextColor"
                                  : "darkTextColor"]: event.target.value,
                              });
                          }}
                        />
                        {!valid && (
                          <p role="alert">
                            Use a six-digit hex color, for example #24384c.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="reset-colors-btn"
                  onClick={() => {
                    setLightHex("#24384c");
                    setDarkHex("#e2eaf5");
                    changeSetting({
                      lightTextColor: "#24384c",
                      darkTextColor: "#e2eaf5",
                    });
                  }}
                >
                  Reset colors
                </button>
                <p className="field-hint">
                  Save settings to apply the theme, colors and layout.
                </p>
              </div>
            )}
            {activeTab === "Capture" && (
              <div className="hintlens-pane">
                <h3 className="pane-heading">Capture</h3>
                <fieldset disabled={!nativeAvailable || busy}>
                  <legend>Screenshot area</legend>
                  {[
                    ["active", "Active monitor (where the mouse is)"],
                    ["all", "All monitors"],
                    ["specific", "Specific monitor"],
                  ].map(([mode, title]) => (
                    <label key={mode} className="radio-label">
                      <input
                        aria-label={title}
                        type="radio"
                        name="screenshotArea"
                        checked={capture.mode === mode}
                        onChange={() => patchPrefs("capture", { mode })}
                      />
                      {title}
                    </label>
                  ))}
                  {capture.mode === "specific" &&
                    label(
                      "Monitor",
                      <select
                        aria-label="Capture monitor"
                        className="hintlens-select"
                        value={capture.displayId}
                        onChange={(event) =>
                          patchPrefs("capture", {
                            displayId: event.target.value,
                          })
                        }
                      >
                        <option value="">Choose a monitor</option>
                        {displays.map((display) => (
                          <option key={display.id} value={String(display.id)}>
                            {display.label || `Display ${display.id}`}
                          </option>
                        ))}
                      </select>,
                    )}
                  <p className="field-hint">
                    Screen capture requires OS permission. Protected application
                    content may be unavailable.
                  </p>
                  <button
                    type="button"
                    className="hintlens-btn secondary"
                    onClick={() =>
                      run(async () => {
                        const result = await api(
                          "desktop.captureArchive.choose",
                        );
                        if (!result.canceled)
                          patchPrefs("captureArchive", {
                            directory: result.directory,
                          });
                      })
                    }
                  >
                    Choose archive folder
                  </button>
                  <p className="field-hint">
                    {archivePrefs.directory || "No archive folder selected."}
                  </p>
                  <label className="checkbox-row">
                    <input
                      aria-label="Save screenshots to disk"
                      type="checkbox"
                      checked={archivePrefs.enabled}
                      disabled={!archivePrefs.directory}
                      onChange={(event) =>
                        patchPrefs("captureArchive", {
                          enabled: event.target.checked,
                        })
                      }
                    />{" "}
                    Save screenshots to disk
                  </label>
                  <p className="field-hint">
                    Saved PNG files remain in your chosen folder when this
                    option is turned off. Limit: 200 MB of LensDesk captures.
                  </p>
                  <label className="checkbox-row" style={{ marginTop: 14 }}>
                    <input
                      aria-label="Save answer history"
                      type="checkbox"
                      checked={draft.cloudScreenshotSync ?? true}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          cloudScreenshotSync: event.target.checked,
                        }))
                      }
                    />{" "}
                    Save answer history (Cloud Screenshot Sync)
                  </label>
                  <p className="field-hint">
                    Image plus AI answer stored to account per session in PostgreSQL cloud database. Web access and sign-in required.
                  </p>
                  <button
                    type="button"
                    className="hintlens-btn secondary"
                    disabled={!baseline?.captureArchive?.directory}
                    onClick={() =>
                      run(async () => {
                        await api("desktop.captureArchive.open");
                      })
                    }
                  >
                    Open archive
                  </button>
                  <button
                    type="button"
                    className="reset-inline-btn"
                    onClick={() =>
                      run(async () => {
                        setArchive(await api("desktop.captureArchive.status"));
                      })
                    }
                  >
                    Refresh storage usage
                  </button>
                  <p className="storage-text">
                    Storage used:{" "}
                    {archive
                      ? `${(archive.bytes / 1024 / 1024).toFixed(2)} MB · ${archive.files} captures`
                      : "Unavailable"}
                  </p>
                </fieldset>
                {!nativeAvailable && (
                  <p className="field-hint">
                    Monitor selection and local screenshot archives require the
                    desktop app.
                  </p>
                )}
                <label className="checkbox-row">
                  <input type="checkbox" disabled checked={false} /> Save
                  screenshot answers automatically to cloud history
                </label>
                <p className="field-hint">
                  Automatic screenshot-history synchronization is unavailable.
                  Sessions already save locally; use the account page's explicit
                  cloud workspace upload when signed in.
                </p>
              </div>
            )}
            {activeTab === "Typing" && (
              <div className="hintlens-pane">
                <h3 className="pane-heading">Typing</h3>
                <p className="field-hint">
                  How the Type hotkey enters an answer into the focused app. Pick a preset, or fine-tune the pace and how human the typing looks. Changes apply to the next Type.
                </p>
                <fieldset disabled={!nativeAvailable || busy}>
                  <legend>Auto-typer</legend>
                  <div className="presets-row">
                    {[
                      ["Slow", 35],
                      ["Normal", 65],
                      ["Fast", 130],
                    ].map(([name, wpm]) => (
                      <button
                        key={name}
                        type="button"
                        className={`preset-btn ${autoType.wpm === wpm ? "active" : ""}`}
                        onClick={() =>
                          patchPrefs("autoType", { wpm, speed: "human" })
                        }
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  {range(
                    "Speed",
                    autoType.wpm,
                    10,
                    250,
                    (wpm) => patchPrefs("autoType", { wpm }),
                    " WPM",
                  )}
                  <p className="field-hint" style={{ fontSize: "11px", margin: "-4px 0 8px 0", opacity: 0.8 }}>
                    Typing pace in words per minute. The real speed varies a little around this so it never looks mechanical.
                  </p>
                  {range(
                    "Jitter",
                    autoType.jitter,
                    0,
                    100,
                    (jitter) => patchPrefs("autoType", { jitter }),
                    "%",
                  )}
                  <p className="field-hint" style={{ fontSize: "11px", margin: "-4px 0 8px 0", opacity: 0.8 }}>
                    Keystroke-to-keystroke timing variation (log-normal, like real typing). 0% is metronome-steady; higher makes the rhythm more uneven.
                  </p>
                  {range(
                    "Mistakes",
                    autoType.mistakes ?? 0,
                    0,
                    100,
                    (mistakes) => patchPrefs("autoType", { mistakes }),
                    "%",
                  )}
                  <p className="field-hint" style={{ fontSize: "11px", margin: "-4px 0 8px 0", opacity: 0.8 }}>
                    How often it makes and fixes human-like typos/slips. 0% types flawlessly; higher adds more slips and corrections.
                  </p>
                  {range(
                    "Pauses",
                    autoType.pauses,
                    0,
                    100,
                    (pauses) => patchPrefs("autoType", { pauses }),
                    "%",
                  )}
                  <p className="field-hint" style={{ fontSize: "11px", margin: "-4px 0 8px 0", opacity: 0.8 }}>
                    Thinking pauses at words, punctuation and new lines. 0% types straight through; higher adds more hesitation.
                  </p>
                  {label(
                    "Start delay (seconds)",
                    <input
                      aria-label="Typing start delay"
                      className="hintlens-input"
                      type="number"
                      min={0}
                      max={10}
                      value={autoType.delaySeconds}
                      onChange={(event) =>
                        patchPrefs("autoType", {
                          delaySeconds: Number(event.target.value),
                        })
                      }
                    />,
                  )}
                  <label className="checkbox-row">
                    <input
                      aria-label="Type code only"
                      type="checkbox"
                      checked={autoType.codeOnly}
                      onChange={(event) =>
                        patchPrefs("autoType", {
                          codeOnly: event.target.checked,
                        })
                      }
                    />{" "}
                    Type code blocks only when present
                  </label>
                </fieldset>
                {!nativeAvailable && (
                  <p className="field-hint">
                    Typing into other applications requires the desktop app and
                    OS Accessibility permission.
                  </p>
                )}
              </div>
            )}
            {activeTab === "Hotkeys" && (
              <div className="hintlens-pane">
                <div className="hotkeys-header-row">
                  <h3 className="pane-heading">Hotkeys</h3>
                  <button
                    type="button"
                    className="reset-inline-btn"
                    disabled={!nativeAvailable || busy}
                    onClick={() => {
                      patchPrefs("shortcuts", DEFAULT_HINTLENS_HOTKEYS);
                      setRecording(null);
                    }}
                  >
                    Reset defaults
                  </button>
                </div>
                <p className="pane-subtext">
                  Click a binding and press a combination with Control, Command,
                  Shift or Alt. Escape cancels recording. Save settings to
                  register changes.
                </p>
                {!nativeAvailable && (
                  <p className="field-hint">
                    Global shortcut customization requires the desktop app.
                  </p>
                )}
                <div className="accordion-container">
                  {Object.entries(groups).map(([group, rows]) => (
                    <div className="accordion-item" key={group}>
                      <button
                        type="button"
                        className="accordion-header"
                        aria-expanded={Boolean(expanded[group])}
                        onClick={() =>
                          setExpanded({
                            ...expanded,
                            [group]: !expanded[group],
                          })
                        }
                      >
                        {expanded[group] ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        {group}
                      </button>
                      {expanded[group] && (
                        <div className="accordion-body">
                          {rows.map(([key, title]) => (
                            <div className="binding-row" key={key}>
                              <span className="binding-label">{title}</span>
                              <button
                                type="button"
                                aria-label={`Record shortcut for ${title}`}
                                disabled={!nativeAvailable || busy}
                                className={`binding-key-btn ${recording === key ? "recording" : ""}`}
                                onClick={() => setRecording(key)}
                                onKeyDown={(event) => {
                                  if (recording === key) record(key, event);
                                }}
                              >
                                {recording === key
                                  ? "Press keys…"
                                  : hotkeys[key] || "Unassigned"}
                              </button>
                              {!DEFAULT_HINTLENS_HOTKEYS[key] &&
                                hotkeys[key] && (
                                  <button
                                    type="button"
                                    className="reset-inline-btn"
                                    aria-label={`Disable shortcut for ${title}`}
                                    disabled={!nativeAvailable || busy}
                                    onClick={() =>
                                      patchPrefs("shortcuts", { [key]: "" })
                                    }
                                  >
                                    Disable
                                  </button>
                                )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="field-hint">
                  OS-reserved or conflicting global shortcuts may fail
                  registration. They cannot override another app's security
                  controls.
                </p>
              </div>
            )}
            {activeTab === "Mouse" && (
              <div className="hintlens-pane">
                <h3 className="pane-heading">Mouse</h3>
                <p className="field-hint">
                  The radial action wheel works inside the LensDesk window. It
                  does not install a system-wide mouse hook.
                </p>
                <fieldset disabled={!nativeAvailable || busy}>
                  <legend>Radial action wheel</legend>
                  <label className="checkbox-row">
                    <input
                      aria-label="Enable mouse gestures"
                      type="checkbox"
                      checked={mouse.enabled}
                      onChange={(event) =>
                        patchPrefs("mouse", { enabled: event.target.checked })
                      }
                    />
                    Enable mouse gestures
                  </label>
                  {label(
                    "Trigger",
                    <select
                      aria-label="Mouse gesture trigger"
                      className="hintlens-select"
                      value={mouse.trigger}
                      onChange={(event) =>
                        patchPrefs("mouse", { trigger: event.target.value })
                      }
                    >
                      <option value="middle">
                        Middle button (wheel click)
                      </option>
                      <option value="right">Right button</option>
                    </select>,
                  )}
                  {range("Wheel size", mouse.size, 50, 150, (size) =>
                    patchPrefs("mouse", { size }),
                  )}
                  {range("Wheel opacity", mouse.opacity, 10, 100, (opacity) =>
                    patchPrefs("mouse", { opacity }),
                  )}
                  {range(
                    "Hold to open",
                    mouse.holdMs,
                    0,
                    1000,
                    (holdMs) => patchPrefs("mouse", { holdMs }),
                    " ms",
                  )}
                  {label(
                    "Style",
                    <select
                      aria-label="Mouse gesture style"
                      className="hintlens-select"
                      value={mouse.style}
                      onChange={(event) =>
                        patchPrefs("mouse", { style: event.target.value })
                      }
                    >
                      <option value="wheel">Wheel</option>
                      <option value="flick">Flick</option>
                    </select>,
                  )}
                  {label(
                    "Slots",
                    <select
                      aria-label="Mouse gesture slots"
                      className="hintlens-select"
                      value={mouse.slots}
                      onChange={(event) =>
                        patchPrefs("mouse", {
                          slots: Number(event.target.value),
                        })
                      }
                    >
                      {[4, 6, 8].map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>,
                  )}
                  {Array.from(
                    { length: mouse.slots },
                    (_, index) => index + 1,
                  ).map((slot) =>
                    label(
                      `Slot ${slot}`,
                      <select
                        key={slot}
                        aria-label={`Mouse slot ${slot}`}
                        className="hintlens-select"
                        value={mouse.mappings[slot]}
                        onChange={(event) =>
                          patchPrefs("mouse", {
                            mappings: {
                              ...mouse.mappings,
                              [slot]: event.target.value,
                            },
                          })
                        }
                      >
                        {[
                          ["getAnswer", "Get Answer"],
                          ["capture", "Capture"],
                          ["autoType", "Type"],
                          ["undo", "Undo Shot"],
                          ["hide", "Hide/Show"],
                          ["snip", "Snip"],
                          ["browser", "Browser"],
                          ["settings", "Settings"],
                        ].map(([value, title]) => (
                          <option key={value} value={value}>
                            {title}
                          </option>
                        ))}
                      </select>,
                    ),
                  )}
                  <button
                    type="button"
                    className="reset-inline-btn"
                    onClick={() =>
                      patchPrefs("mouse", {
                        ...defaultMouse,
                        enabled: mouse.enabled,
                      })
                    }
                  >
                    Reset mouse defaults
                  </button>
                  <p className="field-hint">
                    Reset restores the trigger, size, opacity, hold time, style,
                    slots and actions. It preserves the enable toggle. Release
                    in the center to cancel.
                  </p>
                </fieldset>
              </div>
            )}
            {activeTab === "Browser" && (
              <div className="hintlens-pane">
                <h3 className="pane-heading">Browser</h3>
                <fieldset disabled={!nativeAvailable || busy}>
                  <legend>Browser preferences</legend>
                  <div className="preset-buttons">
                    {[
                      ["Google", "https://www.google.com/"],
                      ["ChatGPT", "https://chatgpt.com/"],
                      ["Gemini", "https://gemini.google.com/"],
                      ["Claude", "https://claude.ai/"],
                    ].map(([name, homePage]) => (
                      <button
                        type="button"
                        className={`preset-btn ${browser.homePage === homePage ? "active" : ""}`}
                        key={name}
                        onClick={() => patchPrefs("browser", { homePage })}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  {label(
                    "Home page",
                    <input
                      aria-label="Browser home page"
                      className="hintlens-input"
                      type="url"
                      maxLength={2048}
                      value={browser.homePage}
                      onChange={(event) =>
                        patchPrefs("browser", { homePage: event.target.value })
                      }
                    />,
                  )}
                  {label(
                    "Search engine",
                    <select
                      aria-label="Browser search engine"
                      className="hintlens-select"
                      value={browser.searchEngine}
                      onChange={(event) =>
                        patchPrefs("browser", {
                          searchEngine: event.target.value,
                        })
                      }
                    >
                      <option value="google">Google</option>
                      <option value="bing">Bing</option>
                      <option value="duckduckgo">DuckDuckGo</option>
                    </select>,
                  )}
                  {range(
                    "Page zoom",
                    Math.round(browser.zoom * 100),
                    50,
                    250,
                    (zoom) => patchPrefs("browser", { zoom: zoom / 100 }),
                  )}
                  <button
                    type="button"
                    className="hintlens-btn secondary"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Clear the embedded browser's cookies, cache and saved site data? This signs you out of websites in that browser.",
                        )
                      )
                        void run(async () => {
                          await api("browser.clearData");
                          setNotice("Embedded browser data cleared.");
                        });
                    }}
                  >
                    <Trash2 size={13} /> Clear browsing data
                  </button>
                  <p className="field-hint">
                    This affects the embedded browser's website sessions. Your
                    LensDesk account and local workspace are retained.
                  </p>
                </fieldset>
                {!nativeAvailable && (
                  <p className="field-hint">
                    The embedded browser requires the desktop app.
                  </p>
                )}
              </div>
            )}
            {activeTab === "Local LLM" && (
              <div className="hintlens-pane">
                <h3 className="pane-heading">Local LLM</h3>
                <p className="field-hint">
                  Connect to Ollama, LM Studio, llama.cpp or vLLM using its
                  OpenAI-compatible endpoint. Prompts are sent to that server;
                  use a trusted local or LAN server.
                </p>
                <fieldset disabled={!desktop || busy}>
                  <legend>Server</legend>
                  <div className="engine-tabs-row">
                    {[
                      ["Ollama", "11434"],
                      ["LM Studio", "1234"],
                      ["llama.cpp", "8080"],
                      ["vLLM", "8000"],
                    ].map(([name, port]) => (
                      <button
                        type="button"
                        className="engine-tab-btn"
                        key={name}
                        onClick={() => {
                          setLocalPort(port);
                          setConnectedUrl("");
                          setLocalModels([]);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  {label(
                    "Host",
                    <input
                      aria-label="Local model host"
                      className="hintlens-input"
                      value={localHost}
                      onChange={(event) => {
                        setLocalHost(event.target.value);
                        setConnectedUrl("");
                        setLocalModels([]);
                      }}
                    />,
                  )}
                  {label(
                    "Port",
                    <input
                      aria-label="Local model port"
                      className="hintlens-input"
                      inputMode="numeric"
                      value={localPort}
                      onChange={(event) => {
                        setLocalPort(event.target.value);
                        setConnectedUrl("");
                        setLocalModels([]);
                      }}
                    />,
                  )}
                  <button
                    type="button"
                    className="hintlens-btn secondary"
                    onClick={detect}
                  >
                    Detect
                  </button>
                  <button
                    type="button"
                    className="hintlens-btn primary"
                    onClick={connect}
                  >
                    Connect
                  </button>
                  <p className="field-hint">
                    Detect checks this computer's ports 11434, 1234, 8080 and
                    8000. Connect uses exactly the host and port above. No
                    prompt is sent when listing models.
                  </p>
                  {servers.length > 0 &&
                    label(
                      "Detected server",
                      <select
                        aria-label="Detected local server"
                        className="hintlens-select"
                        value={connectedUrl}
                        onChange={(event) => {
                          const server = servers.find(
                            (item) => item.baseUrl === event.target.value,
                          );
                          if (!server) return;
                          const url = new URL(server.baseUrl);
                          setLocalHost(url.hostname);
                          setLocalPort(url.port);
                          setConnectedUrl(server.baseUrl);
                          setLocalModels(server.models || []);
                          setLocalModel(server.models?.[0]?.id || "");
                        }}
                      >
                        <option value="">Choose a detected server</option>
                        {servers.map((server) => (
                          <option key={server.baseUrl} value={server.baseUrl}>
                            {server.name} · {server.models.length} models
                          </option>
                        ))}
                      </select>,
                    )}
                  {localModels.length > 0 && (
                    <>
                      {label(
                        "Model",
                        <select
                          aria-label="Local model"
                          className="hintlens-select"
                          value={localModel}
                          onChange={(event) =>
                            setLocalModel(event.target.value)
                          }
                        >
                          {localModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.name || model.id}
                            </option>
                          ))}
                        </select>,
                      )}
                      <button
                        type="button"
                        className="hintlens-btn primary"
                        disabled={!connectedUrl || !localModel}
                        onClick={() => {
                          changeSetting({
                            provider: "local",
                            localBaseUrl: connectedUrl,
                            model: localModel,
                          });
                          setNotice(
                            "Local provider selected. Save settings to use this model.",
                          );
                        }}
                      >
                        Use selected model
                      </button>
                    </>
                  )}
                </fieldset>
                <label className="checkbox-row">
                  <input type="checkbox" disabled checked={false} /> Read
                  screenshots with local OCR
                </label>
                <p className="field-hint">
                  A verified local screenshot OCR pipeline is unavailable.
                  Choose a vision-capable model for images. Text-only models can
                  answer typed or pasted text.
                </p>
                {!desktop && (
                  <p className="field-hint">
                    Local endpoints are accessible from the desktop app. The
                    hosted backend does not access your computer's loopback
                    network.
                  </p>
                )}
              </div>
            )}
            {activeTab === "Account" && (
              <div className="hintlens-pane">
                <h3 className="pane-heading">Account</h3>
                {accountError && <p role="status">{accountError}</p>}
                <div className="account-card">
                  {account?.user ? (
                    <>
                      <p>Signed in to LensDesk.</p>
                      <p className="account-email">{account.user.email}</p>
                      <p>Plan: {account.plan || "Unavailable"}</p>
                      <button
                        type="button"
                        className="hintlens-btn secondary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            if (window.lens)
                              await window.lens.invoke("gate.logout");
                            else await cloud("auth.logout");
                            setAccount(await cloud("cloud.state"));
                            window.dispatchEvent(
                              new CustomEvent("lensdesk:account-changed"),
                            );
                            setNotice("Signed out. Local workspace retained.");
                          })
                        }
                      >
                        Sign out
                      </button>
                    </>
                  ) : (
                    <p>
                      {account
                        ? "Not signed in. Open the account page to connect a hosted service, register or sign in."
                        : "Account status unavailable."}
                    </p>
                  )}
                  <p className="account-version">
                    Version: {appInfo?.version || "Unavailable"}
                  </p>
                </div>

                <div
                  className="update-manager-box"
                  style={{
                    margin: "14px 0",
                    padding: "14px 16px",
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <strong style={{ fontSize: "13px" }}>Software Updates (OTA)</strong>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                      Installed: v{appInfo?.version || "2.0.0"}
                    </span>
                  </div>
                  {updateProgress ? (
                    <div style={{ margin: "8px 0" }}>
                      <p style={{ fontSize: "12px", color: "#38bdf8", margin: "0 0 6px 0" }}>
                        {updateProgress.status}
                      </p>
                      <div
                        style={{
                          width: "100%",
                          height: 6,
                          background: "rgba(255, 255, 255, 0.1)",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${updateProgress.percent}%`,
                            height: "100%",
                            background: "#0284c7",
                            transition: "width 0.2s",
                          }}
                        />
                      </div>
                      <small style={{ color: "#94a3b8", fontSize: "10px" }}>
                        {updateProgress.percent}% complete
                      </small>
                    </div>
                  ) : updateInfo?.updateAvailable ? (
                    <div style={{ margin: "8px 0" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 12px",
                          borderRadius: 6,
                          background: "rgba(16, 185, 129, 0.15)",
                          border: "1px solid rgba(16, 185, 129, 0.3)",
                          color: "#34d399",
                          fontSize: "12px",
                          marginBottom: 10,
                        }}
                      >
                        <span>
                          🚀 New version available: <strong>v{updateInfo.latestVersion}</strong>{" "}
                          ({updateInfo.artifact?.size
                            ? (updateInfo.artifact.size / 1048576).toFixed(1) + " MB"
                            : "Native C++ PE build"})
                        </span>
                      </div>
                      <button
                        type="button"
                        className="hintlens-btn primary"
                        style={{ width: "100%", padding: "8px 12px" }}
                        onClick={handleInstallUpdate}
                      >
                        Download &amp; Install Update Now
                      </button>
                    </div>
                  ) : (
                    <div>
                      {updateInfo?.checked && !updateInfo.updateAvailable && (
                        <p style={{ fontSize: "12px", color: "#34d399", margin: "4px 0 8px 0" }}>
                          ✓ Your LensDesk application is completely up to date!
                        </p>
                      )}
                      {updateInfo?.error && (
                        <p style={{ fontSize: "12px", color: "#f87171", margin: "4px 0 8px 0" }}>
                          ⚠️ {updateInfo.error}
                        </p>
                      )}
                      <button
                        type="button"
                        className="hintlens-btn secondary"
                        disabled={updateChecking}
                        onClick={handleCheckUpdate}
                      >
                        {updateChecking ? "Checking for updates..." : "Check for updates now"}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="hintlens-btn secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      setAccount(await cloud("cloud.state"));
                      setAccountError("");
                    })
                  }
                >
                  Refresh account status
                </button>
                <label className="checkbox-row">
                  <input type="checkbox" disabled checked={false} /> Restricted
                  network mode
                </label>
                <p className="field-hint">
                  Certificate verification remains enabled. Use an
                  administrator-configured system proxy and trusted CA
                  certificates. An application-level proxy or CA settings editor
                  is unavailable.
                </p>
                <div className="danger-zone-block">
                  <span className="danger-title">Danger zone</span>
                  <button type="button" className="danger-btn" disabled>
                    Sign out &amp; delete all local data — unavailable here
                  </button>
                  <p className="field-hint">
                    This reference action is a local data wipe, not deletion of
                    your cloud account. LensDesk does not provide this combined
                    operation. Cloud account deletion, with password
                    confirmation, is available on the account page.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
        <div className="hintlens-modal-footer">
          <button
            type="button"
            className="footer-btn restart"
            disabled={!desktop || busy}
            onClick={() =>
              run(async () => {
                if (
                  dirty &&
                  !window.confirm(
                    "Restart and discard unsaved settings changes?",
                  )
                )
                  return;
                if (onRestart) onRestart();
                else await api("desktop.restart");
              })
            }
          >
            <RotateCcw size={14} /> Restart
          </button>
          <button
            type="button"
            className="footer-btn quit"
            disabled={!desktop || busy}
            onClick={() =>
              run(async () => {
                if (
                  dirty &&
                  !window.confirm("Quit and discard unsaved settings changes?")
                )
                  return;
                if (onQuit) onQuit();
                else await api("desktop.quit");
              })
            }
          >
            <Power size={14} /> Quit
          </button>
          <button
            type="button"
            className="hintlens-btn primary"
            disabled={busy}
            onClick={save}
          >
            {busy ? "Working…" : "Save settings"}
          </button>
          {dirty && <span>Unsaved changes</span>}
        </div>
      </section>
    </div>
  );
}
