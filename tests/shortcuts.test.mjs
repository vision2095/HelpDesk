import test from "node:test";
import assert from "node:assert/strict";
import { matchesShortcut } from "../src/shortcuts.mjs";
test("web shortcut matching preserves Command versus Control, arrow names and exact modifier sets", () => {
  assert.equal(
    matchesShortcut(
      { key: "h", metaKey: true, shiftKey: true },
      "CommandOrControl+Shift+H",
      true,
    ),
    true,
  );
  assert.equal(
    matchesShortcut({ key: "h", shiftKey: true }, "Shift+H", true),
    true,
  );
  assert.equal(
    matchesShortcut({ key: "m", shiftKey: true }, "Shift+M", true),
    true,
  );
  assert.equal(
    matchesShortcut(
      { key: "m", metaKey: true, shiftKey: true },
      "Shift+M",
      true,
    ),
    false,
  );
  assert.equal(
    matchesShortcut(
      { key: "h", ctrlKey: true, shiftKey: true },
      "CommandOrControl+Shift+H",
      true,
    ),
    false,
  );
  assert.equal(
    matchesShortcut({ key: "h", metaKey: true }, "Control+H", true),
    false,
  );
  assert.equal(
    matchesShortcut(
      { key: "ArrowUp", ctrlKey: true, shiftKey: true },
      "Control+Shift+Up",
    ),
    true,
  );
  assert.equal(
    matchesShortcut(
      { key: "h", ctrlKey: true, shiftKey: true, altKey: true },
      "Control+Shift+H",
    ),
    false,
  );
});
