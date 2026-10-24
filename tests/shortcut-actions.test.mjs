import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { createShortcutActions } = createRequire(import.meta.url)(
  "../desktop/shortcut-actions.cjs",
);
test("both window shortcuts hide and restore with the same action", () => {
  let visible = true,
    clickThrough = true;
  const win = {
    isVisible: () => visible,
    hide: () => {
      visible = false;
    },
  };
  const actions = createShortcutActions({
    getWindow: () => win,
    showWindow: () => {
      visible = true;
      clickThrough = false;
    },
  });
  for (const action of ["hide", "toggle"]) {
    actions[action]();
    assert.equal(visible, false);
    actions[action]();
    assert.equal(visible, true);
    assert.equal(clickThrough, false);
  }
});
test("typing shortcut starts once, repeated press stops; reversible actions toggle", () => {
  let typing = false,
    stops = 0,
    overlay = false,
    through = false,
    answer = false,
    captures = 0,
    starts = 0;
  const actions = createShortcutActions({
    getWindow: () => null,
    showWindow: () => {},
    send: (action) => {
      if (action === "autoType") {
        typing = true;
        starts++;
      }
      if (action === "hideAnswer") answer = !answer;
      if (action === "capture") captures++;
    },
    isTyping: () => typing,
    stopTyping: () => {
      stops++;
      typing = false;
    },
    toggleOverlay: () => {
      overlay = !overlay;
    },
    toggleClickThrough: () => {
      through = !through;
    },
  });
  actions.autoType();
  actions.autoType();
  assert.equal(starts, 1);
  assert.equal(stops, 1);
  assert.equal(typing, false);
  actions.autoType();
  assert.equal(starts, 2);
  actions.stopTyping();
  assert.equal(typing, false);
  for (const action of ["overlay", "clickThrough", "hideAnswer"]) {
    actions[action]();
    actions[action]();
  }
  assert.equal(overlay, false);
  assert.equal(through, false);
  assert.equal(answer, false);
  actions.capture();
  actions.capture();
  assert.equal(captures, 2);
});

test("window movement clamps negative and positive monitor bounds; additional actions dispatch distinctly", () => {
  let bounds = { x: -1590, y: 10, width: 1000, height: 600 };
  const area = { x: -1600, y: 0, width: 1600, height: 900 },
    sent = [];
  const actions = createShortcutActions({
    getWindow: () => ({
      getBounds: () => bounds,
      setBounds: (next) => {
        bounds = next;
      },
    }),
    getWorkArea: () => area,
    send: (action) => sent.push(action),
  });
  actions.moveLeft();
  actions.moveUp();
  assert.deepEqual(bounds, { x: -1600, y: 0, width: 1000, height: 600 });
  for (let i = 0; i < 100; i++) {
    actions.moveRight();
    actions.moveDown();
  }
  assert.deepEqual(bounds, { x: -1000, y: 300, width: 1000, height: 600 });
  for (const action of [
    "browser",
    "theme",
    "opacityUp",
    "opacityDown",
    "clearLastCapture",
    "clearCaptures",
    "cancelAnswer",
    "shortcuts",
    "scrollUp",
    "scrollDown",
    "getAnswer",
    "regionSnip",
    "clearChat",
    "cycleProvider",
    "cycleModel",
    "stealth",
    "restart",
    "quit",
  ])
    actions[action]();
  assert.equal(new Set(sent).size, 18);
});

test("quit action triggers onQuit callback for emergency exit in LSUIElement stealth mode", () => {
  let quitTriggered = false;
  let sentAction = null;
  const actions = createShortcutActions({
    send: (action) => {
      sentAction = action;
    },
    onQuit: () => {
      quitTriggered = true;
    },
  });
  actions.quit();
  assert.equal(sentAction, "quit");
  assert.equal(quitTriggered, true);
});

test("toggleTyping stops active typing on second press and toggles typing focus when idle", () => {
  let typingActive = false;
  let stopCalls = 0;
  let focusCalls = 0;
  const sent = [];

  const actions = createShortcutActions({
    send: (ch) => sent.push(ch),
    isTyping: () => typingActive,
    stopTyping: () => {
      stopCalls++;
      typingActive = false;
    },
    toggleTypingFocus: () => {
      focusCalls++;
    },
  });

  // 1st press when idle: toggles typing focus
  actions.toggleTyping();
  assert.equal(focusCalls, 1);
  assert.equal(stopCalls, 0);
  assert.equal(sent[sent.length - 1], "toggleTyping");

  // Simulate typing becoming active
  typingActive = true;

  // 2nd press when active: stops typing immediately
  actions.toggleTyping();
  assert.equal(stopCalls, 1);
  assert.equal(typingActive, false);
  assert.equal(sent[sent.length - 1], "typingStopped");
});

test("snapToWorkArea calculates correct top-right corner on primary and secondary displays", () => {
  let pos = { x: 0, y: 0 };
  const mockWin = {
    isDestroyed: () => false,
    getSize: () => [470, 640],
    setPosition: (x, y) => {
      pos = { x, y };
    },
  };

  // Monitor 1: 1920x1080 at 0,0
  const area1 = { x: 0, y: 25, width: 1920, height: 1055 };
  let actions = createShortcutActions({
    getWindow: () => mockWin,
    getWorkArea: () => area1,
  });
  actions.snapToWorkArea();
  // x = 0 + 1920 - 470 - 20 = 1430, y = 25 + 20 = 45
  assert.deepEqual(pos, { x: 1430, y: 45 });

  // Monitor 2 (Left): 1680x1050 at -1680, 0
  const area2 = { x: -1680, y: 0, width: 1680, height: 1050 };
  actions = createShortcutActions({
    getWindow: () => mockWin,
    getWorkArea: () => area2,
  });
  actions.snapToWorkArea();
  // x = -1680 + 1680 - 470 - 20 = -490, y = 0 + 20 = 20
  assert.deepEqual(pos, { x: -490, y: 20 });
});

test("mouseMode toggles natively once without dispatching a second renderer toggle", () => {
  let through = false;
  let sentAction = null;
  const actions = createShortcutActions({
    toggleClickThrough: () => {
      through = !through;
    },
    send: (ch) => {
      sentAction = ch;
    },
  });
  actions.mouseMode();
  assert.equal(through, true);
  assert.equal(sentAction, null);
  actions.mouseMode();
  assert.equal(through, false);
});
