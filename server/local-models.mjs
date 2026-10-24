// Detection is an explicit desktop action, limited to four well-known loopback ports.
export const localServers = [
  { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  { name: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" },
  { name: "vLLM", baseUrl: "http://127.0.0.1:8000/v1" },
];

export async function detectLocalModels({ fetchImpl = fetch, signal } = {}) {
  const results = await Promise.all(
    localServers.map(async (server) => {
      try {
        const response = await fetchImpl(server.baseUrl + "/models", {
          redirect: "error",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(2000)])
            : AbortSignal.timeout(2000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const reader = response.body.getReader();
        let bytes = 0,
          chunks = [];
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 1024 * 1024) throw new Error("Model list exceeds 1 MB");
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!Array.isArray(data.data))
          throw new Error("No compatible model list");
        const models = [
          ...new Set(
            data.data
              .map((m) => m?.id)
              .filter(
                (id) => typeof id === "string" && id.trim() && id.length <= 100,
              ),
          ),
        ]
          .slice(0, 1000)
          .map((id) => ({ id, name: id }));
        return { ...server, models };
      } catch (error) {
        return { ...server, error: String(error.message).slice(0, 160) };
      }
    }),
  );
  signal?.throwIfAborted();
  return {
    servers: results.filter((result) => !result.error),
    unavailable: results.filter((result) => result.error),
  };
}
