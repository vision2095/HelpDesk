/** POST event stream. Authentication and quota checks happen before this starts. */
export async function respondWithStream(res, execute) {
  const controller = new AbortController();
  const closed = () => {
    if (!res.writableEnded) controller.abort(new Error("Client disconnected."));
  };
  res.on("close", closed);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  const emit = (event) => {
    controller.signal.throwIfAborted();
    // Disconnect a stalled consumer rather than buffer unbounded provider output.
    if (res.writableLength > 1024 * 1024) {
      controller.abort(new Error("Connection is too slow."));
      controller.signal.throwIfAborted();
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.flush?.();
  };
  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(": keepalive\n\n");
  }, 15000);
  heartbeat.unref?.();
  try {
    const result = await execute({ signal: controller.signal, onEvent: emit });
    emit({ type: "done", result });
  } catch (error) {
    res.lensError = true;
    if (!res.destroyed)
      res.write(
        `data: ${JSON.stringify({ type: "error", error: error.message || "Generation failed." })}\n\n`,
      );
  } finally {
    clearInterval(heartbeat);
    res.off("close", closed);
    res.end();
  }
}

export async function readEventStream(response, onEvent, signal) {
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Request failed.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    result,
    complete = false;
  try {
    while (true) {
      signal?.throwIfAborted();
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
        } else onEvent?.(event);
      }
    }
    if (!complete)
      throw new Error(
        "The connection ended before the answer was saved. Your question is still available to retry.",
      );
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
