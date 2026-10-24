import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { workspaceBounds, floatingBounds } = createRequire(import.meta.url)("../desktop/window-bounds.cjs");

for (const area of [
  { x: 0, y: 25, width: 1440, height: 875 },
  { x: -1024, y: 0, width: 1024, height: 768 },
  { x: 0, y: 0, width: 800, height: 600 },
]) {
  test(`landscape windows fit work area ${area.width}×${area.height} at ${area.x}`, () => {
    for (const bounds of [floatingBounds(area), workspaceBounds(null, area), workspaceBounds({ x: 9000, y: -9000, width: 1100, height: 1900 }, area)]) {
      assert.ok(bounds.width > bounds.height);
      assert.ok(bounds.x >= area.x && bounds.y >= area.y);
      assert.ok(bounds.x + bounds.width <= area.x + area.width);
      assert.ok(bounds.y + bounds.height <= area.y + area.height);
    }
  });
}
