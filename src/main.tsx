import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Aperture,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock,
  Code2,
  Copy,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  History,
  ImagePlus,
  KeyRound,
  Laptop,
  Layers,
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserRound,
  Volume2,
  X,
  ExternalLink,
  Monitor,
  BookOpen,
  Command,
  Keyboard,
  Eye,
  EyeOff,
  Sliders,
  Globe,
} from "lucide-react";
import { api, uid, chat } from "./api";
import { captureBrowserScreen } from "./screen-capture";
import { applyTheme, cacheTheme, type Theme } from "./theme";
import { createSettingsWriter } from "./settings-writer";
import { installOverlayFocusDebug } from "./overlay-focus-debug";
import {
  createAudioQueue,
  audioNamespace,
  encryptedAudioStorage,
  type AudioQueue,
  type PendingClip,
} from "./audio-queue.mjs";
import { ProviderModels } from "./ProviderModels";
import { DesktopSettings } from "./DesktopSettings";
import { WorkspaceBrowser } from "./Browser";
import { AppearanceSettings } from "./AppearanceSettings";
import { shortcutLabel } from "./shortcut-label";
import { matchesShortcut } from "./shortcuts.mjs";
import { Recovery } from "./Recovery";
import { Account } from "./Account";
import { Home } from "./Home";
import { PageNav } from "./PageNav";
import { Access } from "./Access";
import { GateLock } from "./GateLock";
import { Admin } from "./Admin";
import { OverlayView } from "./OverlayView";
import { FloatingGate } from "./FloatingGate";
import {
  HintLensSettingsModal,
  DEFAULT_HINTLENS_HOTKEYS,
} from "./HintLensSettingsModal";
import { HintLensAuthModal } from "./HintLensAuthModal";
import { RadialActionWheel } from "./RadialActionWheel";
import { RegionCapture } from "./RegionCapture";
import { installMouseGestures } from "./mouse-gestures.mjs";
import type {
  State,
  Session,
  Profile,
  Provider,
  Mode,
  Settings,
} from "./types";
import "./styles.css";
const blankState: State = {
  storage: "cloud",
  sessions: [],
  profiles: [],
  keys: {
    openai: false,
    groq: false,
    gemini: false,
    anthropic: false,
    deepseek: false,
    local: false,
  },
  settings: {
    provider: "openai",
    model: "gpt-4o-mini",
    localBaseUrl: "http://127.0.0.1:11434/v1",
    language: "English",
    systemPrompt:
      "Give clear, practical answers. Explain your reasoning, state assumptions, and ask for clarification when needed.",
    transcriptionProvider: "openai",
    transcriptionModel: "whisper-1",
    opacity: 1,
    alwaysOnTop: true,
    captureProtection: true,
  },
};
const providerMeta: Record<
  Provider,
  { label: string; model: string; url: string; note: string }
> = {
  openai: {
    label: "OpenAI",
    model: "gpt-4o-mini",
    url: "https://platform.openai.com/api-keys",
    note: "Ultra-fast text, vision, and Whisper transcription (< 1s)",
  },
  groq: {
    label: "Groq (Ultra-Fast)",
    model: "llama-3.3-70b-versatile",
    url: "https://console.groq.com/keys",
    note: "Ultra-fast responses (500+ tok/sec) and Whisper transcription. Choose a vision model for screenshots.",
  },
  gemini: {
    label: "Google Gemini",
    model: "gemini-3.5-flash-lite",
    url: "https://aistudio.google.com/apikey",
    note: "Ultra-fast Google Gemini Flash (< 1s response)",
  },
  anthropic: {
    label: "Anthropic",
    model: "claude-3-5-haiku-20241022",
    url: "https://console.anthropic.com/settings/keys",
    note: "Ultra-fast Claude 3.5 Haiku text and vision",
  },
  deepseek: {
    label: "DeepSeek",
    model: "deepseek-chat",
    url: "https://platform.deepseek.com/api_keys",
    note: "Text and reasoning only (no vision/screenshots). API keys start with 'sk-'.",
  },
  local: {
    label: "Local LLM",
    model: "llama3.2",
    url: "",
    note: "Connect to Ollama, LM Studio, llama.cpp, or another OpenAI-compatible local server",
  },
};
const modeLabels: Record<Mode, string> = {
  general: "General",
  coding: "Coding",
  "system-design": "System design",
  behavioral: "Behavioral",
};
const starters = [
  {
    icon: Code2,
    title: "Work through a coding problem",
    text: "Help me practice an algorithm question. Ask me one problem, then guide me with hints before showing a solution.",
    mode: "coding",
  },
  {
    icon: Layers,
    title: "Think through system design",
    text: "Help me practice designing a URL shortener. Start with the requirements and guide me through the tradeoffs.",
    mode: "system-design",
  },
  {
    icon: UserRound,
    title: "Shape a stronger answer",
    text: "Help me prepare a concise STAR answer about a challenging project. Ask me about my experience first.",
    mode: "behavioral",
  },
] as const;
function fileData(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}
function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function sessionMarkdown(s: Session) {
  return `# ${s.title}\n\n${s.createdAt}\n\n## Notes\n${s.notes}\n\n## Transcript\n${s.transcript}\n\n## Conversation\n\n${s.messages.map((m) => `### ${m.role === "user" ? "You" : "LensDesk"}\n${m.content}`).join("\n\n")}`;
}
function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  className = "",
}: React.PropsWithChildren<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}>) {
  return (
    <button
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span>{language || "code"}</span>
        <button
          type="button"
          className="code-copy-btn"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function getPageFromPath(path: string, isDesktop: boolean): string {
  if (isDesktop) return "workspace";
  if (typeof window !== "undefined" && window.location?.search) {
    const params = new URLSearchParams(window.location.search);
    if (
      params.has("verify") ||
      params.has("reset") ||
      params.has("billing") ||
      params.has("account")
    ) {
      return "account";
    }
    if (params.has("admin")) return "admin";
    if (params.has("app") || params.has("workspace")) return "workspace";
  }
  const clean = path.toLowerCase().replace(/\/+$/, "") || "/";
  if (clean === "" || clean === "/" || clean === "/home") return "home";
  if (clean === "/workshop" || clean === "/assistant" || clean === "/workspace") return "workspace";
  if (clean === "/account" || clean === "/login" || clean === "/register" || clean === "/security") return "account";
  if (clean === "/admin" || clean === "/operator") return "admin";
  if (clean === "/downloads" || clean === "/download") return "downloads";
  if (clean === "/profiles") return "profiles";
  if (clean === "/sessions" || clean === "/history") return "sessions";
  if (clean === "/settings") return "settings";
  return "home";
}

function getPathForPage(p: string): string {
  switch (p) {
    case "home":
      return "/";
    case "workspace":
      return "/workshop";
    case "account":
      return "/account";
    case "admin":
      return "/admin";
    case "downloads":
      return "/downloads";
    case "profiles":
      return "/profiles";
    case "sessions":
      return "/sessions";
    case "settings":
      return "/settings";
    default:
      return "/" + p;
  }
}



function App() {
  const [state, setState] = useState<State | null>(null),
    [desktopShortcuts, setDesktopShortcuts] =
      useState<Record<string, string>>(),
    [page, setPage] = useState(() =>
      getPageFromPath(window.location.pathname, Boolean(window.lens)),
    ),
    [showContext, setShowContext] = useState(false),
    [activeId, setActiveId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [question, setQuestion] = useState(""),
    [saveStatus, setSaveStatus] = useState("saved"),
    [streamingText, setStreamingText] = useState(""),
    [images, setImages] = useState<string[]>([]),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [sessionFilter, setSessionFilter] = useState("all"),
    [hintlensSettingsOpen, setHintlensSettingsOpen] = useState(false),
    [hintlensSettingsTab, setHintlensSettingsTab] = useState("Model"),
    [authModalOpen, setAuthModalOpen] = useState(false),
    [radialWheelOpen, setRadialWheelOpen] = useState(false),
    [regionImage, setRegionImage] = useState<string | null>(null),
    [radialMousePos, setRadialMousePos] = useState<{
      x: number;
      y: number;
    } | null>(null),
    [gate, setGate] = useState<any>(null),
    [floatingView, setFloatingView] = useState<"assistant" | "browser">(
      "assistant",
    ),
    [desktopPreferences, setDesktopPreferences] = useState<any>(null),
    [modal, setModal] = useState<"new" | "sources" | "delete" | null>(null),
    [sources, setSources] = useState<any[]>([]),
    [newTitle, setNewTitle] = useState(""),
    [newMode, setNewMode] = useState<Mode>("general"),
    [newProfile, setNewProfile] = useState(""),
    [tab, setTab] = useState("transcript"),
    [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]),
    [microphoneId, setMicrophoneId] = useState(""),
    [audioLevel, setAudioLevel] = useState(0),
    [audioSource, setAudioSource] = useState<
      "microphone" | "computer" | "both"
    >("microphone"),
    [recording, setRecording] = useState(false),
    [transcribing, setTranscribing] = useState(false),
    [pendingAudio, setPendingAudio] = useState<PendingClip[]>([]),
    [elapsed, setElapsed] = useState(0),
    [recordSeconds, setRecordSeconds] = useState(0),
    [profileDraft, setProfileDraft] = useState<Profile | null>(null),
    [settingsDraft, setSettingsDraft] = useState<Settings | null>(null),
    [keyDraft, setKeyDraft] = useState(""),
    [confirmProfileDelete, setConfirmProfileDelete] = useState(false),
    [floating, setFloating] = useState(Boolean(window.lens)),
    [pipActive, setPipActive] = useState(false),
    [hideAnswer, setHideAnswer] = useState(false),
    [autoTyping, setAutoTyping] = useState(false),
    [clickThrough, setClickThrough] = useState(false),
    [workspaceWebSearch, setWorkspaceWebSearch] = useState(false),
    [detectedQuestion, setDetectedQuestion] = useState<string | null>(null),
    [autoAnswer, setAutoAnswer] = useState(true),
    [modelTesting, setModelTesting] = useState(false),
    [quickKeyModal, setQuickKeyModal] = useState<Provider | null>(null),
    [quickKeyInput, setQuickKeyInput] = useState("");
  const pipWindowRef = useRef<Window | null>(null);
  const shortcutHandlerRef = useRef<(action: string) => void>(() => {});
  const autoAnswerRef = useRef(true);
  useEffect(() => {
    autoAnswerRef.current = autoAnswer;
  }, [autoAnswer]);
  const recentSpokenWindow = useRef("");
  useEffect(() => {
    const theme = state?.settings.theme;
    if (!theme) return;
    const update = () => {
      cacheTheme(theme, state?.settings);
      if (pipWindowRef.current)
        applyTheme(theme, pipWindowRef.current.document, state?.settings);
    };
    update();
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [
    state?.settings.theme,
    state?.settings.lightTextColor,
    state?.settings.darkTextColor,
  ]);
  useEffect(() => {
    if (!window.lens) return;
    return installOverlayFocusDebug();
  }, []);
  const current = state?.sessions.find((s) => s.id === activeId),
    currentRef = useRef<Session | undefined>(current),
    stateRef = useRef(state),
    endRef = useRef<HTMLDivElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    audioInput = useRef<HTMLInputElement>(null),
    docInput = useRef<HTMLInputElement>(null),
    backupInput = useRef<HTMLInputElement>(null),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    recordingRef = useRef(false),
    sourceStreams = useRef<MediaStream[]>([]),
    audioContext = useRef<AudioContext | null>(null),
    meterFrame = useRef<number>(0),
    pendingAudioQueue = useRef<AudioQueue | null>(null),
    audioQueueReady = useRef<Promise<void> | null>(null),
    audioQueueNamespace = useRef<string | null>(null),
    acquiringAudio = useRef(false),
    audioAcquisition = useRef(0),
    chatBusyRef = useRef(false),
    generationController = useRef<AbortController | null>(null),
    drafts = useRef(
      new Map<string, { patch: Partial<Session>; base: Partial<Session> }>(),
    ),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saveQueue = useRef(Promise.resolve()),
    settingsWriter = useRef<ReturnType<typeof createSettingsWriter> | null>(
      null,
    ),
    opacityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  currentRef.current = current;
  stateRef.current = state;
  chatBusyRef.current = busy;
  const cloudStorage = state?.storage === "cloud";
  const desktop = Boolean(window.lens),
    mac =
      window.lens?.platform === "darwin" || navigator.platform.includes("Mac"),
    mod = mac ? "⌘" : "Ctrl";
  const keyLabel = (action: string) =>
    shortcutLabel(action, desktopShortcuts, mac);
  function notify(text: string) {
    setToast(text);
  }
  async function refresh() {
    const next = await api<State>("state");
    setState(next);
    return next;
  }
  useEffect(() => {
    const changed = () => {
      run(refresh);
    };
    window.addEventListener("lensdesk:account-changed", changed);
    return () =>
      window.removeEventListener("lensdesk:account-changed", changed);
  }, []);
  useEffect(() => {
    // Subscription gate snapshots: authoritative phase, session, and
    // entitlement pushed by the main-process arbitraritor.
    if (!window.lens?.onGate) return;
    let alive = true;
    window.lens
      .invoke("gate.state")
      .then((v) => alive && setGate(v))
      .catch(() => {});
    const off = window.lens.onGate((v) => alive && setGate(v));
    return () => {
      alive = false;
      off();
    };
  }, []);
  function fail(e: unknown) {
    setError(
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "Something went wrong. Try again.",
    );
  }
  function saveSettingsPatch(patch: Partial<Settings>) {
    if (!settingsWriter.current)
      settingsWriter.current = createSettingsWriter({
        getBase: () => stateRef.current!.settings,
        read: () => api<State>("state"),
        save: (settings) => api<State>("settings.save", settings),
        onSaved: (next, applied, base) => {
          const merged = {
            ...next,
            sessions: next.sessions.map((s) => ({
              ...s,
              ...drafts.current.get(s.id)?.patch,
            })),
          };
          stateRef.current = merged;
          setState(merged);
          setSettingsDraft((old) => {
            const pending: Partial<Settings> = {};
            for (const key of Object.keys(old || {}) as (keyof Settings)[]) {
              if (
                key !== "version" &&
                old![key] !== base[key] &&
                (!(key in applied) || old![key] !== applied[key])
              )
                Object.assign(pending, { [key]: old![key] });
            }
            return { ...next.settings, ...pending };
          });
        },
      });
    return settingsWriter.current.write(patch).then(async (next) => {
      if (window.lens) await api("desktop.appearance");
      return next;
    });
  }

  async function testCurrentModel(providerOverride?: Provider) {
    if (modelTesting || !state) return;
    const targetProvider = providerOverride || state.settings.provider;
    if (targetProvider === "local") {
      notify("Local model server selected (localhost:11434/v1).");
      return;
    }
    const hasKey = state.keys[targetProvider];
    if (!hasKey) {
      setQuickKeyModal(targetProvider);
      return;
    }
    setModelTesting(true);
    try {
      const activeModel =
        state.settings.model ||
        providerMeta[targetProvider]?.model ||
        "gpt-4o-mini";
      const result: any = await api("model.test", {
        provider: targetProvider,
        model: activeModel,
      });
      if (result?.ok) {
        notify(`✓ ${providerMeta[targetProvider].label} connection confirmed!`);
      } else {
        notify(`Connection test response: ${JSON.stringify(result)}`);
      }
    } catch (err: any) {
      notify(`Connection test: ${err.message || String(err)}`);
    } finally {
      setModelTesting(false);
    }
  }

  async function handleWorkshopProviderChange(newProvider: Provider) {
    await saveSettingsPatch({
      provider: newProvider,
      model: providerMeta[newProvider].model,
    });
    setSettingsDraft((old) =>
      old
        ? {
            ...old,
            provider: newProvider,
            model: providerMeta[newProvider].model,
          }
        : old,
    );
    notify(`${providerMeta[newProvider].label} set as default active provider.`);
  }

  async function handleQuickKeySave() {
    if (!quickKeyModal || !quickKeyInput.trim()) return;
    const p = quickKeyModal;
    const key = quickKeyInput.trim();
    try {
      await api("key.save", { provider: p, key });
      await saveSettingsPatch({
        provider: p,
        model: providerMeta[p].model,
      });
      await refresh();
      setQuickKeyModal(null);
      setQuickKeyInput("");
      notify(`${providerMeta[p].label} API key saved and activated!`);
      void testCurrentModel(p);
    } catch (err: any) {
      notify(`Error saving key: ${err.message || String(err)}`);
    }
  }
  async function run(fn: () => Promise<unknown>) {
    try {
      setError("");
      await fn();
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    run(async () => {
      const initial = getPageFromPath(window.location.pathname, desktop);
      try {
        const next = await refresh();
        setSettingsDraft(next.settings);
        if (desktop && next.sessions && next.sessions.length > 0) {
          setActiveId((old) => old || next.sessions[0].id);
        }
        if (!desktop) {
          const params = new URLSearchParams(location.search);
          if (params.has("app") || params.has("workspace")) {
            setPage("workspace");
          } else if (params.has("admin")) {
            setPage("admin");
          } else if (
            params.has("account") ||
            params.has("verify") ||
            params.has("reset") ||
            params.has("billing")
          ) {
            setPage("account");
          } else {
            setPage(initial);
          }
        }
      } catch (e) {
        if (
          !desktop ||
          (e instanceof Error &&
            e.message.includes("Sign in to your cloud account"))
        ) {
          setState(structuredClone(blankState));
          setSettingsDraft(blankState.settings);
          const params = new URLSearchParams(location.search);
          if (params.has("admin")) {
            setPage("admin");
          } else if (
            params.has("account") ||
            params.has("verify") ||
            params.has("reset") ||
            params.has("billing")
          ) {
            setPage("account");
          } else if (initial && initial !== "home") {
            setPage(initial);
          } else {
            setPage("home");
          }
        } else throw e;
      }
      if (
        new URLSearchParams(location.search).has("verify") ||
        new URLSearchParams(location.search).has("reset") ||
        new URLSearchParams(location.search).has("billing")
      )
        setPage("account");
    });
    return () => {
      stopRecording();
    };
  }, []);
  useEffect(() => {
    if (desktop) return;
    const targetUrl = getPathForPage(page);
    if (window.location.pathname !== targetUrl) {
      const search = window.location.search;
      window.history.pushState({ page }, "", targetUrl + search);
    }
  }, [page, desktop]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [current?.messages.length, busy]);
  useEffect(() => {
    if (!current) {
      setElapsed(0);
      return;
    }
    const update = () =>
      setElapsed(
        Math.floor(
          (current.activeSeconds || 0) +
            (current.endedAt
              ? 0
              : Math.max(
                  0,
                  (Date.now() -
                    Date.parse(current.activeSince || current.createdAt)) /
                    1000,
                )),
        ),
      );
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [
    current?.id,
    current?.endedAt,
    current?.activeSince,
    current?.activeSeconds,
  ]);

  useEffect(() => {
    if (!recording) return;
    setRecordSeconds(0);
    const t = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => {
    if (window.lens) {
      window.lens
        .invoke("desktop.preferences")
        .then((p) => {
          setDesktopShortcuts(p.shortcuts);
          setDesktopPreferences(p);
        })
        .catch(fail);
      const unsubPreferences = window.lens.onPreferences?.((p) => {
        setDesktopShortcuts(p.shortcuts);
        setDesktopPreferences(p);
      });
      window.lens
        .invoke("desktop.overlayState")
        .then((res: { floating?: boolean }) => {
          if (res && typeof res.floating === "boolean")
            setFloating(res.floating);
        })
        .catch(() => {});
      window.lens
        .invoke("desktop.clickThroughState")
        .then((res: { clickThrough?: boolean }) => {
          if (res && typeof res.clickThrough === "boolean")
            setClickThrough(res.clickThrough);
        })
        .catch(() => {});
      const unsubOverlay = window.lens.onOverlay?.(({ floating: f }) => {
        setFloating(f);
        setHintlensSettingsOpen(false);
      });
      const unsubClick = window.lens.onClickThrough?.(
        ({ clickThrough: ct }) => {
          setClickThrough(ct);
        },
      );
      return () => {
        unsubPreferences?.();
        unsubOverlay?.();
        unsubClick?.();
      };
    }
  }, []);
  const providerSwitchBusy = useRef(false);
  const cycleProvider = () =>
    run(async () => {
      if (!settingsDraft || providerSwitchBusy.current || chatBusyRef.current)
        return;
      providerSwitchBusy.current = true;
      try {
        const providers: Provider[] = [
          "groq",
          "gemini",
          "openai",
          "anthropic",
          "deepseek",
          ...(desktop ? ["local" as Provider] : []),
        ];
        const next =
          providers[
            (providers.indexOf(settingsDraft.provider) + 1) % providers.length
          ];
        const result = await api<{ models: { id: string }[] }>("model.list", {
          provider: next,
          localBaseUrl: settingsDraft.localBaseUrl,
        });
        if (!result.models?.length)
          throw new Error(
            "No models returned. Configure the provider in Model settings first.",
          );
        await saveSettingsPatch({ provider: next, model: result.models[0].id });
      } finally {
        providerSwitchBusy.current = false;
      }
    });
  const cycleModel = () =>
    run(async () => {
      if (!settingsDraft || providerSwitchBusy.current || chatBusyRef.current)
        return;
      providerSwitchBusy.current = true;
      try {
        const provider = settingsDraft.provider;
        const result = await api<{ models: { id: string }[] }>("model.list", {
          provider,
          localBaseUrl: settingsDraft.localBaseUrl,
        });
        if (!result.models?.length)
          throw new Error(
            "No models returned. Connect to a provider before cycling models.",
          );
        const index = result.models.findIndex(
          (m) => m.id === settingsDraft.model,
        );
        await saveSettingsPatch({
          model: result.models[(index + 1) % result.models.length].id,
        });
      } finally {
        providerSwitchBusy.current = false;
      }
    });
  const handleRadialAction = (actionKey: string) => {
    if (actionKey === "getAnswer") {
      if (!chatBusyRef.current) run(snapAndSolve);
    } else if (actionKey === "capture") {
      run(quickCaptureScreen);
    } else if (actionKey === "autoType") {
      run(handleAutoType);
    } else if (actionKey === "undo") {
      setImages((old) => old.slice(0, -1));
    } else if (actionKey === "hide") {
      handleHideWindow();
    } else if (actionKey === "snip") {
      run(captureRegion);
    } else if (actionKey === "browser") {
      run(async () => {
        if (floating)
          setFloatingView((view) =>
            view === "browser" ? "assistant" : "browser",
          );
        else await navigate(page === "browser" ? "workspace" : "browser");
      });
    } else if (actionKey === "settings") {
      setHintlensSettingsTab("Model");
      setHintlensSettingsOpen(true);
    }
  };

  shortcutHandlerRef.current = (action) => {
    if (action === "getAnswer" && !chatBusyRef.current) run(snapAndSolve);
    if (action === "capture") run(quickCaptureScreen);
    if (action === "regionSnip") run(captureRegion);
    if (action === "overlay") {
      // The desktop product has one floating window; this shortcut can only
      // bring it back, never expand a second workspace surface.
      run(toggleOverlayMode);
    }
    if (action === "hide") {
      handleHideWindow();
    }
    if (action === "hideAnswer") {
      setHideAnswer((v) => !v);
    }
    if (action === "autoType") {
      run(handleAutoType);
    }
    if (action === "clickThrough") {
      run(toggleClickThrough);
    }
    if (action === "mouseMode") run(toggleClickThrough);
    if (action === "browser")
      run(async () => {
        if (floating) {
          setFloatingView((v) => (v === "browser" ? "assistant" : "browser"));
        } else {
          await navigate(page === "browser" ? "workspace" : "browser");
        }
      });
    if (action === "shortcuts")
      run(async () => {
        if (floating) {
          setHintlensSettingsTab("Hotkeys");
          setHintlensSettingsOpen((prev) => !prev);
        } else {
          await navigate(page === "settings" ? "workspace" : "settings");
        }
      });
    if (action === "theme")
      run(() =>
        saveSettingsPatch({
          theme:
            document.documentElement.dataset.theme === "dark"
              ? "light"
              : "dark",
        }),
      );
    if (action === "opacityUp" || action === "opacityDown")
      run(() =>
        saveSettingsPatch({
          opacity: Math.max(
            0,
            Math.min(
              1,
              (stateRef.current?.settings.opacity ?? 1) +
                (action === "opacityUp" ? 0.1 : -0.1),
            ),
          ),
        }),
      );
    if (action === "clearLastCapture" || action === "undo")
      setImages((old) => old.slice(0, -1));
    if (action === "clearCaptures" || action === "clearBundle") setImages([]);
    if (action === "clearChat") {
      run(async () => {
        if (chatBusyRef.current)
          throw new Error("Stop the current answer before clearing chat.");
        const session = currentRef.current;
        if (session) await saveSession({ ...session, messages: [] });
      });
    }
    if (action === "cancelAnswer") generationController.current?.abort();
    if (action === "cycleProvider") cycleProvider();
    if (action === "cycleModel") cycleModel();
    if (action === "stealth") run(handleToggleStealth);
    if (action === "restart") {
      if (window.lens) run(() => api("desktop.restart"));
      else window.location.reload();
    }
    if (action === "quit") {
      if (window.lens) run(() => api("desktop.quit"));
      else window.close();
    }
    if (action === "scrollUp" || action === "scrollDown") {
      const target = pipWindowRef.current?.document || document;
      target
        .querySelector(
          floating || pipWindowRef.current
            ? ".overlay-messages-scroll"
            : ".conversation",
        )
        ?.scrollBy({
          top: action === "scrollUp" ? -220 : 220,
          behavior: "smooth",
        });
    }
  };
  useEffect(
    () =>
      window.lens?.onShortcut((action) => shortcutHandlerRef.current(action)),
    [],
  );
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "n"
      ) {
        e.preventDefault();
        if (!chatBusyRef.current && !recordingRef.current) setModal("new");
        return;
      }

      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      const isInput = Boolean(
        target?.closest("input,textarea,select,[contenteditable=true]"),
      );

      // Dedicated hide check: Cmd+Shift+H / Ctrl+Shift+H always hides
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "h"
      ) {
        e.preventDefault();
        handleHideWindow();
        return;
      }

      // Plain Shift+H: hides if not typing in an input field (so capital H can be typed in fields)
      if (
        !isInput &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === "h"
      ) {
        e.preventDefault();
        handleHideWindow();
        return;
      }

      // Plain Shift+A: Get Answer / Snap & Solve if not typing in an input field
      if (
        !isInput &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === "a"
      ) {
        e.preventDefault();
        shortcutHandlerRef.current("getAnswer");
        return;
      }

      // Plain Shift+S: Quick screen capture if not typing in an input field
      if (
        !isInput &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === "s"
      ) {
        e.preventDefault();
        shortcutHandlerRef.current("capture");
        return;
      }

      // If focused inside an input or textarea, let normal typing occur without triggering global hotkeys
      if (isInput) return;
      const activeHotkeys = {
        ...DEFAULT_HINTLENS_HOTKEYS,
        ...desktopPreferences?.shortcuts,
      };
      const action = Object.entries(activeHotkeys).find(
        ([, shortcut]) =>
          Boolean(shortcut) && matchesShortcut(e, shortcut as string),
      );
      if (action) {
        e.preventDefault();
        shortcutHandlerRef.current(action[0]);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [pipActive, desktop, desktopPreferences, settingsDraft]);
  useEffect(() => {
    if (!desktopPreferences?.mouse?.enabled) {
      setRadialWheelOpen(false);
      return;
    }
    return installMouseGestures(
      window,
      desktopPreferences.mouse,
      (pos: { x: number; y: number }) => {
        setRadialMousePos(pos);
        setRadialWheelOpen(true);
      },
      () => setRadialWheelOpen(false),
    );
  }, [desktopPreferences?.mouse]);
  useEffect(() => {
    if (!modal) return;
    const prior = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const nodes = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        ) || [],
      );
    setTimeout(
      () =>
        (nodes().find((el) => el.tagName === "INPUT") ?? nodes()[0])?.focus(),
      0,
    );
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = nodes(),
        first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    dialog?.addEventListener("keydown", trap);
    return () => {
      dialog?.removeEventListener("keydown", trap);
      prior?.focus();
    };
  }, [modal]);
  function editField(s: Session, field: "notes" | "transcript", value: string) {
    const draft = drafts.current.get(s.id) || { patch: {}, base: { ...s } };
    draft.patch[field] = value;
    drafts.current.set(s.id, draft);
    setState((old) =>
      old
        ? {
            ...old,
            sessions: old.sessions.map((item) =>
              item.id === s.id ? { ...item, [field]: value } : item,
            ),
          }
        : old,
    );
    setSaveStatus("pending");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushDrafts();
    }, 650);
  }
  async function flushDrafts() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const operation = saveQueue.current.then(async () => {
      for (const [id, draft] of [...drafts.current]) {
        const patch = { ...draft.patch };
        if (!Object.keys(patch).length) continue;
        setSaveStatus("saving");
        try {
          const latest = await api<Session>("session.get", { id });
          for (const field of Object.keys(patch) as (keyof Session)[]) {
            if (
              latest[field] !== draft.base[field] &&
              latest[field] !== patch[field]
            )
              throw new Error(
                "This text changed elsewhere. Your unsaved text is kept in this editor. Copy it before reloading, or restore an earlier version.",
              );
          }
          const saved = await api<Session>("session.patch", {
            id,
            version: latest.version,
            patch,
          });
          const newer = drafts.current.get(id);
          if (newer) {
            for (const field of Object.keys(patch) as (
              "notes" | "transcript"
            )[]) {
              newer.base[field] = saved[field];
              if (newer.patch[field] === patch[field])
                delete newer.patch[field];
            }
            if (!Object.keys(newer.patch).length) drafts.current.delete(id);
          }
          setState((old) =>
            old
              ? {
                  ...old,
                  sessions: old.sessions.map((item) =>
                    item.id === id
                      ? { ...saved, ...drafts.current.get(id)?.patch }
                      : item,
                  ),
                }
              : old,
          );
        } catch (e) {
          setSaveStatus("error");
          fail(e);
          throw e;
        }
      }
      setSaveStatus(drafts.current.size ? "pending" : "saved");
    });
    saveQueue.current = operation.catch(() => {});
    try {
      await operation;
    } catch {
      return false;
    }
    return true;
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (drafts.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  async function saveSession(s: Session) {
    const saved = await api<Session>("session.save", s);
    setState((old) =>
      old
        ? {
            ...old,
            sessions: [saved, ...old.sessions.filter((x) => x.id !== saved.id)],
          }
        : old,
    );
    return saved;
  }
  async function createSession(mode: Mode = newMode) {
    const now = new Date().toISOString();
    const s: Session = {
      id: uid(),
      title:
        newTitle.trim() ||
        `${modeLabels[mode]} session · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      mode,
      profileId: newProfile,
      createdAt: now,
      updatedAt: now,
      notes: "",
      transcript: "",
      messages: [],
    };
    const saved = await saveSession(s);
    setActiveId(s.id);
    setQuestion("");
    setImages([]);
    setPage("workspace");
    setModal(null);
    setNewTitle("");
    return saved;
  }
  async function send(
    text = question,
    mode?: Mode,
    customImages?: string[],
    options?: { webSearch?: boolean },
  ) {
    if (chatBusyRef.current) return false;
    const payloadImages = customImages !== undefined ? customImages : images;
    setQuestion(text);
    chatBusyRef.current = true;
    setBusy(true);
    setStreamingText("");
    const controller = new AbortController();
    generationController.current = controller;
    setError("");
    try {
      if (!(await flushDrafts())) return false;
      let s = currentRef.current;
      if (!s) s = await createSession(mode || "general");
      setQuestion(text);
      setImages(payloadImages);
      if (mode && s.mode !== mode) s = await saveSession({ ...s, mode });
      const useWeb = options?.webSearch ?? workspaceWebSearch;
      const updated: Session = await chat(
        { sessionId: s.id, text, images: payloadImages, webSearch: useWeb },
        (event) => {
          if (event.type === "delta")
            setStreamingText((old) => old + (event.text || ""));
        },
        controller.signal,
      );
      setState((old) =>
        old
          ? {
              ...old,
              sessions: [
                {
                  ...((old.sessions.find((x) => x.id === updated.id)?.version ||
                    0) > (updated.version || 0)
                    ? old.sessions.find((x) => x.id === updated.id)!
                    : updated),
                  ...drafts.current.get(updated.id)?.patch,
                },
                ...old.sessions.filter((x) => x.id !== updated.id),
              ],
            }
          : old,
      );
      setQuestion("");
      setImages([]);
      return true;
    } catch (e) {
      if (!controller.signal.aborted) fail(e);
      else notify("Answer stopped. Your question is available to retry.");
      return false;
    } finally {
      generationController.current = null;
      setStreamingText("");
      chatBusyRef.current = false;
      setBusy(false);
    }
  }
  async function capture() {
    if (!currentRef.current) {
      notify("Start a session before capturing a screen.");
      return;
    }
    if (window.lens) {
      setSources(await api("desktop.sources"));
      setModal("sources");
      return;
    }
    const image = await captureBrowserScreen();
    setImages((old) => [...old, image].slice(0, 5));
  }
  async function toggleOverlayMode() {
    if (!desktop) {
      notify("Floating window is exclusive to the installed LensDesk desktop application.");
      return;
    }
    const res = await api<{ floating: boolean }>("desktop.overlay");
    if (res && typeof res.floating === "boolean") setFloating(res.floating);
    setHintlensSettingsOpen(false);
  }
  async function captureRegion() {
    if (regionImage) return;
    if (!currentRef.current) {
      const session = await createSession("general");
      currentRef.current = session;
      setActiveId(session.id);
    }
    if (images.length >= 5)
      throw new Error(
        "The bundle holds five screenshots. Remove a capture before adding another.",
      );
    const image = desktop
      ? (
          await api<{ image: string }>("desktop.capture", {
            mode: "active",
            silent: true,
            deferArchive: true,
          })
        ).image
      : await captureBrowserScreen();
    if (!image) throw new Error("No screenshot was captured.");
    setRegionImage(image);
  }
  async function attachRegion(image: string) {
    let warning = "";
    if (desktop) {
      try {
        await api("desktop.captureArchive.save", { image });
      } catch (error: any) {
        warning = "Region attached, but archive save failed: " + error.message;
      }
    }
    setImages((old) => [...old, image].slice(0, 5));
    setRegionImage(null);
    notify("Selected region added to the bundle.");
    if (warning) fail(warning);
  }
  async function quickCaptureScreen() {
    if (!currentRef.current) {
      const s = await createSession("general");
      currentRef.current = s;
      setActiveId(s.id);
    }
    if (images.length >= 5)
      throw new Error(
        "The bundle holds five screenshots. Remove a capture before adding another.",
      );
    if (window.lens) {
      try {
        const res = await api<{
          image: string;
          images?: string[];
          archiveError?: string;
        }>("desktop.capture", { silent: true });
        if (res?.image) {
          const captures = res.images || [res.image];
          if (images.length + captures.length > 5)
            throw new Error(
              "There is not enough space in the five-image bundle. Clear captures and retry.",
            );
          setImages((old) => [...old, ...captures]);
          if (res.archiveError) fail(res.archiveError);
          notify("Screen captured and added to bundle!");
        }
      } catch (e: any) {
        if (e?.message?.includes("System Settings")) {
          notify(
            "Screen recording permission required. Please allow LensDesk in System Settings, then restart.",
          );
          if (window.lens) {
            void api("desktop.openScreenSettings").catch(() => {});
          }
        } else {
          notify(e?.message || "Screen capture failed.");
        }
      }
      return;
    }
    try {
      const image = await captureBrowserScreen();
      setImages((old) => [...old, image].slice(0, 5));
      notify("Screen captured and added to bundle!");
    } catch (e: any) {
      if (e.name !== "NotAllowedError")
        notify(e?.message || "Capture canceled.");
    }
  }
  async function snapAndSolve() {
    if (chatBusyRef.current) return;
    if (!currentRef.current) {
      const s = await createSession("general");
      currentRef.current = s;
      setActiveId(s.id);
    }
    const defaultSolvePrompt =
      "Answer the question shown on the screen directly, accurately, and concisely. State the final answer or solution first, followed by brief key points only if necessary.";

    // If user already typed a question, solve directly with that question!
    if (images.length === 0 && question.trim()) {
      await send(question.trim(), undefined, [], { webSearch: false });
      return;
    }

    // If we already have captured screenshots in the bundle, solve with them!
    if (images.length > 0) {
      notify(`Analyzing ${images.length} screenshot(s) in bundle...`);
      const capturedBundle = [...images];
      if (
        await send(defaultSolvePrompt, undefined, capturedBundle, {
          webSearch: false,
        })
      )
        setImages((old) =>
          old.filter((image) => !capturedBundle.includes(image)),
        );
      return;
    }

    let imageBase64: string | null = null;
    let captureImages: string[] = [];
    let archiveWarning = "";
    if (window.lens) {
      try {
        const res = await api<{
          image: string;
          images?: string[];
          archiveError?: string;
        }>("desktop.capture", { silent: true });
        archiveWarning = res.archiveError || "";
        if (res?.image) {
          imageBase64 = res.image;
          captureImages = res.images || [res.image];
        }
      } catch (e: any) {
        if (e?.message?.includes("System Settings")) {
          notify(
            "Screen recording permission required. Please allow LensDesk in System Settings, then restart.",
          );
          if (window.lens) {
            void api("desktop.openScreenSettings").catch(() => {});
          }
        } else {
          notify(e?.message || "Screen capture failed.");
        }
        return;
      }
    } else {
      try {
        imageBase64 = await captureBrowserScreen();
      } catch (e: any) {
        if (e.name !== "NotAllowedError")
          notify(e?.message || "Capture canceled.");
        return;
      }
    }
    if (imageBase64) {
      notify("Screen captured! Analyzing question on screen...");
      const captured = captureImages.length ? captureImages : [imageBase64];
      setImages(captured);
      if (
        await send(defaultSolvePrompt, undefined, captured, {
          webSearch: false,
        })
      )
        setImages([]);
      if (archiveWarning) fail(archiveWarning);
    }
  }
  async function toggleClickThrough() {
    if (window.lens) {
      try {
        const res = await window.lens.invoke("desktop.clickThrough");
        if (res && typeof res.clickThrough === "boolean") {
          setClickThrough(res.clickThrough);
          notify(
            res.clickThrough
              ? "Click-Through enabled: Clicks pass to the editor beneath."
              : "Click-Through disabled.",
          );
        }
      } catch (e: any) {
        notify(e?.message || "Click-through toggle failed.");
      }
    } else {
      notify(
        "Click-Through mode is active in the native LensDesk Desktop application.",
      );
    }
  }
  function handleOpacityChange(op: number) {
    if (!settingsDraft) return;
    const opacity = Math.max(0, Math.min(1, op));
    const next = { ...settingsDraft, opacity };
    setSettingsDraft(next);
    if (opacityTimer.current) clearTimeout(opacityTimer.current);
    opacityTimer.current = setTimeout(() => {
      void run(async () => {
        await saveSettingsPatch({ opacity });
      });
    }, 250);
  }
  async function handleToggleStealth() {
    if (!settingsDraft) return;
    const next = {
      ...settingsDraft,
      captureProtection: !settingsDraft.captureProtection,
    };
    setSettingsDraft(next);
    await saveSettingsPatch({ captureProtection: next.captureProtection });
    notify(
      next.captureProtection
        ? "Stealth Mode ON: LensDesk is excluded from screenshots & video recording."
        : "Stealth Mode OFF: Window capture protection disabled.",
    );
  }
  async function handleAutoType(customText?: string) {
    const text =
      customText ||
      currentRef.current?.messages
        ?.slice()
        .reverse()
        .find((m) => m.role === "assistant")?.content ||
      streamingText;
    if (!text) {
      notify("No solution text available to auto-type.");
      return;
    }
    if (window.lens) {
      try {
        setAutoTyping(true);
        notify(
          "Confirm typing into your editor. Use your saved typing shortcut again to stop.",
        );
        const result = await window.lens.invoke("desktop.autoType", {
          text,
          skipConfirm: true,
        });
        notify(
          result?.canceled ? "Auto-typing stopped." : "Auto-typing complete.",
        );
      } catch (err: any) {
        fail(err);
      } finally {
        setAutoTyping(false);
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        notify(
          "Code copied to clipboard. (Direct keystroke auto-typing requires LensDesk Desktop app).",
        );
      } catch {
        fail("Could not copy code to clipboard.");
      }
    }
  }
  function handleHideWindow() {
    if (window.lens) {
      window.lens.invoke("desktop.hide").catch(() => {});
    } else {
      run(toggleOverlayMode);
    }
  }
  async function addImage(file: File) {
    if (file.size > 15000000)
      throw new Error("Choose an image smaller than 15 MB.");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw new Error("Choose a PNG, JPEG, or WebP image.");
    const data = await fileData(file),
      img = new Image();
    img.src = data;
    await img.decode();
    const scale = Math.min(1, 1920 / Math.max(img.width, img.height)),
      canvas = document.createElement("canvas");
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    setImages((old) =>
      [...old, canvas.toDataURL("image/jpeg", 0.85)].slice(0, 5),
    );
  }
  function stopRecording() {
    audioAcquisition.current++;
    recordingRef.current = false;
    setRecording(false);
    if (recordTimer.current) clearTimeout(recordTimer.current);
    recordTimer.current = null;
    const activeRecorder = recorder.current;
    recorder.current = null;
    if (activeRecorder && activeRecorder.state !== "inactive") {
      try {
        activeRecorder.stop();
      } catch {
        /* Tracks below still must stop. */
      }
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    sourceStreams.current.forEach((source) =>
      source.getTracks().forEach((t) => t.stop()),
    );
    sourceStreams.current = [];
    cancelAnimationFrame(meterFrame.current);
    setAudioLevel(0);
    const context = audioContext.current;
    audioContext.current = null;
    if (context) void context.close().catch(() => {});
  }
  function currentAudioNamespace() {
    return audioNamespace({
      desktop: Boolean(window.lens),
      state: stateRef.current,
    });
  }
  function audioQueue() {
    const namespace = currentAudioNamespace();
    if (!namespace)
      throw new Error("Sign in to your account before using audio recovery.");
    if (audioQueueNamespace.current !== namespace) {
      pendingAudioQueue.current?.pause();
      pendingAudioQueue.current = null;
      audioQueueNamespace.current = namespace;
    }
    if (!pendingAudioQueue.current) {
      const expectedAccountId = namespace.startsWith("account:")
        ? namespace.slice(8)
        : undefined;
      let owner: AudioQueue;
      const ensureIdentity = () => {
        if (
          currentAudioNamespace() !== namespace ||
          pendingAudioQueue.current !== owner
        )
          throw new Error(
            "Account changed. Audio was kept for its original account.",
          );
      };
      owner = createAudioQueue({
        storage: encryptedAudioStorage(namespace),
        onChange: (clips) => {
          if (
            currentAudioNamespace() !== namespace ||
            pendingAudioQueue.current !== owner
          )
            return;
          setPendingAudio(clips);
          setTranscribing(
            clips.some(
              (clip) =>
                clip.status === "processing" || clip.status === "queued",
            ),
          );
        },
        transcribe: async (clip) => {
          ensureIdentity();
          await api("session.get", { id: clip.sessionId, expectedAccountId });
          const data = (await fileData(clip.blob)).split(",")[1];
          ensureIdentity();
          return api<{ text: string; durationSeconds?: number }>("transcribe", {
            data,
            mime: clip.blob.type.split(";")[0],
            expectedAccountId,
          });
        },
        append: async (sessionId, segment) => {
          ensureIdentity();
          const updated = await api<Session>("transcript.append", {
            id: sessionId,
            segment,
            expectedAccountId,
          });
          ensureIdentity();
          setState((old) =>
            old
              ? {
                  ...old,
                  sessions: old.sessions.map((existing) => {
                    if (existing.id !== sessionId) return existing;
                    const latest =
                      (existing.version || 0) > (updated.version || 0)
                        ? existing
                        : updated;
                    return {
                      ...latest,
                      ...drafts.current.get(sessionId)?.patch,
                    };
                  }),
                }
              : old,
          );
          const segmentText = segment?.text?.trim() || "";
          if (segmentText.length >= 5) {
            const combined = (recentSpokenWindow.current + " " + segmentText).trim();
            recentSpokenWindow.current = combined.slice(-600);

            const isInterviewPrompt =
              segmentText.endsWith("?") ||
              combined.endsWith("?") ||
              /\b(how|what|why|when|where|who|which|can you|could you|tell me|walk me through|explain|describe|difference between|implement|design|solve|write|create|find|approach|complexity|compare|pros and cons|experience|background|resume|project)\b/i.test(
                segmentText,
              ) ||
              /\b(how|what|why|when|where|who|which|can you|could you|tell me|walk me through|explain|describe|difference between|implement|design|solve|write|create|find|approach|complexity|compare|pros and cons|experience|background|resume|project)\b/i.test(
                combined,
              ) ||
              /\b(kya|kaise|kyu|batao|bataiye|samjhao|karo|karein|hoga|hai kya|karna hai|kaise hota)\b/i.test(
                segmentText,
              ) ||
              /\b(kya|kaise|kyu|batao|bataiye|samjhao|karo|karein|hoga|hai kya|karna hai|kaise hota)\b/i.test(
                combined,
              );

            const questionText = isInterviewPrompt ? combined : (segmentText.length >= 25 ? segmentText : null);
            if (questionText) {
              setDetectedQuestion(questionText);
              if (
                (stateRef.current?.settings.interviewLayout === "compact" || autoAnswerRef.current) &&
                !chatBusyRef.current
              ) {
                recentSpokenWindow.current = "";
                void send(questionText);
              }
            }
          }
        },
      });
      pendingAudioQueue.current = owner;
      audioQueueReady.current = owner.initialize();
    }
    return pendingAudioQueue.current;
  }
  const recoveryNamespace = audioNamespace({ desktop, state });
  const visiblePendingAudio =
    audioQueueNamespace.current === recoveryNamespace ? pendingAudio : [];
  useEffect(() => {
    stopRecording();
    pendingAudioQueue.current?.pause();
    pendingAudioQueue.current = null;
    audioQueueReady.current = null;
    audioQueueNamespace.current = null;
    setPendingAudio([]);
    setTranscribing(false);
    if (recoveryNamespace) {
      audioQueue();
      void (audioQueueReady.current as Promise<void> | null)?.catch(
        (error: unknown) => {
          if (currentAudioNamespace() === recoveryNamespace) fail(error);
        },
      );
    }
    return () => {
      pendingAudioQueue.current?.pause();
    };
  }, [recoveryNamespace]);
  useEffect(() => {
    const protectPendingCapture = (event: BeforeUnloadEvent) => {
      if (
        recordingRef.current ||
        acquiringAudio.current ||
        pendingAudio.some((clip) => !clip.durable)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protectPendingCapture);
    return () =>
      window.removeEventListener("beforeunload", protectPendingCapture);
  }, [pendingAudio]);
  async function queueTranscription(
    blob: Blob,
    sessionId: string,
    timing?: { startedAt: string; duration: number },
    captureQueue?: AudioQueue,
  ) {
    const queue = captureQueue || audioQueue();
    if (!captureQueue) await audioQueueReady.current;
    try {
      await queue.enqueue({
        blob,
        sessionId,
        ...timing,
        finalCapture: Boolean(timing),
      });
      if (queue === pendingAudioQueue.current && !queue.capacity()) {
        stopRecording();
        notify(
          "Recording paused: audio backlog is full. Process pending clips before recording again.",
        );
      }
    } catch (e) {
      stopRecording();
      fail(e);
      throw e;
    }
  }
  function downloadPendingAudio(id: string) {
    const clip = audioQueue().get(id);
    if (!clip) return;
    const url = URL.createObjectURL(clip.blob);
    const link = document.createElement("a");
    const ext = clip.blob.type.includes("mp4")
      ? "m4a"
      : clip.blob.type.split("/")[1]?.split(";")[0] || "webm";
    link.href = url;
    link.download = `lensdesk-audio-${clip.id}.${ext}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (clip.segments)
      download(
        `lensdesk-transcript-${clip.id}.txt`,
        clip.segments.map((segment) => segment.text).join(""),
      );
  }
  async function startRecording() {
    if (recordingRef.current) {
      stopRecording();
      return;
    }
    if (acquiringAudio.current) return;
    acquiringAudio.current = true;
    const acquisition = ++audioAcquisition.current;
    const ensureCurrent = () => {
      if (audioAcquisition.current !== acquisition)
        throw new Error("Audio recording was canceled.");
    };
    const remember = (source: MediaStream) => {
      if (audioAcquisition.current !== acquisition) {
        source.getTracks().forEach((track) => track.stop());
        ensureCurrent();
      }
      sourceStreams.current.push(source);
      return source;
    };
    try {
      const queue = audioQueue();
      await audioQueueReady.current;
      ensureCurrent();
      if (!queue.capacity())
        throw new Error(
          "Audio backlog is full. Retry, download, or discard pending clips first.",
        );
      if (!(await flushDrafts())) return;
      ensureCurrent();
      let session = currentRef.current;
      if (!session) {
        session = await createSession("general");
        currentRef.current = session;
        setActiveId(session.id);
      }
      if (session.endedAt)
        throw new Error("Resume this session before recording audio.");
      const workspace = stateRef.current;
      let provider = workspace?.settings.transcriptionProvider;
      if (!provider || !workspace?.keys[provider]) {
        if (workspace?.keys?.["gemini"]) provider = "gemini";
        else if (workspace?.keys?.["groq"]) provider = "groq";
        else if (workspace?.keys?.["openai"]) provider = "openai";
      }
      if (!provider || !workspace?.keys[provider]) {
        if (!desktop || !floating) setPage("settings");
        throw new Error(
          `Add an API key in Settings (Gemini, Groq, or OpenAI) for speech recognition.`,
        );
      }
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Audio capture is unavailable in this environment. Use the desktop app or a supported secure browser.",
        );
      const mime = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg",
      ].find((value) => MediaRecorder.isTypeSupported(value));
      if (!mime)
        throw new Error(
          "Audio recording is not supported on this platform. Import an audio file.",
        );
      const inputs: MediaStream[] = [];
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
      };
      const mic = remember(
        await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        }),
      );
      ensureCurrent();
      mic
        .getTracks()
        .forEach((track) =>
          track.addEventListener("ended", stopRecording, { once: true }),
        );
      setMicrophones(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (device) => device.kind === "audioinput",
        ),
      );
      ensureCurrent();
      inputs.push(mic);
      const context = new AudioContext();
      audioContext.current = context;
      await context.resume();
      ensureCurrent();
      if (inputs.length > 1) {
        const destination = context.createMediaStreamDestination();
        inputs.forEach((input) =>
          context.createMediaStreamSource(input).connect(destination),
        );
        stream.current = destination.stream;
      } else stream.current = inputs[0];
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream.current!).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let lastMeter = 0;
      let lastSpeechTime = 0;
      let speechActiveInChunk = false;
      let currentChunkRec: MediaRecorder | null = null;
      let chunkStartTime = 0;

      const meter = (time: number) => {
        if (!recordingRef.current) return;
        if (time - lastMeter > 80) {
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce(
              (sum, value) => sum + ((value - 128) / 128) ** 2,
              0,
            ) / samples.length,
          );
          const level = Math.min(100, Math.round(rms * 320));
          setAudioLevel(level);
          lastMeter = time;

          const now = Date.now();
          if (level > 12) {
            lastSpeechTime = now;
            speechActiveInChunk = true;
          }

          // Real-time chunk completion upon pause/silence:
          if (
            speechActiveInChunk &&
            lastSpeechTime > 0 &&
            now - lastSpeechTime > 1100 &&
            now - chunkStartTime > 1400 &&
            currentChunkRec &&
            currentChunkRec.state === "recording"
          ) {
            speechActiveInChunk = false;
            lastSpeechTime = 0;
            if (recordTimer.current) clearTimeout(recordTimer.current);
            try {
              currentChunkRec.stop();
            } catch {}
          }
        }
        meterFrame.current = requestAnimationFrame(meter);
      };
      recordingRef.current = true;
      setRecording(true);
      meterFrame.current = requestAnimationFrame(meter);
      const sessionId = session.id;
      function nextChunk() {
        if (!recordingRef.current || !stream.current) return;
        try {
          const rec = new MediaRecorder(stream.current, { mimeType: mime! });
          recorder.current = rec;
          currentChunkRec = rec;
          chunkStartTime = Date.now();
          speechActiveInChunk = false;
          const chunkStarted = chunkStartTime;
          const chunks: BlobPart[] = [];
          rec.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
          };
          rec.onerror = () => {
            stopRecording();
            fail(
              new Error(
                "Audio capture failed. Any captured clip remains in Pending audio.",
              ),
            );
          };
          rec.onstop = () => {
            currentChunkRec = null;
            void (async () => {
              if (chunks.length)
                await queueTranscription(
                  new Blob(chunks, { type: mime }),
                  sessionId,
                  {
                    startedAt: new Date(chunkStarted).toISOString(),
                    duration: (Date.now() - chunkStarted) / 1000,
                  },
                  queue,
                );
              if (
                recordingRef.current &&
                audioAcquisition.current === acquisition
              )
                nextChunk();
            })().catch((error) => {
              stopRecording();
              fail(error);
            });
          };
          rec.start();
          recordTimer.current = setTimeout(() => {
            if (rec.state === "recording") rec.stop();
          }, 3500);
        } catch (error) {
          stopRecording();
          fail(error);
        }
      }
      nextChunk();
    } catch (error) {
      stopRecording();
      throw error;
    } finally {
      acquiringAudio.current = false;
    }
  }
  async function importAudio(file: File) {
    if (!current) return;
    if (file.size > 20000000)
      throw new Error("Choose an audio file smaller than 20 MB.");
    const ext = file.name.split(".").pop()?.toLowerCase(),
      mime =
        ext === "m4a" || ext === "mp4"
          ? "audio/mp4"
          : ext === "ogg"
            ? "audio/ogg"
            : ext === "wav"
              ? "audio/wav"
              : ext === "webm"
                ? "audio/webm"
                : null;
    if (!mime)
      throw new Error("Choose a WebM, M4A, MP4, OGG, or WAV recording.");
    await queueTranscription(new Blob([file], { type: mime }), current.id);
  }
  async function handleImportResume(file: File) {
    if (file.size > 10000000) {
      throw new Error("Choose a document smaller than 10 MB.");
    }
    notify(`Reading ${file.name}…`);
    const { text } = await api<{ text: string }>("document.read", {
      name: file.name,
      data: (await fileData(file)).split(",")[1],
    });
    if (!text || !text.trim()) {
      throw new Error("No readable text found in document.");
    }
    const cleanText = text.trim();
    // 1. Update or create profile
    let currentSession = currentRef.current;
    let targetProfile =
      stateRef.current?.profiles.find((p) => p.id === currentSession?.profileId) ||
      stateRef.current?.profiles[0];

    if (targetProfile) {
      const updatedProfile = { ...targetProfile, resume: cleanText };
      await api("profile.save", updatedProfile);
      setState((old) =>
        old
          ? {
              ...old,
              profiles: old.profiles.map((p) =>
                p.id === updatedProfile.id ? updatedProfile : p,
              ),
            }
          : old,
      );
    } else {
      const newProfile: Profile = {
        id: crypto.randomUUID(),
        name: "Candidate Profile",
        role: "Applicant",
        company: "Interview",
        resume: cleanText,
        jobDescription: "",
      };
      await api("profile.save", newProfile);
      setState((old) => (old ? { ...old, profiles: [newProfile] } : old));
      if (currentSession) {
        await saveSession({ ...currentSession, profileId: newProfile.id });
      }
    }

    // 2. Also inject into session notes for immediate display and AI context
    if (currentSession) {
      const existingNotes = currentSession.notes?.trim() || "";
      const prefix = "=== RESUME & EXPERIENCE ===\n";
      const updatedNotes = existingNotes
        ? `${prefix}${cleanText}\n\n=== NOTES ===\n${existingNotes.replace(/^=== RESUME & EXPERIENCE ===\n[\s\S]*?\n\n=== NOTES ===\n/, "")}`
        : `${prefix}${cleanText}`;
      editField(currentSession, "notes", updatedNotes);
      void flushDrafts();
    }
    notify(
      `Resume "${file.name}" loaded (${cleanText.length} chars). AI will tailor answers to your experience!`,
    );
  }
  async function exportCurrent(format: "md" | "pdf") {
    if (!current) return;
    if (desktop) {
      const result = await api("desktop.export", { id: current.id, format });
      if (!result.canceled) notify("Session exported.");
    } else if (format === "md") {
      download(`${current.title}.md`, sessionMarkdown(current));
    } else {
      window.print();
    }
  }
  async function navigate(next: string) {
    if (busy || recording || transcribing) {
      notify("Finish the current recording or request first.");
      return;
    }
    if (!(await flushDrafts())) return;
    setPage(next);
    setError("");
    if (!desktop) {
      const targetUrl = getPathForPage(next);
      if (window.location.pathname !== targetUrl) {
        window.history.pushState({ page: next }, "", targetUrl);
      }
    }
  }

  useEffect(() => {
    if (desktop) return;
    const handlePopState = () => {
      const target = getPageFromPath(window.location.pathname, false);
      setPage(target);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [desktop]);

  async function selectSession(s: Session) {
    if (busy || recording || transcribing) {
      notify("Finish the current recording or request first.");
      return;
    }
    if (!(await flushDrafts())) return;
    setActiveId(s.id);
    setPage("workspace");
    setQuestion("");
    setImages([]);
    setError("");
    if (!desktop) {
      const targetUrl = getPathForPage("workspace");
      if (window.location.pathname !== targetUrl) {
        window.history.pushState({ page: "workspace" }, "", targetUrl);
      }
    }
  }
  function emptyProfile(): Profile {
    return {
      id: uid(),
      name: "",
      role: "",
      company: "",
      resume: "",
      jobDescription: "",
    };
  }
  // Desktop launch is deliberately login-first. Nothing from the workshop is
  // mounted until the main-process gate has an active entitlement.
  const desktopAuthorized =
    desktop &&
    gate?.phase === "active" &&
    (gate?.licenseValid === true || Boolean(gate.entitlement));
  if (desktop && !desktopAuthorized) {
    return (
      <FloatingGate
        gate={gate}
        notice={toast}
        onNotice={notify}
        onError={fail}
        onSignedIn={() => {
          window.dispatchEvent(new Event("lensdesk:account-changed"));
          run(refresh);
        }}
        onHide={handleHideWindow}
        onQuit={() => run(() => api("desktop.quit"))}
      />
    );
  }
  if (!state)
    return (
      <div className={`loading${desktop ? " loading-floating" : ""}`}>
        <Aperture size={40} />
        <h2>Opening your workspace</h2>
        {error ? (
          <p className="error">{error}</p>
        ) : (
          <Loader2 className="spin" />
        )}
      </div>
    );
  const sessionDisabled = busy || recording || transcribing;
  const keyCount =
    state.settings.provider === "local"
      ? 1
      : Object.values(state.keys).filter(Boolean).length;
  const overlayProps = {
    session: current,
    sessions: state.sessions,
    onSelectSession: (id: string) => {
      const s = state.sessions.find((x) => x.id === id);
      if (s) selectSession(s);
    },
    onNewSession: () => {
      if (floating) {
        run(() => createSession());
      } else {
        setModal("new");
      }
    },
    busy,
    streamingText,
    recording,
    recordSeconds,
    audioLevel,
    transcript: current?.transcript || "",
    interviewLayout: state.settings.interviewLayout,
    opacity: settingsDraft?.opacity ?? 1,
    onOpacityChange: handleOpacityChange,
    stealth: desktop ? (settingsDraft?.captureProtection ?? true) : false,
    onToggleStealth: () => run(handleToggleStealth),
    onCaptureScreen: () => run(quickCaptureScreen),
    onToggleRecording: () => {
      if (recording) stopRecording();
      else run(startRecording);
    },
    onSend: (text: string, options?: { webSearch?: boolean }) =>
      send(text, undefined, undefined, options),
    detectedQuestion,
    onDismissDetectedQuestion: () => setDetectedQuestion(null),
    onCancel: () => {
      generationController.current?.abort();
    },
    onToggleOverlay: () => run(toggleOverlayMode),
    images,
    onRemoveImage: (idx: number) =>
      setImages((old) => old.filter((_, i) => i !== idx)),
    provider: (() => {
      const draftP = settingsDraft?.provider;
      const stateP = state.settings?.provider;
      if (draftP && (state.keys?.[draftP] || state.ownedKeys?.[draftP])) return draftP;
      if (stateP && (state.keys?.[stateP] || state.ownedKeys?.[stateP])) return stateP;
      const anyWithKey = (Object.keys(state.keys || {}) as Provider[]).find((p) => Boolean(state.keys[p] || state.ownedKeys?.[p]));
      return anyWithKey || draftP || stateP || "gemini";
    })(),
    model: settingsDraft?.model || state.settings?.model || "gemini-2.5-flash",
    providerReady: Boolean(
      (settingsDraft?.provider === "local" || state.settings?.provider === "local") ||
      (settingsDraft?.provider && (state.keys?.[settingsDraft.provider] || state.ownedKeys?.[settingsDraft.provider])) ||
      (state.settings?.provider && (state.keys?.[state.settings.provider] || state.ownedKeys?.[state.settings.provider])) ||
      Object.values(state.keys || {}).some(Boolean) ||
      Object.values(state.ownedKeys || {}).some(Boolean)
    ),
    onConnectProvider: () => {
      setFloatingView("assistant");
      setHintlensSettingsTab("Model");
      setHintlensSettingsOpen(true);
    },
    desktop,
    shortcuts: desktopShortcuts,
    hideAnswer,
    onToggleHideAnswer: () => setHideAnswer((v) => !v),
    onAutoType: (text?: string) => run(() => handleAutoType(text)),
    autoTyping,
    onStopTyping: () =>
      run(async () => {
        await api("desktop.autoType.stop");
      }),
    error,
    notice: toast,
    onHideWindow: handleHideWindow,
    clickThrough,
    onToggleClickThrough: () => run(toggleClickThrough),
    onSnapAndSolve: () => run(snapAndSolve),
    onOpenSettings: (tab = "Model") => {
      setFloatingView("assistant");
      setHintlensSettingsTab(tab);
      setHintlensSettingsOpen(true);
    },
    onUndoCapture: () => setImages((old) => old.slice(0, -1)),
    onClearBundle: () => setImages([]),
    onToggleBrowser: () => {
      if (floating) {
        setFloatingView((v) => (v === "browser" ? "assistant" : "browser"));
      } else {
        run(async () => {
          await navigate(page === "browser" ? "workspace" : "browser");
        });
      }
    },
    activeView: floatingView,
    onToggleView: (v: "assistant" | "browser") => setFloatingView(v),
    renderBrowser: <WorkspaceBrowser onError={fail} />,
    onToggleInterviewLayout: () => {
      if (!settingsDraft) return;
      const nextLayout =
        settingsDraft.interviewLayout === "compact" ? "full" : "compact";
      setSettingsDraft({ ...settingsDraft, interviewLayout: nextLayout });
      void saveSettingsPatch({ interviewLayout: nextLayout });
    },
    onCycleProvider: cycleProvider,
    onCycleModel: cycleModel,
    onRegionSnip: () => run(captureRegion),
    profiles: state.profiles,
    activeProfile:
      state.profiles.find((p) => p.id === current?.profileId) ||
      state.profiles[0],
    onSelectProfile: (profileId: string) => {
      if (current) {
        run(async () => {
          await saveSession({ ...current, profileId });
        });
      }
    },
    onEditNotes: (notes: string) => {
      if (current) editField(current, "notes", notes);
    },
    onSaveNotes: () => {
      void flushDrafts();
    },
    onImportResume: (f?: File) => {
      if (f) run(() => handleImportResume(f));
      else docInput.current?.click();
    },
    autoAnswer,
    onToggleAutoAnswer: () => setAutoAnswer((v) => !v),
    microphones,
    microphoneId,
    onSelectMicrophone: setMicrophoneId,
    audioSource,
    onSetAudioSource: setAudioSource,
    elapsedSeconds: current?.activeSeconds ?? elapsed,
  };
  const handleSaveDesktopPreferences = async (prefs: any) => {
    try {
      const res: any = await api("desktop.preferences.save", prefs);
      const updated = res?.shortcuts ? res : prefs;
      setDesktopPreferences(updated);
      setDesktopShortcuts(updated.shortcuts || {});
      notify("Desktop settings updated.");
    } catch (err: any) {
      fail(err.message || "Failed to save desktop preferences.");
      throw err;
    }
  };
  const regionDialog = regionImage ? (
    <RegionCapture
      image={regionImage}
      onCancel={() => setRegionImage(null)}
      onCapture={attachRegion}
    />
  ) : null;
  if (desktop) {
    return (
      <>
        {regionDialog}
        <OverlayView
          {...overlayProps}
          activeView={floatingView}
          onToggleView={setFloatingView}
          singleWindow
          renderBrowser={<WorkspaceBrowser onError={fail} />}
        />
        {hintlensSettingsOpen && (
          <HintLensSettingsModal
            isOpen={hintlensSettingsOpen}
            onClose={() => setHintlensSettingsOpen(false)}
            initialTab={hintlensSettingsTab}
            settings={settingsDraft || state.settings}
            onSaveSettings={saveSettingsPatch}
            desktopPreferences={desktopPreferences}
            onSaveDesktopPreferences={handleSaveDesktopPreferences}
            onRestart={() => run(() => api("desktop.restart"))}
            onQuit={() => run(() => api("desktop.quit"))}
            keys={state.keys}
            onRefresh={refresh}
          />
        )}
        {authModalOpen && (
          <HintLensAuthModal
            isOpen={authModalOpen}
            onClose={() => setAuthModalOpen(false)}
            onSuccess={() => {
              setAuthModalOpen(false);
              run(refresh);
            }}
          />
        )}
        {Boolean(desktopPreferences?.mouse?.enabled) && radialWheelOpen && (
          <RadialActionWheel
            visible={radialWheelOpen}
            onClose={() => setRadialWheelOpen(false)}
            mousePosition={radialMousePos}
            slotsCount={desktopPreferences?.mouse?.slots || 6}
            size={desktopPreferences?.mouse?.size || 100}
            opacity={desktopPreferences?.mouse?.opacity || 85}
            style={desktopPreferences?.mouse?.style || "wheel"}
            slotActions={desktopPreferences?.mouse?.mappings}
            triggerButton={
              desktopPreferences?.mouse?.trigger === "right" ? 2 : 1
            }
            onSelectAction={handleRadialAction}
          />
        )}
      </>
    );
  }
  if (page === "home") {
    return <Home navigate={navigate} />;
  }
  if (page === "admin") {
    return <Admin navigate={navigate} />;
  }
  return (
    <div className={`app-shell ${desktop ? "desktop-shell" : "web-shell"}`}>
      {regionDialog}
      <aside className="sidebar">
        <div className="traffic-space" />
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate(!desktop ? "home" : "workspace");
          }}
        >
          <span className="brand-mark">
            <Aperture size={23} />
          </span>
          lensdesk<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          {[
            { id: "workspace", label: "Assistant", icon: Aperture },
            { id: "sessions", label: "Session history", icon: History },
            { id: "profiles", label: "Interview profiles", icon: UserRound },
            { id: "account", label: "Account & cloud", icon: ShieldCheck },
            ...(desktop
              ? [{ id: "browser", label: "Browser", icon: Globe }]
              : []),
          ].map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === "workspace" && (
                <span className="nav-key">{keyLabel("toggle")}</span>
              )}
              {item.id === "sessions" && (
                <span className="nav-count">{state.sessions.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${page === "downloads" ? "active" : ""}`}
            onClick={() => navigate("downloads")}
          >
            <Download size={18} />
            Desktop & shortcuts
          </button>
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            Settings{!keyCount && <span className="small-dot" />}
          </button>
          <div className="user-row">
            <div className="avatar">Y</div>
            <div>
              <strong>Personal workspace</strong>
              <span>
                {desktop
                  ? "Desktop edition"
                  : cloudStorage
                    ? "Cloud workspace"
                    : "Browser preview"}
              </span>
            </div>
            <span className="local-badge">
              {cloudStorage ? "CLOUD" : "LOCAL"}
            </span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={14} />
            <strong>
              {page === "workspace"
                ? "Assistant"
                : page === "sessions"
                  ? "Session history"
                  : page === "profiles"
                    ? "Interview profiles"
                    : page === "settings"
                      ? "Settings"
                      : page === "account"
                        ? "Account & cloud"
                        : page === "browser"
                          ? "Browser"
                          : page === "home"
                            ? "Welcome"
                            : "Desktop & shortcuts"}
            </strong>
          </div>
          <div className="top-actions">
            <select
              className="theme-select"
              aria-label="Color theme"
              value={state.settings.theme || "system"}
              onChange={(event) =>
                run(() =>
                  saveSettingsPatch({ theme: event.target.value as Theme }),
                )
              }
            >
              <option value="system">System theme</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <select
              className="compact-nav"
              aria-label="Navigate workspace"
              value={page}
              onChange={(e) => navigate(e.target.value)}
            >
              <option value="workspace">Assistant</option>
              <option value="sessions">History</option>
              <option value="profiles">Profiles</option>
              <option value="settings">Settings</option>
              <option value="downloads">Guide</option>
              <option value="account">Account & cloud</option>
              {desktop && <option value="browser">Browser</option>}
            </select>
            <span className="platform-badge">
              <span />
              {desktop
                ? "Desktop connected"
                : cloudStorage
                  ? "Cloud workspace"
                  : "Browser preview"}
            </span>
            <button
              className="text-button"
              onClick={() => navigate("downloads")}
            >
              <BookOpen size={15} />
              Quick guide
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <IconButton label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        {page === "browser" && desktop && !floating && !modal && (
          <WorkspaceBrowser onError={fail} />
        )}
        {page === "workspace" && (
          <div className="workspace-page">
            {pipActive ? (
              <div className="pip-placeholder">
                <div className="pip-placeholder-card">
                  <PanelRightOpen size={40} />
                  <h3>Overlay Floating Over Browser</h3>
                  <p>
                    LensDesk is running in Picture-in-Picture mode on top of
                    your browser and applications.
                  </p>
                  <div className="pip-placeholder-actions">
                    <button
                      className="button primary"
                      onClick={() => pipWindowRef.current?.focus()}
                    >
                      Focus Overlay Window
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => {
                        pipWindowRef.current?.close();
                        setPipActive(false);
                      }}
                    >
                      Return to Workspace
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="workspace-header-bar">
                  <div className="workspace-header-left">
                    <span
                      className={`status-orb ${current && !current.endedAt ? "live" : ""}`}
                    />
                    {current ? (
                      <input
                        className="workspace-title-input"
                        aria-label="Session title"
                        key={current.id}
                        defaultValue={current.title}
                        disabled={sessionDisabled}
                        onBlur={(e) => {
                          const title =
                            e.target.value.trim().slice(0, 150) ||
                            current.title;
                          e.target.value = title;
                          if (title !== current.title)
                            run(async () => {
                              await saveSession({ ...current, title });
                            });
                        }}
                      />
                    ) : (
                      <h2 className="workspace-header-title">LensDesk Assistant</h2>
                    )}
                    <div className="mode-chips">
                      {(["general", "coding", "system-design", "behavioral"] as Mode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`mode-chip ${current?.mode === m ? "active" : ""}`}
                          onClick={() => {
                            if (current) {
                              run(async () => {
                                await saveSession({ ...current, mode: m });
                              });
                            }
                          }}
                        >
                          {modeLabels[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="workspace-header-right">
                    <div className="workshop-model-bar">
                      <select
                        aria-label="Active AI Provider"
                        className="workshop-provider-select"
                        value={state.settings.provider}
                        onChange={(e) =>
                          run(() =>
                            handleWorkshopProviderChange(
                              e.target.value as Provider,
                            ),
                          )
                        }
                      >
                        {Object.entries(providerMeta)
                          .filter(([id]) => id !== "local" || desktop)
                          .map(([id, meta]) => {
                            const isReady =
                              id === "local" ||
                              Boolean(state.keys[id as Provider]);
                            return (
                              <option key={id} value={id}>
                                {meta.label} {isReady ? "✓ Ready" : "· Key needed"}
                              </option>
                            );
                          })}
                      </select>
                      {state.settings.provider !== "local" &&
                      !state.keys[state.settings.provider] ? (
                        <button
                          type="button"
                          className="workshop-add-key-pill"
                          onClick={() =>
                            setQuickKeyModal(state.settings.provider)
                          }
                          title="Add API Key for this provider"
                        >
                          + Add Key
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="workshop-test-btn"
                          disabled={modelTesting}
                          onClick={() => void testCurrentModel()}
                          title="Test API connection with this provider"
                        >
                          {modelTesting ? (
                            <>
                              <Loader2 size={12} className="spin" /> Testing…
                            </>
                          ) : (
                            <>
                              <Sparkles size={12} /> Test
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    {current && (
                      <span className="timer" style={{ fontSize: "12px", color: "var(--site-dark-muted, #9aa698)" }}>
                        <Clock size={13} style={{ marginRight: 4, verticalAlign: "middle" }} />
                        {Math.floor(elapsed / 60)
                          .toString()
                          .padStart(2, "0")}
                        :{(elapsed % 60).toString().padStart(2, "0")}
                      </span>
                    )}
                    <button
                      type="button"
                      className={`button secondary context-toggle-btn ${showContext ? "active" : ""}`}
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                      onClick={() => setShowContext(!showContext)}
                      title={showContext ? "Hide Context & Notes" : "Show Audio & Notes Context"}
                    >
                      <AudioLines size={14} />
                      {showContext ? "Hide Context" : "Audio & Notes"}
                    </button>
                    {current && (
                      <IconButton
                        label="Export Markdown"
                        disabled={sessionDisabled}
                        onClick={() => run(() => exportCurrent("md"))}
                      >
                        <Download size={15} />
                      </IconButton>
                    )}
                    <button
                      type="button"
                      className="button primary"
                      style={{ padding: "6px 14px", fontSize: "12px" }}
                      disabled={sessionDisabled}
                      aria-label="New session"
                      onClick={() => setModal("new")}
                    >
                      <Plus size={15} />
                      New session
                    </button>
                    {desktop && (
                      <button
                        className="button secondary overlay-button"
                        onClick={() => run(toggleOverlayMode)}
                        title="Toggle floating overlay over any browser window"
                      >
                        <PanelRightOpen size={15} />
                        Overlay
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={`workbench ${showContext ? "with-context" : "full-chat"}`}
                >
                  {showContext && (
                    <section className="context-panel">
                      <div className="panel-header">
                        <div className="panel-tabs">
                          <button
                            className={tab === "transcript" ? "active" : ""}
                            onClick={() => setTab("transcript")}
                          >
                            <AudioLines size={16} />
                            Transcript
                          </button>
                          <button
                            className={tab === "notes" ? "active" : ""}
                            onClick={() => setTab("notes")}
                          >
                            <FileText size={15} />
                            Notes
                          </button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="tiny-label">CONTEXT</span>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Close context"
                            onClick={() => setShowContext(false)}
                            title="Close context panel"
                            style={{ width: 24, height: 24, padding: 0 }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    <div className="context-content">
                      {tab === "transcript" ? (
                        <>
                          {current?.transcript ? (
                            <textarea
                              aria-label="Transcript"
                              className="transcript-editor"
                              value={current.transcript}
                              disabled={sessionDisabled}
                              onChange={(e) =>
                                editField(current, "transcript", e.target.value)
                              }
                              onBlur={() => {
                                void flushDrafts();
                              }}
                            />
                          ) : (
                            <div className="transcript-empty">
                              <div
                                className={`audio-visual ${recording ? "is-recording" : ""}`}
                              >
                                {[
                                  12, 22, 34, 46, 28, 18, 38, 54, 32, 20, 12,
                                ].map((h, i) => (
                                  <span
                                    key={i}
                                    style={{
                                      height: h,
                                      animationDelay: `${i * 0.1}s`,
                                    }}
                                  />
                                ))}
                              </div>
                              <h3>
                                {recording
                                  ? audioSource === "microphone"
                                    ? "Listening to your microphone"
                                    : "Listening to shared audio"
                                  : transcribing
                                    ? "Transcribing your recording…"
                                    : "Audio & Transcription"}
                              </h3>
                              <p>
                                {recording
                                  ? "Live transcript updates continuously. You can ask questions while recording."
                                  : "Record audio or import files. Your transcript is automatically used as context."}
                              </p>
                              {!current && (
                                <button
                                  className="text-link"
                                  onClick={() => setModal("new")}
                                >
                                  Start your first session{" "}
                                  <ChevronRight size={15} />
                                </button>
                              )}
                            </div>
                          )}
                          {recording && current?.transcript && (
                            <p className="recording-label">
                              <span className="red-dot" />
                              Recording · {recordSeconds}s
                            </p>
                          )}
                        </>
                      ) : (
                        <textarea
                          className="notes-editor"
                          aria-label="Session notes"
                          placeholder="Keep your thoughts close.\n\nAdd an agenda, a problem statement, or details you want the assistant to remember."
                          value={current?.notes || ""}
                          disabled={!current || sessionDisabled}
                          onChange={(e) =>
                            current &&
                            editField(current, "notes", e.target.value)
                          }
                          onBlur={() => {
                            void flushDrafts();
                          }}
                        />
                      )}
                    </div>
                    {current && (
                      <div className="microphone-controls">
                        <label>
                          Microphone
                          <select
                            aria-label="Microphone device"
                            value={microphoneId}
                            disabled={recording || audioSource === "computer"}
                            onChange={(e) => setMicrophoneId(e.target.value)}
                          >
                            <option value="">System default microphone</option>
                            {microphones.map((device, i) => (
                              <option
                                key={device.deviceId}
                                value={device.deviceId}
                              >
                                {device.label || `Microphone ${i + 1}`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="text-button"
                          disabled={recording}
                          onClick={() =>
                            run(async () => {
                              const sample =
                                await navigator.mediaDevices.getUserMedia({
                                  audio: true,
                                });
                              try {
                                setMicrophones(
                                  (
                                    await navigator.mediaDevices.enumerateDevices()
                                  ).filter((d) => d.kind === "audioinput"),
                                );
                              } finally {
                                sample.getTracks().forEach((t) => t.stop());
                              }
                            })
                          }
                        >
                          Refresh microphones
                        </button>
                        {recording && (
                          <label>
                            Input level{" "}
                            <meter
                              aria-label="Audio input level"
                              min={0}
                              max={100}
                              value={audioLevel}
                            />
                            {audioLevel === 0
                              ? " No input detected"
                              : " Audio detected"}
                          </label>
                        )}
                      </div>
                    )}
                    <div className="recording-controls">
                      <div className="recording-description">
                        <span className={recording ? "red-dot" : "gray-dot"} />
                        {recording
                          ? "Recording audio"
                          : transcribing
                            ? "Transcribing…"
                            : "Audio is off"}
                        <span className="recording-time">
                          {recording ? `${recordSeconds}s` : "15s segments"}
                        </span>
                      </div>
                      <select
                        aria-label="Audio source"
                        className="audio-source"
                        disabled={sessionDisabled}
                        value={audioSource}
                        onChange={(e) =>
                          setAudioSource(e.target.value as typeof audioSource)
                        }
                      >
                        <option value="microphone">Microphone</option>
                        <option value="computer">Computer audio</option>
                        <option value="both">Microphone + computer</option>
                      </select>
                      <div className="recording-buttons">
                        <button
                          className={`button ${recording ? "danger" : "secondary"}`}
                          disabled={
                            !current ||
                            Boolean(current.endedAt) ||
                            (!recording && (busy || transcribing))
                          }
                          onClick={() => run(startRecording)}
                        >
                          {recording ? <Square size={14} /> : <Mic size={16} />}{" "}
                          {recording ? "Stop recording" : "Record audio"}
                        </button>
                        <IconButton
                          label="Import an audio recording"
                          disabled={
                            !current ||
                            sessionDisabled ||
                            Boolean(current.endedAt)
                          }
                          onClick={() => audioInput.current?.click()}
                        >
                          <Upload size={17} />
                        </IconButton>
                      </div>
                      <p>Record only with everyone’s permission.</p>
                      {visiblePendingAudio.length > 0 && (
                        <section
                          aria-label="Pending audio"
                          className="pending-audio"
                        >
                          <strong>
                            Pending audio ({visiblePendingAudio.length})
                          </strong>
                          <p>
                            Clips are stored encrypted offline. You can retry, download, or discard clips below.
                          </p>
                          {visiblePendingAudio.map((clip) => (
                            <div key={clip.id}>
                              <span>
                                {new Date(clip.startedAt).toLocaleTimeString()}{" "}
                                · {Math.ceil(clip.bytes / 1024)} KB ·{" "}
                                {clip.status}
                              </span>
                              {clip.error && <p role="status">{clip.error}</p>}
                              {!clip.durable && (
                                <p>
                                  Not saved to recovery storage. Download before
                                  closing.
                                </p>
                              )}
                              <button
                                className="text-button"
                                onClick={() => downloadPendingAudio(clip.id)}
                              >
                                Download clip
                                {clip.segments ? " and transcript" : ""}
                              </button>
                              {clip.status === "failed" && (
                                <>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      run(() => audioQueue().retry(clip.id))
                                    }
                                  >
                                    Retry clip
                                  </button>
                                  <button
                                    className="text-button danger-text"
                                    onClick={() =>
                                      run(() => audioQueue().remove(clip.id))
                                    }
                                  >
                                    Discard clip
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                        </section>
                      )}
                      {current?.transcript && (
                        <button
                          className="transcript-question text-link"
                          disabled={sessionDisabled || Boolean(current.endedAt)}
                          onClick={() =>
                            setQuestion(
                              "Help me answer the latest question in this transcript:\n\n" +
                                current.transcript.slice(-10000),
                            )
                          }
                        >
                          <Sparkles size={13} />
                          Use latest transcript as a question
                        </button>
                      )}
                    </div>
                    <div className="context-profile">
                      <UserRound size={18} />
                      <div>
                        <span>INTERVIEW PROFILE</span>
                        <select
                          aria-label="Interview profile"
                          value={current?.profileId || ""}
                          disabled={!current || sessionDisabled}
                          onChange={(e) =>
                            run(async () => {
                              await saveSession({
                                ...current!,
                                profileId: e.target.value,
                              });
                            })
                          }
                        >
                          <option value="">No profile selected</option>
                          {state.profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <IconButton
                        label="Manage profiles"
                        onClick={() => navigate("profiles")}
                      >
                        <ChevronRight size={17} />
                      </IconButton>
                    </div>
                  </section>
                  )}
                  <section className="answer-panel">
                    <div className="print-context">
                      <h1>{current?.title}</h1>
                      <h2>Notes</h2>
                      <pre>{current?.notes}</pre>
                      <h2>Transcript</h2>
                      <pre>{current?.transcript}</pre>
                      <h2>Conversation</h2>
                    </div>
                    <div className="conversation">
                      {!current?.messages.length ? (
                        <div className="assistant-welcome">
                          <div className="welcome-mark">
                            <Aperture size={31} />
                          </div>
                          <h2>What would you like to explore?</h2>
                          <p>
                            Ask a question, analyze a problem, or capture your screen to get started.
                          </p>
                          <div className="starter-list">
                            {starters.map((s) => (
                              <button
                                key={s.mode}
                                disabled={
                                  sessionDisabled || Boolean(current?.endedAt)
                                }
                                onClick={() => {
                                  setQuestion(s.text);
                                  if (current)
                                    run(async () => {
                                      await saveSession({
                                        ...current,
                                        mode: s.mode,
                                      });
                                    });
                                  else {
                                    setNewMode(s.mode);
                                  }
                                }}
                              >
                                <span>
                                  <s.icon size={17} />
                                </span>
                                {s.title}
                                <ChevronRight size={16} />
                              </button>
                            ))}
                          </div>
                          {!keyCount && (
                            <div className="download-portal-hero" style={{ marginTop: "24px", textAlign: "left" }}>
                              <div className="site-kicker" style={{ marginBottom: "8px" }}>
                                <span />
                                READY TO BEGIN
                              </div>
                              <h3 style={{ margin: "0 0 8px", fontSize: "17px", color: "#f3f5ed" }}>
                                Connect your AI provider or local model
                              </h3>
                              <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#9aa698", lineHeight: 1.5 }}>
                                LensDesk works directly with your OpenAI, Anthropic, Gemini, Groq, DeepSeek, or local Ollama endpoints. Your keys stay encrypted on your device.
                              </p>
                              <button
                                type="button"
                                className="download-action-btn primary"
                                style={{ width: "auto", display: "inline-flex", padding: "10px 18px", fontSize: "12px" }}
                                onClick={() => navigate("settings")}
                              >
                                <KeyRound size={14} />
                                Open Settings & Connect Provider
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        current.messages.map((m) => (
                          <article key={m.id} className={`message ${m.role}`}>
                            <div className="message-heading">
                              <span
                                className={
                                  m.role === "assistant"
                                    ? "mini-mark"
                                    : "you-mark"
                                }
                              >
                                {m.role === "assistant" ? (
                                  <Aperture size={15} />
                                ) : (
                                  <UserRound size={14} />
                                )}
                              </span>
                              <strong>
                                {m.role === "assistant" ? "LensDesk" : "You"}
                              </strong>
                              <time>
                                {new Date(m.createdAt).toLocaleTimeString(
                                  undefined,
                                  { hour: "2-digit", minute: "2-digit" },
                                )}
                              </time>
                              {m.role === "assistant" &&
                                m.content.includes("```") && (
                                  <IconButton
                                    label="Auto-type code into editor (Cmd+Shift+T)"
                                    onClick={() =>
                                      run(() => handleAutoType(m.content))
                                    }
                                  >
                                    <Keyboard size={14} />
                                  </IconButton>
                                )}
                              <IconButton
                                label="Copy message"
                                onClick={() =>
                                  run(async () => {
                                    await navigator.clipboard.writeText(
                                      m.content,
                                    );
                                    notify("Copied to clipboard.");
                                  })
                                }
                              >
                                <Clipboard size={14} />
                              </IconButton>
                            </div>
                            {m.images?.length ? (
                              <div className="message-images">
                                {m.images.map((img, i) => (
                                  <img
                                    key={i}
                                    src={img}
                                    alt={`Attached screenshot ${i + 1}`}
                                  />
                                ))}
                              </div>
                            ) : null}
                            {m.role === "assistant" && hideAnswer ? (
                              <div
                                className="overlay-masked-content"
                                onClick={() => setHideAnswer(false)}
                                title="Click to reveal answer"
                                style={{ margin: "10px 0" }}
                              >
                                <EyeOff size={16} />
                                <span>
                                  Answer hidden for privacy (Panic mode)
                                </span>
                                <small>
                                  Press Cmd+Shift+A or click to reveal
                                </small>
                              </div>
                            ) : (
                              <div className="markdown">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    a: ({ href, children }) => (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {children}
                                      </a>
                                    ),
                                    img: () => null,
                                    code: ({ node, inline, className, children, ...props }: any) => {
                                      const match = /language-(\w+)/.exec(className || "");
                                      const text = String(children).replace(/\n$/, "");
                                      if (!inline && (match || text.includes("\n"))) {
                                        return <CodeBlock language={match ? match[1] : "code"} code={text} />;
                                      }
                                      return <code className={className} {...props}>{children}</code>;
                                    },
                                  }}
                                >
                                  {m.content}
                                </ReactMarkdown>
                              </div>
                            )}
                          </article>
                        ))
                      )}
                      {busy && streamingText && (
                        <article
                          className="message assistant"
                          aria-live="polite"
                        >
                          {hideAnswer ? (
                            <div
                              className="overlay-masked-content"
                              onClick={() => setHideAnswer(false)}
                              title="Click to reveal answer"
                              style={{ margin: "10px 0" }}
                            >
                              <EyeOff size={16} />
                              <span>
                                Answer hidden for privacy (Panic mode)
                              </span>
                              <small>
                                Press Cmd+Shift+A or click to reveal
                              </small>
                            </div>
                          ) : (
                            <div className="markdown">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  img: () => null,
                                  code: ({ node, inline, className, children, ...props }: any) => {
                                    const match = /language-(\w+)/.exec(className || "");
                                    const text = String(children).replace(/\n$/, "");
                                    if (!inline && (match || text.includes("\n"))) {
                                      return <CodeBlock language={match ? match[1] : "code"} code={text} />;
                                    }
                                    return <code className={className} {...props}>{children}</code>;
                                  },
                                }}
                              >
                                {streamingText}
                              </ReactMarkdown>
                            </div>
                          )}
                        </article>
                      )}
                      {busy && (
                        <div className="thinking">
                          <Aperture size={17} className="spin" />
                          {streamingText
                            ? "Writing your answer"
                            : "Thinking through your question"}
                          <button
                            onClick={() =>
                              generationController.current?.abort()
                            }
                          >
                            Stop
                          </button>
                        </div>
                      )}
                      <div ref={endRef} />
                    </div>
                    <div className="composer-area">
                      {images.length > 0 && (
                        <div className="attachments">
                          {images.map((img, i) => (
                            <div key={i}>
                              <img src={img} alt={`Screenshot ${i + 1}`} />
                              <IconButton
                                label={`Remove screenshot ${i + 1}`}
                                onClick={() =>
                                  setImages((old) =>
                                    old.filter((_, index) => index !== i),
                                  )
                                }
                              >
                                <X size={12} />
                              </IconButton>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="composer">
                        <textarea
                          aria-label="Ask LensDesk"
                          value={question}
                          disabled={busy || Boolean(current?.endedAt)}
                          onChange={(e) => setQuestion(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              send(
                                question,
                                current ? undefined : newMode,
                                undefined,
                                { webSearch: workspaceWebSearch },
                              );
                            }
                          }}
                          placeholder={
                            current?.endedAt
                              ? "Resume this session to keep the conversation going…"
                              : workspaceWebSearch
                                ? "Ask with live web search & citations…"
                                : "Ask a question or explore an idea…"
                          }
                        />
                        <div className="composer-bottom">
                          <div>
                            <IconButton
                              label="Capture a screen"
                              disabled={
                                sessionDisabled ||
                                !current ||
                                Boolean(current.endedAt) ||
                                images.length >= 5
                              }
                              onClick={() => run(capture)}
                            >
                              <Monitor size={17} />
                            </IconButton>
                            <IconButton
                              label="Attach an image"
                              disabled={
                                sessionDisabled ||
                                images.length >= 5 ||
                                Boolean(current?.endedAt)
                              }
                              onClick={() => imageInput.current?.click()}
                            >
                              <ImagePlus size={18} />
                            </IconButton>
                            <IconButton
                              label={
                                workspaceWebSearch
                                  ? "Live Web Search ON (DuckDuckGo)"
                                  : "Enable Live Web Search"
                              }
                              className={workspaceWebSearch ? "active" : ""}
                              disabled={
                                sessionDisabled || Boolean(current?.endedAt)
                              }
                              onClick={() => setWorkspaceWebSearch((v) => !v)}
                            >
                              <Globe size={18} />
                            </IconButton>
                            <span className="composer-context">
                              {current?.transcript
                                ? "Transcript included"
                                : workspaceWebSearch
                                  ? "Web search active"
                                  : "Add context, get better answers"}
                            </span>
                          </div>
                          <button
                            className="send-button"
                            aria-label="Send question"
                            disabled={
                              busy ||
                              (!question.trim() && !images.length) ||
                              Boolean(current?.endedAt)
                            }
                            onClick={() =>
                              send(
                                question,
                                current ? undefined : newMode,
                                undefined,
                                { webSearch: workspaceWebSearch },
                              )
                            }
                          >
                            {busy ? (
                              <Loader2 size={19} className="spin" />
                            ) : (
                              <ArrowUp size={21} />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="composer-footer">
                        <span>
                          <ShieldCheck size={12} />
                          Your API key. Your choice of model.
                        </span>
                        <span>↵ to send · ⇧ ↵ for a new line</span>
                      </div>
                    </div>
                  </section>
                </div>
                <div className="workspace-footer">
                  <span>
                    <span className="small-dot" />
                    <span role="status">
                      {saveStatus === "saving"
                        ? "Saving…"
                        : saveStatus === "pending"
                          ? "Unsaved changes"
                          : saveStatus === "error"
                            ? "Save failed · your text is still in the editor"
                            : cloudStorage
                              ? "Saved to your cloud account"
                              : "All changes saved locally"}
                    </span>
                    {saveStatus === "error" && (
                      <button
                        className="text-button"
                        onClick={() => {
                          void flushDrafts();
                        }}
                      >
                        Retry save
                      </button>
                    )}
                  </span>
                  <span>Made for focused conversations.</span>
                  <button
                    className="text-button"
                    disabled={!current || sessionDisabled}
                    onClick={() => run(() => exportCurrent("pdf"))}
                  >
                    <FileText size={13} />
                    Export PDF
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {page === "home" && <Home navigate={navigate} />}
        {page === "account" && (
          <Account
            onError={fail}
            onNotice={notify}
            onRestore={(next) => {
              setState(next);
              setSettingsDraft(next.settings);
              setActiveId(null);
            }}
            onLogout={() => {
              run(async () => {
                try {
                  await refresh();
                } catch {
                  setState(structuredClone(blankState));
                  setSettingsDraft(blankState.settings);
                  setActiveId(null);
                }
              });
            }}
            navigate={navigate}
          />
        )}
        {page === "sessions" && (
          <div className="content-page">
            <PageNav current="sessions" onNavigate={navigate} isDesktop={desktop} />
            <div className="page-heading">
              <div>
                <div className="site-kicker">
                  <span />
                  CONVERSATION ARCHIVE
                </div>
                <h1>Every conversation, kept<span>.</span></h1>
                <p>Your notes, transcripts, and answers, safely archived.</p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                {state.sessions.length > 0 && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      const blob = new Blob(
                        [JSON.stringify(state.sessions, null, 2)],
                        { type: "application/json" },
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `lensdesk_sessions_${new Date().toISOString().slice(0, 10)}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                      notify("Exported all sessions to JSON file.");
                    }}
                  >
                    <Download size={15} />
                    Export All (JSON)
                  </button>
                )}
                <button
                  className="button primary"
                  onClick={() => setModal("new")}
                >
                  <Plus size={17} />
                  New session
                </button>
              </div>
            </div>

            <div className="session-filter-row">
              {[
                { id: "all", label: `All (${state.sessions.length})` },
                {
                  id: "open",
                  label: `Open (${state.sessions.filter((s) => !s.endedAt).length})`,
                },
                {
                  id: "completed",
                  label: `Completed (${state.sessions.filter((s) => Boolean(s.endedAt)).length})`,
                },
                {
                  id: "coding",
                  label: `Coding (${state.sessions.filter((s) => s.mode === "coding").length})`,
                },
                {
                  id: "system-design",
                  label: `System Design (${state.sessions.filter((s) => s.mode === "system-design").length})`,
                },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`session-filter-btn ${sessionFilter === f.id ? "active" : ""}`}
                  onClick={() => setSessionFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="list-toolbar">
              <div className="search-box">
                <Search size={17} />
                <input
                  aria-label="Search sessions"
                  placeholder="Search titles, notes, and conversations"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <span className="local-tag">
                <ShieldCheck size={14} />
                {state.sessions.length} sessions encrypted locally
              </span>
            </div>
            <div className="session-list">
              {state.sessions
                .filter((s) => {
                  const matchesSearch =
                    !search.trim() ||
                    [
                      s.title,
                      s.notes,
                      s.transcript,
                      ...s.messages.map((m) => m.content),
                    ]
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase());
                  if (!matchesSearch) return false;
                  if (sessionFilter === "open") return !s.endedAt;
                  if (sessionFilter === "completed") return Boolean(s.endedAt);
                  if (sessionFilter === "coding") return s.mode === "coding";
                  if (sessionFilter === "system-design")
                    return s.mode === "system-design";
                  return true;
                })
                .map((s) => (
                  <button
                    className="session-card"
                    key={s.id}
                    onClick={() => selectSession(s)}
                  >
                    <div className="session-card-icon">
                      {s.mode === "coding" ? (
                        <Code2 size={22} />
                      ) : s.mode === "system-design" ? (
                        <Layers size={22} />
                      ) : (
                        <MessageSquare size={22} />
                      )}
                    </div>
                    <div>
                      <h3>{s.title}</h3>
                      <p>
                        {s.messages
                          .find((m) => m.role === "user")
                          ?.content.slice(0, 110) ||
                          "A fresh space for your next conversation."}
                      </p>
                      <span>
                        {new Date(s.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}{" "}
                        · {s.messages.length} messages · {modeLabels[s.mode]}
                      </span>
                    </div>
                    <span className="session-ended">
                      {s.endedAt ? "Completed" : "Open"}
                    </span>
                    <ChevronRight size={18} />
                  </button>
                ))}
              {!state.sessions.length && (
                <div className="empty-state">
                  <History size={36} />
                  <h2>Start something worth keeping.</h2>
                  <p>
                    Create a session and your conversation will appear here.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setModal("new")}
                  >
                    Create a session
                  </button>
                </div>
              )}
              {state.sessions.length > 0 &&
                !state.sessions.some((s) =>
                  [
                    s.title,
                    s.notes,
                    s.transcript,
                    ...s.messages.map((m) => m.content),
                  ]
                    .join(" ")
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) && (
                  <div className="empty-state">
                    <Search size={28} />
                    <h3>No matching sessions</h3>
                    <p>Try another word from your conversation.</p>
                  </div>
                )}
            </div>
            {current && (
              <div className="history-actions">
                <button
                  className="text-button danger-text"
                  onClick={() => setModal("delete")}
                >
                  <Trash2 size={15} />
                  Delete selected session: {current.title}
                </button>
              </div>
            )}
          </div>
        )}
        {page === "profiles" && (
          <div className="content-page">
            <PageNav current="profiles" onNavigate={navigate} isDesktop={desktop} />
            <div className="page-heading">
              <div>
                <div className="site-kicker">
                  <span />
                  INTERVIEW & WORK PERSONAS
                </div>
                <h1>Bring your experience<span>.</span></h1>
                <p>
                  Give your assistant the details, resume context, and role requirements that make answers relevant.
                </p>
              </div>
              <button
                className="button primary"
                onClick={() => {
                  setProfileDraft(emptyProfile());
                  setConfirmProfileDelete(false);
                }}
              >
                <Plus size={17} />
                New profile
              </button>
            </div>

            <div className="template-picker-section">
              <div className="site-kicker" style={{ marginBottom: "6px" }}>
                <span />
                QUICK-START PRE-CONFIGURED TEMPLATES
              </div>
              <div className="template-chips-grid">
                <button
                  type="button"
                  className="template-chip-card"
                  onClick={() => {
                    setProfileDraft({
                      id: uid(),
                      name: "Senior Software Engineer",
                      role: "Staff / Senior Software Engineer",
                      company: "Tech Lead",
                      resume: "10+ years designing distributed systems, low-latency microservices, cloud infrastructure, and database optimization. Expert in C++, Go, TypeScript, and AWS/GCP.",
                      jobDescription: "Seeking senior engineering leaders capable of scaling multi-tenant distributed platforms, driving architectural decisions, mentoring team members, and solving complex algorithmic challenges. Focus on optimal algorithms, time/space complexity (Big-O), edge cases, and robust production trade-offs.",
                    });
                    setConfirmProfileDelete(false);
                    notify("Loaded Senior Software Engineer template.");
                  }}
                >
                  <Code2 size={20} className="template-chip-icon" />
                  <div>
                    <strong>Coding & Algorithms Copilot</strong>
                    <span>Senior engineer context with time/space complexity focus.</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="template-chip-card"
                  onClick={() => {
                    setProfileDraft({
                      id: uid(),
                      name: "System Design Architect",
                      role: "Principal Cloud Architect",
                      company: "Distributed Systems",
                      resume: "Architected high-throughput pipelines processing 500k+ events/sec. Deep expertise in event-driven streaming (Kafka), distributed caches (Redis), relational and NoSQL partitioning.",
                      jobDescription: "Lead system design interviews focusing on scalability, load balancing, caching tiers, data storage schemas, and resilience. Structure responses into: 1) Requirements & Scope, 2) Capacity Estimations, 3) High-Level Architecture, 4) Component Deep Dives, 5) Trade-offs.",
                    });
                    setConfirmProfileDelete(false);
                    notify("Loaded System Design Architect template.");
                  }}
                >
                  <Layers size={20} className="template-chip-icon" />
                  <div>
                    <strong>System Design Architect</strong>
                    <span>Scalable architecture, trade-offs, and data pipelines.</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="template-chip-card"
                  onClick={() => {
                    setProfileDraft({
                      id: uid(),
                      name: "Executive Meeting Scribe",
                      role: "Executive Chief of Staff",
                      company: "Executive Operations",
                      resume: "Corporate strategist and executive scribe specializing in high-stakes boardroom meetings, strategy reviews, and technical cross-functional summits.",
                      jobDescription: "Produce concise, bulleted executive briefings, highlighted decision logs, action items with assigned owners, and risk assessments. Keep summaries ultra-crisp, highlight actionable commitments, and omit conversational filler.",
                    });
                    setConfirmProfileDelete(false);
                    notify("Loaded Meeting Scribe template.");
                  }}
                >
                  <AudioLines size={20} className="template-chip-icon" />
                  <div>
                    <strong>Live Meeting Scribe</strong>
                    <span>Action items, decision logs, and concise executive takeaways.</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="template-chip-card"
                  onClick={() => {
                    setProfileDraft({
                      id: uid(),
                      name: "Leadership & STAR Interview",
                      role: "Engineering Manager / Director",
                      company: "Leadership",
                      resume: "Led multiple high-performing engineering teams. Champion of engineering culture, conflict resolution, career development, and hiring excellence.",
                      jobDescription: "Answer behavioral interview questions using the STAR framework (Situation, Task, Action, Result) with strong leadership focus. Highlight ownership, measurable business outcomes, empathy, and collaborative conflict resolution.",
                    });
                    setConfirmProfileDelete(false);
                    notify("Loaded Leadership template.");
                  }}
                >
                  <UserRound size={20} className="template-chip-icon" />
                  <div>
                    <strong>STAR Behavioral Copilot</strong>
                    <span>Situation, Task, Action, Result structured storytelling.</span>
                  </div>
                </button>
              </div>
            </div>
            <div className="profile-layout">
              <div className="profile-list">
                {state.profiles.map((p) => (
                  <button
                    className={`profile-card ${profileDraft?.id === p.id ? "selected" : ""}`}
                    key={p.id}
                    onClick={() => {
                      setProfileDraft({ ...p });
                      setConfirmProfileDelete(false);
                    }}
                  >
                    <div className="avatar">{p.name[0]?.toUpperCase()}</div>
                    <div>
                      <strong>{p.name}</strong>
                      <span>
                        {p.role || "Add a role"}
                        {p.company ? ` · ${p.company}` : ""}
                      </span>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                ))}
                {!state.profiles.length && (
                  <div className="empty-state">
                    <UserRound size={30} />
                    <h3>A little background helps.</h3>
                    <p>
                      Add your role, resume, and the job you’re preparing for.
                    </p>
                    <button
                      className="text-link"
                      onClick={() => setProfileDraft(emptyProfile())}
                    >
                      Create a profile <Plus size={16} />
                    </button>
                  </div>
                )}
              </div>
              <section className="form-card">
                {profileDraft ? (
                  <>
                    <div className="form-heading">
                      <h2>
                        {state.profiles.some((p) => p.id === profileDraft.id)
                          ? "Edit profile"
                          : "New profile"}
                      </h2>
                      <span className="local-tag">
                        <ShieldCheck size={13} />
                        {cloudStorage
                          ? "Saved to your account"
                          : "Stored locally"}
                      </span>
                    </div>
                    <label>
                      Profile name
                      <input
                        maxLength={150}
                        value={profileDraft.name}
                        onChange={(e) =>
                          setProfileDraft({
                            ...profileDraft,
                            name: e.target.value,
                          })
                        }
                        placeholder="e.g. Senior engineer at Acme"
                      />
                    </label>
                    <div className="form-row">
                      <label>
                        Target role
                        <input
                          value={profileDraft.role}
                          maxLength={200}
                          onChange={(e) =>
                            setProfileDraft({
                              ...profileDraft,
                              role: e.target.value,
                            })
                          }
                          placeholder="Senior software engineer"
                        />
                      </label>
                      <label>
                        Company
                        <input
                          maxLength={200}
                          value={profileDraft.company}
                          onChange={(e) =>
                            setProfileDraft({
                              ...profileDraft,
                              company: e.target.value,
                            })
                          }
                          placeholder="Company name"
                        />
                      </label>
                    </div>
                    <label>
                      <span className="label-with-action">
                        Resume / background
                        <button
                          className="text-link"
                          onClick={() => docInput.current?.click()}
                        >
                          <Upload size={14} />
                          Import PDF or text
                        </button>
                      </span>
                      <textarea
                        rows={7}
                        maxLength={100000}
                        value={profileDraft.resume}
                        onChange={(e) =>
                          setProfileDraft({
                            ...profileDraft,
                            resume: e.target.value,
                          })
                        }
                        placeholder="Your experience, projects, and achievements…"
                      />
                    </label>
                    <label>
                      Job description
                      <textarea
                        rows={6}
                        maxLength={100000}
                        value={profileDraft.jobDescription}
                        onChange={(e) =>
                          setProfileDraft({
                            ...profileDraft,
                            jobDescription: e.target.value,
                          })
                        }
                        placeholder="Paste the role’s requirements and responsibilities…"
                      />
                    </label>
                    <div className="form-footer">
                      <button
                        className="button primary"
                        disabled={!profileDraft.name.trim()}
                        onClick={() =>
                          run(async () => {
                            const p = await api<Profile>("profile.save", {
                              ...profileDraft,
                              name: profileDraft.name.trim(),
                            });
                            await refresh();
                            setProfileDraft(p);
                            notify("Profile saved.");
                          })
                        }
                      >
                        <Check size={16} />
                        Save profile
                      </button>
                      {state.profiles.some((p) => p.id === profileDraft.id) && (
                        <button
                          className="text-button danger-text"
                          onClick={() =>
                            run(async () => {
                              if (!confirmProfileDelete) {
                                setConfirmProfileDelete(true);
                                return;
                              }
                              await api("profile.delete", {
                                id: profileDraft.id,
                              });
                              await refresh();
                              setProfileDraft(null);
                              setConfirmProfileDelete(false);
                              notify("Profile deleted.");
                            })
                          }
                        >
                          <Trash2 size={15} />
                          {confirmProfileDelete
                            ? "Confirm deletion"
                            : "Delete profile"}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <FileText size={35} />
                    <h2>Your experience is the context.</h2>
                    <p>Choose a profile or create one to get started.</p>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
        {page === "settings" && settingsDraft && (
          <div className="content-page settings-page">
            <PageNav current="settings" onNavigate={navigate} isDesktop={desktop} />
            <div className="page-heading">
              <div>
                <div className="site-kicker">
                  <span />
                  PREFERENCES & MODELS
                </div>
                <h1>Your assistant, your way<span>.</span></h1>
                <p>Choose your models, configure API keys, and customize assistant behavior.</p>
              </div>
              <span className="local-tag">
                <ShieldCheck size={15} />
                {desktop
                  ? "Keys encrypted by your operating system"
                  : cloudStorage
                    ? "Keys encrypted on your server"
                    : "Preview keys stay in memory"}
              </span>
            </div>
            <div className="settings-grid">
              <section className="form-card">
                <div className="form-heading">
                  <h2>
                    <Sparkles size={18} />
                    AI connection
                  </h2>
                  <span
                    className={`connection-badge ${settingsDraft.provider === "local" || state.keys[settingsDraft.provider] ? "connected" : ""}`}
                  >
                    {settingsDraft.provider === "local"
                      ? "Local endpoint"
                      : state.keys[settingsDraft.provider]
                        ? !state.ownedKeys?.[settingsDraft.provider] &&
                          (cloudStorage || state.cloudConnected)
                          ? "Hosted access"
                          : "Key saved"
                        : "Add an API key"}
                  </span>
                </div>
                <label>
                  Provider
                  <select
                    value={settingsDraft.provider}
                    onChange={(e) => {
                      const p = e.target.value as Provider;
                      setSettingsDraft({
                        ...settingsDraft,
                        provider: p,
                        model: providerMeta[p].model,
                      });
                      setKeyDraft("");
                    }}
                  >
                    {Object.entries(providerMeta)
                      .filter(([id]) => id !== "local" || desktop)
                      .map(([id, p]) => (
                        <option value={id} key={id}>
                          {p.label}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="field-help">
                  {providerMeta[settingsDraft.provider].note}
                </p>
                {settingsDraft.provider === "local" ? (
                  <>
                    <label>
                      Local model server
                      <input
                        aria-label="Local model server address"
                        type="url"
                        maxLength={500}
                        value={
                          settingsDraft.localBaseUrl ||
                          "http://127.0.0.1:11434/v1"
                        }
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            localBaseUrl: e.target.value,
                          })
                        }
                      />
                    </label>
                    <p className="field-help">
                      Use an OpenAI-compatible endpoint, such as Ollama on
                      127.0.0.1:11434/v1 or LM Studio on 127.0.0.1:1234/v1.
                      Requests run from this desktop and are never sent to the
                      hosted LensDesk AI service. Vision support depends on the
                      model.
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      API key
                      <div className="key-field">
                        <input
                          aria-label="API key"
                          type="password"
                          autoComplete="off"
                          value={keyDraft}
                          onChange={(e) => setKeyDraft(e.target.value)}
                          placeholder={
                            state.keys[settingsDraft.provider]
                              ? "Key saved · enter a replacement"
                              : "Paste your provider API key"
                          }
                        />
                        <button
                          className="button secondary"
                          disabled={!keyDraft.trim()}
                          onClick={() =>
                            run(async () => {
                              await api("key.save", {
                                provider: settingsDraft.provider,
                                key: keyDraft,
                              });
                              await saveSettingsPatch({
                                provider: settingsDraft.provider,
                                model:
                                  settingsDraft.model ||
                                  providerMeta[settingsDraft.provider].model,
                              });
                              await refresh();
                              setKeyDraft("");
                              notify(
                                `${providerMeta[settingsDraft.provider].label} API key saved and activated.`,
                              );
                            })
                          }
                        >
                          Save key
                        </button>
                      </div>
                      {settingsDraft.provider === "deepseek" &&
                        keyDraft.trim() &&
                        (keyDraft.trim().endsWith("==") ||
                          !keyDraft.trim().startsWith("sk-")) && (
                          <p
                            className="field-help"
                            style={{ color: "#ef4444", marginTop: "6px" }}
                          >
                            DeepSeek API keys start with &quot;sk-&quot; and do
                            not end in &quot;==&quot;. Verify you copied your key
                            from platform.deepseek.com.
                          </p>
                        )}
                    </label>
                    <div className="key-help">
                      <a
                        href={providerMeta[settingsDraft.provider].url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Get a provider key
                        <ExternalLink size={12} />
                      </a>
                      {(state.ownedKeys?.[settingsDraft.provider] ??
                        state.keys[settingsDraft.provider]) && (
                        <button
                          className="text-button danger-text"
                          onClick={() =>
                            run(async () => {
                              await api("key.save", {
                                provider: settingsDraft.provider,
                                key: "",
                              });
                              await refresh();
                              notify("Key removed.");
                            })
                          }
                        >
                          Remove key
                        </button>
                      )}
                    </div>
                  </>
                )}
                <label>
                  Model ID (auto-configured)
                  <input
                    value={
                      settingsDraft.model ||
                      providerMeta[settingsDraft.provider]?.model ||
                      ""
                    }
                    placeholder={
                      providerMeta[settingsDraft.provider]?.model || ""
                    }
                    maxLength={100}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        model: e.target.value,
                      })
                    }
                  />
                </label>
                <p className="field-help">
                  Optional. Defaults automatically to the optimal model (
                  {providerMeta[settingsDraft.provider]?.model}). You only need
                  to enter your API key.
                </p>
                <ProviderModels
                  settings={settingsDraft}
                  onChange={setSettingsDraft}
                  onError={fail}
                />
                <label>
                  Response language
                  <input
                    maxLength={80}
                    value={settingsDraft.language}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        language: e.target.value,
                      })
                    }
                  />
                </label>
              </section>
              <section className="form-card">
                <div className="form-heading">
                  <h2>
                    <AudioLines size={18} />
                    Audio & behavior
                  </h2>
                </div>
                <label>
                  Transcription provider
                  <select
                    value={settingsDraft.transcriptionProvider}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        transcriptionProvider: e.target.value as
                          "groq" | "openai",
                        transcriptionModel:
                          e.target.value === "groq"
                            ? "whisper-large-v3-turbo"
                            : "whisper-1",
                      })
                    }
                  >
                    <option value="openai">OpenAI</option>
                    <option value="groq">Groq</option>
                  </select>
                </label>
                <label>
                  Transcription model
                  <input
                    maxLength={100}
                    value={settingsDraft.transcriptionModel}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        transcriptionModel: e.target.value,
                      })
                    }
                  />
                </label>
                <p className="field-help">
                  Connect the matching provider’s API key. Audio is sent to that
                  provider only when you record or import it.
                </p>
                <label>
                  Instructions for your assistant
                  <textarea
                    rows={6}
                    maxLength={20000}
                    value={settingsDraft.systemPrompt}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        systemPrompt: e.target.value,
                      })
                    }
                  />
                </label>
                <div className="toggle-row">
                  <div>
                    <strong>
                      Keep window on top
                      {!desktop && <span className="desktop-tag-pill">Desktop App Only</span>}
                    </strong>
                    <p>Keep your workspace pinned above all other windows.</p>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Keep window on top"
                    disabled={!desktop}
                    checked={settingsDraft.alwaysOnTop}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        alwaysOnTop: e.target.checked,
                      })
                    }
                  />
                </div>
                <div className="toggle-row">
                  <div>
                    <strong>
                      Protect window from capture
                      {!desktop && <span className="desktop-tag-pill">Desktop App Only</span>}
                    </strong>
                    <p>
                      Requests OS capture exclusion. Protects private notes and AI answers from screen recording.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Protect window from capture"
                    disabled={!desktop}
                    checked={settingsDraft.captureProtection}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        captureProtection: e.target.checked,
                      })
                    }
                  />
                </div>
                <label>
                  Window opacity{" "}
                  {!desktop && <span className="desktop-tag-pill">Desktop App Only</span>}
                  <span className="muted">
                    {Math.round(settingsDraft.opacity * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    disabled={!desktop}
                    value={Math.round(settingsDraft.opacity * 100)}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        opacity: Math.max(
                          0,
                          Math.min(1, Number(e.target.value) / 100),
                        ),
                      })
                    }
                  />
                </label>
                <AppearanceSettings
                  settings={settingsDraft}
                  onChange={setSettingsDraft}
                />
              </section>
            </div>
            <div className="settings-save">
              <p>Provider usage is billed directly by your provider.</p>
              <button
                className="button primary"
                onClick={() =>
                  run(async () => {
                    const patch = Object.fromEntries(
                      Object.entries(settingsDraft).filter(
                        ([key, value]) =>
                          key !== "version" &&
                          value !==
                            stateRef.current?.settings[key as keyof Settings],
                      ),
                    );
                    await saveSettingsPatch(patch);
                    notify("Settings saved.");
                  })
                }
              >
                <Check size={16} />
                Save settings
              </button>
            </div>
            <section className="form-card backup-card">
              <div>
                <h2>
                  <FolderOpen size={18} />
                  Your workspace travels with you.
                </h2>
                <p>
                  Export sessions, profiles, and preferences. API keys are never
                  included.
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  run(async () => {
                    download(
                      "lensdesk-backup.json",
                      JSON.stringify(await api("backup"), null, 2),
                      "application/json",
                    );
                  })
                }
              >
                <Download size={16} />
                Export backup
              </button>
              <button
                className="text-button"
                onClick={() => backupInput.current?.click()}
              >
                <Upload size={15} />
                Restore backup
              </button>
            </section>
            {desktop && <DesktopSettings onError={fail} onNotice={notify} />}
            <Recovery
              sessions={state.sessions}
              onRestore={refresh}
              onError={fail}
            />
          </div>
        )}
        {page === "downloads" && (
          <div className="content-page">
            <PageNav current="downloads" onNavigate={navigate} isDesktop={desktop} />
            <div className="page-heading">
              <div>
                <div className="site-kicker">
                  <span />
                  NATIVE DESKTOP APPLICATIONS
                </div>
                <h1>Direct Desktop Downloads<span>.</span></h1>
                <p>
                  Experience the true OS-level floating overlay, global hotkeys,
                  and stealth click-through with our native Windows and macOS applications.
                </p>
              </div>
              <Monitor size={44} strokeWidth={1} />
            </div>

            <div className="download-grid-cards">
              <article className="download-card-featured">
                <span className="download-card-badge">RECOMMENDED</span>
                <div>
                  <div className="download-card-title">
                    <Laptop size={24} style={{ color: "var(--site-accent, #d8f56b)" }} />
                    <h3>Windows Installer</h3>
                  </div>
                  <p className="download-card-desc">
                    Complete native x64 Windows installer with Start menu integration,
                    desktop shortcut, and automatic WebView2 bootstrapping.
                  </p>
                  <div className="download-card-meta">
                    <span>Windows 10 & 11 (64-bit)</span>
                    <span>·</span>
                    <span>1.15 MB Setup.exe</span>
                  </div>
                </div>
                <a
                  className="download-action-btn primary"
                  href="https://github.com/VivekGitNinja/LensDesk2.0/releases/download/v2.0.0/LensDesk-2.0.0-Setup.exe"
                  download="LensDesk-2.0.0-Setup.exe"
                >
                  <Download size={16} />
                  Download Installer (.exe)
                </a>
              </article>

              <article className="download-card-featured">
                <span className="download-card-badge" style={{ background: "rgba(255,255,255,0.08)", color: "#e5ede3" }}>
                  PORTABLE
                </span>
                <div>
                  <div className="download-card-title">
                    <FolderOpen size={24} style={{ color: "#9aa698" }} />
                    <h3>Windows Portable</h3>
                  </div>
                  <p className="download-card-desc">
                    Standalone archive that requires no installation or administrator rights.
                    Extract anywhere or run directly from a USB drive.
                  </p>
                  <div className="download-card-meta">
                    <span>Windows 10 & 11 (64-bit)</span>
                    <span>·</span>
                    <span>1.06 MB ZIP</span>
                  </div>
                </div>
                <a
                  className="download-action-btn secondary"
                  href="https://github.com/VivekGitNinja/LensDesk2.0/releases/download/v2.0.0/LensDesk-2.0.0-Windows-x64.zip"
                  download="LensDesk-2.0.0-Windows-x64.zip"
                >
                  <Download size={16} />
                  Download Portable (.zip)
                </a>
              </article>

              <article className="download-card-featured">
                <span className="download-card-badge" style={{ background: "rgba(216,245,107,0.15)", color: "var(--site-accent, #d8f56b)" }}>
                  MACOS (APPLE SILICON)
                </span>
                <div>
                  <div className="download-card-title">
                    <Aperture size={24} style={{ color: "var(--site-accent, #d8f56b)" }} />
                    <h3>macOS Apple Silicon</h3>
                  </div>
                  <p className="download-card-desc">
                    Native Apple Silicon DMG package optimized for M1, M2, M3, and M4 Macs with native ARM64 performance, floating overlay, and global shortcuts.
                  </p>
                  <div className="download-card-meta">
                    <span>macOS 12+ (Apple Silicon M1/M2/M3/M4)</span>
                    <span>·</span>
                    <span>136 MB DMG</span>
                  </div>
                </div>
                <a
                  className="download-action-btn primary"
                  href="/downloads/mac-arm64"
                  download="LensDesk-2.0.0-macOS-Apple-Silicon-arm64.dmg"
                >
                  <Download size={16} />
                  Download Apple Silicon (.dmg)
                </a>
              </article>

              <article className="download-card-featured">
                <span className="download-card-badge" style={{ background: "rgba(255,255,255,0.08)", color: "#e5ede3" }}>
                  MACOS (INTEL)
                </span>
                <div>
                  <div className="download-card-title">
                    <Laptop size={24} style={{ color: "#9aa698" }} />
                    <h3>macOS Intel</h3>
                  </div>
                  <p className="download-card-desc">
                    Native Intel 64-bit DMG package for Intel Core i5, i7, and i9 Mac computers.
                  </p>
                  <div className="download-card-meta">
                    <span>macOS 12+ (Intel 64-bit)</span>
                    <span>·</span>
                    <span>140 MB DMG</span>
                  </div>
                </div>
                <a
                  className="download-action-btn secondary"
                  href="/downloads/mac-x64"
                  download="LensDesk-2.0.0-macOS-Intel-x64.dmg"
                >
                  <Download size={16} />
                  Download Intel (.dmg)
                </a>
              </article>
            </div>

            <section className="form-card" style={{ marginBottom: "30px" }}>
              <div className="form-heading">
                <h2>
                  <Sparkles size={18} />
                  Why the Desktop App is Better
                </h2>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="feature-matrix-table">
                  <thead>
                    <tr>
                      <th>Capability</th>
                      <th>Installed Desktop App</th>
                      <th>Web Browser Version</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Floating Overlay Window</strong></td>
                      <td style={{ color: "var(--site-accent, #d8f56b)" }}>✓ OS-wide hardware-accelerated overlay</td>
                      <td style={{ color: "#9aa698" }}>✗ Restricted to desktop app</td>
                    </tr>
                    <tr>
                      <td><strong>Global Keyboard Shortcuts</strong></td>
                      <td style={{ color: "var(--site-accent, #d8f56b)" }}>✓ Works anywhere across entire OS</td>
                      <td style={{ color: "#9aa698" }}>Only when website tab is focused</td>
                    </tr>
                    <tr>
                      <td><strong>Stealth & Click-Through</strong></td>
                      <td style={{ color: "var(--site-accent, #d8f56b)" }}>✓ Native transparent window click-through</td>
                      <td style={{ color: "#9aa698" }}>✗ Not possible in web browsers</td>
                    </tr>
                    <tr>
                      <td><strong>Direct Screen Snip</strong></td>
                      <td style={{ color: "var(--site-accent, #d8f56b)" }}>✓ Silent background screen capture</td>
                      <td style={{ color: "#9aa698" }}>Requires permission popup every time</td>
                    </tr>
                    <tr>
                      <td><strong>Encrypted Offline Storage</strong></td>
                      <td style={{ color: "var(--site-accent, #d8f56b)" }}>✓ Native OS DPAPI / Keychain encryption</td>
                      <td style={{ color: "#9aa698" }}>Browser IndexedDB / Session storage</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <div className="guide-grid">
              <section className="form-card">
                <div className="form-heading">
                  <h2>
                    <Command size={19} />
                    Desktop Shortcuts
                  </h2>
                </div>
                <div className="shortcut">
                  <div>
                    <strong>Show or hide LensDesk</strong>
                    <p>Summon or dismiss your floating copilot from anywhere.</p>
                  </div>
                  <kbd>{keyLabel("toggle")}</kbd>
                </div>
                <div className="shortcut">
                  <div>
                    <strong>Capture screenshot</strong>
                    <p>Instant silent screen snip attached to your conversation.</p>
                  </div>
                  <kbd>{keyLabel("capture")}</kbd>
                </div>
                <div className="shortcut">
                  <div>
                    <strong>Toggle floating overlay</strong>
                    <p>Switch between full workspace and compact stealth window.</p>
                  </div>
                  <kbd>{keyLabel("overlay")}</kbd>
                </div>
                <p className="field-help">
                  Shortcuts can be fully customized in Settings.
                </p>
              </section>

              <section className="form-card">
                <div className="form-heading">
                  <h2>
                    <Play size={18} />
                    Quick Installation Guide
                  </h2>
                </div>
                {[
                  [
                    "1. Download Release",
                    "Choose either the Setup installer (.exe) or Portable ZIP for Windows.",
                  ],
                  [
                    "2. Run & Launch",
                    "Run the installer or extract the ZIP. Windows SmartScreen may show an initial prompt—click More Info -> Run Anyway.",
                  ],
                  [
                    "3. Configure or Bring Keys",
                    "Open Settings to add your OpenAI, Anthropic, Gemini, DeepSeek, or local Ollama key.",
                  ],
                  [
                    "4. Summon with Hotkey",
                    "Press Ctrl+Shift+Space (or Alt+Space) anytime to bring up your assistant while working.",
                  ],
                ].map(([title, text]) => (
                  <div className="guide-step" key={title}>
                    <span style={{ background: "rgba(216,245,107,0.15)", color: "var(--site-accent, #d8f56b)" }}>✓</span>
                    <div>
                      <strong>{title}</strong>
                      <p>{text}</p>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </div>
        )}
        {desktop &&
          gate &&
          (gate.phase !== "active" ||
            (gate.licenseValid !== true && !gate.entitlement)) &&
          !["account", "downloads", "settings", "admin"].includes(page) && (
            <GateLock gate={gate} navigate={navigate} />
          )}
      </main>
      <input
        type="file"
        ref={imageInput}
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) run(() => addImage(f));
          e.target.value = "";
        }}
      />
      <input
        type="file"
        ref={audioInput}
        hidden
        accept=".webm,.m4a,.mp4,.ogg,.wav"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) run(() => importAudio(f));
          e.target.value = "";
        }}
      />
      <input
        type="file"
        ref={docInput}
        hidden
        accept=".pdf,.txt,.md"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            run(async () => {
              if (profileDraft) {
                if (f.size > 10000000)
                  throw new Error("Choose a document smaller than 10 MB.");
                const { text } = await api("document.read", {
                  name: f.name,
                  data: (await fileData(f)).split(",")[1],
                });
                setProfileDraft({ ...profileDraft, resume: text });
                notify("Resume imported. Save the profile to keep it.");
              } else {
                await handleImportResume(f);
              }
            });
          e.target.value = "";
        }}
      />
      <input
        type="file"
        ref={backupInput}
        hidden
        accept=".json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            run(async () => {
              if (f.size > 40000000)
                throw new Error("Backup must be smaller than 40 MB.");
              const data = JSON.parse(await f.text());
              if (
                !window.confirm(
                  "Replace this workspace with the backup? A copy of your current data will be kept on disk.",
                )
              )
                return;
              const next = await api<State>("backup.restore", data);
              setState(next);
              setSettingsDraft(next.settings);
              setActiveId(null);
              if (desktop) await api("desktop.appearance");
              notify("Backup restored.");
            });
          e.target.value = "";
        }}
      />
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "sources" ? "source-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "new"
                ? "New session"
                : modal === "delete"
                  ? "Delete session"
                  : "Choose a screen"
            }
          >
            <div className="modal-header">
              <h2>
                {modal === "new"
                  ? "A fresh thinking space."
                  : modal === "delete"
                    ? "Delete this session?"
                    : "What would you like to capture?"}
              </h2>
              <IconButton label="Close dialog" onClick={() => setModal(null)}>
                <X size={20} />
              </IconButton>
            </div>
            {modal === "new" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await createSession();
                  });
                }}
              >
                <p>Bring a question. We’ll take it from there.</p>
                <label>
                  Session title
                  <input
                    autoFocus
                    maxLength={150}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Backend engineering practice"
                  />
                </label>
                <label>
                  Focus
                  <select
                    value={newMode}
                    onChange={(e) => setNewMode(e.target.value as Mode)}
                  >
                    {Object.entries(modeLabels).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Interview profile
                  <select
                    value={newProfile}
                    onChange={(e) => setNewProfile(e.target.value)}
                  >
                    <option value="">No profile</option>
                    {state.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button primary full-width" type="submit">
                  <Plus size={17} />
                  Start session
                </button>
              </form>
            ) : modal === "delete" ? (
              <>
                <p>
                  This permanently removes “{current?.title}” and its messages,
                  notes, and transcript. Export it first if you want to keep a
                  copy.
                </p>
                <div className="form-footer">
                  <button
                    className="button secondary"
                    onClick={() => setModal(null)}
                  >
                    Keep session
                  </button>
                  <button
                    className="button danger"
                    onClick={() =>
                      run(async () => {
                        await api("session.delete", { id: activeId });
                        setActiveId(null);
                        await refresh();
                        setModal(null);
                        notify("Session deleted.");
                      })
                    }
                  >
                    Delete session
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  The selected image will be attached to your next question.
                </p>
                <div className="source-grid">
                  {sources.map((s) => (
                    <button
                      key={s.id}
                      onClick={() =>
                        run(async () => {
                          const { image, archiveError } = await api(
                            "desktop.capture",
                            {
                              id: s.id,
                            },
                          );
                          setImages((old) => [...old, image].slice(0, 5));
                          setModal(null);
                          if (archiveError) fail(archiveError);
                        })
                      }
                    >
                      <img src={s.thumbnail} alt={s.name} />
                      <strong>{s.name}</strong>
                    </button>
                  ))}
                </div>
                {!sources.length && (
                  <p>
                    No screens available. Enable Screen Recording access for
                    LensDesk in System Settings, then reopen the picker.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {hintlensSettingsOpen && (
        <HintLensSettingsModal
          isOpen={hintlensSettingsOpen}
          onClose={() => setHintlensSettingsOpen(false)}
          initialTab={hintlensSettingsTab}
          settings={settingsDraft || state.settings}
          onSaveSettings={saveSettingsPatch}
          desktopPreferences={desktopPreferences}
          onSaveDesktopPreferences={handleSaveDesktopPreferences}
          onRestart={() => run(() => api("desktop.restart"))}
          onQuit={() => run(() => api("desktop.quit"))}
          keys={state.keys}
          onRefresh={refresh}
        />
      )}
      {authModalOpen && (
        <HintLensAuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={() => {
            setAuthModalOpen(false);
            run(refresh);
          }}
        />
      )}
      {Boolean(desktopPreferences?.mouse?.enabled) && radialWheelOpen && (
        <RadialActionWheel
          visible={radialWheelOpen}
          onClose={() => setRadialWheelOpen(false)}
          mousePosition={radialMousePos}
          slotsCount={desktopPreferences?.mouse?.slots || 6}
          size={desktopPreferences?.mouse?.size || 100}
          opacity={desktopPreferences?.mouse?.opacity || 85}
          style={desktopPreferences?.mouse?.style || "wheel"}
          slotActions={desktopPreferences?.mouse?.mappings}
          triggerButton={desktopPreferences?.mouse?.trigger === "right" ? 2 : 1}
          onSelectAction={handleRadialAction}
        />
      )}
      {quickKeyModal && (
        <div
          className="quick-key-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setQuickKeyModal(null);
          }}
        >
          <div className="quick-key-card" role="dialog" aria-modal="true">
            <h3>
              <span>Enter {providerMeta[quickKeyModal].label} Key</span>
              <IconButton
                label="Close"
                onClick={() => setQuickKeyModal(null)}
              >
                <X size={16} />
              </IconButton>
            </h3>
            <p>
              Paste your API key below. It will be encrypted at rest with
              AES-256-GCM and set as your active default provider.
            </p>
            <input
              type="password"
              className="quick-key-input"
              placeholder={`Paste ${providerMeta[quickKeyModal].label} API key...`}
              value={quickKeyInput}
              autoFocus
              onChange={(e) => setQuickKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleQuickKeySave();
                if (e.key === "Escape") setQuickKeyModal(null);
              }}
            />
            <div className="quick-key-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setQuickKeyModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!quickKeyInput.trim()}
                onClick={() => void handleQuickKeySave()}
              >
                Save & Set Default
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
