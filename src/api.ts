export async function api<T = any>(
  action: string,
  payload: unknown = {},
): Promise<T> {
  if (window.lens) return window.lens.invoke(action, payload);
  if (typeof window !== "undefined" && (window as any).chrome?.webview) {
    let attempts = 0;
    while (!(window as any).lens && attempts < 15) {
      await new Promise((r) => setTimeout(r, 10));
      attempts++;
    }
    if ((window as any).lens) return (window as any).lens.invoke(action, payload);
  }
  const response = await fetch(`/api/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "Request failed"), {
      code: result.code,
      current: result.current,
    });
  return result;
}
export const uid = () => crypto.randomUUID();

export async function chat(
  payload: Record<string, unknown>,
  onEvent: (event: any) => void,
  signal: AbortSignal,
) {
  const requestId = uid();
  signal.throwIfAborted();
  if (window.lens) {
    const off = window.lens.onChatEvent((event) => {
      if (event.requestId === requestId) onEvent(event);
    });
    const cancel = () => {
      void window.lens!.invoke("chat.cancel", { requestId }).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      return await api("chat", { ...payload, requestId, stream: true });
    } finally {
      off();
      signal.removeEventListener("abort", cancel);
    }
  }
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, requestId, stream: true }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Request failed.");
  }
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    result,
    complete = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 42 * 1024 * 1024)
        throw new Error("Response exceeds the safe size limit.");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "done") {
          result = event.result;
          complete = true;
        } else onEvent(event);
      }
    }
    if (!complete)
      throw new Error(
        "Connection ended before the answer was saved. Retry your question.",
      );
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
