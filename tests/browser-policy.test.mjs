import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { browserURL, createBrowser } = createRequire(import.meta.url)(
  "../desktop/browser.cjs",
);
test("embedded browser accepts web addresses, normalizes hosts and searches text", () => {
  assert.equal(browserURL("example.com/path"), "https://example.com/path");
  assert.equal(browserURL("http://127.0.0.1:1234/"), "http://127.0.0.1:1234/");
  assert.equal(
    browserURL("explain event loop"),
    "https://www.google.com/search?q=explain%20event%20loop",
  );
  assert.equal(browserURL(""), "https://www.google.com/");
  assert.equal(
    browserURL("local llm", {
      homePage: "https://example.com/home",
      searchEngine: "bing",
    }),
    "https://www.bing.com/search?q=local%20llm",
  );
  assert.equal(
    browserURL("", { homePage: "https://example.com/home" }),
    "https://example.com/home",
  );
});
test("embedded browser rejects executable/local schemes, credentials and invalid input", () => {
  for (const input of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<h1>test</h1>",
    "https://user:secret@example.com",
    "ftp://example.com",
    null,
    {},
    "x".repeat(8001),
  ])
    assert.throws(() => browserURL(input));
});

test("embedded browser clearing removes only its session cookies, cache and site storage", async () => {
  const calls = [];
  const browserSession = {
    clearStorageData: async (options) => calls.push(["storage", options]),
    clearCache: async () => calls.push(["cache"]),
    clearAuthCache: async () => calls.push(["auth"]),
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    on() {},
    removeListener() {},
  };
  const browser = createBrowser({
    WebContentsView: class {},
    browserSession,
    getWindow: () => null,
    dialog: {},
    downloadDirectory: "/tmp",
  });
  await browser.dispatch("clearData");
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["storage", "cache", "auth"],
  );
  assert.ok(calls[0][1].storages.includes("cookies"));
  assert.ok(calls[0][1].storages.includes("localstorage"));
  assert.ok(calls[0][1].storages.includes("serviceworkers"));
});
