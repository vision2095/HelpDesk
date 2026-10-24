import test from "node:test";
import assert from "node:assert/strict";
import { detectLocalModels, localServers } from "../server/local-models.mjs";

test("local detection probes only fixed loopback model lists, never sends credentials, and reports partial failures", async () => {
  const calls = [];
  const result = await detectLocalModels({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes(":11434/"))
        return Response.json({
          data: [
            { id: "llama" },
            { id: "llama" },
            { id: null },
            { id: "a".repeat(101) },
          ],
        });
      if (url.includes(":1234/")) return Response.json({ data: [] });
      if (url.includes(":8080/"))
        return Response.json({ error: "unauthorized" }, { status: 401 });
      throw new Error("Connection refused");
    },
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    localServers.map((server) => server.baseUrl + "/models"),
  );
  for (const { options } of calls) {
    assert.equal(options.redirect, "error");
    assert.equal(options.headers, undefined);
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.deepEqual(
    result.servers.map((server) => server.models),
    [[{ id: "llama", name: "llama" }], []],
  );
  assert.equal(result.unavailable.length, 2);
});

test("local detection rejects oversized or incompatible lists and propagates cancellation", async () => {
  const result = await detectLocalModels({
    fetchImpl: async (url) =>
      url.includes(":11434/")
        ? new Response("x".repeat(1024 * 1024 + 1))
        : Response.json({ notModels: [] }),
  });
  assert.equal(result.servers.length, 0);
  assert.match(result.unavailable[0].error, /1 MB/);
  assert.match(result.unavailable[1].error, /compatible model list/);
  const controller = new AbortController();
  controller.abort(new Error("User canceled"));
  await assert.rejects(
    detectLocalModels({
      signal: controller.signal,
      fetchImpl: async () => {
        controller.signal.throwIfAborted();
      },
    }),
    /User canceled/,
  );
});
