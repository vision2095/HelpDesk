import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAnswer, buildContext } from "../server/ai.mjs";
import { createService } from "../server/core.mjs";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const context = {
  system: "Be helpful.",
  messages: [{ role: "user", content: "Hello" }],
};
const frame = (data, newline = "\n") =>
  `data: ${typeof data === "string" ? data : JSON.stringify(data)}${newline}${newline}`;
const streamed = (chunks) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
        c.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
test("compatible provider stream parses split CRLF frames, usage and completion", async () => {
  const events = [];
  let body;
  const wire =
    frame({ choices: [{ delta: { content: "Hello " } }] }, "\r\n") +
    frame(
      { choices: [{ delta: { content: "world" }, finish_reason: "stop" }] },
      "\r\n",
    ) +
    frame({ usage: { total_tokens: 12 } }, "\r\n") +
    frame("[DONE]", "\r\n");
  const result = await generateAnswer({
    provider: "openai",
    model: "test",
    key: "key",
    context,
    onEvent: (e) => events.push(e),
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return streamed([...wire]);
    },
  });
  assert.equal(result.content, "Hello world");
  assert.equal(result.usage.total_tokens, 12);
  assert.deepEqual(
    events.map((e) => e.text),
    ["Hello ", "world"],
  );
  assert.equal(body.max_completion_tokens, 4096);
  assert.equal(body.stream, true);
});
test("Anthropic streams text and usage while ignoring thinking and ping events", async () => {
  const result = await generateAnswer({
    provider: "anthropic",
    model: "test",
    key: "key",
    context,
    fetchImpl: async () =>
      streamed([
        frame({
          type: "message_start",
          message: { usage: { input_tokens: 5 } },
        }),
        frame({
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "private" },
        }),
        frame({ type: "ping" }),
        frame({
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Visible" },
        }),
        frame({ type: "message_delta", usage: { output_tokens: 3 } }),
        frame({ type: "message_stop" }),
      ]),
  });
  assert.equal(result.content, "Visible");
  assert.deepEqual(result.usage, { input_tokens: 5, output_tokens: 3 });
});
test("DeepSeek uses its OpenAI-compatible endpoint with the selected API key", async () => {
  let request;
  const result = await generateAnswer({
    provider: "deepseek",
    model: "deepseek-chat",
    key: "deepseek-test-key",
    context,
    stream: false,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({
        choices: [{ message: { content: "DeepSeek connection works." } }],
      });
    },
  });
  assert.equal(result.content, "DeepSeek connection works.");
  assert.equal(request.url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(
    request.options.headers.Authorization,
    "Bearer deepseek-test-key",
  );
});
test("truncated and malformed provider streams are errors", async () => {
  for (const wire of [
    frame({ choices: [{ delta: { content: "partial" } }] }),
    "data: not json\n\n",
  ])
    await assert.rejects(
      generateAnswer({
        provider: "groq",
        model: "test",
        key: "key",
        context,
        fetchImpl: async () => streamed([wire]),
      }),
      /ended|invalid streaming/,
    );
});
test("transient failures retry before output; authentication failures do not retry", async () => {
  let calls = 0;
  const events = [];
  const result = await generateAnswer({
    provider: "openai",
    model: "test",
    key: "key",
    context,
    onEvent: (e) => events.push(e),
    fetchImpl: async () =>
      ++calls === 1
        ? Response.json({ error: { message: "busy" } }, { status: 503 })
        : Response.json({ choices: [{ message: { content: "Recovered" } }] }),
  });
  assert.equal(calls, 2);
  assert.equal(result.content, "Recovered");
  assert.equal(events[0].type, "retry");
  calls = 0;
  await assert.rejects(
    generateAnswer({
      provider: "openai",
      model: "test",
      key: "key",
      context,
      fetchImpl: async () => {
        calls++;
        return Response.json(
          { error: { message: "invalid key" } },
          { status: 401 },
        );
      },
    }),
    /401/,
  );
  assert.equal(calls, 1);
});
test("context stays within its conservative budget and reports omitted history", () => {
  const session = {
    mode: "coding",
    notes: "n".repeat(100000),
    transcript: "t".repeat(200000),
    messages: Array.from({ length: 40 }, () => ({
      role: "user",
      content: "old".repeat(1000),
    })),
  };
  const result = buildContext({
    session,
    profile: { resume: "r".repeat(100000) },
    settings: {
      language: "English",
      systemPrompt: "Be concise.",
      contextTokens: 24000,
    },
    user: { role: "user", content: "q".repeat(20000), images: ["one", "two"] },
  });
  assert.ok(result.clipped);
  assert.ok(result.estimatedInputTokens + 4096 <= 24000);
  assert.match(result.system, /edge cases/);
  assert.throws(
    () =>
      buildContext({
        session,
        settings: { contextTokens: 4000 },
        user: { content: "q".repeat(10000) },
      }),
    /exceed/,
  );
});
test("canceling a partial answer commits no phantom messages and releases chat lease", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lens-stream-"));
  let upstreamCanceled = false,
    first = true;
  const service = createService({
    directory,
    defaultKeys: { openai: "test" },
    fetchImpl: async (_url, { signal }) => {
      if (!first)
        return Response.json({
          choices: [{ message: { content: "Retry succeeded" } }],
        });
      first = false;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                frame({ choices: [{ delta: { content: "Partial" } }] }),
              ),
            );
            signal.addEventListener(
              "abort",
              () => {
                upstreamCanceled = true;
                c.error(signal.reason);
              },
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  t.after(() => {
    service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const s = await service.dispatch("session.save", {
    id: randomUUID(),
    title: "Cancel test",
    mode: "general",
    profileId: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: "",
    transcript: "",
    messages: [],
  });
  const requestId = randomUUID();
  const pending = service.dispatch(
    "chat",
    { sessionId: s.id, text: "Hello", requestId },
    {
      onEvent: (event) => {
        if (event.type === "delta")
          void service.dispatch("chat.cancel", { requestId });
      },
    },
  );
  await assert.rejects(pending, /canceled/);
  assert.ok(upstreamCanceled);
  assert.equal(
    (await service.dispatch("session.get", { id: s.id })).messages.length,
    0,
  );
  const retry = await service.dispatch("chat", {
    sessionId: s.id,
    text: "Hello",
  });
  assert.equal(retry.messages.length, 2);
});
