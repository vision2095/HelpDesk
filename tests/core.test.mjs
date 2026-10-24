import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../server/core.mjs";
import { settingsSchema } from "../server/contracts.mjs";
function fixture(t, fetchImpl) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-test-"));
  const services = [];
  const open = (options = {}) => {
    const service = createService({ directory, fetchImpl, ...options });
    services.push(service);
    return service;
  };
  t.after(() => {
    for (const service of services) service.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, service: open(), open };
}
function session() {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: "Design practice",
    mode: "system-design",
    profileId: "",
    createdAt: now,
    updatedAt: now,
    notes: "Keep it concise",
    transcript: "How would you scale this?",
    messages: [],
  };
}
test("appearance preferences migrate default colors and reject invalid colors or layouts", async (t) => {
  const { service, open } = fixture(t);
  const before = (await service.dispatch("state")).settings;
  assert.equal(before.lightTextColor, "#24384c");
  assert.equal(before.darkTextColor, "#e2eaf5");
  assert.equal(before.interviewLayout, "full");
  const updated = {
    ...before,
    darkTextColor: "#dce8ff",
    lightTextColor: "#123456",
    interviewLayout: "compact",
  };
  await service.dispatch("settings.save", updated);
  assert.equal(
    (await open().dispatch("state")).settings.interviewLayout,
    "compact",
  );
  assert.equal(
    (await service.dispatch("state")).settings.darkTextColor,
    "#dce8ff",
  );
  assert.equal(
    settingsSchema.safeParse({ ...updated, darkTextColor: "url(x)" }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({ ...updated, interviewLayout: "invalid" })
      .success,
    false,
  );
});
test("sessions, profiles, settings persist; backups omit secrets", async (t) => {
  const { directory, service, open } = fixture(t);
  const s = session();
  await service.dispatch("session.save", s);
  const profile = {
    id: randomUUID(),
    name: "Backend",
    role: "Engineer",
    company: "Acme",
    resume: "Built APIs",
    jobDescription: "Distributed systems",
  };
  await service.dispatch("profile.save", profile);
  await service.dispatch("key.save", {
    provider: "openai",
    key: "secret-test",
  });
  const state = await service.dispatch("state");
  assert.equal(state.keys.openai, true);
  assert.equal(state.sessions[0].notes, s.notes);
  const backup = await service.dispatch("backup");
  assert.equal(JSON.stringify(backup).includes("secret-test"), false);
  const reopened = open();
  assert.equal((await reopened.dispatch("state")).profiles[0].name, "Backend");
  assert.equal((await reopened.dispatch("state")).keys.openai, false);
  await service.dispatch("session.delete", { id: s.id });
  assert.equal((await service.dispatch("state")).sessions.length, 0);
  await service.dispatch("backup.restore", backup);
  assert.equal((await service.dispatch("state")).sessions.length, 1);
  assert.ok((await service.dispatch("recovery.snapshots")).length > 0);
});
test("successful provider request includes context and commits both messages", async (t) => {
  let request;
  const { service } = fixture(t, async (url, options) => {
    request = { url, ...options };
    return Response.json({
      choices: [{ message: { content: "Use a queue and a worker pool." } }],
    });
  });
  const s = session();
  await service.dispatch("session.save", s);
  await service.dispatch("key.save", { provider: "openai", key: "test-key" });
  const result = await service.dispatch("chat", {
    sessionId: s.id,
    text: "What next?",
  });
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].content, "Use a queue and a worker pool.");
  const body = JSON.parse(request.body);
  assert.match(body.messages[0].content, /How would you scale this/);
  assert.equal(request.headers.Authorization, "Bearer test-key");
});
test("provider failure preserves the draft session without phantom messages", async (t) => {
  const { service } = fixture(t, async () =>
    Response.json({ error: { message: "Key is invalid" } }, { status: 401 }),
  );
  const s = session();
  await service.dispatch("session.save", s);
  await assert.rejects(
    service.dispatch("chat", { sessionId: s.id, text: "Hello" }),
    /Add your openai/,
  );
  await service.dispatch("key.save", { provider: "openai", key: "bad" });
  await assert.rejects(
    service.dispatch("chat", { sessionId: s.id, text: "Hello" }),
    /401: Key is invalid/,
  );
  assert.equal(
    (await service.dispatch("state")).sessions[0].messages.length,
    0,
  );
});
test("Anthropic vision requests use native image blocks", async (t) => {
  let body;
  const { service } = fixture(t, async (url, options) => {
    assert.ok(url.endsWith("/messages"));
    body = JSON.parse(options.body);
    return Response.json({
      content: [{ type: "text", text: "An architecture diagram." }],
    });
  });
  const state = await service.dispatch("state");
  await service.dispatch("settings.save", {
    ...state.settings,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
  });
  await service.dispatch("key.save", {
    provider: "anthropic",
    key: "test-key",
  });
  const s = session();
  await service.dispatch("session.save", s);
  await service.dispatch("chat", {
    sessionId: s.id,
    text: "Explain",
    images: ["data:image/png;base64,aGVsbG8="],
  });
  assert.equal(body.messages[0].content[1].source.media_type, "image/png");
});
test("desktop local models list and answer through the chosen OpenAI-compatible endpoint without an API key", async (t) => {
  const requests = [];
  const { service } = fixture(t, async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/models"))
      return Response.json({ data: [{ id: "qwen2.5-vl:7b" }] });
    return Response.json({
      choices: [{ message: { content: "Local model response." } }],
    });
  });
  const state = await service.dispatch("state");
  await service.dispatch("settings.save", {
    ...state.settings,
    provider: "local",
    model: "qwen2.5-vl:7b",
    localBaseUrl: "http://127.0.0.1:1234/v1",
  });
  const models = await service.dispatch("model.list", {
    provider: "local",
    localBaseUrl: "http://127.0.0.1:1234/v1",
  });
  assert.equal(models.models[0].id, "qwen2.5-vl:7b");
  const s = session();
  await service.dispatch("session.save", s);
  const result = await service.dispatch("chat", {
    sessionId: s.id,
    text: "Answer locally",
  });
  assert.equal(result.messages[1].content, "Local model response.");
  assert.equal(requests[0].url, "http://127.0.0.1:1234/v1/models");
  assert.equal(requests[1].url, "http://127.0.0.1:1234/v1/chat/completions");
  assert.equal(requests[1].options.headers.Authorization, undefined);
  assert.equal((await service.dispatch("state")).keys.local, false);
  await assert.rejects(
    service.dispatch("key.save", { provider: "local", key: "unused" }),
    /do not use API keys/,
  );
});
test("in-flight requests cannot overwrite or delete sessions", async (t) => {
  let release;
  const { service } = fixture(
    t,
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const s = session();
  await service.dispatch("session.save", s);
  await service.dispatch("key.save", { provider: "openai", key: "test-key" });
  const pending = service.dispatch("chat", { sessionId: s.id, text: "Hello" });
  await assert.rejects(service.dispatch("session.save", s), /Wait for/);
  await assert.rejects(
    service.dispatch("session.delete", { id: s.id }),
    /Wait for/,
  );
  await assert.rejects(
    service.dispatch("chat", { sessionId: s.id, text: "Again" }),
    /already in progress/,
  );
  release(Response.json({ choices: [{ message: { content: "Hi" } }] }));
  await pending;
  assert.equal(
    (await service.dispatch("state")).sessions[0].messages.length,
    2,
  );
});
test("invalid backup and image URLs are rejected without changing data", async (t) => {
  const { service } = fixture(t);
  const s = session();
  await service.dispatch("session.save", s);
  await assert.rejects(
    service.dispatch("backup.restore", { version: 2, sessions: [] }),
    /./,
  );
  await assert.rejects(
    service.dispatch("chat", {
      sessionId: s.id,
      text: "Fetch",
      images: ["https://example.com/private.png"],
    }),
    /./,
  );
  assert.equal((await service.dispatch("state")).sessions.length, 1);
});
test("transcription sends a multipart file to the selected provider", async (t) => {
  const { service } = fixture(t, async (url, options) => {
    assert.match(url, /audio\/transcriptions$/);
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get("model"), "whisper-1");
    return Response.json({ text: "Tell me about your project." });
  });
  await service.dispatch("key.save", { provider: "openai", key: "test-key" });
  const result = await service.dispatch("transcribe", {
    mime: "audio/webm",
    data: "aGVsbG8=",
  });
  assert.equal(result.text, "Tell me about your project.");
});
test("key encryption failure never stores a usable key", async (t) => {
  const { open } = fixture(t);
  let fail = false;
  const service = open({
    encrypt: (value) => {
      if (fail) throw new Error("Keychain unavailable");
      return Buffer.from(value);
    },
    decrypt: (value) => value.toString("utf8"),
  });
  fail = true;
  await assert.rejects(
    service.dispatch("key.save", { provider: "openai", key: "sensitive" }),
    /Keychain/,
  );
  assert.equal((await service.dispatch("state")).keys.openai, false);
});
test("corrupt workspace fails visibly and preserves original bytes", async (t) => {
  const { directory } = fixture(t);
  const file = path.join(directory, "workspace.json");
  fs.writeFileSync(file, "{broken");
  assert.throws(() => createService({ directory }), /data is preserved/);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});
test("ended sessions reject new questions", async (t) => {
  const { service } = fixture(t);
  const s = { ...session(), endedAt: new Date().toISOString() };
  await service.dispatch("session.save", s);
  await assert.rejects(
    service.dispatch("chat", { sessionId: s.id, text: "Hello" }),
    /Resume this session/,
  );
});

test("session timer preserves elapsed time across end and resume", async (t) => {
  const { service } = fixture(t);
  const s = session();
  s.activeSince = new Date(Date.now() - 120000).toISOString();
  s.activeSeconds = 60;
  const saved = await service.dispatch("session.save", s);
  const ended = await service.dispatch("session.save", {
    ...saved,
    endedAt: new Date().toISOString(),
  });
  assert.ok(ended.activeSeconds >= 180 && ended.activeSeconds <= 181);
  assert.equal(ended.activeSince, undefined);
  const resumed = await service.dispatch("session.save", {
    ...ended,
    endedAt: undefined,
  });
  assert.equal(resumed.activeSeconds, ended.activeSeconds);
  assert.ok(Date.parse(resumed.activeSince) > Date.now() - 1000);
});
