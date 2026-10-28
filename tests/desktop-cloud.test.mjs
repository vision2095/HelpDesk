import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { createCloudClient } = createRequire(import.meta.url)(
  "../desktop/cloud.cjs",
);
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fixture(t, fetchImpl, options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "lensdesk-cloud-client-"),
  );
  t.after(() => {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  });
  const params = {
    directory,
    encrypt: (text) => Buffer.from("sealed:" + text),
    decrypt: (bytes) => bytes.toString().replace(/^sealed:/, ""),
    fetchImpl,
    ...options,
  };
  return { client: createCloudClient(params), directory, params };
}
test("same-origin configuration keeps sign-in; different server clears it", async (t) => {
  const calls = [];
  const { client } = fixture(t, async (url, options) => {
    calls.push({ url, options });
    return response({ user: { id: "user" }, token: "session" });
  });
  client.configure("https://example.com");
  await client.request("auth.login");
  client.configure("https://example.com/");
  await client.request("cloud.public");
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer session");
  client.configure("https://other.example.com");
  await client.request("cloud.public");
  assert.equal(calls.at(-1).options.headers.Authorization, undefined);
});
test("late login response cannot attach credentials to another server", async (t) => {
  let finish;
  const { client } = fixture(
    t,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  client.configure("https://first.example.com");
  const pending = client.request("auth.login");
  client.configure("https://second.example.com");
  finish(response({ user: { id: "user" }, token: "first-server-token" }));
  await assert.rejects(pending, /connection changed/);
  assert.equal((await client.request("cloud.state")).user, null);
});
test("offline logout clears persisted credential and reports server revocation unknown", async (t) => {
  let offline = false;
  const f = fixture(t, async () => {
    if (offline) throw new Error("offline");
    return response({ user: { id: "user" }, token: "session" });
  });
  f.client.configure("https://example.com");
  await f.client.request("auth.login");
  offline = true;
  assert.deepEqual(await f.client.request("auth.logout"), {
    ok: true,
    serverRevoked: false,
  });
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.directory, "cloud.json"))).token,
    "",
  );
  assert.equal((await f.client.request("cloud.state")).user, null);
});
test("corrupt connection file does not prevent local desktop startup", async (t) => {
  const f = fixture(t, async () => response({}));
  fs.writeFileSync(path.join(f.directory, "cloud.json"), "{broken");
  const client = createCloudClient(f.params);
  assert.match(
    (await client.request("cloud.state")).configurationError,
    /could not be read/,
  );
  assert.equal(
    fs.readFileSync(path.join(f.directory, "cloud.json"), "utf8"),
    "{broken",
  );
  client.configure("https://example.com");
  assert.equal(
    (await client.request("cloud.state")).configurationError,
    undefined,
  );
});
test("token persistence failure cannot create an in-memory signed-in session", async (t) => {
  const calls = [];
  const { client } = fixture(
    t,
    async (url, options) => {
      calls.push(options);
      return response({ user: { id: "user" }, token: "session" });
    },
    {
      encrypt: () => {
        throw new Error("encryption unavailable");
      },
    },
  );
  client.configure("https://example.com");
  await assert.rejects(client.request("auth.login"), /encryption unavailable/);
  await client.request("cloud.public");
  assert.equal(calls.at(-1).headers.Authorization, undefined);
});
test("401 and explicit session revocation clear invalid credentials", async (t) => {
  let status = 200;
  const { client } = fixture(t, async () =>
    status === 200
      ? response({ user: { id: "user" }, token: "session" })
      : response({ error: "Session expired" }, 401),
  );
  client.configure("https://example.com");
  await client.request("auth.login");
  status = 401;
  await assert.rejects(client.request("account.sessions"), /Session expired/);
  assert.equal((await client.request("cloud.state")).user, null);
});
test("desktop login detects incompatible cookie-only server and cancellation is accurate", async (t) => {
  const { client } = fixture(t, async () => response({ user: { id: "user" } }));
  client.configure("https://example.com");
  await assert.rejects(
    client.request("auth.login"),
    /did not issue a desktop session/,
  );
  const abort = new AbortController();
  abort.abort();
  const second = fixture(t, async () => {
    throw new Error("aborted");
  }).client;
  second.configure("https://example.com");
  await assert.rejects(
    second.request("cloud.public", {}, { signal: abort.signal }),
    /canceled/,
  );
});
test("connection rejects insecure origins and unsupported path prefixes", (t) => {
  const { client } = fixture(t, async () => response({}));
  assert.throws(() => client.configure("http://example.com"), /HTTPS/);
  assert.throws(
    () => client.configure("https://example.com/subpath"),
    /without a path/,
  );
});
