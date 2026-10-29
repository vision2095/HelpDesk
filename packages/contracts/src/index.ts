/**
 * LensDesk 2.0 Shared Contracts & IPC Action Schemas
 * Authoritative types and communication interfaces across Web, macOS, and Windows.
 */

// IPC and Native Host Action Constants
export const IPC_ACTIONS = {
  DESKTOP_CAPTURE: "desktop.capture",
  DESKTOP_AUTOTYPE: "desktop.autoType",
  DESKTOP_LOGIN: "desktop.login",
  DESKTOP_MFA: "desktop.mfa",
  DESKTOP_HEARTBEAT: "desktop.heartbeat",
  DESKTOP_LOGOUT: "desktop.logout",
  DESKTOP_FOCUS_WINDOW: "desktop.focusWindow",
  DESKTOP_UPDATE_ACCESSIBILITY: "desktop.updateAccessibility",
  DESKTOP_SET_SHORTCUTS: "desktop.setShortcuts",
  GATE_STATUS: "gate.status",
  GATE_LOGIN: "gate.login",
  GATE_REGISTER: "gate.register",
  GATE_MFA: "gate.mfa",
  BROWSER_NAVIGATE: "browser.navigate",
  BROWSER_SEARCH: "browser.search",
  BROWSER_BACK: "browser.back",
  BROWSER_FORWARD: "browser.forward",
  BROWSER_RELOAD: "browser.reload",
  BROWSER_PASTE_BUNDLE: "browser.pasteBundle",
  BROWSER_CLEAR: "browser.clear",
  WINDOW_MINIMIZE: "window.minimize",
  WINDOW_MAXIMIZE: "window.maximize",
  WINDOW_CLOSE: "window.close",
  WINDOW_SET_BOUNDS: "window.setBounds",
  WINDOW_SET_STEALTH: "window.setStealth",
  WINDOW_SET_OPACITY: "window.setOpacity",
  WINDOW_SET_ALWAYS_ON_TOP: "window.setAlwaysOnTop"
} as const;

export type IpcAction = typeof IPC_ACTIONS[keyof typeof IPC_ACTIONS];

// Supported AI Providers
export type Provider = "openai" | "groq" | "gemini" | "anthropic" | "deepseek" | "local";

// Chat and HUD Modes
export type Mode = "general" | "coding" | "system-design" | "behavioral";

export interface Message {
  provider?: Provider;
  model?: string;
  usage?: Record<string, number>;
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  images?: string[];
  rating?: "helpful" | "unhelpful";
}

export interface Segment {
  id: string;
  text: string;
  startedAt: string;
  duration: number;
  speaker?: string;
}

export interface Session {
  version?: number;
  activeSeconds?: number;
  activeSince?: string;
  segments?: Segment[];
  id: string;
  title: string;
  mode: Mode;
  profileId: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  notes: string;
  transcript: string;
  messages: Message[];
}

export interface Profile {
  version?: number;
  id: string;
  name: string;
  role: string;
  company: string;
  resume: string;
  jobDescription: string;
}

export interface Settings {
  lightTextColor?: string;
  darkTextColor?: string;
  interviewLayout?: "full" | "compact";
  theme?: "light" | "dark" | "system";
  contextTokens?: number;
  version?: number;
  provider: Provider;
  model: string;
  localBaseUrl?: string;
  language: string;
  systemPrompt: string;
  transcriptionProvider: "openai" | "groq" | "gemini";
  transcriptionModel: string;
  opacity: number;
  alwaysOnTop: boolean;
  captureProtection: boolean;
  cloudScreenshotSync?: boolean;
}

export interface State {
  accountId?: string;
  storage?: "local" | "cloud";
  cloudConnected?: boolean;
  ownedKeys?: Record<Provider, boolean>;
  sessions: Session[];
  profiles: Profile[];
  settings: Settings;
  keys: Record<Provider, boolean>;
}

export interface GateView {
  unlocked: boolean;
  status: "idle" | "verifying" | "mfa_required" | "locked" | "error";
  email?: string;
  error?: string;
  subscriptionPlan?: string;
  activeDevice?: string;
}

export interface Entitlement {
  plan: "free" | "pro" | "team" | "enterprise";
  active: boolean;
  expiresAt?: string;
  maxSeats: number;
  byokAllowed: boolean;
}

export interface DesktopBridge {
  onPreferences?: (
    listener: (preferences: { shortcuts: Record<string, string> }) => void,
  ) => () => void;
  onGate?: (listener: (view: GateView) => void) => () => void;
  onBrowserState?: (listener: (state: any) => void) => () => void;
  onBrowserFocusAddress?: (listener: () => void) => () => void;
  onBrowserFocusFind?: (listener: () => void) => () => void;
  invoke: (action: string, payload?: unknown) => Promise<any>;
  onChatEvent: (
    listener: (event: {
      requestId: string;
      type: string;
      text?: string;
    }) => void,
  ) => () => void;
  onShortcut: (listener: (action: string) => void) => () => void;
  onGlobalKey?: (
    listener: (
      event:
        | { type: "mode"; typing: boolean }
        | { type: "char"; text: string }
        | { type: "action"; action: string },
    ) => void,
  ) => () => void;
  onOverlay?: (listener: (data: { floating: boolean }) => void) => () => void;
  onClickThrough?: (
    listener: (data: { clickThrough: boolean }) => void,
  ) => () => void;
}
