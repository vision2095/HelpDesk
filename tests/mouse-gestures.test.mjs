import test from "node:test";
import assert from "node:assert/strict";
import { installMouseGestures, radialSlotAt } from "../src/mouse-gestures.mjs";
class Target extends EventTarget {
  listeners = new Set();
  addEventListener(name, handler, options) {
    this.listeners.add(handler);
    super.addEventListener(name, handler, options);
  }
  removeEventListener(name, handler) {
    this.listeners.delete(handler);
    super.removeEventListener(name, handler);
  }
  fire(type, values = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 1, clientX: 100, clientY: 100, ...values });
    this.dispatchEvent(event);
    return event;
  }
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test("disabled gestures install no hooks and leave all native mouse events untouched", () => {
  const target = new Target();
  const dispose = installMouseGestures(
    target,
    { enabled: false },
    () => assert.fail("Disabled gesture opened"),
    () => assert.fail("Disabled gesture cancelled"),
  );
  assert.equal(target.listeners.size, 0);
  for (const type of [
    "mousedown",
    "mousemove",
    "mouseup",
    "auxclick",
    "contextmenu",
  ])
    assert.equal(target.fire(type).defaultPrevented, false);
  dispose();
});
test("instant mode preserves a quick click and opens once after the drag threshold", () => {
  const target = new Target(),
    opened = [],
    cancelled = [];
  const dispose = installMouseGestures(
    target,
    { enabled: true, trigger: "middle", holdMs: 0 },
    (point) => opened.push(point),
    () => cancelled.push(true),
  );
  assert.equal(target.fire("mousedown").defaultPrevented, false);
  assert.equal(target.fire("mouseup").defaultPrevented, false);
  assert.equal(target.fire("auxclick").defaultPrevented, false);
  assert.equal(opened.length, 0);
  target.fire("mousedown");
  assert.equal(
    target.fire("mousemove", { clientX: 107 }).defaultPrevented,
    false,
  );
  assert.equal(
    target.fire("mousemove", { clientX: 108 }).defaultPrevented,
    true,
  );
  target.fire("mousemove", { clientX: 120 });
  assert.deepEqual(opened, [{ x: 100, y: 100 }]);
  let wheelReceivedRelease = false;
  target.addEventListener("mouseup", () => {
    wheelReceivedRelease = true;
  });
  assert.equal(target.fire("mouseup").defaultPrevented, true);
  assert.equal(
    wheelReceivedRelease,
    true,
    "The rendered wheel must receive release selection",
  );
  assert.equal(target.fire("auxclick").defaultPrevented, true);
  assert.deepEqual(cancelled, []);
  dispose();
});
test("hold mode opens at the current pointer after its timer and cancels cleanly", async () => {
  const target = new Target(),
    opened = [],
    cancelled = [];
  const dispose = installMouseGestures(
    target,
    { enabled: true, trigger: "right", holdMs: 25 },
    (point) => opened.push(point),
    () => cancelled.push(true),
  );
  target.fire("mousedown", { button: 1 });
  await pause(35);
  assert.equal(opened.length, 0, "A different button is ignored");
  target.fire("mousedown", { button: 2 });
  target.fire("mousemove", { button: 2, clientX: 180, clientY: 200 });
  assert.equal(
    opened.length,
    0,
    "Dragging cannot bypass the selected hold delay",
  );
  await pause(35);
  assert.deepEqual(opened, [{ x: 180, y: 200 }]);
  assert.equal(
    target.fire("contextmenu", { button: 2 }).defaultPrevented,
    true,
  );
  target.fire("keydown", { key: "Escape" });
  assert.equal(cancelled.length, 1);
  target.fire("mousedown", { button: 2 });
  target.fire("mouseup", { button: 2 });
  await pause(35);
  assert.equal(opened.length, 1, "A quick release clears the pending timer");
  target.fire("mousedown", { button: 2 });
  dispose();
  assert.equal(target.listeners.size, 0);
  await pause(35);
  assert.equal(opened.length, 1, "Cleanup clears pending timers");
});
test("blur cancels an opened gesture and cleanup is idempotent", () => {
  const target = new Target();
  let cancelled = 0;
  const dispose = installMouseGestures(
    target,
    { enabled: true },
    () => {},
    () => cancelled++,
  );
  target.fire("mousedown");
  target.fire("mousemove", { clientX: 125 });
  target.fire("blur");
  assert.equal(cancelled, 1);
  dispose();
  dispose();
  assert.equal(target.listeners.size, 0);
});
test("rendered wheel geometry centers slot 1 at the top and treats wheel/flick boundaries differently", () => {
  const at = (x, y, options = {}) =>
    radialSlotAt({ x, y, center: { x: 100, y: 100 }, slots: 4, ...options });
  assert.equal(at(100, 100), null);
  assert.equal(at(100, 20), 1);
  assert.equal(at(180, 100), 2);
  assert.equal(at(100, 180), 3);
  assert.equal(at(20, 100), 4);
  assert.equal(
    at(100, -100),
    null,
    "Wheel mode clears selection outside its ring",
  );
  assert.equal(
    at(100, -100, { style: "flick" }),
    1,
    "Flick mode accepts a direction beyond the visual ring",
  );
  assert.equal(
    at(100, 80, { style: "flick" }),
    null,
    "Both styles preserve the cancel deadzone",
  );
  assert.equal(at(100, 20, { slots: 6 }), 1);
  assert.equal(at(180, 100, { slots: 8 }), 3);
  assert.equal(at(100, 60, { size: 50 }), 1, "Deadzone scales with wheel size");
  assert.equal(at(100, 20, { slots: 5 }), null);
  assert.equal(at(NaN, 20), null);
});
