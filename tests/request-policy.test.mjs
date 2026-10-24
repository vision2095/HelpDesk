import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { createRequestPolicy } = createRequire(import.meta.url)("../desktop/request-policy.cjs");
const entryURL = "file:///C:/Users/Vivek/AppData/Local/Temp/LensDesk/resources/app.asar/dist/index.html";
const windows = createRequestPolicy({ entryURL, platform: "win32" });

test("Windows renderer URLs accept equivalent path casing and encoding", () => {
  assert.equal(windows.trusted(entryURL), true);
  assert.equal(windows.trusted(entryURL.replace("C:", "c:").replace("Vivek", "vivek") + "#settings"), true);
  assert.equal(windows.trusted(entryURL.replace("LensDesk", "%4censDesk")), true);
  const spaces = createRequestPolicy({ entryURL: entryURL.replace("Vivek", "Vivek%20Verma"), platform: "win32" });
  assert.equal(spaces.trusted(entryURL.replace("Vivek", "Vivek Verma")), true);
});
test("renderer trust rejects remote pages, different files, queries and malformed URLs", () => {
  for (const url of ["https://example.com", "about:blank", "invalid", entryURL + "?x=1", entryURL.replace("index.html", "other.html"), entryURL.replace("C:", "D:"), entryURL.replace("dist/", "dist%2f"), "file://attacker/share/index.html"]) {
    assert.equal(windows.trusted(url), false, url);
  }
});
test("macOS paths remain case sensitive and development only trusts the configured origin", () => {
  const mac = createRequestPolicy({ entryURL: "file:///Applications/LensDesk.app/index.html", platform: "darwin" });
  assert.equal(mac.trusted("file:///Applications/LensDesk.app/index.html#settings"), true);
  assert.equal(mac.trusted("file:///applications/LensDesk.app/index.html"), false);
  const dev = createRequestPolicy({ dev: true });
  assert.equal(dev.trusted("http://127.0.0.1:5173/settings"), true);
  assert.equal(dev.trusted("http://127.0.0.1:5174/"), false);
});
test("IPC accepts equivalent main-frame wrappers but rejects subframes and other windows", () => {
  const frame = { processId: 10, routingId: 2, url: entryURL, isDestroyed: () => false };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: { ...frame, url: entryURL.replace("C:", "c:") } };
  assert.equal(windows.allows(event, window), true);
  for (const patch of [{ routingId: 3 }, { processId: 11 }, { url: "https://example.com" }, { isDestroyed: () => true }]) {
    assert.equal(windows.allows({ ...event, senderFrame: { ...frame, ...patch } }, window), false);
  }
  assert.equal(windows.allows({ ...event, sender: {} }, window), false);
  assert.equal(windows.allows({ ...event, senderFrame: null }, window), false);
  assert.equal(windows.allows(event, null), false);
});
