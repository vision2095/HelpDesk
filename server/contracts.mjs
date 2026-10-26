import { z } from "zod";
export const providers = {
  openai: { url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: {
    url: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.5-flash-lite",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1",
    model: "claude-3-5-haiku-20241022",
  },
  deepseek: { url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  // Local is dispatched only by a desktop user's local service.
  local: { url: "http://127.0.0.1:11434/v1", model: "llama3.2" },
};
export const provider = z.enum([
  "openai",
  "groq",
  "gemini",
  "anthropic",
  "deepseek",
  "local",
]);
const mode = z.enum(["general", "coding", "system-design", "behavioral"]);
const bounded = z.string().max(100000);
const image = z
  .string()
  .max(8000000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
const message = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: bounded,
  createdAt: z.string(),
  images: z.array(image).max(5).optional(),
  provider: provider.optional(),
  model: z.string().max(100).optional(),
  usage: z.record(z.number()).optional(),
  rating: z.enum(["helpful", "unhelpful"]).optional(),
});
export const sessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(150),
  mode,
  profileId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().optional(),
  notes: bounded,
  transcript: bounded,
  messages: z.array(message).max(500),
  version: z.number().int().nonnegative().optional(),
  activeSeconds: z.number().nonnegative().default(0),
  activeSince: z.string().optional(),
  segments: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(10000),
        startedAt: z.string(),
        duration: z.number().nonnegative(),
        speaker: z.string().max(80).optional(),
      }),
    )
    .max(10000)
    .default([]),
});
export const profileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(150),
  role: z.string().max(200),
  company: z.string().max(200),
  resume: bounded,
  jobDescription: bounded,
  version: z.number().int().nonnegative().optional(),
});
export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
  lightTextColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#24384c"),
  darkTextColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#e2eaf5"),
  interviewLayout: z.enum(["full", "compact"]).default("full"),
  provider,
  model: z.string().trim().min(1).max(100),
  localBaseUrl: z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    }, "Use an HTTP or HTTPS model server address without embedded credentials.")
    .default("http://127.0.0.1:11434/v1"),
  language: z.string().min(1).max(80),
  systemPrompt: z.string().max(20000),
  transcriptionProvider: z.enum(["openai", "groq", "gemini"]),
  transcriptionModel: z.string().min(1).max(100),
  opacity: z.preprocess(
    (val) => {
      const num = Number(val);
      if (Number.isNaN(num)) return 0.5;
      return Math.max(0.1, Math.min(1, num));
    },
    z.number().min(0.1).max(1).default(0.5),
  ),
  alwaysOnTop: z.boolean(),
  captureProtection: z.boolean().default(true),
  cloudScreenshotSync: z.boolean().default(true),
  contextTokens: z.number().int().min(8000).max(64000).default(24000),
  version: z.number().int().nonnegative().optional(),
});
export const initial = () => ({
  sessions: [],
  profiles: [],
  settings: {
    theme: "system",
    provider: "openai",
    model: providers.openai.model,
    localBaseUrl: "http://127.0.0.1:11434/v1",
    language: "English",
    systemPrompt:
      "Analyse the provided screenshot(s) or question and provide the correct answer. For MCQs, give the correct option with a brief explanation if helpful. For coding/debugging, return the complete correct code. For descriptive questions, provide a clear and accurate answer.",
    transcriptionProvider: "openai",
    transcriptionModel: "whisper-1",
    opacity: 1,
    alwaysOnTop: true,
    captureProtection: true,
    cloudScreenshotSync: true,
  },
});
