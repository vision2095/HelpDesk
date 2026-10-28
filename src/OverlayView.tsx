import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Aperture,
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Keyboard,
  Maximize2,
  Mic,
  MicOff,
  Minus,
  Play,
  RotateCcw,
  Sliders,
  Sparkles,
  Square,
  Volume2,
  X,
  Code2,
  Lightbulb,
  FileQuestion,
  Image as ImageIcon,
  MousePointer,
  Globe,
  Settings as SettingsIcon,
  Bot,
  Trash2,
  AudioLines,
  FileText,
  UserRound,
  Upload,
  Zap,
  MoreVertical,
} from "lucide-react";
import type { Session, Provider } from "./types";
import { shortcutLabel } from "./shortcut-label";
import { useGamepadController } from "./useGamepadController";

export const LENSDESK_SPEECH_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "multi", label: "Auto / Multilingual" },
  { id: "hi", label: "Hindi" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "pt", label: "Portuguese" },
  { id: "it", label: "Italian" },
  { id: "nl", label: "Dutch" },
  { id: "ru", label: "Russian" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese" },
  { id: "zh-TW", label: "Chinese (Taiwan)" },
  { id: "tr", label: "Turkish" },
  { id: "id", label: "Indonesian" },
  { id: "vi", label: "Vietnamese" },
  { id: "ms", label: "Malay" },
  { id: "pl", label: "Polish" },
  { id: "uk", label: "Ukrainian" },
  { id: "el", label: "Greek" },
  { id: "cs", label: "Czech" },
  { id: "sk", label: "Slovak" },
  { id: "ro", label: "Romanian" },
  { id: "hu", label: "Hungarian" },
  { id: "bg", label: "Bulgarian" },
  { id: "sv", label: "Swedish" },
  { id: "da", label: "Danish" },
  { id: "no", label: "Norwegian" },
  { id: "fi", label: "Finnish" },
  { id: "et", label: "Estonian" },
  { id: "lv", label: "Latvian" },
  { id: "lt", label: "Lithuanian" },
  { id: "ca", label: "Catalan" },
];
export const HINTLENS_SPEECH_LANGUAGES = LENSDESK_SPEECH_LANGUAGES;

export interface OverlayViewProps {
  shortcuts?: Record<string, string>;
  session?: Session;
  sessions: Session[];
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  busy: boolean;
  streamingText: string;
  recording: boolean;
  recordSeconds: number;
  audioLevel?: number;
  transcript?: string;
  interviewLayout?: "full" | "compact";
  chatLayout?: "standard" | "minimal";
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  stealth: boolean;
  onToggleStealth: () => void;
  onCaptureScreen: () => void;
  onToggleRecording: () => void;
  onSend: (text: string, options?: { webSearch?: boolean }) => Promise<boolean>;
  onCancel: () => void;
  onToggleOverlay: () => void;
  /** Desktop renders exactly one floating window; hide expand affordances. */
  singleWindow?: boolean;
  images: string[];
  onRemoveImage: (index: number) => void;
  provider: Provider;
  model: string;
  providerReady?: boolean;
  onConnectProvider?: () => void;
  desktop: boolean;
  hideAnswer?: boolean;
  onToggleHideAnswer?: () => void;
  onAutoType?: (text?: string) => void;
  autoTyping?: boolean;
  onStopTyping?: () => void;
  error?: string;
  notice?: string;
  onHideWindow?: () => void;
  clickThrough?: boolean;
  onToggleClickThrough?: () => void;
  onSnapAndSolve?: () => void;
  // LensDesk explicit actions
  onOpenSettings?: (tab?: string) => void;
  onUndoCapture?: () => void;
  onClearBundle?: () => void;
  onToggleBrowser?: () => void;
  onToggleInterviewLayout?: () => void;
  onCycleProvider?: () => void;
  onCycleModel?: () => void;
  onRegionSnip?: () => void;
  activeView?: "assistant" | "browser";
  onToggleView?: (view: "assistant" | "browser") => void;
  renderBrowser?: React.ReactNode;
  detectedQuestion?: string | null;
  onDismissDetectedQuestion?: () => void;
  profiles?: Array<{ id: string; name: string }>;
  activeProfile?: { id: string; name: string; role?: string; company?: string; resume?: string; jobDescription?: string };
  onSelectProfile?: (profileId: string) => void;
  onEditNotes?: (notes: string) => void;
  onSaveNotes?: () => void;
  onImportResume?: (file?: File) => void;
  autoAnswer?: boolean;
  onToggleAutoAnswer?: () => void;
  audioSource?: "microphone" | "computer" | "both";
  onSetAudioSource?: (source: "microphone" | "computer" | "both") => void;
  microphones?: MediaDeviceInfo[];
  microphoneId?: string;
  onSelectMicrophone?: (deviceId: string) => void;
  elapsedSeconds?: number;
  theme?: string;
  availableUpdate?: { latestVersion: string; artifact?: any } | null;
  isInterviewMode?: boolean;
  onToggleInterviewMode?: (enabled?: boolean) => void;
  onClearTranscript?: () => void;
  speechLanguage?: string;
  onSetSpeechLanguage?: (lang: string) => void;
  onSetInterviewLayout?: (layout: "full" | "compact") => void;
}

export function OverlayView({
  shortcuts,
  session,
  sessions,
  onSelectSession,
  onNewSession,
  busy,
  streamingText,
  recording,
  recordSeconds,
  audioLevel = 0,
  transcript = "",
  interviewLayout = "full",
  chatLayout = "standard",
  opacity,
  onOpacityChange,
  stealth,
  onToggleStealth,
  onCaptureScreen,
  onToggleRecording,
  onSend,
  onCancel,
  onToggleOverlay,
  singleWindow = false,
  images,
  onRemoveImage,
  provider,
  model,
  providerReady = true,
  onConnectProvider,
  desktop,
  hideAnswer = false,
  onToggleHideAnswer,
  onAutoType,
  onStopTyping,
  error,
  notice,
  autoTyping = false,
  onHideWindow,
  clickThrough = false,
  onToggleClickThrough,
  onSnapAndSolve,
  onOpenSettings,
  onUndoCapture,
  onClearBundle,
  onToggleBrowser,
  onToggleInterviewLayout,
  onCycleProvider,
  onCycleModel,
  onRegionSnip,
  activeView = "assistant",
  onToggleView,
  renderBrowser,
  detectedQuestion,
  onDismissDetectedQuestion,
  profiles,
  activeProfile,
  onSelectProfile,
  onEditNotes,
  onSaveNotes,
  onImportResume,
  autoAnswer = true,
  onToggleAutoAnswer,
  audioSource,
  onSetAudioSource,
  microphones,
  microphoneId,
  onSelectMicrophone,
  elapsedSeconds,
  theme,
  availableUpdate,
  isInterviewMode,
  onToggleInterviewMode,
  onClearTranscript,
  speechLanguage,
  onSetSpeechLanguage,
  onSetInterviewLayout,
}: OverlayViewProps) {
  const [internalInterviewMode, setInternalInterviewMode] = useState(
    isInterviewMode ?? false,
  );
  const inInterviewMode = isInterviewMode ?? internalInterviewMode;
  const [localSpeechLanguage, setLocalSpeechLanguage] = useState<string>("en");
  const speechLang = speechLanguage ?? localSpeechLanguage;
  const activeInterviewLayout = interviewLayout || "full";

  const handleToggleInterviewMode = () => {
    const next = !inInterviewMode;
    setInternalInterviewMode(next);
    onToggleInterviewMode?.(next);
  };

  const handleExitInterview = () => {
    setInternalInterviewMode(false);
    onToggleInterviewMode?.(false);
  };

  const handleSetLayout = (layout: "full" | "compact") => {
    if (onSetInterviewLayout) {
      onSetInterviewLayout(layout);
    } else if (onToggleInterviewLayout && activeInterviewLayout !== layout) {
      onToggleInterviewLayout();
    }
  };

  const handleAIHelp = () => {
    const latest = (transcript || "").trim().slice(-3000);
    const prompt = latest
      ? `Help me answer this interview question from the live interviewer:\n\n${latest}`
      : "Help me answer the interview question shown in the attached screenshots.";
    void onSend(prompt, { webSearch: webSearchEnabled });
  };

  const handleClearTranscript = () => {
    onClearTranscript?.();
  };

  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [showKeysLegend, setShowKeysLegend] = useState(false);
  const [showCheatSheetModal, setShowCheatSheetModal] = useState(false);
  const [cheatSheetFilter, setCheatSheetFilter] = useState("");
  const [showMinMore, setShowMinMore] = useState(false);
  const [selectedBundleImage, setSelectedBundleImage] = useState<string | null>(
    null,
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousActiveView = useRef(activeView);
  const [contextTab, setContextTab] = useState<"transcript" | "notes">("transcript");
  const [contextExpanded, setContextExpanded] = useState(true);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const renderCleanText = (text: string) => {
    if (!text || !text.includes("$")) return text;
    const parts = text.split(/(\$[^$\n]+\$)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
        return (
          <span key={idx} className="bubble-math-inline">
            {part.slice(1, -1)}
          </span>
        );
      }
      return part;
    });
  };

  const markdownComponents = {
    a: ({ href, children }: any) => (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    hr: () => <hr className="bubble-hr" />,
    p: ({ children }: any) => (
      <p>
        {Array.isArray(children)
          ? children.map((c, i) =>
              typeof c === "string" ? renderCleanText(c) : c,
            )
          : typeof children === "string"
            ? renderCleanText(children)
            : children}
      </p>
    ),
    li: ({ children }: any) => (
      <li>
        {Array.isArray(children)
          ? children.map((c, i) =>
              typeof c === "string" ? renderCleanText(c) : c,
            )
          : typeof children === "string"
            ? renderCleanText(children)
            : children}
      </li>
    ),
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length, streamingText, busy]);

  useEffect(() => {
    typingRef.current = typing;
  }, [typing]);

  useEffect(() => {
    const previous = previousActiveView.current;
    previousActiveView.current = activeView;
    if (previous === "browser" && activeView === "assistant") {
      const frame = requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [activeView]);

  useEffect(() => {
    const off = window.lens?.onGlobalKey?.((event) => {
      if (event.type === "mode") {
        typingRef.current = event.typing;
        setTyping(event.typing);
        if (event.typing) {
          textareaRef.current?.focus();
          window.lens?.invoke?.("desktop.focusWindow")?.catch?.(() => {});
        }
      }
    });
    return off;
  }, []);

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // fallback
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (busy) return;
    const currentText = input || textareaRef.current?.value || "";
    const trimmed = currentText.trim();
    if (!trimmed && images.length === 0) return;
    const submitted = currentText;
    if (await onSend(trimmed, { webSearch: webSearchEnabled })) {
      setInput("");
      if (textareaRef.current) textareaRef.current.value = "";
    }
  };

  const isMac =
    typeof navigator !== "undefined" &&
    (/Mac|iPod|iPhone|iPad/.test(navigator.platform) ||
      /Macintosh/.test(navigator.userAgent));
  const key = (action: string) => {
    const alias: Record<string, string> = {
      undo: "clearLastCapture",
      clearBundle: "clearCaptures",
      clickThrough: "mouseMode",
    };
    return shortcutLabel(
      shortcuts && !shortcuts[action] && alias[action] ? alias[action] : action,
      shortcuts,
      isMac,
    );
  };
  const keyLabel = (action: string, fallback: string) => key(action) || fallback;

  // Provider icon badge helper
  const getProviderIcon = () => {
    switch (provider) {
      case "gemini":
        return <span className="provider-glyph gemini">✦</span>;
      case "groq":
        return <span className="provider-glyph groq">ⓖ</span>;
      case "openai":
        return <span className="provider-glyph openai">◯</span>;
      case "anthropic":
        return <span className="provider-glyph anthropic">▢</span>;
      case "deepseek":
        return <span className="provider-glyph deepseek">🐳</span>;
      default:
        return <span className="provider-glyph local">⚙</span>;
    }
  };

  const latestAssistantMessage = session?.messages
    ?.filter((m) => m.role === "assistant")
    ?.slice(-1)[0]?.content;

  const handleGetAnswer = async () => {
    if (busy) return;
    if (activeView === "browser" && onToggleView) {
      onToggleView("assistant");
    }
    if (input.trim()) {
      const text = input.trim();
      const submitted = input;
      if (await onSend(text))
        setInput((value) => (value === submitted ? "" : value));
    } else {
      onSnapAndSolve?.();
    }
  };

  const handleTypeAction = () => {
    if (autoTyping) {
      onStopTyping?.();
      return;
    }
    if (latestAssistantMessage && onAutoType) {
      onAutoType(latestAssistantMessage);
    } else if (onAutoType) {
      onAutoType();
    }
  };

  useGamepadController(
    {
      onGetAnswer: handleGetAnswer,
      onCancelAnswer: onCancel,
      onCaptureScreenshot: onCaptureScreen,
      onTypeAnswer: handleTypeAction,
      onUndoShot: onUndoCapture,
      onRegionSnip: onRegionSnip,
      onOpacityUp: () =>
        onOpacityChange(
          Math.min(1, Math.round((opacity + 0.05) * 100) / 100),
        ),
      onOpacityDown: () =>
        onOpacityChange(
          Math.max(0.1, Math.round((opacity - 0.05) * 100) / 100),
        ),
      onToggleOverlay: onHideWindow,
      onToggleKeys: () => setShowKeysLegend((v) => !v),
      onToggleBrowser: () => {
        if (onToggleView) {
          onToggleView(activeView === "browser" ? "assistant" : "browser");
        } else if (onToggleBrowser) {
          onToggleBrowser();
        }
      },
    },
    true,
  );

  const renderMinimalLayout = () => {
    return (
      <div className="min-overlay-container">
        {/* Minimal Chat Area */}
        <div className="min-chat-view">
          {(!session?.messages || session.messages.length === 0) && !streamingText ? (
            <div className="min-empty-prompt">
              <span>Chat</span>
              <p>Press Capture (Shift+S) or Get Answer to begin.</p>
            </div>
          ) : (
            <div className="min-messages-list">
              {session?.messages.map((m) => (
                <div key={m.id} className={`min-bubble ${m.role}`}>
                  <div className="min-bubble-header">
                    <span className="min-bubble-role">
                      {m.role === "user" ? "You" : "AI"}
                    </span>
                    {m.role === "assistant" && (
                      <button
                        className="copy-bubble-btn"
                        onClick={() => copyToClipboard(m.content, m.id)}
                        title="Copy answer"
                      >
                        {copiedId === m.id ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    )}
                  </div>
                  <div className="min-bubble-text markdown-body">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
              {busy && streamingText && (
                <div className="min-bubble assistant streaming">
                  <div className="min-bubble-header">
                    <span className="min-bubble-role">AI</span>
                  </div>
                  <div className="min-bubble-text markdown-body">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {streamingText}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Minimal One-Line Status Bar */}
        <div className="min-status-bar">
          <div className="min-status-left">
            <span>
              {recording
                ? `Recording... (${recordSeconds}s)`
                : autoTyping
                  ? "Typing..."
                  : busy
                    ? "Thinking..."
                    : "Live"}
            </span>
            <span className="min-status-sep">|</span>
            <span className="min-status-model">
              {provider} ({model})
            </span>
          </div>
          <div className="min-status-right">
            <span>(Ctrl+Shift+M for mouse)</span>
          </div>
        </div>

        {/* Minimal Screenshot Strip */}
        <div className="min-strip">
          {images.length === 0 ? (
            <div
              className="min-strip-empty"
              onClick={onCaptureScreen}
              title="Capture screen"
            >
              <Camera size={13} />
              <span>No screenshots - Shift+S / Ctrl+Shift+D to capture</span>
            </div>
          ) : (
            <div className="min-strip-thumbs">
              {images.map((img, idx) => (
                <div key={idx} className="min-thumb-item">
                  <img src={img} alt={`Capture ${idx + 1}`} />
                  <button
                    className="min-thumb-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveImage(idx);
                    }}
                    title="Remove this screenshot"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              <button
                className="min-strip-add"
                onClick={onCaptureScreen}
                title="Add screenshot"
              >
                +
              </button>
            </div>
          )}
        </div>

        {/* Minimal 4-Button Action Bar */}
        <div className="min-action-bar">
          {/* 1. Answer / Stop Answer */}
          <button
            className={`min-btn ${busy ? "stop" : "primary"}`}
            onClick={busy ? onCancel : handleGetAnswer}
          >
            {busy ? <Square size={13} /> : <Bot size={13} />}
            <span>{busy ? "Stop Answer" : "Answer"}</span>
          </button>

          {/* 2. Type / Stop Type */}
          <button
            className={`min-btn ${autoTyping ? "active-type" : ""}`}
            onClick={handleTypeAction}
          >
            <Keyboard size={13} />
            <span>{autoTyping ? "Stop Type" : "Type"}</span>
          </button>

          {/* 2b. Restart */}
          {(autoTyping || Boolean(latestAssistantMessage)) && (
            <button
              className="min-btn"
              onClick={() => {
                onStopTyping?.();
                setTimeout(() => {
                  if (latestAssistantMessage && onAutoType) {
                    onAutoType(latestAssistantMessage);
                  }
                }, 120);
              }}
              title="Type this answer again from the beginning"
            >
              <RotateCcw size={12} />
              <span>Restart</span>
            </button>
          )}

          {/* 3. Undo */}
          <button
            className="min-btn"
            onClick={onUndoCapture}
            disabled={images.length === 0}
            title="Undo last screenshot"
          >
            <RotateCcw size={13} />
            <span>Undo</span>
          </button>

          {/* 4. More Menu */}
          <div className="min-more-wrap">
            <button
              className={`min-btn more ${showMinMore ? "active" : ""}`}
              onClick={() => setShowMinMore((v) => !v)}
              title="More options"
            >
              <MoreVertical size={13} />
              <span>More</span>
            </button>

            {showMinMore && (
              <div className="min-more-popover">
                <button
                  onClick={() => {
                    setShowMinMore(false);
                    onClearBundle?.();
                  }}
                >
                  <Trash2 size={13} /> Clear screenshot bundle
                </button>
                <button
                  onClick={() => {
                    setShowMinMore(false);
                    onNewSession?.();
                  }}
                >
                  <RotateCcw size={13} /> Clear chat
                </button>
                <button
                  onClick={() => {
                    setShowMinMore(false);
                    setShowKeysLegend((v) => !v);
                  }}
                >
                  <Keyboard size={13} /> Hotkey cheat-sheet
                </button>
                <button
                  onClick={() => {
                    setShowMinMore(false);
                    onOpenSettings?.("Model");
                  }}
                >
                  <SettingsIcon size={13} /> Settings
                </button>
                <button
                  onClick={() => {
                    setShowMinMore(false);
                    onToggleInterviewLayout?.();
                  }}
                >
                  <AudioLines size={13} /> Interview mode
                </button>
                <button
                  onClick={() => {
                    setShowMinMore(false);
                    if (onToggleView) {
                      onToggleView(
                        activeView === "browser" ? "assistant" : "browser",
                      );
                    } else if (onToggleBrowser) {
                      onToggleBrowser();
                    }
                  }}
                >
                  <Globe size={13} /> Browser mode
                </button>
                <div className="min-popover-divider" />
                <div className="min-popover-opacity">
                  <span>Background</span>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={Math.round(opacity * 100)}
                    onChange={(e) =>
                      onOpacityChange(
                        Math.max(0.1, Number(e.target.value) / 100),
                      )
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderInterviewSuggestions = () => {
    const hasMessages = session && session.messages.length > 0;
    if (!hasMessages && !busy) {
      return (
        <div className="iv-suggestions-empty">
          <div className="iv-empty-sparkle">
            <Sparkles size={28} />
          </div>
          <p>
            Answers appear here automatically when the interviewer finishes a question (or press AI Help). Screenshots in the bundle are attached for coding questions.
          </p>
        </div>
      );
    }
    return (
      <div className="iv-messages-scroll">
        {session?.messages.map((m) => (
          <div key={m.id} className={`lensdesk-bubble hintlens-bubble ${m.role}`}>
            <div className="bubble-header">
              <span className="bubble-role">
                {m.role === "user" ? "Interviewer" : "AI"}
              </span>
              {m.role === "assistant" && (
                <div className="bubble-actions">
                  {onAutoType && (
                    <button
                      className="bubble-action-btn autotype"
                      onClick={() => onAutoType(m.content)}
                      title={`Auto-type answer into focused editor (${key("autoType")})`}
                    >
                      <Keyboard size={12} /> Type
                    </button>
                  )}
                  <button
                    className="bubble-action-btn copy"
                    onClick={() => copyToClipboard(m.content, m.id)}
                    title="Copy answer"
                  >
                    {copiedId === m.id ? (
                      <span className="copied-text">
                        <Check size={12} /> Copied
                      </span>
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              )}
            </div>

            {m.role === "assistant" && hideAnswer ? (
              <div
                className="bubble-hidden-mask"
                onClick={onToggleHideAnswer}
                title="Click to reveal answer"
              >
                <EyeOff size={15} />
                <span>Answer hidden (Stealth mode)</span>
              </div>
            ) : (
              <div className="bubble-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {m.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        ))}

        {busy && streamingText && (
          <div className="lensdesk-bubble hintlens-bubble assistant streaming">
            <div className="bubble-header">
              <span className="bubble-role">AI</span>
              <div className="bubble-actions">
                {onAutoType && (
                  <button
                    className="bubble-action-btn autotype"
                    onClick={() => onAutoType(streamingText)}
                  >
                    <Keyboard size={12} /> Type
                  </button>
                )}
                <button
                  className="bubble-action-btn copy"
                  onClick={() => copyToClipboard(streamingText, "streaming")}
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
            <div className="bubble-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {streamingText}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {busy && !streamingText && (
          <div className="iv-thinking-row">
            <Aperture size={15} className="spin" />
            <span>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    );
  };

  const renderInterviewComposer = () => (
    <div className="iv-composer-row">
      <input
        type="text"
        className="iv-composer-input focus-free-input"
        placeholder="Ask the AI a question…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        onFocus={() => {
          window.lens?.invoke?.("desktop.focusWindow")?.catch?.(() => {});
        }}
      />
      <button
        type="button"
        className="iv-composer-send-btn"
        onClick={handleSubmit}
        disabled={!input.trim()}
      >
        Send
      </button>
    </div>
  );

  const isDark =
    theme === "dark" ||
    (theme !== "light" &&
      typeof document !== "undefined" &&
      (document.documentElement.dataset.theme === "dark" ||
        (document.documentElement.dataset.theme !== "light" &&
          window.matchMedia?.("(prefers-color-scheme: dark)").matches)));

  return (
    <div
      className={`lensdesk-overlay-shell hintlens-overlay-shell ${opacity <= 0.2 ? "ghost-mode" : ""} ${interviewLayout === "compact" ? "compact-interview-mode" : ""}`}
      style={{
        backgroundColor: isDark
          ? `rgba(15, 23, 42, ${Math.max(0.1, opacity)})`
          : `rgba(255, 255, 255, ${Math.max(0.1, opacity)})`,
      }}
      onMouseDownCapture={() => {
        window.lens?.invoke?.("desktop.focusWindow")?.catch?.(() => {});
      }}
    >
      {/* 1. TOP TITLEBAR */}
      <header className="lensdesk-titlebar hintlens-titlebar">
        <div className="titlebar-left">
          <span className="app-title">LensDesk</span>
          {availableUpdate && (
            <button
              type="button"
              onClick={() => onOpenSettings?.("Account")}
              style={{
                marginLeft: 8,
                padding: "2px 8px",
                fontSize: "11px",
                borderRadius: "12px",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                background: "rgba(16, 185, 129, 0.2)",
                color: "#34d399",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              title="New update available! Click to open update manager."
            >
              <span>🚀 Update v{availableUpdate.latestVersion}</span>
            </button>
          )}
          {interviewLayout === "compact" && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                marginLeft: "8px",
              }}
            >
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "rgba(124, 58, 237, 0.25)",
                  color: "#c4b5fd",
                  fontWeight: 600,
                  letterSpacing: "0.5px",
                }}
              >
                INTERVIEW
              </span>
              {(elapsedSeconds !== undefined || recording) && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    fontSize: "10px",
                    color: "#94a3b8",
                    padding: "2px 5px",
                    background: "rgba(255, 255, 255, 0.06)",
                    borderRadius: "4px",
                  }}
                  title="Session duration"
                >
                  <Clock size={10} />
                  <span>{formatTimer(recording ? recordSeconds : (elapsedSeconds || 0))}</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="titlebar-right">
          {/* Settings Gear Button */}
          <button
            className="titlebar-icon-btn gear"
            onClick={() => onOpenSettings?.("Model")}
            title={"Open Settings (" + key("shortcuts") + ")"}
          >
            <SettingsIcon size={16} />
          </button>

          {!singleWindow && (
            <button
              className="titlebar-icon-btn expand"
              onClick={onToggleOverlay}
              title={`Expand to full workspace (${key("overlay")})`}
            >
              <Maximize2 size={16} />
            </button>
          )}

          {/* Minimize / Hide Button */}
          <button
            className="titlebar-icon-btn hide"
            onClick={onHideWindow}
            title={`Hide window (${key("hide")})`}
          >
            <Minus size={16} />
          </button>

          {/* Close Window Button */}
          <button
            className="titlebar-icon-btn close"
            onClick={onHideWindow}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* 2. LENSDESK INTERVIEW TOP ACTION BAR */}
      {inInterviewMode && (
        <div className="lensdesk-interview-action-bar hintlens-interview-action-bar">
          {/* Start/Stop Session */}
          <button
            type="button"
            className={`iv-session-btn ${recording ? "stop" : "start"}`}
            onClick={onToggleRecording}
            title={recording ? "Stop listening to interviewer" : "Start listening to interviewer"}
          >
            {recording ? (
              <>
                <Square size={12} fill="currentColor" />
                <span>Stop Session</span>
              </>
            ) : (
              <>
                <Play size={12} fill="currentColor" />
                <span>Start Session</span>
              </>
            )}
          </button>

          {/* Auto-answer switch */}
          <label className="iv-auto-answer-toggle" title="Answers appear automatically when interviewer finishes speaking">
            <input
              type="checkbox"
              checked={autoAnswer}
              onChange={onToggleAutoAnswer}
            />
            <span>Auto-answer</span>
          </label>

          {/* Speech language selector */}
          <div className="iv-speech-group" title="Speech language applies when the next session starts">
            <span className="iv-speech-label">Speech</span>
            <select
              className="iv-speech-select"
              value={speechLang}
              onChange={(e) => {
                const val = e.target.value;
                setLocalSpeechLanguage(val);
                onSetSpeechLanguage?.(val);
              }}
            >
              {LENSDESK_SPEECH_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* AI Help (+) / AI Help */}
          <button
            type="button"
            className="iv-ai-help-btn"
            onClick={handleAIHelp}
            title={images.length > 0 ? `screenshots: ${images.length}` : "Solve latest transcript with AI"}
          >
            <Sparkles size={12} />
            <span>{images.length > 0 ? "AI Help (+)" : "AI Help"}</span>
          </button>

          {/* Undo Shot */}
          <button
            type="button"
            className="iv-action-btn"
            onClick={onUndoCapture}
            disabled={images.length === 0}
            title="Undo last captured screenshot"
          >
            <RotateCcw size={12} />
            <span>Undo Shot</span>
          </button>

          {/* Clear Transcript */}
          <button
            type="button"
            className="iv-action-btn"
            onClick={handleClearTranscript}
            disabled={!transcript}
            title="Clear current speech transcript"
          >
            <Trash2 size={12} />
            <span>Clear Transcript</span>
          </button>

          {/* Layout: Full / Compact */}
          <div className="iv-layout-group">
            <span className="iv-layout-label">Layout</span>
            <div className="iv-layout-pills">
              <button
                type="button"
                className={`iv-layout-btn ${activeInterviewLayout === "full" ? "active" : ""}`}
                onClick={() => handleSetLayout("full")}
                title="Full layout: Split view with live transcript and suggestions"
              >
                Full
              </button>
              <button
                type="button"
                className={`iv-layout-btn ${activeInterviewLayout === "compact" ? "active" : ""}`}
                onClick={() => handleSetLayout("compact")}
                title="Compact narrows the interview window to a single-line transcript with full-width answers. Applies to interview mode only."
              >
                Compact
              </button>
            </div>
          </div>

          {/* Shots (%d) button */}
          <button
            type="button"
            className={`iv-shots-btn ${images.length > 0 ? "has-shots" : ""}`}
            onClick={onCaptureScreen}
            title="Attached screenshots bundle. Click to capture new shot (Shift+S)."
          >
            <Camera size={12} />
            <span>Shots ({images.length})</span>
          </button>
        </div>
      )}

      {/* 3. MAIN BODY */}
      {inInterviewMode && activeInterviewLayout === "compact" ? (
        <div className="lensdesk-compact-interview-body hintlens-compact-interview-body">
          {/* ##ivcompactline */}
          <div className="lensdesk-compact-ticker-line hintlens-compact-ticker-line">
            <span className={`ticker-status-pill ${recording ? "live" : "off"}`}>
              {recording ? "[interviewer: live]" : "[interviewer: off]"}
            </span>
            <div className="ticker-text-scroll">
              {recording ? (
                transcript ? (
                  <span className="ticker-active-text">{transcript}</span>
                ) : (
                  <span className="ticker-placeholder-text">
                    Listening... the interviewer's speech appears here.
                  </span>
                )
              ) : (
                <span className="ticker-idle-text">
                  Start a session to begin live transcription of the interviewer's audio.
                </span>
              )}
            </div>
            {images.length > 0 && (
              <span className="ticker-shots-badge" onClick={onUndoCapture} title="Click to undo latest shot">
                {images.length} shot{images.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Full-width AI Suggestions Canvas (##ivsuggest) */}
          <div className="lensdesk-compact-suggestions-canvas hintlens-compact-suggestions-canvas">
            <div className="iv-suggestions-header">
              <span className="iv-suggestions-title">AI Suggestions</span>
              {busy && streamingText && (
                <span className="iv-generating-pill">Streaming answer...</span>
              )}
            </div>

            <div className="iv-suggestions-content">
              {renderInterviewSuggestions()}
            </div>

            {renderInterviewComposer()}
          </div>
        </div>
      ) : inInterviewMode && activeInterviewLayout === "full" ? (
        <div className="lensdesk-interview-split hintlens-interview-split">
          {/* Left Column: Live Transcript (##ivtranscript) */}
          <div className="iv-transcript-pane">
            <div className="iv-pane-header">
              <span className="iv-pane-title">Live Transcript</span>
              <span className="iv-role-badge">Interviewer</span>
              {recording && (
                <div className="mini-audio-bars">
                  {[10, 18, 28, 14, 22, 30, 16, 24, 12].map((h, i) => (
                    <span
                      key={i}
                      style={{
                        height: `${Math.max(6, Math.min(26, (h * (audioLevel || 20)) / 25))}px`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="iv-transcript-body">
              {transcript ? (
                <div className="iv-transcript-lines">
                  {transcript.split("\n").filter(Boolean).map((line, idx) => (
                    <div key={idx} className="iv-transcript-line">
                      <span className="iv-q-prefix">Q:</span>
                      <span className="iv-q-text">{line}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="iv-transcript-empty-text">
                  {recording
                    ? "Listening... the interviewer's speech appears here. (System audio loopback)"
                    : "Start a session to begin live transcription of the interviewer's audio."}
                </div>
              )}
            </div>

            <div className="iv-transcript-footer">
              <button
                type="button"
                className="iv-footer-btn ai-help"
                onClick={handleAIHelp}
                title="Send current transcript to AI for immediate answer"
              >
                <Sparkles size={12} />
                <span>AI Help</span>
              </button>
              <button
                type="button"
                className="iv-footer-btn clear"
                onClick={handleClearTranscript}
                disabled={!transcript}
                title="Clear current transcript"
              >
                <Trash2 size={12} />
                <span>Clear Transcript</span>
              </button>
            </div>
          </div>

          {/* Right Column: AI Suggestions (##ivsuggest) */}
          <div className="iv-answers-pane">
            <div className="iv-pane-header">
              <span className="iv-pane-title">AI Suggestions</span>
              {busy && streamingText && (
                <span className="iv-generating-pill">Streaming answer...</span>
              )}
            </div>

            <div className="iv-suggestions-content">
              {renderInterviewSuggestions()}
            </div>

            {renderInterviewComposer()}
          </div>
        </div>
      ) : activeView === "browser" && renderBrowser ? (
        <div className="floating-browser-container">{renderBrowser}</div>
      ) : chatLayout === "minimal" && interviewLayout !== "compact" ? (
        renderMinimalLayout()
      ) : (
        <div className="lensdesk-main-split hintlens-main-split">
          {/* Left Column: Chat Area */}
          <section className="lensdesk-chat-column hintlens-chat-column">
            <div className="lensdesk-messages-container hintlens-messages-container">
              {/* Live Detected Question Banner */}
              {detectedQuestion && (
                <div className="lensdesk-detected-banner hintlens-detected-banner">
                  <div className="detected-left">
                    <Sparkles size={14} className="sparkle-icon" />
                    <div className="detected-content">
                      <span className="detected-label">
                        Live Question Detected
                      </span>
                      <span className="detected-text">{detectedQuestion}</span>
                    </div>
                  </div>
                  <div className="detected-actions">
                    <button
                      type="button"
                      className="detected-solve-btn"
                      onClick={() => {
                        onSend(detectedQuestion, {
                          webSearch: webSearchEnabled,
                        });
                        onDismissDetectedQuestion?.();
                      }}
                      title="Generate instant answer for this detected question"
                    >
                      Solve
                    </button>
                    <button
                      type="button"
                      className="detected-close-btn"
                      onClick={onDismissDetectedQuestion}
                      title="Dismiss"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              {/* If no messages yet */}
              {(!session || session.messages.length === 0) && !busy && (
                <div className="lensdesk-chat-empty hintlens-chat-empty">
                  <div className="empty-sparkle">
                    <Bot size={28} />
                  </div>
                  <h3>{providerReady ? "LensDesk Overlay Ready" : "Connect an AI provider"}</h3>
                  <p>
                    {!providerReady ? "Add your provider API key in Settings before asking for AI answers. Screen capture is available now." : <>Press <strong>{key("capture")}</strong> to capture your
                    screen, or <strong>{key("getAnswer")}</strong> to get
                    instant AI answers.</>}
                  </p>
                  {!providerReady && onConnectProvider && (
                    <button className="toolbar-btn secondary" onClick={onConnectProvider}>
                      Open AI connection settings
                    </button>
                  )}
                </div>
              )}

              {/* Conversation Messages */}
              {session?.messages.map((m) => (
                <div key={m.id} className={`lensdesk-bubble hintlens-bubble ${m.role}`}>
                  <div className="bubble-header">
                    <span className="bubble-role">
                      {m.role === "user" ? "You" : "LensDesk"}
                    </span>

                    {m.role === "assistant" && (
                      <div className="bubble-actions">
                        {onAutoType && (
                          <button
                            className="bubble-action-btn autotype"
                            onClick={() => onAutoType(m.content)}
                            title={`Auto-type answer into focused app (${key("autoType")})`}
                          >
                            <Keyboard size={12} /> Type
                          </button>
                        )}
                        <button
                          className="bubble-action-btn copy"
                          onClick={() => copyToClipboard(m.content, m.id)}
                          title="Copy answer"
                        >
                          {copiedId === m.id ? (
                            <span className="copied-text">
                              <Check size={12} /> Copied
                            </span>
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {m.images && m.images.length > 0 && (
                    <div className="bubble-images">
                      {m.images.map((img, i) => (
                        <div
                          key={i}
                          className="bubble-image-thumb-card"
                          onClick={() => setSelectedBundleImage(img)}
                          title="Click to expand full screenshot"
                        >
                          <img
                            src={img}
                            alt={`Attached screenshot ${i + 1}`}
                            className="bubble-thumb-img"
                          />
                          <div className="bubble-thumb-overlay">
                            <Maximize2 size={11} />
                            <span>Capture #{i + 1}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {m.role === "assistant" && hideAnswer ? (
                    <div
                      className="bubble-hidden-mask"
                      onClick={onToggleHideAnswer}
                      title="Click to reveal answer"
                    >
                      <EyeOff size={15} />
                      <span>Answer hidden (Stealth mode)</span>
                      <small>Press {key("hideAnswer")} to reveal</small>
                    </div>
                  ) : (
                    <div className="bubble-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}
              {/* Streaming assistant response */}
              {busy && streamingText && (
                <div className="lensdesk-bubble hintlens-bubble assistant streaming">
                  <div className="bubble-header">
                    <span className="bubble-role">LensDesk</span>
                    <div className="bubble-actions">
                      {onAutoType && (
                        <button
                          className="bubble-action-btn autotype"
                          onClick={() => onAutoType(streamingText)}
                          title="Auto-type"
                        >
                          <Keyboard size={12} /> Type
                        </button>
                      )}
                      <button
                        className="bubble-action-btn copy"
                        onClick={() =>
                          copyToClipboard(streamingText, "streaming")
                        }
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>

                  {hideAnswer ? (
                    <div
                      className="bubble-hidden-mask"
                      onClick={onToggleHideAnswer}
                    >
                      <EyeOff size={15} />
                      <span>Generating answer (hidden)...</span>
                    </div>
                  ) : (
                    <div className="bubble-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {streamingText}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}

              {/* Thinking status */}
              {busy && !streamingText && (
                <div className="lensdesk-thinking-row hintlens-thinking-row">
                  <Aperture size={15} className="spin" />
                  <span>Thinking through solution...</span>
                  <button className="thinking-cancel-btn" onClick={onCancel}>
                    <Square size={11} /> Stop
                  </button>
                </div>
              )}

              {/* Error Alert */}
              {error && (
                <div
                  className="lensdesk-error-banner hintlens-error-banner"
                  style={{
                    margin: "8px 0",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    color: "#fca5a5",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                    <span style={{ fontSize: "14px" }}>⚠️</span>
                    <span style={{ lineHeight: 1.4 }}>{error}</span>
                  </div>
                  {onConnectProvider && (
                    <button
                      type="button"
                      className="toolbar-btn secondary"
                      onClick={onConnectProvider}
                      style={{ fontSize: "11px", padding: "4px 8px", whiteSpace: "nowrap" }}
                    >
                      Settings
                    </button>
                  )}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Attached Screenshots Preview Strip */}
            {images.length > 0 && (
              <div className="composer-attached-strip">
                <span className="composer-attached-label">
                  <Camera size={12} />
                  <span>Screenshots ({images.length}/5)</span>
                </span>
                <div className="composer-chips-row">
                  {images.map((img, idx) => (
                    <div
                      key={idx}
                      className="composer-screenshot-chip"
                      onClick={() => setSelectedBundleImage(img)}
                      title="Click to preview screenshot"
                    >
                      <img src={img} alt={`Capture ${idx + 1}`} />
                      <span className="chip-name">Shot #{idx + 1}</span>
                      {onRemoveImage && (
                        <button
                          type="button"
                          className="chip-remove-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveImage(idx);
                          }}
                          title="Remove capture"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inline Chat Composer */}
            <div className="lensdesk-composer hintlens-composer">
              <button
                type="button"
                className={`composer-tool-btn ${webSearchEnabled ? "active" : ""}`}
                onClick={() => setWebSearchEnabled((prev) => !prev)}
                title={
                  webSearchEnabled
                    ? "Live Web Search ON (DuckDuckGo real-time sources with citations)"
                    : "Enable Live Web Search"
                }
              >
                <Globe size={13} />
                <span>Web</span>
              </button>
              <textarea
                ref={textareaRef}
                rows={1}
                className={`composer-textarea focus-free-input ${typing ? "is-typing" : ""}`}
                placeholder={
                  webSearchEnabled
                    ? "Ask with live web search & citations..."
                    : "Ask a question or request..."
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  window.lens?.invoke?.("desktop.focusWindow")?.catch?.(() => {});
                }}
                onClick={() => {
                  window.lens?.invoke?.("desktop.focusWindow")?.catch?.(() => {});
                }}
              />
              <button
                className="composer-send-btn"
                onClick={handleSubmit}
                disabled={!input.trim() && !(textareaRef.current?.value?.trim()) && images.length === 0}
              >
                <ArrowUp size={15} />
              </button>
            </div>
          </section>

          {/* Right Column: Screenshot Bundle Drawer */}
          <aside className="lensdesk-bundle-column hintlens-bundle-column">
            <div className="bundle-header">
              <span className="bundle-title">Bundle ({images.length})</span>
              {images.length > 0 && (
                <button
                  className="bundle-clear-btn"
                  onClick={onClearBundle}
                  title={"Clear bundle (" + key("clearBundle") + ")"}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="bundle-body">
              {images.length === 0 ? (
                <div className="bundle-empty">
                  <p className="bundle-empty-title">No screenshots</p>
                  <p className="bundle-empty-hint">
                    {key("capture")} to capture
                  </p>
                </div>
              ) : (
                <div className="bundle-list">
                  {images.map((img, idx) => (
                    <div
                      key={idx}
                      className="bundle-item-card"
                      onClick={() => setSelectedBundleImage(img)}
                    >
                      <div className="bundle-item-thumb">
                        <img src={img} alt={`Capture ${idx + 1}`} />
                      </div>
                      <div className="bundle-item-meta">
                        <span className="bundle-item-name">
                          Shot #{idx + 1}
                        </span>
                        <button
                          className="bundle-remove-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveImage(idx);
                          }}
                          title={"Remove capture (" + key("undo") + ")"}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* 3. BOTTOM STATUS ROW */}
      <div className="lensdesk-status-row hintlens-status-row">
        <div className="status-left">
          <span
            className={`status-dot ${
              recording ? "recording" : busy || !providerReady ? "busy" : "ready"
            }`}
          />
          <span className="status-label">
            {recording
              ? `Listening (${recordSeconds}s)...`
              : busy
                ? "Generating answer..."
                : providerReady ? "Ready" : "API key required"}
          </span>
        </div>

        <div className="status-right">
          <div className="provider-status-badge" onClick={onCycleProvider}>
            {getProviderIcon()}
            <span className="provider-name">{provider}</span>
            <span className="model-name">({model})</span>
            <span className="captures-count">| {images.length} captures</span>
          </div>
        </div>
      </div>

      {/* 4. ACTION TOOLBAR */}
      <div className="lensdesk-toolbar-row hintlens-toolbar-row">
        <div className="toolbar-left-buttons">
          {/* 1. Get Answer */}
          <button
            className="toolbar-btn primary get-answer"
            onClick={handleGetAnswer}
            disabled={busy}
            title={`Get Answer (${keyLabel("getAnswer", "Shift+A")})`}
          >
            <Bot size={15} />
            <span>Get Answer</span>
          </button>

          {/* 2. Capture */}
          <button
            className="toolbar-btn secondary"
            onClick={onCaptureScreen}
            title={`Capture Screenshot (${keyLabel("capture", "Shift+S")})`}
          >
            <Camera size={14} />
            <span>Capture</span>
          </button>

          {/* 2b. Voice Record */}
          {onToggleRecording && (
            <button
              className={`toolbar-btn secondary ${recording ? "active-recording" : ""}`}
              onClick={onToggleRecording}
              title={
                recording
                  ? `Stop Recording (${recordSeconds}s)`
                  : "Record Audio / Microphone"
              }
            >
              {recording ? <MicOff size={14} /> : <Mic size={14} />}
              <span>{recording ? `${recordSeconds}s` : "Record"}</span>
            </button>
          )}

          {/* 3. Type */}
          <button
            className={`toolbar-btn secondary ${autoTyping ? "active-typing" : ""}`}
            onClick={handleTypeAction}
            title={
              autoTyping
                ? `Stop typing (${keyLabel("autoType", "Shift+T")})`
                : `Type answer into focused app (${keyLabel("autoType", "Shift+T")})`
            }
          >
            <Keyboard size={14} />
            <span>{autoTyping ? "Stop Typing" : "Type"}</span>
          </button>

          {/* 3b. Restart Typing from beginning */}
          {(autoTyping || Boolean(latestAssistantMessage)) && (
            <button
              className="toolbar-btn secondary restart-type"
              onClick={() => {
                onStopTyping?.();
                setTimeout(() => {
                  if (latestAssistantMessage && onAutoType) {
                    onAutoType(latestAssistantMessage);
                  }
                }, 120);
              }}
              title="Type this answer again from the beginning"
            >
              <RotateCcw size={13} />
              <span>Restart</span>
            </button>
          )}

          {/* 4. Undo */}
          <button
            className="toolbar-btn secondary"
            onClick={onUndoCapture}
            disabled={images.length === 0}
            title={`Undo last screenshot (${keyLabel("undo", "Shift+U")})`}
          >
            <RotateCcw size={14} />
            <span>Undo</span>
          </button>

          {/* 5. Keys */}
          <button
            className={`toolbar-btn secondary ${showKeysLegend ? "active" : ""}`}
            onClick={() => setShowKeysLegend((v) => !v)}
            title="Toggle hotkey cheat-sheet"
          >
            <span>Keys</span>
          </button>

          {/* 6. Interview */}
          <button
            className={`toolbar-btn interview ${interviewLayout === "compact" ? "active" : ""}`}
            onClick={onToggleInterviewLayout}
            title={
              interviewLayout === "compact"
                ? "Switch back to Full Workbench layout"
                : "Switch to Interview Mode (voice recognition & teleprompter)"
            }
          >
            <span>{interviewLayout === "compact" ? "Interview ON" : "Interview"}</span>
          </button>

          {/* 7. Browser */}
          <button
            className={`toolbar-btn browser ${activeView === "browser" ? "active" : ""}`}
            onClick={() => {
              if (onToggleView) {
                onToggleView(
                  activeView === "browser" ? "assistant" : "browser",
                );
              } else if (onToggleBrowser) {
                onToggleBrowser();
              }
            }}
            title={
              activeView === "browser"
                ? "Switch back to Assistant"
                : "Open Browser (" + key("browser") + ")"
            }
          >
            <Globe size={14} />
            <span>{activeView === "browser" ? "Assistant" : "Browser"}</span>
          </button>
        </div>

        {/* Opacity slider and mouse mode label */}
        <div className="toolbar-right-controls">
          <div className="bg-opacity-control">
            <span className="bg-label">BG</span>
            <div className="opacity-preset-pills">
              {[100, 80, 60, 40, 20, 10].map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`opacity-pill-btn ${Math.round(opacity * 100) === val ? "active" : ""}`}
                  onClick={() => onOpacityChange(val / 100)}
                  title={`Set opacity to ${val}%`}
                >
                  {`${val}%`}
                </button>
              ))}
            </div>
            <span className="bg-val-text">{Math.max(10, Math.round(opacity * 100))}%</span>
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={Math.max(10, Math.round(opacity * 100))}
              onChange={(e) => onOpacityChange(Math.max(0.1, Number(e.target.value) / 100))}
              className="bg-slider-track"
              title="Continuous cursor opacity (10% - 100%)"
            />
          </div>

          <span
            className="mouse-hint-text"
            onClick={onToggleClickThrough}
            title={"Toggle Mouse Mode (" + key("clickThrough") + ")"}
          >
            ({key("clickThrough")} for mouse)
          </span>
        </div>
      </div>

      {/* 5. SHORTCUT CHEAT-SHEET LEGEND BAR */}
      {showKeysLegend && (
        <div className="lensdesk-shortcuts-legend-bar hintlens-shortcuts-legend-bar">
          <div className="legend-row">
            <div
              className="legend-pill"
              onClick={handleGetAnswer}
              title={`Get Answer (${keyLabel("getAnswer", "Shift + A")})`}
              style={{ cursor: "pointer" }}
            >
              <span className="pill-name">Get Answer</span>
              <kbd className="pill-key">
                {keyLabel("getAnswer", "Shift + A")}
              </kbd>
            </div>
            <div
              className="legend-pill"
              onClick={onCaptureScreen}
              title={`Capture Screenshot (${keyLabel("capture", "Shift + S")})`}
              style={{ cursor: "pointer" }}
            >
              <span className="pill-name">Screenshot</span>
              <kbd className="pill-key">{keyLabel("capture", "Shift + S")}</kbd>
            </div>
            <div
              className="legend-pill"
              onClick={onRegionSnip || onCaptureScreen}
              title={`Region Snipping (${keyLabel("regionSnip", "Ctrl + Shift + C")})`}
              style={{ cursor: "pointer" }}
            >
              <span className="pill-name">Region</span>
              <kbd className="pill-key">
                {keyLabel("regionSnip", "Ctrl + Shift + C")}
              </kbd>
            </div>
            <div
              className="legend-pill"
              onClick={onUndoCapture}
              title={`Undo last screenshot (${keyLabel("undo", "Shift + U")})`}
              style={{
                cursor: images.length > 0 ? "pointer" : "not-allowed",
                opacity: images.length > 0 ? 1 : 0.6,
              }}
            >
              <span className="pill-name">Undo</span>
              <kbd className="pill-key">{keyLabel("undo", "Shift + U")}</kbd>
            </div>
            <div
              className={`legend-pill ${autoTyping ? "active-green" : ""}`}
              onClick={handleTypeAction}
              title={
                autoTyping
                  ? `Stop typing (${keyLabel("autoType", "Shift + T")})`
                  : `Auto-type code (${keyLabel("autoType", "Shift + T")})`
              }
              style={{ cursor: "pointer" }}
            >
              <span className="pill-name">
                {autoTyping ? "Stop Type" : "Type"}
              </span>
              <kbd className="pill-key">
                {keyLabel("autoType", "Shift + T")}
              </kbd>
            </div>
          </div>

          <div className="legend-row">
            <div
              className="legend-pill"
              onClick={onCycleProvider}
              title={`Cycle AI Provider (${keyLabel("cycleProvider", "Shift + P")})`}
              style={{ cursor: "pointer" }}
            >
              <span className="pill-name">Provider</span>
              <kbd className="pill-key">
                {keyLabel("cycleProvider", "Shift + P")}
              </kbd>
            </div>
            <div
              className="legend-pill"
              onClick={onCycleModel}
              title={`Cycle AI Model (${keyLabel("cycleModel", "Ctrl + Shift + R")})`}
              style={{ cursor: "pointer" }}
            >
              <span className="pill-name">Model</span>
              <kbd className="pill-key">
                {keyLabel("cycleModel", "Ctrl + Shift + R")}
              </kbd>
            </div>
            <div
              className={`legend-pill ${clickThrough ? "active-green" : ""}`}
              onClick={onToggleClickThrough}
              title={`Toggle Mouse Click-Through (${keyLabel("mouseMode", keyLabel("clickThrough", "Shift + M"))})`}
              style={{ cursor: "pointer" }}
            >
              <span className="pill-name">
                {clickThrough ? "Mouse ON" : "Mouse"}
              </span>
              <kbd className="pill-key">
                {keyLabel("mouseMode", keyLabel("clickThrough", "Shift + M"))}
              </kbd>
            </div>
            <div
              className={`legend-pill ${stealth ? "active-green" : ""}`}
              onClick={onToggleStealth}
              title={`Toggle Stealth Mode (${keyLabel("stealth", "Shift + R")})`}
              style={{ cursor: "pointer" }}
            >
              <span className="pill-name">
                {stealth ? "Stealth ON" : "Stealth"}
              </span>
              <kbd className="pill-key">{keyLabel("stealth", "Shift + R")}</kbd>
            </div>
            <div
              className="legend-pill"
              onClick={() => setShowCheatSheetModal(true)}
              title={`Open Hotkey Cheat-Sheet (${keyLabel("shortcuts", "Ctrl + Shift + J")})`}
              style={{ cursor: "pointer" }}
            >
              <span className="pill-name">Cheat-Sheet</span>
              <kbd className="pill-key">
                {keyLabel("shortcuts", "Ctrl + Shift + J")}
              </kbd>
            </div>
          </div>
        </div>
      )}

      {/* Hotkeys Cheat-Sheet Modal Window */}
      {showCheatSheetModal && (
        <div
          className="cheatsheet-modal-overlay"
          onClick={() => setShowCheatSheetModal(false)}
        >
          <div
            className="cheatsheet-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cheatsheet-modal-header">
              <span className="cheatsheet-title">Hotkeys Cheat-Sheet</span>
              <button
                type="button"
                className="cheatsheet-close-btn"
                onClick={() => setShowCheatSheetModal(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="cheatsheet-search-bar">
              <input
                type="text"
                placeholder="Filter actions or shortcuts..."
                value={cheatSheetFilter}
                onChange={(e) => setCheatSheetFilter(e.target.value)}
                autoFocus
              />
            </div>
            <div className="cheatsheet-modal-content">
              {[
                {
                  category: "Core Actions",
                  items: [
                    { name: "Get Answer / Analyze", key: keyLabel("getAnswer", "Shift + A") },
                    { name: "Capture Screenshot", key: keyLabel("capture", "Shift + S") },
                    { name: "Mark Region Point (Snip)", key: keyLabel("regionSnip", "Ctrl + Shift + C") },
                    { name: "Clear Last Screenshot", key: keyLabel("undo", "Shift + U") },
                    { name: "Clear Screenshot Bundle", key: keyLabel("clearBundle", "Ctrl + Shift + X") },
                    { name: "Clear Chat / Responses", key: keyLabel("clearChat", "Ctrl + Shift + N") },
                    { name: "Stop / Cancel Answer", key: keyLabel("cancelAnswer", "Escape") },
                    { name: "Type / Auto-type Answer", key: keyLabel("autoType", "Shift + T") },
                    { name: "Cycle AI Provider", key: keyLabel("cycleProvider", "Shift + P") },
                    { name: "Cycle AI Model", key: keyLabel("cycleModel", "Ctrl + Shift + R") },
                    { name: "Open / Close Browser", key: keyLabel("browser", "Ctrl + Shift + G") },
                  ],
                },
                {
                  category: "Window Management",
                  items: [
                    { name: "Toggle Overlay Visibility", key: keyLabel("toggle", "Ctrl + Shift + L") },
                    { name: "Hide / Reveal Window", key: keyLabel("hide", "Shift + H") },
                    { name: "Toggle Mouse Mode", key: keyLabel("mouseMode", keyLabel("clickThrough", "Shift + M")) },
                    { name: "Move Window Up", key: keyLabel("moveUp", "Ctrl + Shift + Up") },
                    { name: "Move Window Down", key: keyLabel("moveDown", "Ctrl + Shift + Down") },
                    { name: "Move Window Left", key: keyLabel("moveLeft", "Ctrl + Shift + Left") },
                    { name: "Move Window Right", key: keyLabel("moveRight", "Ctrl + Shift + Right") },
                    { name: "Scroll Answer Up", key: keyLabel("scrollUp", "Page Up") },
                    { name: "Scroll Answer Down", key: keyLabel("scrollDown", "Page Down") },
                    { name: "Toggle Stealth Mode", key: keyLabel("stealth", "Shift + R") },
                    { name: "Toggle Light / Dark Theme", key: keyLabel("theme", "Ctrl + Shift + T") },
                    { name: "Increase Background Opacity", key: keyLabel("opacityUp", "Shift + I") },
                    { name: "Decrease Background Opacity", key: keyLabel("opacityDown", "Shift + J") },
                  ],
                },
                {
                  category: "Application",
                  items: [
                    { name: "Show Hotkey Cheat-Sheet", key: keyLabel("shortcuts", "Ctrl + Shift + J") },
                    { name: "Restart Application", key: keyLabel("restart", "Ctrl + Shift + F5") },
                    { name: "Quit Application", key: keyLabel("quit", "Ctrl + Shift + Q") },
                  ],
                },
              ].map((section) => {
                const filtered = section.items.filter(
                  (item) =>
                    !cheatSheetFilter ||
                    item.name.toLowerCase().includes(cheatSheetFilter.toLowerCase()) ||
                    item.key.toLowerCase().includes(cheatSheetFilter.toLowerCase())
                );
                if (filtered.length === 0) return null;
                return (
                  <div key={section.category} className="cheatsheet-section">
                    <h4 className="cheatsheet-section-title">{section.category}</h4>
                    <div className="cheatsheet-table">
                      {filtered.map((item) => (
                        <div key={item.name} className="cheatsheet-row">
                          <span className="cheatsheet-action-name">{item.name}</span>
                          <kbd className="cheatsheet-key-badge">{item.key}</kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Screenshot Preview Modal (if clicking a bundle thumbnail) */}
      {selectedBundleImage && (
        <div
          className="bundle-preview-modal"
          onClick={() => setSelectedBundleImage(null)}
        >
          <div
            className="preview-modal-inner"
            onClick={(e) => e.stopPropagation()}
          >
            <img src={selectedBundleImage} alt="Fullscreen preview" />
            <button
              className="preview-close-btn"
              onClick={() => setSelectedBundleImage(null)}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
