export type Provider =
  "openai" | "groq" | "gemini" | "anthropic" | "deepseek" | "local";
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
}
export interface Session {
  version?: number;
  activeSeconds?: number;
  activeSince?: string;
  segments?: {
    id: string;
    text: string;
    startedAt: string;
    duration: number;
    speaker?: string;
  }[];
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
export interface DesktopBridge {
  onPreferences?: (
    listener: (preferences: { shortcuts: Record<string, string> }) => void,
  ) => () => void;
  onGate?: (listener: (view: any) => void) => () => void;
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
  onOpacityChanged?: (listener: (opacity: number) => void) => () => void;
  onUpdaterProgress?: (
    listener: (progress: { percent: number; transferred: number; total: number }) => void,
  ) => () => void;
  onUpdaterAvailable?: (listener: (info: any) => void) => () => void;
  on?: (channel: string, listener: (...args: any[]) => void) => () => void;
  platform: string;
}
declare global {
  interface Window {
    lens?: DesktopBridge;
  }
}
