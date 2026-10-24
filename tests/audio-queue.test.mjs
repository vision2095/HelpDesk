import test from "node:test";
import assert from "node:assert/strict";
import { createAudioQueue } from "../src/audio-queue.mjs";
const sessionId = crypto.randomUUID();
function storage() {
  const rows = new Map();
  return {
    rows,
    async put(clip) {
      rows.set(clip.id, structuredClone(clip));
    },
    async list() {
      return [...rows.values()].map((clip) => structuredClone(clip));
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}
const clip = () => ({
  blob: new Blob(["test audio"], { type: "audio/webm" }),
  sessionId,
});

test("failed uploads retain raw audio and retry succeeds", async () => {
  const db = storage();
  let attempts = 0,
    list;
  const queue = createAudioQueue({
    storage: db,
    onChange: (clips) => (list = clips),
    transcribe: async () => {
      if (++attempts === 1) throw new Error("offline");
      return { text: "Recovered speech" };
    },
    append: async () => {},
  });
  const id = await queue.enqueue(clip());
  await queue.drain();
  assert.equal(list[0].status, "failed");
  assert.equal(list[0].durable, true);
  assert.equal(await queue.get(id).blob.text(), "test audio");
  await queue.retry(id);
  await queue.drain();
  assert.equal(attempts, 2);
  assert.equal(db.rows.size, 0);
  assert.deepEqual(list, []);
});

test("append retry uses cached transcription and stable segment IDs even after response loss", async () => {
  const db = storage();
  let transcriptions = 0,
    calls = 0;
  const ids = [],
    saved = new Set();
  const queue = createAudioQueue({
    storage: db,
    transcribe: async () => {
      transcriptions++;
      return { text: "Speech" };
    },
    append: async (_session, segment) => {
      ids.push(segment.id);
      saved.add(segment.id);
      if (++calls === 1) throw new Error("response lost");
    },
  });
  const id = await queue.enqueue(clip());
  await queue.drain();
  assert.equal(queue.get(id).segments[0].text, "Speech");
  await queue.retry(id);
  await queue.drain();
  assert.equal(transcriptions, 1);
  assert.equal(saved.size, 1);
  assert.equal(ids[0], ids[1]);
});

test("long imported transcripts split into bounded segments and retain all text", async () => {
  const text = "A".repeat(23001),
    segments = [];
  const queue = createAudioQueue({
    storage: storage(),
    transcribe: async () => ({ text, durationSeconds: 650 }),
    append: async (_id, segment) => segments.push(segment),
  });
  await queue.enqueue(clip());
  await queue.drain();
  assert.equal(segments.length, 3);
  assert.equal(segments.map((segment) => segment.text).join(""), text);
  assert.equal(
    segments.reduce((n, segment) => n + segment.duration, 0),
    650,
  );
  assert.ok(segments.every((segment) => segment.text.length <= 10000));
});

test("restart recovers cached transcript without uploading automatically", async () => {
  const db = storage();
  let transcriptions = 0;
  const original = createAudioQueue({
    storage: db,
    transcribe: async () => {
      transcriptions++;
      return { text: "Keep me" };
    },
    append: async () => {
      throw new Error("offline append");
    },
  });
  const id = await original.enqueue(clip());
  await original.drain();
  const segments = [];
  const reopened = createAudioQueue({
    storage: db,
    transcribe: async () => {
      transcriptions++;
      return { text: "wrong" };
    },
    append: async (_id, segment) => segments.push(segment),
  });
  await reopened.initialize();
  assert.equal(transcriptions, 1);
  assert.equal(reopened.get(id).status, "failed");
  await reopened.retry(id);
  await reopened.drain();
  assert.equal(transcriptions, 1);
  assert.equal(segments[0].text, "Keep me");
});

test("bounds include failed clips and reject excess before upload", async () => {
  const queue = createAudioQueue({
    storage: storage(),
    maxClips: 1,
    transcribe: async () => {
      throw new Error("offline");
    },
    append: async () => {},
  });
  const id = await queue.enqueue(clip());
  await queue.drain();
  await assert.rejects(queue.enqueue(clip()), /backlog is full/);
  assert.equal(queue.capacity(), false);
  await queue.remove(id);
  assert.equal(queue.capacity(), true);
});

test("byte bound rejects oversized clips without retaining/uploading them", async () => {
  let uploaded = false;
  const queue = createAudioQueue({
    storage: storage(),
    maxBytes: 3,
    transcribe: async () => {
      uploaded = true;
      return { text: "" };
    },
    append: async () => {},
  });
  await assert.rejects(queue.enqueue(clip()), /backlog is full/);
  assert.equal(uploaded, false);
});

test("persistence failure retains an in-memory downloadable clip and never uploads", async () => {
  let list,
    uploaded = false;
  const db = storage();
  db.put = async () => {
    throw new Error("disk full");
  };
  const queue = createAudioQueue({
    storage: db,
    onChange: (clips) => (list = clips),
    transcribe: async () => {
      uploaded = true;
      return { text: "" };
    },
    append: async () => {},
  });
  await assert.rejects(queue.enqueue(clip()), /disk full/);
  assert.equal(uploaded, false);
  assert.equal(list[0].status, "failed");
  assert.equal(list[0].durable, false);
  assert.equal(await queue.get(list[0].id).blob.text(), "test audio");
});

test("recovery expires clips after seven days and explicit discard removes persistence", async () => {
  const db = storage(),
    id = crypto.randomUUID();
  await db.put({ ...clip(), id, status: "failed", createdAt: 1 });
  const queue = createAudioQueue({
    storage: db,
    now: () => 8 * 86400000,
    transcribe: async () => ({ text: "" }),
    append: async () => {},
  });
  await queue.initialize();
  assert.equal(queue.get(id), undefined);
  assert.equal(db.rows.size, 0);
});

test("IndexedDB recovery encrypts audio and transcript with a non-exportable key and detects tampering", async (t) => {
  const { encryptedAudioStorage } = await import("../src/audio-queue.mjs");
  const stores = new Map();
  const db = {
    createObjectStore(name) {
      stores.set(name, new Map());
    },
    transaction(name) {
      const tx = { error: null };
      let pending = 0;
      const request = (action) => {
        const result = {};
        pending++;
        queueMicrotask(() => {
          try {
            result.result = structuredClone(action());
            result.onsuccess?.();
          } catch (error) {
            tx.error = error;
            tx.onerror?.();
          }
          pending--;
          setImmediate(() => {
            if (!pending && !tx.error) tx.oncomplete?.();
          });
        });
        return result;
      };
      const rows = stores.get(name);
      tx.objectStore = () => ({
        get: (key) => request(() => rows.get(key)),
        put: (value, key = value.id) =>
          request(() => {
            rows.set(key, structuredClone(value));
            return key;
          }),
        getAll: () => request(() => [...rows.values()]),
        delete: (key) => request(() => rows.delete(key)),
      });
      return tx;
    },
  };
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = {
    open() {
      const request = { result: db };
      queueMicrotask(() => {
        if (!stores.size) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  t.after(() => {
    globalThis.indexedDB = previous;
  });
  const storage = encryptedAudioStorage("account:A"),
    id = crypto.randomUUID();
  await storage.put({
    ...clip(),
    id,
    createdAt: Date.now(),
    status: "failed",
    segments: [
      {
        id: crypto.randomUUID(),
        text: "private transcript",
        duration: 1,
        startedAt: new Date().toISOString(),
      },
    ],
  });
  const row = stores.get("clips").get(id);
  assert.deepEqual(Object.keys(row).sort(), ["data", "id", "iv"]);
  assert.equal(
    Buffer.from(row.data).includes(Buffer.from("private transcript")),
    false,
  );
  const key = stores.get("keys").get("audio");
  assert.equal(key.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("raw", key));
  const reopened = encryptedAudioStorage("account:A");
  const [recovered] = await reopened.list();
  assert.equal(await recovered.blob.text(), "test audio");
  assert.equal(recovered.segments[0].text, "private transcript");
  new Uint8Array(row.data)[0] ^= 1;
  await assert.rejects(reopened.list());
  assert.equal(
    stores.get("clips").size,
    1,
    "authentication failure must preserve the original record",
  );
});

test("backlog pressure preserves one final captured segment in a bounded emergency slot", async () => {
  const queue = createAudioQueue({
    storage: storage(),
    maxClips: 1,
    maxBytes: 10,
    transcribe: async () => {
      throw new Error("offline");
    },
    append: async () => {},
  });
  await queue.enqueue(clip());
  await queue.drain();
  const id = await queue.enqueue({ ...clip(), finalCapture: true });
  assert.equal(queue.get(id).status, "failed");
  assert.match(queue.get(id).error, /final clip was preserved/);
  assert.equal(await queue.get(id).blob.text(), "test audio");
  await assert.rejects(
    queue.enqueue({ ...clip(), finalCapture: true }),
    /backlog is full/,
  );
});

test("audio namespaces require hosted identity and isolate desktop, preview, and accounts", async () => {
  const { audioNamespace, encryptedAudioStorage } =
    await import("../src/audio-queue.mjs");
  assert.equal(audioNamespace({ desktop: false, state: null }), null);
  assert.equal(
    audioNamespace({ desktop: false, state: { storage: "cloud" } }),
    null,
  );
  assert.equal(
    audioNamespace({
      desktop: false,
      state: { storage: "cloud", accountId: "A" },
    }),
    "account:A",
  );
  assert.equal(
    audioNamespace({
      desktop: false,
      state: { storage: "cloud", accountId: "B" },
    }),
    "account:B",
  );
  assert.equal(
    audioNamespace({
      desktop: true,
      state: { storage: "cloud", accountId: "A" },
    }),
    "local",
  );
  assert.equal(audioNamespace({ desktop: true, state: null }), "local");
  assert.equal(audioNamespace({ desktop: false, state: {} }), "preview");
  assert.throws(() => encryptedAudioStorage(""), /namespace is required/);
});

test("account switch pauses an old upload, caches its result, and prevents cross-account append or retry", async () => {
  const db = storage();
  let resolveUpload, uploadStarted;
  const started = new Promise((resolve) => {
    uploadStarted = resolve;
  });
  const response = new Promise((resolve) => {
    resolveUpload = resolve;
  });
  let appends = 0;
  const original = createAudioQueue({
    storage: db,
    transcribe: async () => {
      uploadStarted();
      return response;
    },
    append: async () => {
      appends++;
    },
  });
  const id = await original.enqueue(clip());
  await started;
  original.pause();
  resolveUpload({ text: "Account A private speech" });
  await original.drain();
  assert.equal(appends, 0);
  assert.equal(original.get(id).status, "failed");
  assert.equal(original.get(id).segments[0].text, "Account A private speech");
  await assert.rejects(original.retry(id), /previous account/);
  const resumed = createAudioQueue({
    storage: db,
    transcribe: async () => {
      throw new Error("must use cached transcript");
    },
    append: async () => {
      appends++;
    },
  });
  await resumed.initialize();
  await resumed.retry(id);
  await resumed.drain();
  assert.equal(appends, 1);
});

test("separate IndexedDB namespaces never expose another account clip, and preserve it for sign-in again", async (t) => {
  const { encryptedAudioStorage } = await import("../src/audio-queue.mjs");
  const databases = new Map();
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = {
    open(name) {
      let fresh = false;
      if (!databases.has(name)) {
        databases.set(name, new Map());
        fresh = true;
      }
      const stores = databases.get(name);
      const db = {
        createObjectStore(store) {
          stores.set(store, new Map());
        },
        transaction(storeName) {
          const tx = {};
          let pending = 0;
          const request = (action) => {
            const req = {};
            pending++;
            queueMicrotask(() => {
              try {
                req.result = structuredClone(action());
                req.onsuccess?.();
              } catch (error) {
                tx.error = error;
                tx.onerror?.();
              }
              pending--;
              setImmediate(() => {
                if (!pending && !tx.error) tx.oncomplete?.();
              });
            });
            return req;
          };
          const rows = stores.get(storeName);
          tx.objectStore = () => ({
            get: (key) => request(() => rows.get(key)),
            put: (value, key = value.id) =>
              request(() => rows.set(key, structuredClone(value))),
            getAll: () => request(() => [...rows.values()]),
            delete: (key) => request(() => rows.delete(key)),
          });
          return tx;
        },
      };
      const req = { result: db };
      queueMicrotask(() => {
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  t.after(() => {
    globalThis.indexedDB = previous;
  });
  const a = encryptedAudioStorage("account:A"),
    b = encryptedAudioStorage("account:B");
  const id = crypto.randomUUID();
  await a.put({ ...clip(), id, createdAt: Date.now(), status: "failed" });
  assert.deepEqual(await b.list(), []);
  await b.put({
    ...clip(),
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    status: "failed",
  });
  assert.equal((await encryptedAudioStorage("account:A").list())[0].id, id);
  assert.deepEqual([...databases.keys()].sort(), [
    "lensdesk-pending-audio:account:A",
    "lensdesk-pending-audio:account:B",
  ]);
  assert.notEqual(
    databases.get("lensdesk-pending-audio:account:A").get("keys").get("audio"),
    databases.get("lensdesk-pending-audio:account:B").get("keys").get("audio"),
  );
});
