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
} from "lucide-react";
import type { Session, Provider } from "./types";
import { shortcutLabel } from "./shortcut-label";

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
  // HintLens explicit actions
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
}: OverlayViewProps) {
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [showKeysLegend, setShowKeysLegend] = useState(false);
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

  return (
    <div
      className={`hintlens-overlay-shell ${opacity <= 0.2 ? "ghost-mode" : ""} ${interviewLayout === "compact" ? "compact-interview-mode" : ""}`}
      style={{
        backgroundColor: `rgba(15, 23, 42, ${Math.max(0.15, opacity)})`,
      }}
      onMouseDownCapture={() => {
        window.lens?.invoke?.("desktop.focusWindow")?.catch?.(() => {});
      }}
    >
      {/* 1. TOP TITLEBAR */}
      <header className="hintlens-titlebar">
        <div className="titlebar-left">
          <span className="app-title">LensDesk</span>
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

      {/* 2. CONTEXT DRAWER: In Interview Mode, renders the full Workshop Context Panel */}
      {interviewLayout === "compact" ? (
        <div className="overlay-workbench-context">
          <div className="context-workbench-header">
            <div className="context-workbench-tabs">
              <button
                type="button"
                className={`context-tab-btn ${contextTab === "transcript" ? "active" : ""}`}
                onClick={() => setContextTab("transcript")}
              >
                <AudioLines size={13} />
                <span>Transcript</span>
                {transcript ? (
                  <span className="context-badge">
                    {Math.ceil(transcript.length / 5)}w
                  </span>
                ) : null}
                {recording && <span className="recording-pulse-dot" />}
              </button>
              <button
                type="button"
                className={`context-tab-btn ${contextTab === "notes" ? "active" : ""}`}
                onClick={() => setContextTab("notes")}
              >
                <FileText size={13} />
                <span>Notes</span>
                {session?.notes ? (
                  <span className="context-badge">
                    {session.notes.length}c
                  </span>
                ) : null}
              </button>
            </div>

            <div className="context-workbench-actions">
              {/* Direct Live Mic button */}
              {onToggleRecording && (
                <button
                  type="button"
                  className={`overlay-live-mic-btn ${recording ? "active-recording" : ""}`}
                  onClick={onToggleRecording}
                  title={
                    recording
                      ? `Stop live listening (${recordSeconds}s)`
                      : "Start live voice recognition (Mic / Bluetooth)"
                  }
                >
                  {recording ? <MicOff size={12} /> : <Mic size={12} />}
                  <span>{recording ? `Listening (${recordSeconds}s)` : "Live Mic"}</span>
                </button>
              )}

              {/* Direct Auto-Answer button */}
              {onToggleAutoAnswer && (
                <button
                  type="button"
                  className={`overlay-auto-answer-toggle ${autoAnswer ? "enabled" : "disabled"}`}
                  onClick={onToggleAutoAnswer}
                  title={
                    autoAnswer
                      ? "Auto-Answer: ON (Automatically answers spoken questions in real time)"
                      : "Auto-Answer: OFF (Click to turn ON real-time automatic answering)"
                  }
                >
                  <Zap size={11} />
                  <span>{autoAnswer ? "Auto: ON" : "Auto: OFF"}</span>
                </button>
              )}

              {/* Microphone / Bluetooth device selection */}
              {onSelectMicrophone && (
                <select
                  className="overlay-audio-source-select"
                  value={microphoneId || ""}
                  onChange={(e) => onSelectMicrophone(e.target.value)}
                  title="Audio Input Device (Microphone / Bluetooth Headset)"
                >
                  <option value="">🎙️ Default Mic / Bluetooth</option>
                  {microphones &&
                    microphones.map((m, i) => (
                      <option key={m.deviceId || i} value={m.deviceId}>
                        {m.label || `Microphone ${i + 1}`}
                      </option>
                    ))}
                </select>
              )}

              {/* Profile dropdown */}
              {profiles && profiles.length > 0 && onSelectProfile && (
                <div className="overlay-profile-pill">
                  <UserRound size={11} />
                  <select
                    value={session?.profileId || ""}
                    onChange={(e) => onSelectProfile(e.target.value)}
                    title="Interview Profile Context"
                  >
                    <option value="">No Profile</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Expand / Collapse toggle */}
              <button
                type="button"
                className="context-expand-btn"
                onClick={() => setContextExpanded((v) => !v)}
                title={contextExpanded ? "Collapse context bar" : "Expand context bar"}
              >
                {contextExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>
          </div>

          {contextExpanded && (
            <div className="context-workbench-body">
              {contextTab === "transcript" ? (
                <div className="overlay-transcript-content">
                  {transcript ? (
                    <>
                      <div className="transcript-live-box">
                        {transcript}
                      </div>
                      <div className="transcript-live-footer">
                        {recording && (
                          <div className="transcript-recording-indicator">
                            <span className="pulse-red" />
                            <span>Listening live ({recordSeconds}s)...</span>
                          </div>
                        )}
                        <button
                          type="button"
                          className="use-transcript-btn"
                          onClick={() => {
                            const latest = transcript.slice(-3000);
                            onSend(`Answer this interview question from the live transcript:\n\n${latest}`);
                          }}
                          title="Send the latest speech transcript to AI for immediate answer"
                        >
                          <Sparkles size={12} />
                          <span>Use latest transcript as question</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="transcript-empty-state">
                      <div className="transcript-empty-info">
                        <span className={`status-dot ${recording ? "recording" : "ready"}`} />
                        <span>
                          {recording
                            ? "Listening to live interview speech..."
                            : "Live voice is idle. Click 'Live Mic' above to start speech recognition."}
                        </span>
                      </div>
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
                  )}
                </div>
              ) : (
                <div className="overlay-notes-content">
                  <div className="notes-action-bar">
                    <button
                      type="button"
                      className="import-resume-btn"
                      onClick={() => onImportResume?.()}
                      title="Upload PDF, TXT or MD resume to provide complete interview background"
                    >
                      <Upload size={12} />
                      <span>Upload Resume (PDF / TXT)</span>
                    </button>
                    {(session?.notes?.includes("RESUME") || activeProfile?.resume) && (
                      <span className="resume-attached-badge">
                        <Check size={11} />
                        <span>Resume Context Active</span>
                      </span>
                    )}
                  </div>
                  <textarea
                    className="overlay-notes-textarea"
                    placeholder="Interview Notes & Agenda (problem statement, resume points, reminders)...&#10;&#10;Tip: Click 'Upload Resume' above to load your PDF resume directly into AI context."
                    value={session?.notes || ""}
                    onChange={(e) => onEditNotes?.(e.target.value)}
                    onFocus={() => {
                      window.lens?.invoke?.("desktop.focusWindow")?.catch?.(() => {});
                    }}
                    onBlur={onSaveNotes}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Standard Mode: minimal details preview */
        <div className="overlay-context-strip">
          <details
            className="overlay-transcript"
            style={{
              background: "transparent",
              color: "#64748b",
              border: "none",
              borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
              padding: "2px 14px",
              fontSize: "11px",
            }}
          >
            <summary style={{ cursor: "pointer", color: "#64748b" }}>
              {transcript ? "Audio transcript active" : "Audio transcript (idle)"}
              {recording && (
                <span style={{ color: "#ef4444", marginLeft: "8px", fontWeight: 600 }}>
                  ● Recording ({recordSeconds}s)
                </span>
              )}
            </summary>
            <p style={{ margin: "4px 0", color: "#94a3b8", fontSize: "11px" }}>
              {transcript || "No audio transcribed yet."}
            </p>
          </details>
          {session?.notes && (
            <details
              className="overlay-notes"
              style={{
                background: "transparent",
                color: "#64748b",
                border: "none",
                borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                padding: "2px 14px",
                fontSize: "11px",
              }}
            >
              <summary style={{ cursor: "pointer", color: "#64748b" }}>
                Session Notes ({session.notes.length} chars)
              </summary>
              <p
                style={{
                  margin: "4px 0",
                  color: "#94a3b8",
                  fontSize: "11px",
                  whiteSpace: "pre-wrap",
                  maxHeight: "100px",
                  overflowY: "auto",
                }}
              >
                {session.notes}
              </p>
            </details>
          )}
        </div>
      )}

      {/* 2. MAIN BODY (Assistant Chat vs Embedded Browser) */}
      {activeView === "browser" && renderBrowser ? (
        <div className="floating-browser-container">{renderBrowser}</div>
      ) : (
        <div className="hintlens-main-split">
          {/* Left Column: Chat Area */}
          <section className="hintlens-chat-column">
            <div className="hintlens-messages-container">
              {/* Live Detected Question Banner */}
              {detectedQuestion && (
                <div className="hintlens-detected-banner">
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
                <div className="hintlens-chat-empty">
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
                <div key={m.id} className={`hintlens-bubble ${m.role}`}>
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
                        <img key={i} src={img} alt={`Attached ${i + 1}`} />
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
                        components={{
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}
              {/* Streaming assistant response */}
              {busy && streamingText && (
                <div className="hintlens-bubble assistant streaming">
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamingText}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}

              {/* Thinking status */}
              {busy && !streamingText && (
                <div className="hintlens-thinking-row">
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
                  className="hintlens-error-banner"
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

            {/* Inline Chat Composer */}
            <div className="hintlens-composer">
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
          <aside className="hintlens-bundle-column">
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
      <div className="hintlens-status-row">
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
      <div className="hintlens-toolbar-row">
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
                : `Auto-type answer (${keyLabel("autoType", "Shift+T")})`
            }
          >
            <Keyboard size={14} />
            <span>{autoTyping ? "Stop" : "Type"}</span>
          </button>

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
              {[100, 80, 60, 40, 20].map((val) => (
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
            <span className="bg-val-text">{Math.max(15, Math.round(opacity * 100))}%</span>
            <input
              type="range"
              min={15}
              max={100}
              step={1}
              value={Math.max(15, Math.round(opacity * 100))}
              onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
              className="bg-slider-track"
              title="Continuous cursor opacity (15% - 100%)"
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
        <div className="hintlens-shortcuts-legend-bar">
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
              onClick={() => onOpenSettings?.("Hotkeys")}
              title={`Open Hotkeys & Settings (${keyLabel("shortcuts", "Ctrl + Shift + J")})`}
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
