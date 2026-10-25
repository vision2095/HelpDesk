import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readPdf } from "./documents.mjs";
import { buildContext, generateAnswer, discoverModels, isVisionModel } from "./ai.mjs";
import { searchWeb } from "./search.mjs";
import { recognizeImage } from "./media.mjs";
import { z } from "zod";
import {
  providers,
  provider,
  sessionSchema,
  profileSchema,
  settingsSchema,
  initial,
} from "./contracts.mjs";
import { createWorkspaceStore, ConflictError } from "./workspace-store.mjs";
export { providers };

const image = z
  .string()
  .max(8000000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
export function createService({
  directory,
  encrypt,
  decrypt,
  fetchImpl = fetch,
  defaultKeys = {},
  beforeCommit,
  maxBytes,
} = {}) {
  const envKeys = {
    openai: process.env.OPENAI_API_KEY || "",
    groq: process.env.GROQ_API_KEY || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    gemini: process.env.GEMINI_API_KEY || "",
    deepseek: process.env.DEEPSEEK_API_KEY || "",
  };
  const resolvedDefaults = {
    ...Object.fromEntries(
      Object.entries(envKeys).filter(([, v]) => Boolean(v)),
    ),
    ...defaultKeys,
  };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const legacyFile = path.join(directory, "workspace.json"),
    keysFile = path.join(directory, "credentials.bin");
  let legacy,
    keys = {};
  if (fs.existsSync(legacyFile))
    try {
      const data = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
      legacy = {
        sessions: z.array(sessionSchema).parse(data.sessions),
        profiles: z.array(profileSchema).parse(data.profiles),
        settings: settingsSchema.parse(data.settings),
      };
    } catch {
      throw new Error(
        `Workspace could not be read. Your data is preserved at ${legacyFile}. Restore a valid backup before continuing.`,
      );
    }
  const store = createWorkspaceStore({
    directory,
    encrypt,
    decrypt,
    initial,
    legacy,
    beforeCommit,
    maxBytes,
  });
  if (encrypt && fs.existsSync(keysFile) && !store.get("credentials", "keys")) {
    keys = JSON.parse(decrypt(fs.readFileSync(keysFile)));
    store.save("credentials", "keys", { keys });
    fs.unlinkSync(keysFile);
  }
  function readKeys() {
    if (encrypt) {
      try {
        const stored = store.get("credentials", "keys");
        if (stored?.keys) keys = stored.keys;
      } catch {
        keys = {};
      }
    }
    return keys;
  }
  function keyStatus() {
    readKeys();
    return Object.fromEntries(
      Object.keys(providers).map((p) => [
        p,
        Boolean(keys[p] || defaultKeys[p]),
      ]),
    );
  }
  function publicState(lite = false, payload = {}) {
    const data = lite
      ? {
          sessions: store.list("session", {
            summary: true,
            limit: payload.limit || 30,
            offset: payload.offset || 0,
          }),
          profiles: store.list("profile"),
          settings: store.get("settings", "settings"),
          revision: store.revision(),
        }
      : store.load();
    const currentKeys = keyStatus();
    const parsedSettings = settingsSchema.parse(data.settings);

    return {
      ...data,
      settings: parsedSettings,
      keys: currentKeys,
      ownedKeys: Object.fromEntries(
        Object.keys(providers).map((p) => [p, Boolean(keys[p])]),
      ),
    };
  }
  const defaults = resolvedDefaults,
    busy = new Set(),
    generations = new Map();
  async function upstream(url, options) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(90000),
      });
    } catch (error) {
      throw new Error(
        error.name === "TimeoutError"
          ? "The provider timed out. Try again."
          : "Could not reach the AI provider. Check your internet connection.",
      );
    }
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = String(body.error?.message || body.error || "").slice(0, 500);
      } catch {}
      throw new Error(
        `Provider returned ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return response.json();
  }
  async function dispatch(action, payload = {}, options = {}) {
    readKeys();
    switch (action) {
      case "state":
        return publicState();
      case "workspace.list":
        return publicState(true, payload);
      case "session.get": {
        const s = store.get("session", z.string().uuid().parse(payload.id));
        if (!s) throw new Error("Session not found.");
        return s;
      }
      case "session.search":
        return store.search(
          z
            .string()
            .max(200)
            .parse(payload.query || ""),
          {
            limit: Math.min(100, payload.limit || 30),
            offset: payload.offset || 0,
          },
        );
      case "key.owned":
        return Boolean(keys[provider.parse(payload.provider)]);
      case "session.save": {
        if (busy.has(payload.id) || store.isLeased("chat:" + payload.id))
          throw new Error(
            "Wait for the current answer before updating this session.",
          );
        if (payload.loaded === false)
          throw new Error("Open this session before editing it.");
        const s = sessionSchema.parse(payload),
          existing = store.get("session", s.id);
        if (existing && s.version === undefined)
          throw new ConflictError(
            "Reload this session before saving it.",
            existing,
          );
        if (!existing) {
          if (!s.endedAt)
            s.activeSince = s.activeSince || new Date().toISOString();
        } else if (Boolean(existing.endedAt) !== Boolean(s.endedAt)) {
          s.activeSeconds = existing.activeSeconds || 0;
          if (s.endedAt) {
            s.activeSeconds += Math.max(
              0,
              Math.floor(
                (Date.now() -
                  Date.parse(existing.activeSince || existing.createdAt)) /
                  1000,
              ),
            );
            s.activeSince = undefined;
          } else s.activeSince = new Date().toISOString();
        } else {
          s.activeSince = existing.activeSince;
          s.activeSeconds = existing.activeSeconds;
        }
        return store.save("session", s.id, s, s.version ?? 0);
      }
      case "session.applyRemote": {
        const incoming = sessionSchema.parse(payload.session);
        return store.mutate("session", incoming.id, (current) => {
          if (!current) return incoming;
          const messages = [
            ...new Map(
              [...current.messages, ...incoming.messages].map((m) => [m.id, m]),
            ).values(),
          ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          return {
            ...(current.version === payload.expectedVersion
              ? incoming
              : current),
            messages,
          };
        });
      }
      case "session.patch": {
        const data = z
          .object({
            id: z.string().uuid(),
            version: z.number().int().nonnegative(),
            patch: z.object({
              title: z.string().min(1).max(150).optional(),
              notes: z.string().max(100000).optional(),
              transcript: z.string().max(100000).optional(),
              mode: z
                .enum(["general", "coding", "system-design", "behavioral"])
                .optional(),
              profileId: z.string().optional(),
            }),
          })
          .parse(payload);
        return store.mutate(
          "session",
          data.id,
          (current) => {
            if (!current) throw new Error("Session not found.");
            return { ...current, ...data.patch };
          },
          { expectedVersion: data.version },
        );
      }
      case "session.delete":
        if (busy.has(payload.id) || store.isLeased("chat:" + payload.id))
          throw new Error(
            "Wait for the current answer before deleting this session.",
          );
        return store.remove(
          "session",
          z.string().uuid().parse(payload.id),
          payload.version,
        );
      case "profile.save": {
        const p = profileSchema.parse(payload);
        return store.save(
          "profile",
          p.id,
          p,
          p.version ?? (store.get("profile", p.id)?.version || 0),
        );
      }
      case "profile.delete":
        return store.remove(
          "profile",
          z.string().uuid().parse(payload.id),
          payload.version,
        );
      case "settings.save": {
        const normalized = {
          ...payload,
          model:
            (typeof payload?.model === "string" && payload.model.trim()) ||
            providers[payload?.provider]?.model ||
            "gemini-3.8-flash",
        };
        const settings = settingsSchema.parse(normalized);
        store.save(
          "settings",
          "settings",
          settings,
          settings.version ?? store.get("settings", "settings")?.version,
        );
        return publicState();
      }
      case "key.save": {
        const p = provider.parse(payload.provider),
          key = z.string().trim().max(1000).parse(payload.key);
        if (p === "local") throw new Error("Local models do not use API keys.");
        if (key && p === "deepseek" && (key.endsWith("==") || !key.startsWith("sk-"))) {
          throw new Error(
            'Invalid DeepSeek API key. DeepSeek keys must start with "sk-" and cannot end in "==". Please get your API key from platform.deepseek.com.'
          );
        }
        readKeys();
        const next = { ...keys, [p]: key };
        if (encrypt) {
          try {
            store.save(
              "credentials",
              "keys",
              { keys: next },
              store.get("credentials", "keys")?.version || 0,
            );
          } catch {
            store.save("credentials", "keys", { keys: next });
          }
        }
        keys = next;

        // Auto-switch default provider to this newly saved provider
        if (key) {
          try {
            const cur = store.get("settings", "settings") || {};
            const nextSettings = {
              ...cur,
              provider: p,
              model: providers[p]?.model || cur.model || "gemini-3.8-flash",
            };
            store.save("settings", "settings", nextSettings, cur.version);
          } catch {}
        }

        return keyStatus();
      }
      case "transcript.append": {
        const data = z
          .object({
            id: z.string().uuid(),
            segment: z.object({
              id: z.string().uuid(),
              text: z.string().max(10000),
              startedAt: z.string(),
              duration: z.number().min(0).max(7200),
              speaker: z.string().max(80).optional(),
            }),
          })
          .parse(payload);
        return store.mutate("session", data.id, (current) => {
          if (!current) throw new Error("Session not found.");
          if (current.segments?.some((s) => s.id === data.segment.id))
            return current;
          return sessionSchema.parse({
            ...current,
            segments: [...(current.segments || []), data.segment],
            transcript: [current.transcript, data.segment.text]
              .filter(Boolean)
              .join("\n\n"),
          });
        });
      }
      case "model.test": {
        const p = provider.parse(payload.provider),
          model = z.string().trim().min(1).max(100).parse(payload.model);
        const key = p === "local" ? "" : keys[p] || defaults[p];
        if (p !== "local" && !key)
          throw new Error("Add a provider key before testing a model.");
        const settings = store.get("settings", "settings");
        const result = await generateAnswer({
          provider: p,
          model,
          key,
          localBaseUrl:
            p === "local"
              ? payload.localBaseUrl || settings.localBaseUrl
              : settings.localBaseUrl,
          context: {
            system: "Reply with one brief sentence.",
            messages: [
              { role: "user", content: "Confirm this connection works." },
            ],
          },
          fetchImpl,
          signal: options.signal,
          stream: false,
          maxOutputTokens: 128,
        });
        return {
          ok: true,
          provider: p,
          model,
          preview: result.content,
          usage: result.usage,
        };
      }
      case "model.list": {
        const p = provider.parse(payload.provider);
        const key = p === "local" ? "" : keys[p] || defaults[p];
        if (p !== "local" && !key)
          throw new Error("Add a provider key before listing models.");
        return discoverModels({
          provider: p,
          key,
          localBaseUrl:
            p === "local"
              ? payload.localBaseUrl ||
                store.get("settings", "settings").localBaseUrl
              : store.get("settings", "settings").localBaseUrl,
          fetchImpl,
          signal: options.signal,
        });
      }
      case "chat.cancel": {
        const controller = generations.get(payload.requestId);
        controller?.abort(new Error("Generation canceled."));
        return { canceled: Boolean(controller) };
      }
      case "chat": {
        const { sessionId, text, images } = z
          .object({
            sessionId: z.string().uuid(),
            text: z.string().trim().max(30000),
            images: z.array(image).max(5).default([]),
          })
          .parse(payload);
        if (!text && !images.length)
          throw new Error("Write a question or attach a screenshot.");
        const s = store.get("session", sessionId);
        const state = { settings: store.get("settings", "settings") };
        if (!s) throw new Error("Session not found.");
        if (s.endedAt)
          throw new Error("Resume this session before sending a question.");
        if (busy.has(s.id))
          throw new Error("An answer is already in progress.");
        if (s.messages.length >= 498)
          throw new Error(
            "This session has reached 500 messages. Start a new session.",
          );
        let p = state.settings.provider,
          key = p === "local" ? "" : keys[p] || defaults[p];
        if (p !== "local" && !key) {
          const alt = Object.keys(providers).find(
            (candidate) => candidate !== "local" && Boolean(keys[candidate])
          );
          if (alt) {
            p = alt;
            key = keys[alt];
            try {
              const cur = store.get("settings", "settings") || {};
              store.save("settings", "settings", { ...cur, provider: p, model: providers[p]?.model || "gemini-3.8-flash" }, cur.version);
            } catch {}
          } else {
            throw new Error(
              `Add your ${p} API key in Settings before asking a question.`,
            );
          }
        }
        let activeModel =
          (state.settings.model && state.settings.model.trim()) ||
          providers[p]?.model ||
          "gemini-3.8-flash";
        if (p === "gemini" && (activeModel === "gemini-2.5-flash" || activeModel === "gemini-2.0-flash" || !activeModel)) {
          activeModel = "gemini-3.8-flash";
        }
        if (images.length > 0 && !isVisionModel(p, activeModel)) {
          if (p === "gemini") activeModel = "gemini-3.8-flash";
          else if (p === "openai") activeModel = "gpt-4.1-mini";
          else if (p === "anthropic") activeModel = "claude-sonnet-4-5";
          else if (keys["gemini"]) {
            p = "gemini";
            key = keys["gemini"];
            activeModel = "gemini-3.8-flash";
          } else {
            throw new Error(
              `Selected model "${activeModel}" (${p}) does not support images or screenshots. Please choose a vision-capable provider in Settings.`,
            );
          }
        }
        const requestId = z
          .string()
          .uuid()
          .parse(payload.requestId || randomUUID());
        const releaseLease = store.acquireLease("chat:" + s.id);
        busy.add(s.id);
        if (generations.has(requestId)) {
          busy.delete(s.id);
          releaseLease();
          throw new Error("Request already in progress.");
        }
        const controller = new AbortController();
        generations.set(requestId, controller);
        try {
          const user = {
            id: randomUUID(),
            role: "user",
            content:
              text ||
              "Answer the question or problem in this screenshot concisely and directly. State the final answer first.",
            images,
            createdAt: new Date().toISOString(),
          };
          let webSearchResults = [];
          if (payload.webSearch && text) {
            try {
              webSearchResults = await searchWeb(text, { fetchImpl });
              if (webSearchResults.length) {
                options.onEvent?.({
                  type: "search",
                  results: webSearchResults,
                });
              }
            } catch {}
          }
          const context = buildContext({
            session: s,
            profile: store.get("profile", s.profileId),
            settings: state.settings,
            user,
            webSearchResults,
          });
          options.onEvent?.({
            type: "context",
            clipped: context.clipped,
            estimatedInputTokens: context.estimatedInputTokens,
          });
          let result;
          try {
            result = await generateAnswer({
              provider: p,
              model: activeModel,
              key,
              localBaseUrl: state.settings.localBaseUrl,
              context,
              fetchImpl,
              signal: AbortSignal.any([
                controller.signal,
                ...(options.signal ? [options.signal] : []),
              ]),
              onEvent: options.onEvent,
              stream: Boolean(options.onEvent),
            });
          } catch (err) {
            const isAuthOrNotFoundError =
              err.message?.includes("401") ||
              err.message?.includes("404") ||
              /authentication|invalid api key|no longer available/i.test(err.message);
            const alternativeProvider = Object.keys(providers).find(
              (alt) => alt !== p && alt !== "local" && Boolean(keys[alt])
            );
            if (isAuthOrNotFoundError && alternativeProvider) {
              p = alternativeProvider;
              activeModel = providers[alternativeProvider].model;
              key = keys[alternativeProvider];
              try {
                const cur = store.get("settings", "settings") || {};
                store.save("settings", "settings", { ...cur, provider: p, model: activeModel }, cur.version);
              } catch {}
              result = await generateAnswer({
                provider: p,
                model: activeModel,
                key,
                localBaseUrl: state.settings.localBaseUrl,
                context,
                fetchImpl,
                signal: AbortSignal.any([
                  controller.signal,
                  ...(options.signal ? [options.signal] : []),
                ]),
                onEvent: options.onEvent,
                stream: Boolean(options.onEvent),
              });
            } else {
              if (p === "deepseek" && (key.endsWith("==") || !key.startsWith("sk-"))) {
                throw new Error(
                  `Your DeepSeek API key is invalid. DeepSeek keys start with "sk-" and do not end in "==". Please verify your key on platform.deepseek.com or select Google Gemini in Settings.`
                );
              }
              throw err;
            }
          }
          controller.signal.throwIfAborted();
          options.signal?.throwIfAborted();
          s.messages.push(user, {
            id: randomUUID(),
            role: "assistant",
            content: result.content,
            usage: result.usage,
            createdAt: new Date().toISOString(),
            provider: p,
            model: activeModel,
          });
          const added = s.messages.slice(-2);
          return store.mutate("session", s.id, (current) => {
            if (!current)
              throw new Error(
                "Session was removed before the answer finished.",
              );
            return { ...current, messages: [...current.messages, ...added] };
          });
        } finally {
          generations.delete(requestId);
          busy.delete(s.id);
          releaseLease();
        }
      }
      case "transcribe": {
        const state = { settings: store.get("settings", "settings") };
        const { data, mime } = z
          .object({
            data: z
              .string()
              .min(1)
              .max(28000000)
              .regex(/^[A-Za-z0-9+/=]+$/),
            mime: z.enum(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"]),
          })
          .parse(payload);
        let p = state.settings.transcriptionProvider;
        // If current provider has no key, or if user is actively using gemini/groq/openai, pick available key:
        if (!(keys[p] || defaults[p])) {
          if (keys.gemini || defaults.gemini) p = "gemini";
          else if (keys.groq || defaults.groq) p = "groq";
          else if (keys.openai || defaults.openai) p = "openai";
        }
        if (!(keys[p] || defaults[p])) {
          if (keys.gemini || defaults.gemini) p = "gemini";
          else if (keys.groq || defaults.groq) p = "groq";
          else if (keys.openai || defaults.openai) p = "openai";
        }
        if (!(keys[p] || defaults[p]))
          throw new Error(`Add an API key in Settings (Gemini, Groq, or OpenAI) for speech recognition.`);

        if (p === "gemini") {
          const geminiKey = keys.gemini || defaults.gemini;
          const candidateModels = [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-3.8-flash",
          ];
          let lastErr;
          for (const m of candidateModels) {
            try {
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiKey}`;
              const response = await upstream(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [
                    {
                      parts: [
                        {
                          inlineData: {
                            mimeType: mime === "audio/mp4" ? "audio/mp4" : mime,
                            data: data,
                          },
                        },
                        {
                          text: "Transcribe this audio clip accurately and verbatim. Output only the transcribed speech, with no preamble, formatting, or commentary. If the audio is silent or unintelligible, output nothing.",
                        },
                      ],
                    },
                  ],
                }),
              });
              const text =
                response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
              return { text };
            } catch (err) {
              lastErr = err;
              if (String(err?.message || "").includes("404") || String(err?.message || "").includes("not found")) {
                continue;
              }
              // If model failed, try next candidate model
              continue;
            }
          }
          throw lastErr || new Error("Failed to transcribe audio with Gemini.");
        }

        const form = new FormData();
        form.set(
          "file",
          new Blob([Buffer.from(data, "base64")], { type: mime }),
          "recording." + (mime === "audio/mp4" ? "m4a" : mime.split("/")[1]),
        );
        const selectedModel =
          p === "groq"
            ? "whisper-large-v3-turbo"
            : state.settings.transcriptionModel || "whisper-1";
        form.set("model", selectedModel);
        const response = await upstream(
          providers[p].url + "/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${keys[p] || defaults[p]}` },
            body: form,
          },
        );
        if (typeof response.text !== "string")
          throw new Error("No transcript was returned.");
        return { text: response.text };
      }

      case "image.ocr":
        return recognizeImage(payload.data, {
          language: payload.language || "eng",
        });
      case "document.read": {
        const { data, name } = z
          .object({ data: z.string().max(14000000), name: z.string().max(250) })
          .parse(payload);
        const buffer = Buffer.from(data, "base64");
        if (name.toLowerCase().endsWith(".pdf")) {
          return await readPdf(buffer, { ocr: payload.ocr !== false });
        }
        if (!/\.(txt|md)$/i.test(name))
          throw new Error("Choose a PDF, Markdown, or text document.");
        return { text: buffer.toString("utf8").slice(0, 100000) };
      }
      case "backup":
        return { version: 1, ...store.load() };
      case "backup.restore": {
        if (busy.size)
          throw new Error(
            "Wait for current answers before restoring a backup.",
          );
        const data = z
          .object({
            version: z.literal(1),
            sessions: z.array(sessionSchema).max(1000),
            profiles: z.array(profileSchema).max(100),
            settings: settingsSchema,
          })
          .parse(payload);
        store.replace(data, { expectedRevision: payload.expectedRevision });
        return publicState();
      }
      case "sync.changes":
        return store.changes(payload.since || 0, payload.limit || 100);
      case "recovery.snapshots":
        return store.snapshots();
      case "recovery.restore": {
        if (busy.size)
          throw new Error("Wait for current answers before restoring.");
        store.restoreSnapshot(z.string().uuid().parse(payload.id));
        return publicState();
      }
      case "history.list":
        return store.history(
          z.enum(["session", "profile", "settings"]).parse(payload.kind),
          payload.id,
        );
      case "history.restore": {
        if (busy.has(payload.id) || store.isLeased("chat:" + payload.id))
          throw new Error("Wait for the current answer before restoring.");
        return store.restoreVersion(
          z.enum(["session", "profile", "settings"]).parse(payload.kind),
          payload.id,
          z.number().int().positive().parse(payload.version),
        );
      }
      default:
        throw new Error("Unknown action.");
    }
  }
  return { dispatch, close: () => store.close() };
}
