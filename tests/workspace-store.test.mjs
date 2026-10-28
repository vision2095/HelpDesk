import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createService } from "../server/core.mjs";
import { createVault } from "../server/cloud/auth.mjs";
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-store-")),
    services = [];
  const open = (extra) => {
    const s = createService({ directory, ...options, ...extra });
    services.push(s);
    return s;
  };
  t.after(() => {
    for (const s of services) s.close();
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  });
  return { directory, open };
}
function session() {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: "Private title",
    mode: "general",
    profileId: "",
    createdAt: now,
    updatedAt: now,
    notes: "Secret resume detail",
    transcript: "",
    messages: [],
  };
}
test("failed durable commits roll back data, attachments, and revisions", async (t) => {
  let fail = false;
  const f = fixture(t, {
    beforeCommit: () => {
      if (fail) {
        const error = new Error("Disk full");
        error.code = "ENOSPC";
        throw error;
      }
    },
  });
  const service = f.open(),
    s = await service.dispatch("session.save", session());
  const revision = (await service.dispatch("state")).revision;
  fail = true;
  await assert.rejects(
    service.dispatch("session.save", { ...s, notes: "Must not persist" }),
    /Disk full/,
  );
  assert.equal(
    (await service.dispatch("session.get", { id: s.id })).notes,
    "Secret resume detail",
  );
  assert.equal((await service.dispatch("state")).revision, revision);
  fail = false;
  const reopened = f.open();
  assert.equal(
    (await reopened.dispatch("session.get", { id: s.id })).notes,
    "Secret resume detail",
  );
});
test("two processes or tabs cannot silently overwrite the same session revision", async (t) => {
  const f = fixture(t),
    a = f.open(),
    b = f.open(),
    s = await a.dispatch("session.save", session());
  const stale = await b.dispatch("session.get", { id: s.id });
  const fresh = await a.dispatch("session.save", { ...s, notes: "Saved by A" });
  await assert.rejects(
    b.dispatch("session.save", { ...stale, notes: "Stale B" }),
    (error) =>
      error.code === "CONFLICT" && error.current.notes === "Saved by A",
  );
  assert.equal(
    (await b.dispatch("session.get", { id: s.id })).version,
    fresh.version,
  );
});
test("encrypted store hides transcripts, titles, profiles and credentials on disk", async (t) => {
  const vault = createVault(randomBytes(32).toString("hex")),
    f = fixture(t, vault),
    s = f.open();
  await s.dispatch("session.save", session());
  await s.dispatch("key.save", { provider: "openai", key: "DO-NOT-LEAK-KEY" });
  for (const file of fs.readdirSync(f.directory)) {
    const bytes = fs.readFileSync(path.join(f.directory, file));
    for (const secret of [
      "Private title",
      "Secret resume detail",
      "DO-NOT-LEAK-KEY",
    ])
      assert.equal(
        bytes.includes(Buffer.from(secret)),
        false,
        `${secret} leaked in ${file}`,
      );
  }
  const reloaded = f.open();
  assert.equal((await reloaded.dispatch("state")).keys.openai, true);
  const feed = await reloaded.dispatch("sync.changes", { since: 0 });
  assert.equal(JSON.stringify(feed).includes("DO-NOT-LEAK-KEY"), false);
  assert.ok(feed.changes.every((c) => c.kind !== "credentials"));
});
test("transcripts append idempotently while another service generates an answer", async (t) => {
  let release;
  const f = fixture(t, {
      defaultKeys: { openai: "key" },
      fetchImpl: () => new Promise((r) => (release = r)),
    }),
    a = f.open(),
    b = f.open(),
    s = await a.dispatch("session.save", session());
  const pending = a.dispatch("chat", { sessionId: s.id, text: "Question" });
  const segment = {
    id: randomUUID(),
    text: "A new spoken detail",
    startedAt: new Date().toISOString(),
    duration: 2,
  };
  await b.dispatch("transcript.append", { id: s.id, segment });
  await b.dispatch("transcript.append", { id: s.id, segment });
  await assert.rejects(
    b.dispatch("chat", { sessionId: s.id, text: "Concurrent question" }),
    /already in progress/,
  );
  release(Response.json({ choices: [{ message: { content: "An answer" } }] }));
  const result = await pending;
  assert.equal(result.messages.length, 2);
  assert.equal(result.segments.length, 1);
  assert.equal(result.transcript, "A new spoken detail");
});
test("history and snapshots restore data with new monotonically increasing revisions", async (t) => {
  const f = fixture(t),
    service = f.open(),
    s = await service.dispatch("session.save", session());
  const updated = await service.dispatch("session.save", {
    ...s,
    notes: "New notes",
  });
  const history = await service.dispatch("history.list", {
    kind: "session",
    id: s.id,
  });
  assert.ok(history.some((h) => h.version === s.version));
  const restored = await service.dispatch("history.restore", {
    kind: "session",
    id: s.id,
    version: s.version,
  });
  assert.equal(restored.notes, s.notes);
  assert.ok(restored.version > updated.version);
  const backup = await service.dispatch("backup");
  await service.dispatch("backup.restore", { ...backup, sessions: [] });
  const snapshots = await service.dispatch("recovery.snapshots");
  assert.equal(snapshots.length, 1);
  await service.dispatch("recovery.restore", { id: snapshots[0].id });
  assert.equal((await service.dispatch("state")).sessions.length, 1);
});
test("paginated summaries omit conversation payloads while search finds their content", async (t) => {
  const f = fixture(t),
    service = f.open();
  for (let i = 0; i < 4; i++)
    await service.dispatch("session.save", {
      ...session(),
      title: "Session " + i,
      notes: i === 2 ? "needleword" : "",
    });
  const page = await service.dispatch("workspace.list", {
    limit: 2,
    offset: 0,
  });
  assert.equal(page.sessions.length, 2);
  assert.ok(
    page.sessions.every(
      (s) => s.loaded === false && s.notes === "" && s.messages.length === 0,
    ),
  );
  assert.equal(
    (await service.dispatch("session.search", { query: "needleword" })).sessions
      .length,
    1,
  );
  await assert.rejects(
    service.dispatch("session.save", page.sessions[0]),
    /Open this session/,
  );
});
test("storage quota failure leaves no half-written session", async (t) => {
  const f = fixture(t, { maxBytes: 5000 }),
    service = f.open(),
    s = session();
  await assert.rejects(
    service.dispatch("session.save", { ...s, notes: "x".repeat(10000) }),
    /storage limit/,
  );
  assert.equal((await service.dispatch("state")).sessions.length, 0);
});

test("revision retention is bounded and snapshots keep deduplicated images restorable", async (t) => {
  const f = fixture(t);
  const service = f.open();
  let s = await service.dispatch("session.save", session());
  for (let i = 0; i < 40; i++)
    s = await service.dispatch("session.save", {
      ...s,
      notes: "revision " + i,
    });
  assert.equal(
    (await service.dispatch("history.list", { kind: "session", id: s.id }))
      .length,
    30,
  );
  const now = new Date().toISOString();
  s = await service.dispatch("session.save", {
    ...s,
    messages: [
      {
        id: randomUUID(),
        role: "user",
        content: "An image",
        createdAt: now,
        images: ["data:image/png;base64,aGVsbG8="],
      },
    ],
  });
  const backup = await service.dispatch("backup");
  await service.dispatch("backup.restore", { ...backup, sessions: [] });
  const snapshots = await service.dispatch("recovery.snapshots");
  await service.dispatch("recovery.restore", { id: snapshots[0].id });
  assert.equal(
    (await service.dispatch("session.get", { id: s.id })).messages[0].images[0],
    "data:image/png;base64,aGVsbG8=",
  );
});
