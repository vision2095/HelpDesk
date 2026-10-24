import React, { useState, useRef, useEffect } from "react";
import { api } from "./api";
import type { Settings } from "./types";
export function ProviderModels({
  settings,
  onChange,
  onError,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onError: (error: unknown) => void;
}) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([]),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(""),
    [servers, setServers] = useState<
      {
        name: string;
        baseUrl: string;
        models: { id: string; name: string }[];
      }[]
    >([]);
  const identity = `${settings.provider}:${settings.localBaseUrl || ""}`;
  const currentIdentity = useRef(identity),
    request = useRef(0);
  currentIdentity.current = identity;
  useEffect(() => {
    request.current++;
    setModels([]);
    setServers([]);
    setResult("");
    setBusy(false);
    return () => {
      request.current++;
    };
  }, [identity]);
  async function run(action: string) {
    const token = ++request.current,
      startedFor = identity;
    setBusy(true);
    setResult("");
    try {
      const response = await api(action, {
        provider: settings.provider,
        model: settings.model,
        localBaseUrl: settings.localBaseUrl,
      });
      if (token !== request.current || startedFor !== currentIdentity.current)
        return;
      if (action === "desktop.models.detect") {
        setServers(response.servers);
        setResult(
          response.servers.length
            ? `${response.servers.length} local servers found. Choose one to use its models.`
            : "No compatible local server found. Start a model server, or enter its address and select Load available models.",
        );
        return;
      }
      if (action === "model.list") {
        setModels(response.models);
        setResult(
          `${response.models.length} models returned. Image support varies by model; check your provider’s capabilities.`,
        );
      } else setResult(`Connection works: ${response.preview}`);
    } catch (error) {
      if (token === request.current && startedFor === currentIdentity.current)
        onError(error);
    } finally {
      if (token === request.current) setBusy(false);
    }
  }
  return (
    <div>
      {settings.provider === "local" && window.lens && (
        <div className="local-detection">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => run("desktop.models.detect")}
          >
            {busy ? "Checking…" : "Detect local servers"}
          </button>
          <p className="field-help">
            Checks this computer’s Ollama (11434), LM Studio (1234), llama.cpp
            (8080), and vLLM (8000) ports. No question or screenshot is sent.
          </p>
          {servers.length > 0 && (
            <label>
              Detected server
              <select
                aria-label="Detected local server"
                value=""
                onChange={(event) => {
                  const server = servers.find(
                    (item) => item.baseUrl === event.target.value,
                  );
                  if (server)
                    onChange({
                      ...settings,
                      localBaseUrl: server.baseUrl,
                      model: server.models[0]?.id || settings.model,
                    });
                }}
              >
                <option value="" disabled>
                  Choose a local server
                </option>
                {servers.map((server) => (
                  <option value={server.baseUrl} key={server.baseUrl}>
                    {server.name} — {server.baseUrl} ({server.models.length}{" "}
                    models)
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="toggle-row">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => run("model.list")}
        >
          Load available models
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => run("model.test")}
        >
          {busy ? "Checking…" : "Test selected model"}
        </button>
      </div>
      {models.length > 0 && (
        <label>
          Available model
          <select
            aria-label="Available model"
            value={settings.model}
            onChange={(e) => onChange({ ...settings, model: e.target.value })}
          >
            <option value={settings.model}>{settings.model}</option>
            {models
              .filter((m) => m.id !== settings.model)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {result && (
        <p role="status" className="field-help">
          {result}
        </p>
      )}
      <p className="field-help">
        Connection tests generate a small response and use one hosted request
        when using platform access.
      </p>
      <label>
        Input context budget
        <select
          value={settings.contextTokens || 24000}
          onChange={(e) =>
            onChange({ ...settings, contextTokens: Number(e.target.value) })
          }
        >
          <option value={8000}>8,000 estimated tokens</option>
          <option value={16000}>16,000 estimated tokens</option>
          <option value={24000}>24,000 estimated tokens</option>
          <option value={64000}>64,000 estimated tokens</option>
        </select>
      </label>
      <p className="field-help">
        A conservative estimate controls input size. Old context is omitted when
        necessary; model limits can be lower.
      </p>
    </div>
  );
}
