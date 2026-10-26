const fs = require("node:fs/promises");
const path = require("node:path");
const defaults = {
  launchAtLogin: false,
  closeToTray: false,
  stealthDock: false,
  chatLayout: "standard",
  restrictedNetwork: false,
  localOcr: false,
  captureArchive: { enabled: false, directory: "" },
  capture: { mode: "active", displayId: "" },
  mouse: {
    enabled: false,
    trigger: "middle",
    size: 100,
    opacity: 85,
    holdMs: 0,
    style: "wheel",
    slots: 6,
    mappings: {
      1: "getAnswer",
      2: "capture",
      3: "autoType",
      4: "undo",
      5: "hide",
      6: "snip",
      7: "browser",
      8: "settings",
    },
  },
  shortcuts: {
    toggle: "CommandOrControl+Shift+L",
    hide: "Shift+H",
    capture: "CommandOrControl+Shift+S",
    overlay: "CommandOrControl+Shift+O",
    hideAnswer: "CommandOrControl+Shift+A",
    autoType: "CommandOrControl+Shift+T",
    stopTyping: "CommandOrControl+Alt+Escape",
    clickThrough: "Shift+M",
    browser: "",
    theme: "",
    opacityUp: "Shift+I",
    opacityDown: "Shift+J",
    clearLastCapture: "",
    clearCaptures: "",
    cancelAnswer: "",
    shortcuts: "",
    scrollUp: "",
    scrollDown: "",
    moveUp: "",
    moveDown: "",
    moveLeft: "",
    moveRight: "",
    getAnswer: "",
    regionSnip: "",
    undo: "",
    clearBundle: "",
    clearChat: "",
    cycleProvider: "",
    cycleModel: "",
    mouseMode: "",
    stealth: "",
    restart: "",
    quit: "",
  },
  autoType: {
    speed: "human",
    codeOnly: true,
    delaySeconds: 1,
    wpm: 65,
    jitter: 0,
    mistakes: 0,
    pauses: 0,
  },
  browser: {
    homePage: "https://www.google.com/",
    searchEngine: "google",
    zoom: 1,
  },
};
const legacyShortcutDefaults = {
  hide: "CommandOrControl+Shift+H",
  clickThrough: "CommandOrControl+Shift+X",
};
function browserPreferences(value = {}) {
  const homePage = value.homePage ?? defaults.browser.homePage;
  if (typeof homePage !== "string" || homePage.length > 2048)
    throw new Error(
      "Browser home page must be a web address under 2,048 characters.",
    );
  let parsed;
  try {
    parsed = new URL(homePage);
  } catch {
    throw new Error("Browser home page must be a valid HTTP or HTTPS address.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error(
      "Browser home page must be an HTTP or HTTPS address without embedded credentials.",
    );
  const searchEngine = value.searchEngine ?? defaults.browser.searchEngine;
  if (!["google", "bing", "duckduckgo"].includes(searchEngine))
    throw new Error(
      "Choose Google, Bing, or DuckDuckGo as the browser search engine.",
    );
  const zoom = value.zoom ?? defaults.browser.zoom;
  if (
    typeof zoom !== "number" ||
    !Number.isFinite(zoom) ||
    zoom < 0.5 ||
    zoom > 2.5
  )
    throw new Error("Browser zoom must be between 50% and 250%.");
  return { homePage: parsed.href, searchEngine, zoom };
}
function validate(input) {
  const range = (value, fallback, min, max, label) => {
    if (value === undefined) return fallback;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new Error(`${label} must be between ${min} and ${max}.`);
    return value;
  };
  const capture = { ...defaults.capture, ...input.capture };
  if (
    !["active", "all", "specific"].includes(capture.mode) ||
    typeof capture.displayId !== "string" ||
    capture.displayId.length > 100
  )
    throw new Error("Choose a valid screenshot display mode.");
  const mouse = { ...structuredClone(defaults.mouse), ...input.mouse };
  const triggerAliases = {
    "Middle button (wheel click)": "middle",
    "Right button": "right",
  };
  mouse.trigger = triggerAliases[mouse.trigger] || mouse.trigger;
  if (
    typeof mouse.enabled !== "boolean" ||
    !["middle", "right"].includes(mouse.trigger) ||
    !["wheel", "flick"].includes(mouse.style) ||
    ![4, 6, 8].includes(mouse.slots)
  )
    throw new Error("Choose valid mouse gesture options.");
  const mappings = { ...defaults.mouse.mappings, ...mouse.mappings };
  const actions = new Set(Object.values(defaults.mouse.mappings));
  const aliases = {
    "Get Answer": "getAnswer",
    Capture: "capture",
    "Capture Screen": "capture",
    Type: "autoType",
    "Auto Type": "autoType",
    "Undo Shot": "undo",
    clearLastCapture: "undo",
    "Hide/Show": "hide",
    "Hide / Show": "hide",
    Snip: "snip",
    regionSnip: "snip",
    "Snip Region": "snip",
    Browser: "browser",
    Settings: "settings",
    shortcuts: "settings",
  };
  for (const [slot, action] of Object.entries(mappings)) {
    mappings[slot] = aliases[action] || action;
    if (!/^[1-8]$/.test(slot) || !actions.has(mappings[slot]))
      throw new Error("Choose a supported mouse action for each slot.");
  }
  const archive = input.captureArchive ?? defaults.captureArchive;
  if (
    typeof archive.enabled !== "boolean" ||
    typeof archive.directory !== "string" ||
    archive.directory.length > 2000 ||
    archive.directory.includes("\0") ||
    (archive.directory && !path.isAbsolute(archive.directory))
  )
    throw new Error("Choose a valid local screenshot archive folder.");
  if (archive.enabled && !archive.directory)
    throw new Error(
      "Choose an archive folder before enabling screenshot saving.",
    );
  const merged = { ...defaults.shortcuts, ...(input.shortcuts || {}) };
  for (const [key, legacy] of Object.entries(legacyShortcutDefaults)) {
    if (input.shortcuts?.[key] === legacy) merged[key] = defaults.shortcuts[key];
  }
  const shortcuts = {};
  for (const [key, defVal] of Object.entries(defaults.shortcuts)) {
    const value = merged[key] ?? defVal;
    if (
      typeof value !== "string" ||
      value.length > 80 ||
      (!value.trim() && defVal)
    )
      throw new Error(
        `Shortcut for ${key} needs an accelerator such as CommandOrControl+Shift+L.`,
      );
    shortcuts[key] = value.trim();
  }
  const values = Object.values(shortcuts)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  if (new Set(values).size !== values.length)
    throw new Error("Choose a different shortcut for each action.");
  if (
    typeof input.launchAtLogin !== "boolean" ||
    typeof input.closeToTray !== "boolean"
  )
    throw new Error("Invalid desktop preferences.");
  return {
    launchAtLogin: input.launchAtLogin,
    closeToTray: input.closeToTray,
    stealthDock:
      typeof input.stealthDock === "boolean"
        ? input.stealthDock
        : defaults.stealthDock,
    chatLayout: ["standard", "minimal"].includes(input.chatLayout)
      ? input.chatLayout
      : defaults.chatLayout,
    restrictedNetwork:
      typeof input.restrictedNetwork === "boolean"
        ? input.restrictedNetwork
        : defaults.restrictedNetwork,
    localOcr:
      typeof input.localOcr === "boolean"
        ? input.localOcr
        : defaults.localOcr,
    shortcuts,
    captureArchive: { enabled: archive.enabled, directory: archive.directory },
    capture,
    autoType: {
      speed: ["human", "fast", "turbo"].includes(input.autoType?.speed)
        ? input.autoType.speed
        : defaults.autoType.speed,
      codeOnly:
        typeof input.autoType?.codeOnly === "boolean"
          ? input.autoType.codeOnly
          : defaults.autoType.codeOnly,
      delaySeconds:
        typeof input.autoType?.delaySeconds === "number"
          ? Math.max(0, Math.min(10, input.autoType.delaySeconds))
          : defaults.autoType.delaySeconds,
      wpm: range(input.autoType?.wpm, 65, 10, 250, "Typing speed"),
      jitter: range(input.autoType?.jitter, 0, 0, 100, "Timing variation"),
      mistakes: range(input.autoType?.mistakes, 0, 0, 100, "Typing mistakes"),
      pauses: range(input.autoType?.pauses, 0, 0, 100, "Typing pauses"),
    },
    mouse: {
      enabled: mouse.enabled,
      trigger: mouse.trigger,
      style: mouse.style,
      slots: mouse.slots,
      size: range(mouse.size, 100, 50, 150, "Mouse wheel size"),
      opacity: range(mouse.opacity, 85, 10, 100, "Mouse wheel opacity"),
      holdMs: range(mouse.holdMs, 0, 0, 1000, "Hold duration"),
      mappings,
    },
    browser: browserPreferences(input.browser),
  };
}
async function createPreferences(directory) {
  const file = path.join(directory, "desktop-preferences.json");
  let current = structuredClone(defaults),
    bounds,
    floatingBounds;
  try {
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    current = validate(saved);
    bounds = saved.bounds;
    floatingBounds = saved.floatingBounds;
  } catch (error) {
    if (error.code !== "ENOENT")
      console.error("Desktop preferences could not be loaded:", error.message);
  }
  async function persist(
    next,
    nextBounds = bounds,
    nextFloatingBounds = floatingBounds,
  ) {
    await fs.writeFile(
      file + ".tmp",
      JSON.stringify({
        ...next,
        bounds: nextBounds,
        floatingBounds: nextFloatingBounds,
      }),
      { mode: 0o600 },
    );
    await fs.rename(file + ".tmp", file);
    current = next;
    bounds = nextBounds;
    floatingBounds = nextFloatingBounds;
  }
  let queue = Promise.resolve();
  return {
    get: () => structuredClone(current),
    bounds: () => bounds,
    floatingBounds: () => floatingBounds,
    validate,
    save(next) {
      const task = queue.then(() => persist(validate(next)));
      queue = task.catch(() => {});
      return task;
    },
    saveBounds(next) {
      const task = queue.then(() => persist(current, next, floatingBounds));
      queue = task.catch(() => {});
      return task;
    },
    saveFloatingBounds(next) {
      const task = queue.then(() => persist(current, bounds, next));
      queue = task.catch(() => {});
      return task;
    },
  };
}
module.exports = { createPreferences, defaults };
