// derived: rea/native/windows/src/model_palette.hpp

export const DEFAULT_MODEL = "gemini-3.8-flash";

export interface ModelEntry {
  id: string;
  name: string;
}

export const PARITY_MODELS: readonly ModelEntry[] = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Default)" },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "deepseek-flash", name: "DeepSeek Flash" },
  { id: "openai/gpt-oss-120b", name: "OpenAI GPT OSS 120B" },
] as const;

export const LEGACY_MODELS: readonly ModelEntry[] = [
  { id: "gpt-4o-mini", name: "GPT-4o Mini (Legacy)" },
  { id: "gpt-4o", name: "GPT-4o (Legacy)" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Legacy)" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash (Legacy)" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro (Legacy)" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku (Legacy)" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet (Legacy)" },
  { id: "deepseek-chat", name: "DeepSeek Chat (Legacy)" },
  { id: "deepseek-reasoner", name: "DeepSeek Reasoner (Legacy)" },
] as const;

/**
 * Resolves a model ID with fallback semantics:
 * - If saved ID matches a parity model, return it.
 * - If saved ID matches a legacy model, return it.
 * - If saved ID is null, empty, or unknown, return DEFAULT_MODEL ("gemini-3.8-flash").
 */
export function resolveModel(savedModel?: string | null): string {
  if (!savedModel || typeof savedModel !== "string") {
    return DEFAULT_MODEL;
  }
  const trimmed = savedModel.trim();
  if (!trimmed) {
    return DEFAULT_MODEL;
  }
  const inParity = PARITY_MODELS.some((m) => m.id === trimmed);
  if (inParity) return trimmed;
  const inLegacy = LEGACY_MODELS.some((m) => m.id === trimmed);
  if (inLegacy) return trimmed;

  return DEFAULT_MODEL;
}
