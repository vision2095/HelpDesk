/** Bounded, retryable clips. Provider responses are cached before transcript append. */
export function createAudioQueue({
  storage,
  transcribe,
  append,
  onChange = () => {},
  maxClips = 8,
  maxBytes = 40_000_000,
  now = Date.now,
}) {
  const clips = new Map();
  let running = false,
    paused = false;
  const assertActive = () => {
    if (paused)
      throw new Error(
        "Audio belongs to a previous account. Sign in again to retry it.",
      );
  };
  const publish = () =>
    onChange(
      [...clips.values()].map(({ blob, ...clip }) => ({
        ...clip,
        bytes: blob.size,
      })),
    );
  const persist = async (clip) => {
    await storage.put(clip);
    clip.durable = true;
  };
  async function pump() {
    if (running || paused) return;
    running = true;
    try {
      for (const clip of clips.values()) {
        if (clip.status !== "queued") continue;
        clip.status = "processing";
        publish();
        try {
          // Save raw audio before any upload, and the response before any append.
          await persist(clip);
          assertActive();
          if (!clip.segments) {
            const result = await transcribe(clip);
            const text = result.text.trim();
            clip.segments = [];
            for (let offset = 0; offset < text.length; offset += 9000)
              clip.segments.push({
                id: crypto.randomUUID(),
                text: text.slice(offset, offset + 9000),
                startedAt: clip.startedAt,
                duration:
                  offset === 0 ? result.durationSeconds || clip.duration : 0,
              });
            await persist(clip);
          }
          for (const segment of clip.segments) {
            assertActive();
            await append(clip.sessionId, segment);
          }
          await storage.remove(clip.id);
          clips.delete(clip.id);
        } catch (error) {
          clip.status = "failed";
          clip.error = error.message || "Audio could not be processed.";
          try {
            await persist(clip);
          } catch {
            clip.durable = false;
            clip.error +=
              " Local recovery storage is unavailable; download this clip before closing.";
          }
        }
        publish();
      }
    } finally {
      running = false;
      publish();
      if (
        !paused &&
        [...clips.values()].some((clip) => clip.status === "queued")
      )
        void pump();
    }
  }
  return {
    pause() {
      paused = true;
    },
    async initialize() {
      for (const clip of await storage.list()) {
        if (now() - clip.createdAt > 7 * 86400000) {
          await storage.remove(clip.id);
          continue;
        }
        clip.status = "failed";
        clip.durable = true;
        clip.error =
          "Recovered audio. Retry when the original session is available.";
        clips.set(clip.id, clip);
      }
      publish();
    },
    async enqueue({
      blob,
      sessionId,
      startedAt = new Date().toISOString(),
      duration = 0,
      finalCapture = false,
    }) {
      const bytes = [...clips.values()].reduce(
        (n, clip) => n + clip.blob.size,
        0,
      );
      const full = clips.size >= maxClips || bytes + blob.size > maxBytes;
      // One bounded emergency slot preserves the final already-recorded segment.
      // Ordinary imports remain on disk with the user when they exceed the queue.
      const emergency =
        full &&
        finalCapture &&
        clips.size <= maxClips &&
        bytes <= maxBytes &&
        blob.size <= 20_000_000;
      if (full && !emergency)
        throw new Error(
          "Audio backlog is full. Retry, download, or discard pending clips before recording again.",
        );
      const clip = {
        id: crypto.randomUUID(),
        blob,
        sessionId,
        startedAt,
        duration,
        createdAt: now(),
        status: emergency || paused ? "failed" : "queued",
        ...(paused
          ? {
              error:
                "Capture retained for the previous account. Sign in again to retry it.",
            }
          : {}),
        ...(emergency
          ? {
              error:
                "Recording stopped because the backlog is full. This final clip was preserved; retry or download it.",
            }
          : {}),
        durable: false,
      };
      clips.set(clip.id, clip);
      publish();
      try {
        await persist(clip);
      } catch (error) {
        clip.status = "failed";
        clip.error =
          "Local recovery storage is unavailable. Download this clip before closing.";
        publish();
        throw error;
      }
      void pump();
      return clip.id;
    },
    async retry(id) {
      assertActive();
      const clip = clips.get(id);
      if (clip?.status === "failed") {
        clip.status = "queued";
        delete clip.error;
        publish();
        await pump();
      }
    },
    async remove(id) {
      const clip = clips.get(id);
      if (!clip || clip.status !== "failed") return;
      await storage.remove(id);
      clips.delete(id);
      publish();
    },
    get(id) {
      return clips.get(id);
    },
    capacity() {
      return (
        clips.size < maxClips &&
        [...clips.values()].reduce((n, clip) => n + clip.blob.size, 0) <
          maxBytes
      );
    },
    // Resolves when the current pump completes, for deterministic queue tests.
    async drain() {
      while (running) await new Promise((resolve) => setTimeout(resolve, 1));
    },
  };
}

/** AES-GCM protects clip contents at rest; the non-exportable key lives in IndexedDB. */
export function audioNamespace({ desktop, state }) {
  if (desktop) return "local";
  if (!state) return null;
  if (state.storage === "cloud")
    return state.accountId ? `account:${state.accountId}` : null;
  return "preview";
}
export function encryptedAudioStorage(namespace) {
  if (!namespace || typeof namespace !== "string")
    throw new Error("An audio recovery namespace is required.");
  let ready;
  const open = () =>
    (ready ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(`lensdesk-pending-audio:${namespace}`, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("clips", { keyPath: "id" });
        request.result.createObjectStore("keys");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new Error("Close other LensDesk tabs to enable audio recovery."),
        );
    }));
  async function transaction(storeName, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = action(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error("Audio recovery storage failed."));
    });
  }
  let keyPromise;
  const key = () =>
    (keyPromise ||= (async () => {
      const existing = await transaction("keys", "readonly", (store) =>
        store.get("audio"),
      );
      if (existing) return existing;
      const generated = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      // Serialize compare-and-store to avoid two tabs replacing each other's encryption key.
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("keys", "readwrite"),
          store = tx.objectStore("keys"),
          request = store.get("audio");
        let selected;
        request.onsuccess = () => {
          selected = request.result || generated;
          if (!request.result) store.put(selected, "audio");
        };
        tx.oncomplete = () => resolve(selected);
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    })());
  return {
    async put(clip) {
      const { blob, ...metadata } = clip;
      const payload = JSON.stringify({
        ...metadata,
        mime: blob.type,
        audio: await blobToBase64(blob),
      });
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(clip.id),
        },
        await key(),
        new TextEncoder().encode(payload),
      );
      await transaction("clips", "readwrite", (store) =>
        store.put({ id: clip.id, iv, data }),
      );
    },
    async list() {
      const rows = await transaction("clips", "readonly", (store) =>
        store.getAll(),
      );
      const result = [];
      for (const row of rows) {
        const plaintext = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: row.iv,
            additionalData: new TextEncoder().encode(row.id),
          },
          await key(),
          row.data,
        );
        const { audio, mime, ...metadata } = JSON.parse(
          new TextDecoder().decode(plaintext),
        );
        result.push({
          ...metadata,
          blob: new Blob(
            [Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))],
            { type: mime },
          ),
        });
      }
      return result;
    },
    remove(id) {
      return transaction("clips", "readwrite", (store) => store.delete(id));
    },
  };
}
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32768)
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return btoa(binary);
}
