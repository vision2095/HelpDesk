import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
export class ConflictError extends Error {
  constructor(
    message = "This item changed on another device. Reload it before saving.",
    current,
  ) {
    super(message);
    this.name = "ConflictError";
    this.code = "CONFLICT";
    this.current = current;
  }
}
export function createWorkspaceStore({
  directory,
  encrypt,
  decrypt,
  initial,
  legacy,
  beforeCommit,
  maxBytes = 100 * 1024 * 1024,
}) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "workspace.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA secure_delete=ON;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,payload BLOB NOT NULL,summary BLOB NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(kind,id));
 CREATE INDEX IF NOT EXISTS entities_recent ON entities(kind,deleted,updated_at DESC,id);
 CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,payload BLOB NOT NULL,bytes INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,operation TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,payload BLOB NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id,version));
 CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,payload BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
 INSERT OR IGNORE INTO metadata VALUES('schema','3');DELETE FROM history WHERE kind='credentials';`);
  const encode = (value) => {
    const text = JSON.stringify(value);
    return encrypt
      ? Buffer.concat([Buffer.from([1]), encrypt(text)])
      : Buffer.concat([Buffer.from([0]), Buffer.from(text)]);
  };
  const decode = (buffer) => {
    buffer = Buffer.from(buffer);
    if (buffer[0] === 1) {
      if (!decrypt)
        throw new Error(
          "This encrypted workspace requires the account or OS encryption key.",
        );
      return JSON.parse(decrypt(buffer.subarray(1)));
    }
    if (buffer[0] !== 0)
      throw new Error(
        "Workspace record is damaged. Restore a recovery snapshot.",
      );
    return JSON.parse(buffer.subarray(1).toString("utf8"));
  };
  const rev = () =>
    Number(
      db.prepare("SELECT COALESCE(MAX(seq),0) AS revision FROM changes").get()
        .revision,
    );
  function hydrate(entity) {
    if (entity?.messages)
      for (const message of entity.messages)
        if (message.images)
          message.images = message.images.map((value) => {
            if (typeof value === "string") return value;
            const row = db
              .prepare("SELECT payload FROM assets WHERE id=?")
              .get(value.asset);
            if (!row)
              throw new Error(
                "A screenshot attachment is missing. Restore a backup.",
              );
            return decode(row.payload);
          });
    return entity;
  }
  function pack(entity) {
    const copy = structuredClone(entity);
    if (copy?.messages)
      for (const message of copy.messages)
        if (message.images)
          message.images = message.images.map((value) => {
            if (typeof value !== "string") return value;
            const id = createHash("sha256").update(value).digest("hex");
            if (!db.prepare("SELECT id FROM assets WHERE id=?").get(id)) {
              const data = encode(value);
              db.prepare("INSERT INTO assets VALUES(?,?,?)").run(
                id,
                data,
                data.length,
              );
            }
            return { asset: id };
          });
    return copy;
  }
  function raw(kind, id) {
    const row = db
      .prepare("SELECT * FROM entities WHERE kind=? AND id=?")
      .get(kind, id);
    return row && !row.deleted ? row : null;
  }
  function get(kind, id) {
    const row = raw(kind, id);
    return row
      ? { ...hydrate(decode(row.payload)), version: row.version }
      : null;
  }
  function list(kind, { limit = 10000, offset = 0, summary = false } = {}) {
    return db
      .prepare(
        "SELECT * FROM entities WHERE kind=? AND deleted=0 ORDER BY updated_at DESC,id LIMIT ? OFFSET ?",
      )
      .all(kind, Math.min(10000, Math.max(1, limit)), Math.max(0, offset))
      .map((row) => ({
        ...(summary ? decode(row.summary) : hydrate(decode(row.payload))),
        version: row.version,
        ...(summary ? { loaded: false } : {}),
      }));
  }
  function summaryFor(kind, value) {
    if (kind !== "session") return value;
    return {
      id: value.id,
      title: value.title,
      mode: value.mode,
      profileId: value.profileId,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      endedAt: value.endedAt,
      notes: "",
      transcript: "",
      messages: [],
      messageCount: value.messages.length,
      hasTranscript: Boolean(value.transcript),
      preview:
        value.messages.find((m) => m.role === "user")?.content.slice(0, 180) ||
        "",
      activeSeconds: value.activeSeconds || 0,
      activeSince: value.activeSince,
    };
  }
  function write(kind, id, value, expectedVersion, { remove = false } = {}) {
    const row = db
      .prepare("SELECT * FROM entities WHERE kind=? AND id=?")
      .get(kind, id);
    const currentVersion = row?.version || 0;
    if (expectedVersion !== undefined && expectedVersion !== currentVersion)
      throw new ConflictError(undefined, get(kind, id));
    const version = currentVersion + 1,
      updatedAt = new Date().toISOString();
    const next = { ...value, id, version, updatedAt };
    const payload = encode(pack(next)),
      summary = encode(summaryFor(kind, next));
    if (row && kind !== "credentials")
      db.prepare("INSERT OR IGNORE INTO history VALUES(?,?,?,?,?)").run(
        kind,
        id,
        row.version,
        row.payload,
        row.updated_at,
      );
    db.prepare(
      "DELETE FROM history WHERE kind=? AND id=? AND version NOT IN (SELECT version FROM history WHERE kind=? AND id=? ORDER BY version DESC LIMIT 30)",
    ).run(kind, id, kind, id);
    db.prepare(
      "INSERT INTO entities VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at,deleted=excluded.deleted,payload=excluded.payload,summary=excluded.summary,bytes=excluded.bytes",
    ).run(
      kind,
      id,
      version,
      updatedAt,
      remove ? 1 : 0,
      payload,
      summary,
      payload.length + summary.length,
    );
    db.prepare(
      "INSERT INTO changes(kind,id,version,operation,updated_at) VALUES(?,?,?,?,?)",
    ).run(kind, id, version, remove ? "delete" : "upsert", updatedAt);
    return remove ? { id, version, deleted: true } : next;
  }
  function transaction(operation) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      const size = db
        .prepare(
          "SELECT (SELECT COALESCE(SUM(bytes),0) FROM entities)+(SELECT COALESCE(SUM(bytes),0) FROM assets)+(SELECT COALESCE(SUM(length(payload)),0) FROM history)+(SELECT COALESCE(SUM(length(payload)),0) FROM snapshots) AS bytes",
        )
        .get().bytes;
      if (size > maxBytes)
        throw new Error(
          "Workspace storage limit reached. Export and remove old sessions or attachments.",
        );
      beforeCommit?.();
      db.exec("COMMIT");
      return structuredClone(result);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function save(kind, id, value, expectedVersion) {
    return transaction(() => write(kind, id, value, expectedVersion));
  }
  function mutate(kind, id, fn, { expectedVersion } = {}) {
    return transaction(() => {
      const current = get(kind, id);
      return write(
        kind,
        id,
        fn(current),
        expectedVersion ?? current?.version ?? 0,
      );
    });
  }
  function remove(kind, id, expectedVersion) {
    return transaction(() => {
      const current = get(kind, id);
      if (!current) return { ok: true };
      write(kind, id, current, expectedVersion ?? current.version, {
        remove: true,
      });
      return { ok: true };
    });
  }
  function load() {
    return {
      sessions: list("session"),
      profiles: list("profile"),
      settings: get("settings", "settings"),
      revision: rev(),
    };
  }
  function snapshot() {
    const id = randomUUID(),
      createdAt = new Date().toISOString();
    db.prepare("INSERT INTO snapshots VALUES(?,?,?)").run(
      id,
      createdAt,
      encode({
        sessions: db
          .prepare(
            "SELECT payload FROM entities WHERE kind='session' AND deleted=0",
          )
          .all()
          .map((r) => decode(r.payload)),
        profiles: db
          .prepare(
            "SELECT payload FROM entities WHERE kind='profile' AND deleted=0",
          )
          .all()
          .map((r) => decode(r.payload)),
        settings: get("settings", "settings"),
      }),
    );
    db.prepare(
      "DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 10)",
    ).run();
    return id;
  }
  function replace(state, { expectedRevision } = {}) {
    return transaction(() => {
      if (expectedRevision !== undefined && expectedRevision !== rev())
        throw new ConflictError(
          "The workspace changed before restore. Review the latest version.",
        );
      snapshot();
      for (const kind of ["session", "profile"]) {
        const incoming = state[kind === "session" ? "sessions" : "profiles"];
        const ids = new Set(incoming.map((e) => e.id));
        for (const old of list(kind))
          if (!ids.has(old.id))
            write(kind, old.id, old, old.version, { remove: true });
        for (const value of incoming) write(kind, value.id, value, undefined);
      }
      write("settings", "settings", state.settings, undefined);
      return load();
    });
  }
  if (!raw("settings", "settings")) {
    transaction(() => {
      const data = legacy || initial();
      for (const s of data.sessions) write("session", s.id, s);
      for (const p of data.profiles) write("profile", p.id, p);
      write("settings", "settings", data.settings);
    });
    if (legacy) {
      const source = path.join(directory, "workspace.json");
      const backup = encode(legacy);
      fs.writeFileSync(source + ".migrated", backup, { mode: 0o600 });
      fs.unlinkSync(source);
    }
  }
  function acquireLease(id, ttl = 120000) {
    const owner = randomUUID();
    transaction(() => {
      const existing = db.prepare("SELECT * FROM leases WHERE id=?").get(id);
      if (existing && existing.expires > Date.now())
        throw new Error("An answer is already in progress.");
      db.prepare(
        "INSERT INTO leases VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires",
      ).run(id, owner, Date.now() + ttl);
    });
    const timer = setInterval(() => {
      try {
        db.prepare("UPDATE leases SET expires=? WHERE id=? AND owner=?").run(
          Date.now() + ttl,
          id,
          owner,
        );
      } catch {}
    }, 30000);
    timer.unref();
    return () => {
      clearInterval(timer);
      db.prepare("DELETE FROM leases WHERE id=? AND owner=?").run(id, owner);
    };
  }
  function isLeased(id) {
    return Boolean(
      db
        .prepare("SELECT id FROM leases WHERE id=? AND expires>?")
        .get(id, Date.now()),
    );
  }
  function changes(since = 0, limit = 100) {
    const rows = db
      .prepare(
        "SELECT * FROM changes WHERE seq>? AND kind IN ('session','profile','settings') ORDER BY seq LIMIT ?",
      )
      .all(since, Math.min(500, Math.max(1, limit)));
    return {
      changes: rows.map((row) => ({
        ...row,
        entity: row.operation === "delete" ? null : get(row.kind, row.id),
      })),
      cursor:
        rows.length < Math.min(500, Math.max(1, limit))
          ? rev()
          : (rows.at(-1)?.seq ?? since),
      head: rev(),
    };
  }
  function search(query, { limit = 30, offset = 0 } = {}) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const matches = [];
    for (const row of db
      .prepare(
        "SELECT * FROM entities WHERE kind='session' AND deleted=0 ORDER BY updated_at DESC",
      )
      .iterate()) {
      const data = decode(row.payload);
      const text = [
        data.title,
        data.notes,
        data.transcript,
        ...data.messages.map((m) => m.content),
      ]
        .join(" ")
        .toLowerCase();
      if (terms.every((term) => text.includes(term)))
        matches.push({
          ...decode(row.summary),
          version: row.version,
          loaded: false,
        });
      if (matches.length >= offset + limit + 1) break;
    }
    return {
      sessions: matches.slice(offset, offset + limit),
      hasMore: matches.length > offset + limit,
    };
  }
  return {
    db,
    get,
    list,
    save,
    mutate,
    remove,
    load,
    replace,
    revision: rev,
    changes,
    search,
    transaction,
    write,
    encode,
    decode,
    summaryFor,
    snapshots: () =>
      db
        .prepare(
          "SELECT id,created_at AS createdAt FROM snapshots ORDER BY created_at DESC",
        )
        .all(),
    restoreSnapshot(id) {
      const row = db
        .prepare("SELECT payload FROM snapshots WHERE id=?")
        .get(id);
      if (!row) throw new Error("Recovery snapshot not found.");
      return replace(decode(row.payload));
    },
    history(kind, id) {
      return db
        .prepare(
          "SELECT version,updated_at AS updatedAt FROM history WHERE kind=? AND id=? ORDER BY version DESC LIMIT 30",
        )
        .all(kind, id);
    },
    restoreVersion(kind, id, version) {
      const row = db
        .prepare(
          "SELECT payload FROM history WHERE kind=? AND id=? AND version=?",
        )
        .get(kind, id, version);
      if (!row) throw new Error("Revision not found.");
      return save(
        kind,
        id,
        hydrate(decode(row.payload)),
        get(kind, id)?.version || 0,
      );
    },
    acquireLease,
    isLeased,
    close() {
      db.close();
    },
  };
}
