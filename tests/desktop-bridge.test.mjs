import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../server/core.mjs";
import { createDesktopBridge } from "../server/desktop-bridge.mjs";
test("desktop without a local key uses hosted credentials and retains answers locally", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-bridge-"));
  t.after(() => {
    local.close();
    hosted.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const local = createService({ directory: path.join(dir, "local") }),
    hosted = createService({
      directory: path.join(dir, "remote"),
      defaultKeys: { openai: "host-key" },
      fetchImpl: async () =>
        Response.json({
          choices: [{ message: { content: "A cloud-funded desktop answer." } }],
        }),
    });
  const now = new Date().toISOString(),
    s = {
      id: randomUUID(),
      title: "Desktop cloud",
      mode: "general",
      profileId: "",
      createdAt: now,
      updatedAt: now,
      notes: "Some context",
      transcript: "",
      messages: [],
    };
  await local.dispatch("session.save", s);
  const calls = [];
  const bridge = createDesktopBridge({
    service: local,
    cloud: {
      request: async (action, payload) => {
        calls.push(action);
        return action === "cloud.state"
          ? { user: { id: "user-1" } }
          : hosted.dispatch(action, payload);
      },
    },
  });
  const status = await bridge.dispatch("state");
  assert.equal(status.keys.openai, true);
  assert.equal(status.ownedKeys.openai, false);
  assert.equal(status.cloudConnected, true);
  const result = await bridge.dispatch("chat", {
    sessionId: s.id,
    text: "Can I use my plan here?",
  });
  assert.equal(result.messages[1].content, "A cloud-funded desktop answer.");
  assert.equal((await local.dispatch("state")).sessions[0].messages.length, 2);
  assert.ok(calls.includes("settings.save"));
});
test("desktop falls back to local key error when cloud is signed out", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-offline-"));
  t.after(() => {
    local.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const local = createService({ directory: dir }),
    now = new Date().toISOString(),
    s = {
      id: randomUUID(),
      title: "Local",
      mode: "general",
      profileId: "",
      createdAt: now,
      updatedAt: now,
      notes: "",
      transcript: "",
      messages: [],
    };
  await local.dispatch("session.save", s);
  const bridge = createDesktopBridge({
    service: local,
    cloud: { request: async () => ({ user: null }) },
  });
  await assert.rejects(
    bridge.dispatch("chat", { sessionId: s.id, text: "Hello" }),
    /Add your openai API key/,
  );
});
