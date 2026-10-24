import test from "node:test";
import assert from "node:assert/strict";
import { installOverlayFocusDebug } from "../src/overlay-focus-debug.ts";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) listener({ type });
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function setup() {
  const store = new Map();
  const logs = [];
  const windowTarget = eventTarget();
  const documentTarget = eventTarget();
  let timer = null;
  const fakeWindow = {
    ...windowTarget,
    setInterval(callback, ms) {
      timer = { callback, ms, id: 7 };
      return 7;
    },
    clearInterval(id) {
      assert.equal(id, 7);
      timer = null;
    },
  };
  const fakeDocument = { ...documentTarget, hidden: false };
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    log: console.log,
  };
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        return store.get(key) ?? null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
    },
  });
  console.log = (...args) => logs.push(args.join(" "));
  return {
    window: fakeWindow,
    document: fakeDocument,
    localStorage: globalThis.localStorage,
    logs,
    get timer() {
      return timer;
    },
    restore() {
      console.log = previous.log;
      for (const key of ["window", "document"]) {
        if (previous[key] === undefined) delete globalThis[key];
        else globalThis[key] = previous[key];
      }
      if (previous.localStorage)
        Object.defineProperty(globalThis, "localStorage", previous.localStorage);
      else delete globalThis.localStorage;
    },
  };
}

test("focus debug counts blur and hidden events and cleans up", (t) => {
  const env = setup();
  t.after(() => env.restore());
  const uninstall = installOverlayFocusDebug();
  assert.equal(env.timer.ms, 2000);
  assert.deepEqual(env.window.__lensFocusSnapshot(), { blurs: 0, hides: 0 });

  env.window.dispatch("blur");
  env.window.dispatch("blur");
  env.document.hidden = true;
  env.document.dispatch("visibilitychange");
  assert.deepEqual(env.window.__lensFocusSnapshot(), { blurs: 2, hides: 1 });

  env.document.hidden = false;
  env.document.dispatch("visibilitychange");
  assert.deepEqual(env.window.__lensFocusSnapshot(), { blurs: 2, hides: 1 });

  uninstall();
  assert.equal(env.window.__lensFocusSnapshot, undefined);
  assert.equal(env.window.listenerCount("blur"), 0);
  assert.equal(env.document.listenerCount("visibilitychange"), 0);
  assert.equal(env.timer, null);
});

test("focus debug logs only while enabled and only when counters change", (t) => {
  const env = setup();
  t.after(() => env.restore());
  const uninstall = installOverlayFocusDebug(1000);
  assert.equal(env.timer.ms, 1000);

  env.window.dispatch("blur");
  assert.deepEqual(env.logs, []);

  env.localStorage.setItem("lens:debugFocus", "1");
  env.window.dispatch("blur");
  assert.deepEqual(env.logs, ["%cBLUR #2 color:red"]);

  env.timer.callback();
  assert.equal(env.logs.at(-1), "blurs=2 hides=0");
  env.timer.callback();
  assert.equal(env.logs.length, 2);

  env.document.hidden = true;
  env.document.dispatch("visibilitychange");
  assert.equal(env.logs.at(-1), "%cHIDDEN color:red");
  env.timer.callback();
  assert.equal(env.logs.at(-1), "blurs=2 hides=1");
  uninstall();
});
