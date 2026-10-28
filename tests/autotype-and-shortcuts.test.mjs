import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extractCode } = require("../desktop/autotype.cjs");
const { createPreferences } = require("../desktop/preferences.cjs");

test("extractCode extracts code blocks cleanly", () => {
  const md = `Here is a solution for LeetCode Two Sum:
\`\`\`python
def twoSum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        diff = target - num
        if diff in seen:
            return [seen[diff], i]
        seen[num] = i
\`\`\`
This runs in O(N) time.`;

  const extracted = extractCode(md, true);
  assert.equal(
    extracted,
    `def twoSum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        diff = target - num
        if diff in seen:
            return [seen[diff], i]
        seen[num] = i`,
  );

  const full = extractCode(md, false);
  assert.equal(full, md);
});

test("extractCode handles multiple code blocks and plain text", () => {
  const multi = `First block:
\`\`\`typescript
const a: number = 1;
\`\`\`
Second block:
\`\`\`typescript
const b: number = 2;
\`\`\``;

  assert.equal(
    extractCode(multi, true),
    `const a: number = 1;\n\nconst b: number = 2;`,
  );

  const plain = "print('no markdown fences here')";
  assert.equal(extractCode(plain, true), plain);
});

test("desktop preferences preserve required shortcuts and accept disabled optional actions", async (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-prefs-"));
  try {
    const prefs = await createPreferences(tmpDir);
    const initial = prefs.get();

    assert.equal(initial.shortcuts.toggle, "CommandOrControl+Shift+L");
    assert.equal(initial.shortcuts.hide, "Shift+H");
    assert.equal(initial.shortcuts.capture, "CommandOrControl+Shift+S");
    assert.equal(initial.shortcuts.overlay, "CommandOrControl+Shift+O");
    assert.equal(initial.shortcuts.hideAnswer, "CommandOrControl+Shift+A");
    assert.equal(initial.shortcuts.autoType, "CommandOrControl+Shift+T");
    assert.equal(initial.shortcuts.clickThrough, "Shift+M");
    assert.equal(initial.stealthDock, false);
    assert.equal(initial.shortcuts.browser, "");
    assert.equal(initial.shortcuts.theme, "");
    assert.equal(initial.shortcuts.moveLeft, "");
    assert.equal(initial.autoType.speed, "human");
    assert.equal(initial.autoType.codeOnly, true);
    assert.equal(initial.autoType.delaySeconds, 1);
    assert.deepEqual(initial.browser, {
      homePage: "https://www.google.com/",
      searchEngine: "google",
      zoom: 1,
    });

    // Custom shortcuts and options save cleanly
    await prefs.save({
      ...initial,
      shortcuts: {
        ...initial.shortcuts,
        hide: "CommandOrControl+Alt+H",
        hideAnswer: "CommandOrControl+Alt+A",
        autoType: "CommandOrControl+Alt+T",
        browser: "CommandOrControl+Shift+B",
      },
      autoType: {
        speed: "turbo",
        codeOnly: false,
        delaySeconds: 2.5,
      },
      browser: {
        homePage: "https://example.com/start",
        searchEngine: "duckduckgo",
        zoom: 1.25,
      },
    });

    const updated = prefs.get();
    assert.equal(updated.shortcuts.hide, "CommandOrControl+Alt+H");
    assert.equal(updated.shortcuts.hideAnswer, "CommandOrControl+Alt+A");
    assert.equal(updated.shortcuts.autoType, "CommandOrControl+Alt+T");
    assert.equal(updated.shortcuts.browser, "CommandOrControl+Shift+B");
    assert.equal(updated.autoType.speed, "turbo");
    assert.equal(updated.autoType.codeOnly, false);
    assert.equal(updated.autoType.delaySeconds, 2.5);
    assert.deepEqual(updated.browser, {
      homePage: "https://example.com/start",
      searchEngine: "duckduckgo",
      zoom: 1.25,
    });

    // Rejects duplicate shortcuts
    await assert.rejects(
      prefs.save({
        ...updated,
        shortcuts: {
          ...updated.shortcuts,
          capture: updated.shortcuts.toggle,
        },
      }),
      /different shortcut/,
    );
    await assert.rejects(
      prefs.save({
        ...updated,
        browser: { ...updated.browser, homePage: "file:///etc/passwd" },
      }),
      /HTTP or HTTPS/,
    );
    await assert.rejects(
      prefs.save({ ...updated, browser: { ...updated.browser, zoom: 3 } }),
      /between 50% and 250%/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("legacy hide and click-through defaults migrate to the universal Shift keys", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-prefs-migrate-"));
  try {
    const prefs = await createPreferences(tmpDir);
    const initial = prefs.get();
    await prefs.save({
      ...initial,
      shortcuts: {
        ...initial.shortcuts,
        hide: "CommandOrControl+Shift+H",
        clickThrough: "CommandOrControl+Shift+X",
      },
    });
    const migrated = prefs.get();
    assert.equal(migrated.shortcuts.hide, "Shift+H");
    assert.equal(migrated.shortcuts.clickThrough, "Shift+M");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("autotype exports typeWindows and validates cross-platform options", async () => {
  const { autoType, typeWindows, paste } = require("../desktop/autotype.cjs");
  assert.equal(typeof typeWindows, "function");
  assert.equal(typeof paste, "function");

  // Invalid speed rejected
  await assert.rejects(
    autoType({ text: "test", speed: "invalid" }),
    /Invalid auto-typing options/,
  );

  // Invalid delay rejected
  await assert.rejects(
    autoType({ text: "test", delaySeconds: -1 }),
    /Invalid auto-typing options/,
  );

  // Empty text rejected
  await assert.rejects(
    autoType({ text: "   " }),
    /Provide between 1 and 20,000 characters/,
  );
});

test("preload exposes desktop.focusWindow", () => {
  const fs = require("node:fs");
  const preloadSrc = fs.readFileSync(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  assert.ok(preloadSrc.includes('"desktop.focusWindow"'));
});

test("preload exposes accessibility and settings actions and convenience methods", () => {
  const fs = require("node:fs");
  const preloadSrc = fs.readFileSync(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  assert.ok(preloadSrc.includes('"desktop.openAccessibilitySettings"'));
  assert.ok(preloadSrc.includes('"desktop.openSettings"'));
  assert.ok(preloadSrc.includes('openScreenSettings:'));
  assert.ok(preloadSrc.includes('openAccessibilitySettings:'));
  assert.ok(preloadSrc.includes('openSettings:'));
  assert.ok(preloadSrc.includes('relaunch:'));
  assert.ok(preloadSrc.includes('capture:'));
});

test("native module exports isSameApplication and startForegroundHook", () => {
  const nativeMod = require("../native/index.cjs");
  assert.equal(typeof nativeMod.isSameApplication, "function");
  assert.equal(typeof nativeMod.startForegroundHook, "function");
  assert.equal(typeof nativeMod.stopForegroundHook, "function");
  assert.equal(typeof nativeMod.getLastForegroundHwnd, "function");
  assert.equal(typeof nativeMod.isSecureEventInputEnabled, "function");
  assert.equal(typeof nativeMod.isSecureEventInputEnabled(), "boolean");
  // Reflexivity check: same pid is always same application
  assert.equal(nativeMod.isSameApplication(1234, 1234), true);
  // Zero / negative pids are false
  assert.equal(nativeMod.isSameApplication(0, 0), false);
  assert.equal(nativeMod.isSameApplication(0, 1234), false);
});
