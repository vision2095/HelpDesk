import React, { useEffect, useState, useRef } from "react";
import {
  Keyboard,
  Sliders,
  Eye,
  EyeOff,
  RotateCcw,
  Check,
  AlertCircle,
  Zap,
  Shield,
  Monitor,
  Globe,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import { CaptureArchiveSettings } from "./CaptureArchiveSettings";

const SHORTCUT_LABELS: Record<
  string,
  { label: string; desc: string; defaultVal: string }
> = {
  toggle: {
    label: "Toggle window",
    desc: "Show or hide LensDesk when the operating system permits global shortcuts",
    defaultVal: "CommandOrControl+Shift+L",
  },
  hide: {
    label: "Hide / restore window",
    desc: "Press once to hide LensDesk; press the same shortcut again to restore it",
    defaultVal: "Shift+H",
  },
  overlay: {
    label: "Floating Copilot HUD",
    desc: "Toggle overlay mode that floats on top of any browser window",
    defaultVal: "CommandOrControl+Shift+O",
  },
  capture: {
    label: "Screen capture snapshot",
    desc: "Take an instant screenshot of your browser/screen and attach to prompt",
    defaultVal: "CommandOrControl+Shift+S",
  },
  hideAnswer: {
    label: "Hide / Reveal answer",
    desc: "Hide or reveal the displayed answer",
    defaultVal: "CommandOrControl+Shift+A",
  },
  autoType: {
    label: "Type selected text",
    desc: "Start typing into your editor; press the same shortcut again to stop",
    defaultVal: "CommandOrControl+Shift+T",
  },
  stopTyping: {
    label: "Stop typing",
    desc: "Cancel the active typing job immediately",
    defaultVal: "CommandOrControl+Alt+Escape",
  },
  clickThrough: {
    label: "Click-Through Mode",
    desc: "Pass mouse clicks straight through to the IDE/browser window beneath",
    defaultVal: "Shift+M",
  },
  ...Object.fromEntries(
    [
      [
        "browser",
        "Open / close browser",
        "Toggle between the browser and assistant",
      ],
      ["theme", "Toggle light / dark theme", "Switch the saved color theme"],
      ["opacityUp", "Increase opacity", "Increase window opacity by 10%"],
      [
        "opacityDown",
        "Decrease opacity",
        "Decrease window opacity by 10%, to a minimum of 50%",
      ],
      [
        "clearLastCapture",
        "Remove last attachment",
        "Remove the last pending screenshot or image",
      ],
      [
        "clearCaptures",
        "Clear pending attachments",
        "Remove all images attached to your unsent question",
      ],
      ["cancelAnswer", "Stop answer", "Cancel the current AI response"],
      [
        "shortcuts",
        "Open / close shortcut settings",
        "Show the configured shortcuts",
      ],
      ["scrollUp", "Scroll answer up", "Scroll the visible answer panel up"],
      [
        "scrollDown",
        "Scroll answer down",
        "Scroll the visible answer panel down",
      ],
      ["moveUp", "Move window up", "Move 40 pixels within the current display"],
      [
        "moveDown",
        "Move window down",
        "Move 40 pixels within the current display",
      ],
      [
        "moveLeft",
        "Move window left",
        "Move 40 pixels within the current display",
      ],
      [
        "moveRight",
        "Move window right",
        "Move 40 pixels within the current display",
      ],
    ].map(([key, label, desc]) => [key, { label, desc, defaultVal: "" }]),
  ),
};

const isMac =
  typeof navigator !== "undefined" &&
  (/Mac|iPod|iPhone|iPad/.test(navigator.platform) ||
    /Macintosh/.test(navigator.userAgent));

function formatShortcutBadge(accelerator: string, mac: boolean): string {
  if (!accelerator) return "";
  if (mac) {
    return accelerator
      .replace(/CommandOrControl/g, "⌘")
      .replace(/Command/g, "⌘")
      .replace(/Control/g, "Ctrl")
      .replace(/Shift/g, "⇧")
      .replace(/Alt/g, "⌥")
      .replace(/\+/g, "");
  }
  return accelerator
    .replace(/CommandOrControl/g, "Ctrl")
    .replace(/Command/g, "Win")
    .replace(/Control/g, "Ctrl");
}

export function DesktopSettings({
  onError,
  onNotice,
}: {
  onError: (error: unknown) => void;
  onNotice: (text: string) => void;
}) {
  const [preferences, setPreferences] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<{
    requested: boolean;
    appliedRequest: boolean | null;
    nativeFlag: boolean;
    limitation: string;
  } | null>(null);

  useEffect(() => {
    api("desktop.preferences").then(setPreferences).catch(onError);
    api("desktop.captureProtection").then(setCaptureStatus).catch(onError);
  }, []);

  const handleKeyDownRecord = (
    action: string,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Ignore solitary modifier key presses
    if (["Control", "Shift", "Alt", "Meta", "Command"].includes(e.key)) {
      return;
    }

    const modifiers: string[] = [];
    if (e.metaKey) modifiers.push(isMac ? "Command" : "Super");
    if (e.ctrlKey) modifiers.push(isMac ? "Control" : "CommandOrControl");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");

    const namedKeys: Record<string, string> = {
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Home: "Home",
      End: "End",
      Tab: "Tab",
      Enter: "Return",
      Insert: "Insert",
    };
    let key = namedKeys[e.key] || e.key.toUpperCase();
    if (key === " ") key = "Space";
    else if (key === "ESCAPE" && modifiers.length === 0) {
      setRecordingAction(null);
      return;
    } else if (key === "ESCAPE") {
      key = "Escape";
    } else if (key === "BACKSPACE" || key === "DELETE") {
      // Clear or reset
      setRecordingAction(null);
      return;
    }

    const shortcutStr =
      modifiers.length > 0 ? `${modifiers.join("+")}+${key}` : key;

    setPreferences({
      ...preferences,
      shortcuts: {
        ...preferences.shortcuts,
        [action]: shortcutStr,
      },
    });
    setRecordingAction(null);
  };

  const resetShortcut = (action: string) => {
    const defaultVal = SHORTCUT_LABELS[action]?.defaultVal;
    if (defaultVal !== undefined) {
      setPreferences({
        ...preferences,
        shortcuts: {
          ...preferences.shortcuts,
          [action]: defaultVal,
        },
      });
    }
  };

  if (!preferences) return null;

  return (
    <section
      className="form-card desktop-settings-card"
      style={{ marginTop: 24 }}
    >
      <div className="form-heading">
        <h2>
          <Monitor size={19} /> Desktop &amp; Hotkey Controls
        </h2>
        <p>
          Configure global shortcuts, window behavior, and user-controlled text
          entry for your editors. Shortcuts may be reserved by another app or
          restricted by the operating system.
        </p>
      </div>

      {/* General window behaviors */}
      {captureStatus && (
        <div className="notice" role="status" style={{ marginBottom: 20 }}>
          <strong>
            Capture protection:{" "}
            {captureStatus.appliedRequest ? "requested from OS" : "off"}
          </strong>
          <p>{captureStatus.limitation}</p>
          <p>
            OS API reports protection {captureStatus.nativeFlag ? "on" : "off"}.
            This flag does not verify capture exclusion.
          </p>
          {captureStatus.appliedRequest !== captureStatus.nativeFlag && (
            <p>
              The OS API did not reflect the last request. Its status may be
              unreliable on this system.
            </p>
          )}
          {captureStatus.requested !== captureStatus.appliedRequest && (
            <p>
              The saved preference has not been applied. Save your appearance
              settings again.
            </p>
          )}
          <button
            className="button"
            onClick={() => {
              api("desktop.captureProtection")
                .then(setCaptureStatus)
                .catch(onError);
            }}
          >
            Refresh capture status
          </button>
        </div>
      )}
      <div className="desktop-prefs-toggles" style={{ marginBottom: 20 }}>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={preferences.closeToTray}
            onChange={(e) =>
              setPreferences({ ...preferences, closeToTray: e.target.checked })
            }
          />
          <span>
            Keep running in system tray / menu bar when window is closed
          </span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            disabled={!preferences.packaged}
            checked={preferences.launchAtLogin}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                launchAtLogin: e.target.checked,
              })
            }
          />
          <span>
            Launch automatically at login{" "}
            {preferences.packaged ? "" : "(available in packaged build)"}
          </span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={preferences.stealthDock ?? false}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                stealthDock: e.target.checked,
              })
            }
          />
          <span>
            Stealth Dock / Taskbar Mode (Hide app icon from macOS Dock &amp;
            Windows Taskbar / Alt-Tab switchers)
          </span>
        </label>
      </div>

      {/* Auto-Typing Settings */}
      <div
        className="settings-section"
        style={{
          marginTop: 16,
          marginBottom: 24,
          padding: "16px",
          background: "var(--surface-muted)",
          borderRadius: 8,
          border: "1px solid var(--line)",
        }}
      >
        <h3
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 15,
            margin: "0 0 10px 0",
          }}
        >
          <Zap size={16} /> Auto-Typing Configuration
        </h3>
        <p className="field-help" style={{ margin: "0 0 12px 0" }}>
          Enter selected text into an editor you control. Confirm the
          destination before starting. Use the stop shortcut or tray command to
          cancel.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginBottom: 12,
          }}
        >
          <label>
            Typing Speed
            <select
              value={preferences.autoType?.speed || "human"}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  autoType: {
                    ...preferences.autoType,
                    speed: e.target.value,
                  },
                })
              }
              style={{
                marginTop: 4,
                width: "100%",
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                color: "var(--ink)",
              }}
            >
              <option value="human">
                Realistic Human (25–45ms with jitter)
              </option>
              <option value="fast">Fast (10ms per keystroke)</option>
              <option value="turbo">Turbo (Instant line keystrokes)</option>
            </select>
          </label>

          <label>
            Delay before typing: {preferences.autoType?.delaySeconds ?? 1}s
            <input
              type="range"
              min="0"
              max="5"
              step="0.5"
              value={preferences.autoType?.delaySeconds ?? 1}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  autoType: {
                    ...preferences.autoType,
                    delaySeconds: Number(e.target.value),
                  },
                })
              }
              style={{ marginTop: 4, width: "100%" }}
            />
            <span className="field-help">
              Time to focus your target IDE or browser window
            </span>
          </label>
        </div>

        <label className="checkbox-row" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={preferences.autoType?.codeOnly ?? true}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                autoType: {
                  ...preferences.autoType,
                  codeOnly: e.target.checked,
                },
              })
            }
          />
          <span>
            Only auto-type code blocks (strips markdown explanations and
            conversational text)
          </span>
        </label>
      </div>

      {/* In-app browser preferences */}
      <section className="settings-section" style={{ margin: "20px 0 24px" }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Globe size={16} /> Browser
        </h3>
        <p className="field-help">
          Set the page opened in a new tab, choose where text searches go, and
          set the default zoom for the private LensDesk browser.
        </p>
        <label>
          Home page
          <input
            aria-label="Browser home page"
            type="url"
            maxLength={2048}
            value={preferences.browser?.homePage || "https://www.google.com/"}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                browser: { ...preferences.browser, homePage: e.target.value },
              })
            }
            placeholder="https://www.google.com/"
          />
        </label>
        <label>
          Search engine
          <select
            aria-label="Browser search engine"
            value={preferences.browser?.searchEngine || "google"}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                browser: {
                  ...preferences.browser,
                  searchEngine: e.target.value,
                },
              })
            }
          >
            <option value="google">Google</option>
            <option value="bing">Bing</option>
            <option value="duckduckgo">DuckDuckGo</option>
          </select>
        </label>
        <label>
          Default page zoom:{" "}
          {Math.round((preferences.browser?.zoom || 1) * 100)}%
          <input
            aria-label="Default browser page zoom"
            type="range"
            min="50"
            max="250"
            step="25"
            value={(preferences.browser?.zoom || 1) * 100}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                browser: {
                  ...preferences.browser,
                  zoom: Number(e.target.value) / 100,
                },
              })
            }
          />
          <span className="field-help">
            Applies to new tabs; each open tab keeps its own zoom level.
          </span>
        </label>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <div>
            <strong>Browser data</strong>
            <p>
              Clear this app’s embedded-browser cookies, cache, saved logins,
              and site storage. This signs you out of websites in LensDesk.
            </p>
          </div>
          <button
            className="button secondary"
            onClick={async () => {
              if (
                !window.confirm(
                  "Clear LensDesk browser cookies, cache, saved logins, and site data? You will be signed out of websites in the embedded browser.",
                )
              )
                return;
              setBusy(true);
              try {
                await api("browser.clearData");
                onNotice("LensDesk browser data cleared.");
              } catch (error) {
                onError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={15} /> Clear browser data
          </button>
        </div>
      </section>

      <CaptureArchiveSettings
        value={preferences.captureArchive || { enabled: false, directory: "" }}
        onChange={(captureArchive) =>
          setPreferences({ ...preferences, captureArchive })
        }
        onError={onError}
      />
      {/* Global Shortcut customizer */}
      <h3
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 15,
          margin: "0 0 8px 0",
        }}
      >
        <Keyboard size={16} /> Global Custom Hotkeys
      </h3>
      <p className="field-help" style={{ margin: "0 0 16px 0" }}>
        Click any field and press your desired key combination to record it, or
        type accelerator format (e.g., <code>CommandOrControl+Shift+A</code>).
        Additional actions are disabled until you assign a shortcut. Clear a
        field to disable an optional action.
      </p>

      <div
        className="shortcuts-list"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {Object.entries(preferences.shortcuts as Record<string, string>).map(
          ([action, value]) => {
            const meta = SHORTCUT_LABELS[action] || {
              label: action,
              desc: "Custom shortcut",
              defaultVal: value,
            };
            const isRecording = recordingAction === action;

            return (
              <div
                key={action}
                className={`shortcut-row ${isRecording ? "recording" : ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  background: isRecording
                    ? "var(--success-bg)"
                    : "var(--panel)",
                  border: `1px solid ${isRecording ? "var(--success-text)" : "var(--line)"}`,
                  borderRadius: 8,
                  gap: 16,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {meta.label}
                  </div>
                  <div
                    className="field-help"
                    style={{ fontSize: 12, margin: 0 }}
                  >
                    {meta.desc}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      background: isRecording
                        ? "var(--success-bg)"
                        : "var(--surface-muted)",
                      color: isRecording
                        ? "var(--success-text)"
                        : "var(--blue)",
                      border: `1px solid ${isRecording ? "var(--success-text)" : "var(--line)"}`,
                      padding: "4px 8px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: "monospace",
                      minWidth: 54,
                      textAlign: "center",
                    }}
                  >
                    {isRecording
                      ? "..."
                      : formatShortcutBadge(value, isMac) || "Off"}
                  </span>
                  <input
                    aria-label={`${meta.label} shortcut`}
                    value={isRecording ? "Press key combo..." : value}
                    placeholder="Not assigned"
                    readOnly={isRecording}
                    onFocus={() => setRecordingAction(action)}
                    onBlur={() => {
                      if (recordingAction === action) setRecordingAction(null);
                    }}
                    onKeyDown={(e) => {
                      if (isRecording) {
                        handleKeyDownRecord(action, e);
                      }
                    }}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        shortcuts: {
                          ...preferences.shortcuts,
                          [action]: e.target.value,
                        },
                      })
                    }
                    style={{
                      width: 220,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: isRecording
                        ? "2px solid var(--success-text)"
                        : "1px solid var(--line)",
                      background: "var(--panel)",
                      color: "var(--ink)",
                      fontWeight: 600,
                      fontFamily: "monospace",
                      fontSize: 13,
                      textAlign: "center",
                    }}
                  />

                  <button
                    type="button"
                    className="button secondary"
                    style={{ padding: "4px 8px", height: 32, fontSize: 12 }}
                    onClick={() => {
                      if (isRecording) setRecordingAction(null);
                      else setRecordingAction(action);
                    }}
                    title={
                      isRecording ? "Cancel recording" : "Record new shortcut"
                    }
                  >
                    {isRecording ? "Done" : "Record"}
                  </button>

                  {meta.defaultVal === "" && value && (
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Disable ${meta.label} shortcut`}
                      onClick={() => {
                        setRecordingAction(null);
                        setPreferences({
                          ...preferences,
                          shortcuts: { ...preferences.shortcuts, [action]: "" },
                        });
                      }}
                    >
                      Disable
                    </button>
                  )}

                  <button
                    type="button"
                    className="button secondary"
                    style={{ padding: "4px 8px", height: 32 }}
                    onClick={() => resetShortcut(action)}
                    title="Reset to default shortcut"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              </div>
            );
          },
        )}
      </div>

      {preferences.shortcutErrors?.length > 0 && (
        <div
          role="alert"
          style={{
            marginTop: 16,
            padding: "10px 14px",
            background: "var(--error-bg)",
            border: "1px solid var(--red)",
            borderRadius: 6,
            color: "var(--red)",
            fontSize: 13,
          }}
        >
          <AlertCircle
            size={14}
            style={{ display: "inline", marginRight: 6, verticalAlign: -2 }}
          />
          {preferences.shortcutErrors.join("; ")}
        </div>
      )}

      <div
        style={{
          marginTop: 20,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await api("desktop.preferences.save", preferences);
              setPreferences(res);
              onNotice("Desktop hotkeys and settings saved successfully.");
            } catch (error) {
              onError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving..." : "Save Desktop Settings"}
        </button>
      </div>
    </section>
  );
}
