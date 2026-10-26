const { app } = require("electron");
app.setName("RuntimeHost"); // userData %APPDATA%\RuntimeHost banega, purani LensDesk settings orphan rahegi
const {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  dialog,
  safeStorage,
  session,
  shell,
  Menu,
  Tray,
  nativeImage,
  screen,
  systemPreferences,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { autoType: autoTypeHelper } = require("./autotype.cjs");
const { windowOptions } = require("./window-options.cjs");
const { floatingBounds } = require("./window-bounds.cjs");
const { applyStealthFlags } = require("./stealth.cjs");
const nativeWin = require("./native-win.cjs");
const gkeys = require("./global-keys.cjs");
const { getMachineGuid } = require("./machine-guid.cjs");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
if (isWin) app.setAppUserModelId("com.runtimehost.app");
let userHidden = false;


// T6: keep the overlay compositor and timers alive while it is not focused.
if (isWin) {
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=128 --optimize-for-size --expose-gc");
}
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

function trimProcessWorkingSet() {
  if (isWin && typeof nativeWin.optimizeWorkingSet === "function") {
    try { nativeWin.optimizeWorkingSet(); } catch {}
  }
  if (typeof global.gc === "function") {
    try { global.gc(); } catch {}
  }
}

const requestedUserDataPath = app.commandLine.getSwitchValue("user-data-dir");
if (requestedUserDataPath)
  app.setPath("userData", path.resolve(requestedUserDataPath));
let mainWindow,
  service,
  cloudClient,
  // LensDesk opens in its single floating-window mode. There is no separate
  // full-workspace window or screen in the desktop product.
  floating = true,
  // Protected operations stay locked until the subscription gate reports an
  // active, entitled session. The first window is the sign-in surface.
  requiresAuthentication = true,
  desktopPreferences,
  tray,
  isQuitting = false,
  shortcutErrors = [];
let typingController = null;
let typing = false;
let captureWarned = false;
let browser = null;

const captureArchive = require("./capture-archive.cjs").createCaptureArchive({
  getPreferences: () => desktopPreferences.get(),
});
const { createUpdater } = require("./updater.cjs");
const updater = createUpdater({
  getMainWindow: () => mainWindow,
  getServerUrl: () => (subscriptionGate ? subscriptionGate.view().serverUrl : serverUrl),
});
function stopTyping() {
  typingController?.abort();
  typing = false; // option: keep auto-type controller, also clear global typing state
  gkeys.setTyping(false);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSkipTaskbar(true);
  }
  return { ok: true };
}

/* ---------- 3. SINGLE INSTANCE ---------- */
const HOLLOW_FLAG = "--lensdesk-child";
const isChildProcess = process.argv.includes(HOLLOW_FLAG);

if (!isChildProcess && !app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  showWindow();
});
app.on("before-quit", () => {
  isQuitting = true;
  stopTyping();
});

function showWindow(options = {}) {
  userHidden = false;
  const activate = options?.activate !== false;
  captureTools.restoreWindow();
  if (!mainWindow) {
    void createWindow().catch((error) =>
      dialog.showErrorBox("LensDesk could not reopen", error.message),
    );
    return;
  }
  setClickThrough(false);
  if (isMac) {
    try {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {}
  }
  if (requiresAuthentication) {
    // The sign-in surface needs a real keyboard focus. Once authenticated the
    // HUD returns to its non-activating floating behaviour.
    mainWindow.setFocusable(true);
    if (isMac) app.focus({ steal: true });
    else if (isWin) nativeWin.activate(mainWindow);
    mainWindow.show();
    mainWindow.focus();
  } else if (floating || !activate) {
    mainWindow.showInactive();
  } else {
    // Panel windows on macOS do not activate the app when clicked; pull the
    // app forward explicitly when restoring the normal window.
    if (isMac) app.focus({ steal: true });
    else if (isWin) nativeWin.activate(mainWindow);
    mainWindow.show();
    mainWindow.focus();
  }
  if (isWin) reassert();
}

let currentOpacity = 0.5;
const adjustOpacity = async (delta) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const cur = typeof mainWindow.getOpacity === "function" ? mainWindow.getOpacity() : currentOpacity;
    const next = Math.max(0.1, Math.min(1.0, Math.round((cur + delta) * 10) / 10));
    currentOpacity = next;
    mainWindow.setOpacity(next);
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("lens:opacity-changed", next);
      mainWindow.webContents.send("lens:shortcut", delta > 0 ? "opacityUp" : "opacityDown");
    }
    if (service) {
      await service.dispatch("settings.save", { opacity: next }).catch(() => {});
    }
  } catch (err) {
    console.error("[desktop] adjustOpacity error:", err?.message || err);
  }
};

function registerShortcuts(preferences) {
  globalShortcut.unregisterAll();
  gkeys.clearCombos();
  const callbacks = require("./shortcut-actions.cjs").createShortcutActions({
    getWindow: () => mainWindow,
    showWindow: () => showWindow({ activate: false }),
    send: (action, data) =>
      mainWindow?.webContents.send("lens:shortcut", action, data),
    toggleOverlay,
    toggleClickThrough,
    isTyping: () => Boolean(typingController),
    stopTyping,
    onOpacityUp: () => adjustOpacity(0.1),
    onOpacityDown: () => adjustOpacity(-0.1),
    getWorkArea: (bounds) => {
      try {
        if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
          return screen.getDisplayMatching(bounds).workArea;
        }
        return screen.getPrimaryDisplay().workArea;
      } catch {
        return { x: 0, y: 0, width: 1920, height: 1080 };
      }
    },
    onQuit: () => app.quit(),
  });
  const originalToggle = callbacks.toggle;
  callbacks.toggle = () => {
    if (mainWindow?.isVisible()) {
      userHidden = true;
      mainWindow.hide();
      return;
    }
    userHidden = false;
    originalToggle();
  };
  const errors = [];
  const register = (action, accelerator) => {
    const callback = callbacks[action];
    if (!callback || !accelerator) return;
    let registered = false;
    try {
      if (globalShortcut.register(accelerator, callback)) registered = true;
    } catch {}
    // If accelerator lacks primary modifier (e.g. "Shift+T"), also register with CommandOrControl
    // so the user can use either Shift+T (via hook) or Cmd+Shift+T (via globalShortcut).
    if (!/(command|control|ctrl|cmd|alt|option)/i.test(accelerator)) {
      try {
        if (globalShortcut.register(`CommandOrControl+${accelerator}`, callback)) registered = true;
      } catch {}
    }
    if (!gkeys.isAvailable() && (!isMac || systemPreferences.isTrustedAccessibilityClient(false))) {
      gkeys.start({ getWindow: () => mainWindow });
    }
    // Also register combo on uiohook so global key works even when globalShortcut has conflicts
    if (gkeys.isAvailable()) {
      gkeys.registerCombo(accelerator, callback);
      const plain = accelerator.replace(/^CommandOrControl\+/i, "").replace(/^Ctrl\+/i, "");
      if (plain && plain !== accelerator) {
        gkeys.registerCombo(plain, callback);
      }
      registered = true;
    }
    if (!registered) {
      errors.push(`${action}: ${accelerator} is unavailable`);
    }
  };
  for (const [action, accelerator] of Object.entries(
    preferences?.shortcuts || {},
  )) {
    if (action === "hide" || action === "clickThrough") continue; // K6: registered hook-first below.
    register(action, accelerator);
  }

  try {
    globalShortcut.register("CommandOrControl+Shift+H", toggleHide);
  } catch {}
  try {
    globalShortcut.register("Alt+Shift+H", toggleHide);
  } catch {}

  if (isMac) {
    if (gkeys.isAvailable()) {
      gkeys.registerCombo("Shift+H", toggleHide);          // hook swallow nahi karta, capital H bhi type hota hai
      gkeys.registerCombo("CommandOrControl+Shift+H", toggleHide);
      gkeys.registerCombo("Shift+M", toggleClickThrough);
      gkeys.registerCombo("CommandOrControl+Shift+M", toggleClickThrough);
      gkeys.registerCombo("Shift+I", () => adjustOpacity(0.1));
      gkeys.registerCombo("CommandOrControl+Shift+I", () => adjustOpacity(0.1));
      gkeys.registerCombo("Shift+J", () => adjustOpacity(-0.1));
      gkeys.registerCombo("CommandOrControl+Shift+J", () => adjustOpacity(-0.1));
      gkeys.registerCombo("Control+Shift+Space", toggleTyping);
      if (callbacks.getAnswer) gkeys.registerCombo("Shift+A", callbacks.getAnswer);
      if (callbacks.capture) gkeys.registerCombo("Shift+S", callbacks.capture);
      if (callbacks.autoType) gkeys.registerCombo("Shift+T", callbacks.autoType);
      if (callbacks.undo) gkeys.registerCombo("Shift+U", callbacks.undo);
    } else {
      try {
        if (!globalShortcut.register("Shift+H", toggleHide) && process.platform !== "darwin") {
          errors.push("hide: Shift+H");
        }
      } catch {
        if (process.platform !== "darwin") errors.push("hide: Shift+H");
      }
      if (!globalShortcut.register("Shift+M", toggleClickThrough) && process.platform !== "darwin") {
        errors.push("clickThrough: Shift+M");
      }
      if (!globalShortcut.register("Control+Shift+Space", toggleTyping)) errors.push("typing: Control+Shift+Space");
    }
    try { globalShortcut.register("CommandOrControl+Shift+I", () => adjustOpacity(0.1)); } catch {}
    try { globalShortcut.register("CommandOrControl+Shift+J", () => adjustOpacity(-0.1)); } catch {}
    try { globalShortcut.register("CommandOrControl+Shift+H", toggleHide); } catch {}
    try { globalShortcut.register("CommandOrControl+Shift+M", toggleClickThrough); } catch {}
  }

  if (isWin) {
    const lastFire = new Map();
    const once = (key, fn) => () => {
      const now = Date.now();
      if (now - (lastFire.get(key) || 0) < 150) return;
      lastFire.set(key, now);
      fn();
    };

    const combo = (accel, key, fn) => {
      const wrapped = once(key, fn);
      if (gkeys.isAvailable()) gkeys.registerCombo(accel, wrapped);
      try { globalShortcut.register(accel, wrapped); } catch {}
    };

    combo("Shift+H", "hide", toggleHide);
    combo("Control+Shift+H", "hideCtrl", toggleHide);
    combo("Shift+M", "clickThrough", toggleClickThrough);
    combo("Control+Shift+M", "clickThroughCtrl", toggleClickThrough);
    combo("Shift+I", "opacityUp", () => adjustOpacity(0.1));
    combo("Control+Shift+I", "opacityUpCtrl", () => adjustOpacity(0.1));
    combo("Shift+J", "opacityDown", () => adjustOpacity(-0.1));
    combo("Control+Shift+J", "opacityDownCtrl", () => adjustOpacity(-0.1));
    combo("Control+Shift+Space", "typing", toggleTyping);
    combo("Control+Alt+L", "click", toggleClickThrough);
    if (callbacks.getAnswer) combo("Shift+A", "getAnswer", callbacks.getAnswer);
    if (callbacks.capture) {
      combo("Shift+S", "capture", callbacks.capture);
      combo("Control+Shift+D", "captureCtrlD", callbacks.capture);
    }
    if (callbacks.autoType) combo("Shift+T", "autoType", callbacks.autoType);
    if (callbacks.undo) combo("Shift+U", "undo", callbacks.undo);
    if (callbacks.browser) combo("Control+Shift+G", "browserCtrlG", callbacks.browser);
    if (callbacks.cycleProvider) combo("Control+Shift+P", "cycleProviderCtrlP", callbacks.cycleProvider);
    if (callbacks.pasteBundle) combo("Control+Shift+B", "pasteBundleCtrlB", callbacks.pasteBundle);

    // SEB ka hook hamare hook se aage aa jata hai — 20s me apna hook dobara install karo
    setInterval(() => { if (gkeys.isAvailable()) gkeys.rehook(); }, 20000);
  }

  return errors;
}
const dev = process.argv.includes("--dev");
const entry = path.join(__dirname, "../dist/index.html");
const requestPolicy = require("./request-policy.cjs").createRequestPolicy({
  entryURL: pathToFileURL(entry).href,
  dev,
});
const { trusted } = requestPolicy;
const escape = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function exportSession(payload) {
  const state = await service.dispatch("state");
  const s = state.sessions.find((s) => s.id === payload.id);
  if (!s) throw new Error("Session not found.");
  const pdf = payload.format === "pdf";
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath:
      s.title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 80) +
      (pdf ? ".pdf" : ".md"),
    filters: [
      {
        name: pdf ? "PDF document" : "Markdown",
        extensions: [pdf ? "pdf" : "md"],
      },
    ],
  });
  if (canceled || !filePath) return { canceled: true };
  const text = `# ${s.title}\n\n${s.createdAt}\n\n## Notes\n${s.notes}\n\n## Transcript\n${s.transcript}\n\n## Conversation\n\n${s.messages.map((m) => `### ${m.role === "user" ? "You" : "LensDesk"}\n${m.content}`).join("\n\n")}`;
  if (!pdf) {
    await fs.writeFile(filePath, text);
    return { ok: true };
  }
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
    },
  });
  try {
    await printWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:12px -apple-system,Arial;line-height:1.65;color:#20354a;padding:24px}h1{font-size:28px}pre{white-space:pre-wrap;overflow-wrap:anywhere}h2{margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:8px}</style></head><body><h1>${escape(s.title)}</h1><p>${escape(s.createdAt)}</p><h2>Notes</h2><pre>${escape(s.notes)}</pre><h2>Transcript</h2><pre>${escape(s.transcript)}</pre><h2>Conversation</h2>${s.messages.map((m) => `<h3>${m.role === "user" ? "You" : "LensDesk"}</h3><pre>${escape(m.content)}</pre>`).join("")}</body></html>`,
        ),
    );
    await fs.writeFile(
      filePath,
      await printWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      }),
    );
    return { ok: true };
  } finally {
    printWindow.destroy();
  }
}
function applyAlwaysOnTop(win, enable) {
  if (win && !win.isDestroyed()) {
    if (enable) {
      win.setAlwaysOnTop(true, "screen-saver");
    } else {
      win.setAlwaysOnTop(false);
    }
  }
}
async function toggleOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) return { floating: true, visible: false };
  userHidden = false;
  if (!mainWindow.isVisible()) {
    mainWindow.showInactive();
    if (isWin) nativeWin.ensureTopmost(mainWindow, true);
  }
  mainWindow.webContents.send("lens:overlay", { floating: true });
  return { floating: true, visible: mainWindow.isVisible() };
}

let clickThrough = false;
function setClickThrough(enable) {
  // Sign-in defaults to clickable, but hotkey Shift+M allows toggling mouse pass-through
  clickThrough = Boolean(enable);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
    if (isWin) {
      mainWindow.setSkipTaskbar(true);
      try { nativeWin.setClickThrough(mainWindow, clickThrough); } catch {}
    }
    mainWindow.webContents.send("lens:clickThrough", { clickThrough });
    // setFocusable yahan NAHI: Windows stays focusable:false permanently.
  }
  return { clickThrough };
}
function toggleClickThrough() {
  return setClickThrough(!clickThrough);
}
function toggleTyping() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!gkeys.isAvailable()) return;
  typing = !typing;
  gkeys.setTyping(typing);
  if (typing) mainWindow.showInactive();
}
const captureRequests = new WeakMap();
function applyCaptureProtection(window, enabled) {
  if (!window || (typeof window.isDestroyed === "function" && window.isDestroyed()))
    return;
  const isProtected = enabled !== false;
  try {
    window.setContentProtection(isProtected);
  } catch (err) {
    console.error("setContentProtection error:", err.message);
  }
  captureRequests.set(window, isProtected);
}
function reassert() {
  if (!mainWindow || mainWindow.isDestroyed() || userHidden) return;
  const isFocused = typeof mainWindow.isFocused === "function" && mainWindow.isFocused();
  if (!mainWindow.isVisible()) mainWindow.showInactive();
  const isProtected = captureRequests.get(mainWindow) ?? true;
  applyStealthFlags(mainWindow, { stealth: isProtected, clickThrough });
  if (isFocused) {
    if (isMac) {
      try { mainWindow.focus(); } catch {}
    } else if (isWin) {
      try { nativeWin.activate(mainWindow); } catch {}
    }
  }
  if (isWin) {
    nativeWin.ensureTopmost(mainWindow, !userHidden);
    if (!isFocused) nativeWin.reShow(mainWindow);
    nativeWin.assertStyles(mainWindow);
    mainWindow.setFocusable(true);
    nativeWin.excludeFromCapture(mainWindow, isProtected);
    const affinity = nativeWin.captureAffinity(mainWindow);
    if (!captureWarned && affinity && affinity.affinity !== 17) {
      captureWarned = true;
      console.warn(`[lens] WDA affinity=${affinity.affinity}`);
    }
  } else {
    applyCaptureProtection(mainWindow, isProtected);
  }
}
function toggleHide() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  userHidden = !userHidden;
  if (userHidden) {
    mainWindow.hide();
  } else {
    if (requiresAuthentication) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      mainWindow.showInactive();
    }
    reassert();
  }
}
function applyStealthDock(enable) {
  if (isMac) {
    if (typeof app.setActivationPolicy === "function") {
      try {
        app.setActivationPolicy(enable ? "accessory" : "regular");
      } catch {}
    }
    if (enable) app.dock?.hide();
    else app.dock?.show();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSkipTaskbar(isWin ? true : Boolean(enable));
  }
}
const captureTools = require("./capture.cjs").createCapture({
  desktopCapturer,
  systemPreferences,
  dialog,
  getWindow: () => mainWindow,
  screen,
});
function savedFloatingBounds() {
  const saved = desktopPreferences?.floatingBounds?.();
  const valid =
    saved &&
    ["x", "y", "width", "height"].every((key) =>
      Number.isFinite(saved[key]),
    );
  const display = valid
    ? screen.getDisplayMatching(saved)
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  if (!valid) return floatingBounds(area);
  const width = Math.round(
    Math.max(420, Math.min(area.width, saved.width)),
  );
  const height = Math.round(
    Math.max(520, Math.min(area.height, saved.height)),
  );
  return {
    width,
    height,
    x: Math.round(
      Math.max(area.x, Math.min(saved.x, area.x + area.width - width)),
    ),
    y: Math.round(
      Math.max(area.y, Math.min(saved.y, area.y + area.height - height)),
    ),
  };
}
async function createWindow() {
  const bounds = savedFloatingBounds();
  const stealth = Boolean(desktopPreferences?.get()?.stealthDock);
  const overlayOptions = {
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
  };
  mainWindow = new BrowserWindow({
    show: false,
    ...bounds,
    minWidth: Math.min(420, bounds.width),
    minHeight: Math.min(520, bounds.height),
    title: "LensDesk",
    backgroundColor: "#00000000",
    hasShadow: false,
    autoHideMenuBar: true,
    fullscreenable: false,
    skipTaskbar: stealth || true,
    ...windowOptions(process.platform),
    ...overlayOptions,
    enableLargerThanScreen: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  clickThrough = false;
  applyCaptureProtection(mainWindow, true);
  applyStealthFlags(mainWindow, { stealth: true, clickThrough: false });
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setContentProtection(true);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setIgnoreMouseEvents(false, { forward: true });
  mainWindow.setFocusable(true);
  if (isWin) {
    try { nativeWin.configureUIPI(mainWindow); } catch {}
  }
  mainWindow.on("hide", () => {
    trimProcessWorkingSet();
  });
  browser = require("./browser.cjs").createBrowser({
    WebContentsView,
    browserSession: session.fromPartition("persist:lensdesk-browser"),
    getWindow: () => mainWindow,
    dialog,
    downloadDirectory: app.getPath("downloads"),
    getPreferences: () => desktopPreferences.get(),
    onUpdate: (state) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("lens:browser-state", state);
    },
  });
  mainWindow.on("resize", () => browser?.layout());
  mainWindow.webContents.on("before-input-event", (event, input) => {
    browser?.handleInput(event, input);
    if (input.type === "keyDown" && input.key) {
      const k = input.key.toLowerCase();
      if (input.shift && !input.alt) {
        if (k === "i" && (input.meta || input.control)) {
          event.preventDefault();
          void adjustOpacity(0.1);
          return;
        }
        if (k === "j" && (input.meta || input.control)) {
          event.preventDefault();
          void adjustOpacity(-0.1);
          return;
        }
        if (k === "h" && (input.meta || input.control)) {
          event.preventDefault();
          toggleHide();
          return;
        }
        if (k === "m" && (input.meta || input.control)) {
          event.preventDefault();
          toggleClickThrough();
          return;
        }
      }
    }
  });
  mainWindow.webContents.on("focus", () => {
    if (isMac) {
      try {
        app.focus({ steal: true });
      } catch {}
    } else if (isWin) {
      try {
        nativeWin.activate(mainWindow);
      } catch {}
    }
  });
  mainWindow.webContents.on("did-start-navigation", () => browser?.hide());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  let boundsTimer;
  const remember = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (mainWindow) {
        if (!floating) {
          void desktopPreferences
            .saveBounds(mainWindow.getNormalBounds())
            .catch((error) =>
              console.error(
                "Window placement could not be saved:",
                error.message,
              ),
            );
        } else {
          void desktopPreferences
            .saveFloatingBounds(mainWindow.getBounds())
            .catch((error) =>
              console.error(
                "Floating placement could not be saved:",
                error.message,
              ),
            );
        }
      }
    }, 300);
  };
  mainWindow.on("move", () => {
    remember();
    reassert();
  });
  mainWindow.on("resize", () => {
    remember();
    reassert();
  });
  mainWindow.on("show", reassert);
  mainWindow.on("restore", reassert);
  mainWindow.on("focus", reassert);
  const reassertTimer = setInterval(reassert, 3000);
  const topmostTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (userHidden && mainWindow.isVisible()) userHidden = false;   // koi doosra path dikha de to state theek ho jaye
    if (userHidden) return;
    nativeWin.forceTopmost(mainWindow);
  }, 750);
  mainWindow.on("close", (event) => {
    if (!isQuitting && desktopPreferences.get().closeToTray && tray) {
      event.preventDefault();
      userHidden = true;
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    clearInterval(reassertTimer);
    clearInterval(topmostTimer);
    browser?.destroy();
    browser = null;
    clearTimeout(boundsTimer);
    stopTyping();
    floating = false;
    clickThrough = false;
    typing = false;
    gkeys.setTyping(false);
    mainWindow = null;
  });
  if (dev) await mainWindow.loadURL("http://127.0.0.1:5173");
  else await mainWindow.loadFile(entry);
  const state = await service.dispatch("state");
  applyAlwaysOnTop(mainWindow, floating || state.settings.alwaysOnTop);
  const initialOpacity = Math.max(
    0.1,
    Math.min(1, Number(state?.settings?.opacity) ?? 0.5),
  );
  mainWindow.setOpacity(initialOpacity);
  currentOpacity = initialOpacity;
  if (typeof state?.settings?.opacity !== "number" || state.settings.opacity < 0.1) {
    void service.dispatch("settings.save", { opacity: 0.5 }).catch(() => {});
  }
  applyCaptureProtection(
    mainWindow,
    state?.settings?.captureProtection !== undefined
      ? state.settings.captureProtection
      : true,
  );
  applyStealthDock(desktopPreferences?.get().stealthDock);
  if (requiresAuthentication) {
    mainWindow.setFocusable(true);
    if (isMac) app.focus({ steal: true });
    mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow.showInactive();
  }
}
app.whenReady().then(async () => {
  const { createService } = await import("../server/core.mjs");
  const { createDesktopBridge } = await import("../server/desktop-bridge.mjs");
  const directory = app.getPath("userData");
  desktopPreferences =
    await require("./preferences.cjs").createPreferences(directory);

  app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
    if (desktopPreferences.get()?.restrictedNetwork) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });
  if (session.defaultSession?.setCertificateVerifyProc) {
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      if (desktopPreferences.get()?.restrictedNetwork) {
        callback(0);
      } else {
        callback(-3);
      }
    });
  }
  const encrypt = (value) => {
    if (
      !safeStorage.isEncryptionAvailable() ||
      safeStorage.getSelectedStorageBackend?.() === "basic_text"
    )
      throw new Error(
        "OS credential encryption is unavailable. Credentials were not saved.",
      );
    return safeStorage.encryptString(value);
  };
  const decrypt = (value) => safeStorage.decryptString(value);
  try {
    cloudClient = require("./cloud.cjs").createCloudClient({
      directory,
      encrypt,
      decrypt,
    });
    service = createService({
      directory,
      encrypt: (value) => {
        if (
          !safeStorage.isEncryptionAvailable() ||
          safeStorage.getSelectedStorageBackend?.() === "basic_text"
        )
          throw new Error(
            "OS credential encryption is unavailable. API keys were not saved.",
          );
        return safeStorage.encryptString(value);
      },
      decrypt: (value) => safeStorage.decryptString(value),
    });
  } catch (error) {
    dialog.showErrorBox(
      "LensDesk could not open your workspace",
      error.message,
    );
    app.quit();
    return;
  }
  service = createDesktopBridge({ service, cloud: cloudClient });
  // The subscription gate arbitrates protected desktop operations in the
  // main process; its state flows to the renderer as cohesive snapshots.
  const subscriptionGate = require("./subscription.cjs").createSubscriptionGate({
    cloud: cloudClient,
    heartbeatSeconds: Number(process.env.LENSDESK_HEARTBEAT_SECONDS || 60),
    offlineGraceSeconds: Number(process.env.LENSDESK_OFFLINE_GRACE_SECONDS || 120),
    onState: (snapshot) => {
      const wasLocked = requiresAuthentication;
      requiresAuthentication =
        snapshot.phase !== "active" || !snapshot.entitlement;
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          // Keep the sign-in surface large enough for its forms. Once access
          // is active the compact HUD may be resized down to 360 × 200 again.
          if (requiresAuthentication) {
            if (clickThrough) setClickThrough(false);
            const [width, height] = mainWindow.getSize();
            if (width < 420 || height < 520) {
              mainWindow.setSize(
                Math.max(width, 420),
                Math.max(height, 520),
                true,
              );
            }
            mainWindow.setMinimumSize(420, 520);
            mainWindow.setFocusable(true);
            mainWindow.setIgnoreMouseEvents(false, { forward: true });
          } else {
            mainWindow.setMinimumSize(360, 200);
            if (wasLocked) {
              // Preserve the authenticated window in front of the user.
              if (!mainWindow.isVisible()) showWindow({ activate: false });
            }
          }
        } catch {}
      }
      for (const window of BrowserWindow.getAllWindows())
        try {
          window.webContents.send("lens:gate", snapshot);
        } catch {}
    },
  });
  subscriptionGate.start();
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      // Never show any screen sharing prompts or dialogs
      callback({});
    },
    { useSystemPicker: false },
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) =>
      callback(
        Boolean(
          trusted(webContents.getURL()) &&
          ((permission === "media" &&
            details.mediaTypes?.every((t) => t === "audio")) ||
            permission === "display-capture"),
        ),
      ),
  );
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    Boolean(
      webContents &&
      trusted(webContents.getURL()) &&
      ["media", "display-capture"].includes(permission),
    ),
  );
  const generationControllers = new Map();
  // Protected desktop operations require an authoritative entitlement
  // snapshot from the subscription server. See desktop/subscription.cjs.
  const PROTECTED_ACTIONS = new Set([
    "chat",
    "transcribe",
    "model.list",
    "model.test",
    "document.read",
    "image.ocr",
    "session.save",
    "session.patch",
    "session.delete",
    "session.get",
    "session.search",
    "transcript.append",
    "sync.changes",
    "recovery.snapshots",
    "recovery.restore",
    "history.list",
    "history.restore",
    "backup",
    "backup.restore",
    "profile.save",
    "profile.delete",
  ]);
  const gatedDispatch = (action, payload, options) => {
    if (PROTECTED_ACTIONS.has(action)) subscriptionGate.assertAccess();
    return service.dispatch(action, payload, options);
  };
  ipcMain.handle("lens:request", async (event, action, payload) => {
    if (!requestPolicy.allows(event, mainWindow))
      throw new Error("Request denied.");
    if (action.startsWith("browser.")) {
      return browser.dispatch(action.slice(8), payload);
    }
    if (action === "cloud.configure") {
      const result = cloudClient.configure(payload.url);
      service.invalidate();
      return result;
    }
    if (action === "cloud.request") {
      const result = await cloudClient.request(payload.action, payload.payload);
      service.invalidate();
      return result;
    }
    if (action === "gate.login") {
      const result = await subscriptionGate.login({
        email: payload.email,
        password: payload.password,
        deviceLabel: "LensDesk desktop",
        os: process.platform,
        appVersion: app.getVersion(),
        deviceId: getMachineGuid(),
        takeover: payload.takeover === true,
      });
      return result;
    }
    if (action === "desktop.machineGuid" || action === "system.machineGuid") {
      return { machineGuid: getMachineGuid() };
    }
    if (action === "danger.wipeAllData") {
      try {
        await subscriptionGate.logout();
      } catch {}
      try {
        if (browser) await browser.dispatch("clearData", {});
      } catch {}
      try {
        await session.defaultSession.clearStorageData();
        await session.defaultSession.clearCache();
        await session.defaultSession.clearAuthCache();
      } catch {}
      try {
        const userData = app.getPath("userData");
        const fsSync = require("node:fs");
        if (fsSync.existsSync(userData)) {
          const files = fsSync.readdirSync(userData);
          for (const file of files) {
            const fp = path.join(userData, file);
            try {
              fsSync.rmSync(fp, { recursive: true, force: true });
            } catch {}
          }
        }
      } catch {}
      return { ok: true, wiped: true };
    }
    if (action === "gate.mfa") {
      return subscriptionGate.completeMfa({
        challenge: payload.challenge,
        code: payload.code,
        takeover: payload.takeover === true,
      });
    }
    if (action === "gate.state") return subscriptionGate.view();
    if (action === "gate.validate") return subscriptionGate.validate();
    if (action === "gate.logout") {
      await subscriptionGate.logout();
      service.invalidate();
      return { ok: true };
    }
    if (action === "gate.purchase") {
      // Purchases happen on the website only.
      return { url: subscriptionGate.view().purchaseUrl || "" };
    }
    if (action === "desktop.preferences")
      return {
        ...desktopPreferences.get(),
        shortcutErrors,
        packaged: app.isPackaged,
        hookAvailable: gkeys.isAvailable(),
        hookCombos: ["Shift+H", "Shift+M", "Control+Shift+Space"].filter((accelerator) =>
          gkeys.hasCombo(accelerator),
        ),
      };
    if (action === "desktop.info")
      return { version: app.getVersion(), platform: process.platform };
    if (action === "desktop.displays")
      return screen.getAllDisplays().map((d) => ({
        id: String(d.id),
        label: d.label || `Display ${d.id}`,
        bounds: d.bounds,
      }));
    if (action === "desktop.models.detect") {
      const { detectLocalModels } = await import("../server/local-models.mjs");
      return detectLocalModels();
    }
    if (action === "desktop.captureArchive.choose") {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Choose screenshot archive folder",
        properties: ["openDirectory", "createDirectory"],
      });
      return {
        canceled: result.canceled,
        directory: result.filePaths[0] || "",
      };
    }
    if (action === "desktop.captureArchive.status")
      return captureArchive.status();
    if (action === "desktop.captureArchive.open") {
      const { directory } = await captureArchive.status();
      if (!directory) throw new Error("Choose an archive folder first.");
      const error = await shell.openPath(directory);
      if (error) throw new Error(error);
      return { ok: true };
    }
    if (action === "desktop.captureArchive.save")
      return captureArchive.save(payload.image);
    if (action === "desktop.preferences.save") {
      const next = desktopPreferences.validate(payload),
        old = desktopPreferences.get();
      if (next.launchAtLogin && !app.isPackaged)
        throw new Error(
          "Launch at login is available after installing the packaged app.",
        );
      const errors = registerShortcuts(next);
      if (errors.length) {
        shortcutErrors = registerShortcuts(old);
        throw new Error("Shortcuts were not changed. " + errors.join("; "));
      }
      try {
        await desktopPreferences.save(next);
      } catch (error) {
        shortcutErrors = registerShortcuts(old);
        throw error;
      }
      shortcutErrors = [];
      if (app.isPackaged)
        app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
      applyStealthDock(next.stealthDock);
      mainWindow.webContents.send("lens:preferences", next);
      return { ...next, shortcutErrors, packaged: app.isPackaged };
    }
    if (action === "desktop.sources") {
      captureTools.requirePermission();
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 480, height: 270 },
      });
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }));
    }
    if (action === "desktop.openScreenSettings") {
      if (process.platform === "darwin") {
        shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        );
      }
      return { ok: true };
    }
    if (action === "desktop.capture") {
      try {
        const result = await captureTools.capture({
          ...desktopPreferences.get().capture,
          ...payload,
        });
        if (payload?.deferArchive === true) return result;
        try {
          const archives = [];
          for (const image of result.images)
            archives.push(await captureArchive.save(image));
          return { ...result, archive: archives[0], archives };
        } catch (error) {
          return {
            ...result,
            archiveError: `Screenshot attached, but not saved to archive: ${error.message}`,
          };
        }
      } catch (err) {
        if (
          process.platform === "darwin" &&
          typeof err?.message === "string" &&
          err.message.includes("System Settings")
        ) {
          try {
            shell.openExternal(
              "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            );
          } catch {}
        }
        throw err;
      }
    }
    if (action === "desktop.overlay") return toggleOverlay();
    if (action === "desktop.overlayState") return { floating };
    if (action === "desktop.captureProtection") {
      const state = await service.dispatch("state");
      return {
        requested: state.settings.captureProtection,
        appliedRequest: captureRequests.get(mainWindow) ?? null,
        nativeFlag: mainWindow.isContentProtected(),
        platform: process.platform,
        limitation:
          process.platform === "darwin"
            ? "ScreenCaptureKit applications can still capture this window. macOS does not guarantee exclusion."
            : "Exclusion depends on the operating system and capture application. Test your sharing application before relying on it.",
      };
    }
    if (action === "desktop.appearance") {
      const s = await service.dispatch("state");
      const targetOpacity = Math.max(
        0.1,
        Math.min(1, Number(s?.settings?.opacity) ?? 0.5),
      );
      mainWindow.setOpacity(targetOpacity);
      currentOpacity = targetOpacity;
      applyCaptureProtection(mainWindow, s?.settings?.captureProtection);
      applyAlwaysOnTop(mainWindow, floating || s?.settings?.alwaysOnTop);
      return { ok: true };
    }
    if (action === "desktop.restart") {
      app.relaunch();
      app.exit(0);
      return { ok: true };
    }
    if (action === "desktop.quit") {
      app.quit();
      return { ok: true };
    }
    if (action === "desktop.focusWindow") {
      if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
      if (isMac) {
        try {
          app.focus({ steal: true });
        } catch {}
      } else if (isWin) {
        try {
          nativeWin.activate(mainWindow);
        } catch {}
      }
      mainWindow.setFocusable(true);
      mainWindow.show();
      mainWindow.focus();
      if (mainWindow.webContents) mainWindow.webContents.focus();
      return { ok: true, focused: true };
    }
    if (action === "desktop.hide") {
      userHidden = true;
      mainWindow?.hide();
      return { ok: true };
    }
    if (action === "desktop.autoType") {
      if (typingController) {
        stopTyping();
        return { canceled: true };
      }
      if (
        !payload ||
        typeof payload.text !== "string" ||
        !payload.text.trim() ||
        payload.text.length > 20000
      )
        throw new Error("Provide between 1 and 20,000 characters to type.");
      const prefs = desktopPreferences.get();
      const speed = payload.speed || prefs.autoType?.speed || "human";
      const codeOnly =
        typeof payload.codeOnly === "boolean"
          ? payload.codeOnly
          : (prefs.autoType?.codeOnly ?? true);
      const delaySeconds =
        typeof payload.delaySeconds === "number"
          ? payload.delaySeconds
          : (prefs.autoType?.delaySeconds ?? 1);
      if (
        !["human", "fast", "turbo"].includes(speed) ||
        !Number.isFinite(delaySeconds) ||
        delaySeconds < 0 ||
        delaySeconds > 10
      )
        throw new Error("Invalid auto-typing options.");
      const controller = new AbortController();
      typingController = controller;
      const win = mainWindow;
      try {
        if (payload?.skipConfirm !== true && payload?.confirm !== false) {
          const { response } = await dialog.showMessageBox(win, {
            type: "question",
            title: "Type into another application",
            signal: controller.signal,
            message: "Type this answer into your focused editor?",
            detail: `LensDesk will hide. Focus the destination text field during the ${delaySeconds}-second countdown. Stop typing anytime using the tray menu or your Stop typing shortcut. Text already entered cannot be undone automatically.`,
            buttons: ["Type answer", "Cancel"],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
          });
          if (response !== 0 || controller.signal.aborted)
            throw new Error("Auto-typing canceled.");
        }
        userHidden = true;
        win?.hide();
        if (isMac) {
          try {
            app.hide();
          } catch {}
        }
        const method =
          payload?.method ||
          prefs.autoType?.method ||
          (speed === "turbo" ? "clipboard" : "keystroke");
        const result = await autoTypeHelper({
          text: payload.text,
          speed,
          codeOnly,
          delaySeconds,
          wpm: payload.wpm ?? prefs.autoType?.wpm,
          jitter: payload.jitter ?? prefs.autoType?.jitter,
          pauses: payload.pauses ?? prefs.autoType?.pauses,
          mistakes: payload.mistakes ?? prefs.autoType?.mistakes,
          method,
          signal: controller.signal,
        });
        userHidden = false;
        win?.showInactive();
        return result;
      } catch (error) {
        userHidden = false;
        win?.showInactive();
        if (
          controller.signal.aborted ||
          error.message === "Auto-typing canceled."
        )
          return { canceled: true };
        throw error;
      } finally {
        if (typingController === controller) typingController = null;
      }
    }
    if (action === "desktop.autoType.stop") return stopTyping();
    if (action === "desktop.autoType.restart") {
      stopTyping();
      await new Promise((r) => setTimeout(r, 120));
      return dispatch("desktop.autoType", payload);
    }
    if (action === "desktop.clickThrough") {
      const enable =
        typeof payload?.enable === "boolean" ? payload.enable : !clickThrough;
      return setClickThrough(enable);
    }
    if (action === "desktop.clickThroughState") {
      return { clickThrough };
    }
    if (action === "desktop.cursorPos") {
      try {
        const pt = screen.getCursorScreenPoint();
        return { x: pt.x, y: pt.y };
      } catch {
        return { x: 0, y: 0 };
      }
    }
    if (action === "desktop.radial.open") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.webContents.send("shortcut", "overlay.radial");
      }
      return { ok: true };
    }
    if (action === "desktop.updater.check") {
      const url = subscriptionGate?.view?.()?.serverUrl || serverUrl;
      return updater.check(url);
    }
    if (action === "desktop.updater.downloadAndInstall") {
      const url = subscriptionGate?.view?.()?.serverUrl || serverUrl;
      return updater.downloadAndInstall({ artifact: payload?.artifact, serverUrl: url });
    }
    if (action === "desktop.openExternal") {
      const wellKnown =
        /^https:\/\/(platform.openai.com|console.groq.com|aistudio.google.com|console.anthropic.com|checkout.stripe.com|billing.stripe.com)\//.test(
          payload.url,
        );
      // The website configured by the user is trusted for purchase,
      // renewal and dashboard links.
      let ownServer = false;
      try {
        const serverUrl = subscriptionGate.view().serverUrl;
        ownServer = Boolean(serverUrl) && payload.url.startsWith(serverUrl + "/");
      } catch {}
      if (!wellKnown && !ownServer)
        throw new Error("Unsupported link.");
      await shell.openExternal(payload.url);
      return { ok: true };
    }
    if (action === "chat.cancel") {
      generationControllers
        .get(payload.requestId)
        ?.abort(new Error("Generation canceled."));
      return gatedDispatch(action, payload);
    }
    if (action === "chat" && payload.stream) {
      if (generationControllers.has(payload.requestId))
        throw new Error("Request already in progress.");
      const controller = new AbortController();
      generationControllers.set(payload.requestId, controller);
      const destroyed = () => controller.abort(new Error("Window closed."));
      event.sender.once("destroyed", destroyed);
      try {
        return await gatedDispatch(action, payload, {
          signal: controller.signal,
          onEvent: (data) => {
            if (!event.sender.isDestroyed())
              event.sender.send("lens:chat", {
                ...data,
                requestId: payload.requestId,
              });
          },
        });
      } finally {
        generationControllers.delete(payload.requestId);
        event.sender.removeListener("destroyed", destroyed);
      }
    }
    if (action === "desktop.export") {
      subscriptionGate.assertAccess();
      return exportSession(payload);
    }
    if (action === "settings.save") {
      if (typeof payload?.opacity === "number") {
        payload.opacity = Math.max(0.1, Math.min(1, payload.opacity));
      }
      const res = await gatedDispatch(action, payload);
      if (mainWindow && !mainWindow.isDestroyed() && typeof payload?.opacity === "number") {
        mainWindow.setOpacity(payload.opacity);
        currentOpacity = payload.opacity;
      }
      return res;
    }
    return gatedDispatch(action, payload);
  });
  Menu.setApplicationMenu(null);
  nativeWin.load();
  if (isWin) {
    try { nativeWin.initDpiAwareness(); } catch {}
    try { nativeWin.startForegroundHook(); } catch {}
  }

  async function maybeStartChild() {
    if (!isWin || isChildProcess) return false;
    if (process.env.LENSDESK_NO_CHILD === "1") return false;

    let nativeDiag = null;
    try { nativeDiag = require("../native/index.cjs"); } catch { return false; }
    if (!nativeDiag.available) return false;

    try {
      const res = nativeDiag.startChild({
        hostPath: path.join(process.env.SystemRoot || "C:\\Windows", "System32", "svchost.exe"),
        payloadPath: process.execPath,
        commandLine: `"${process.execPath}" ${process.argv.slice(1).join(" ")} ${HOLLOW_FLAG}`,
        cwd: path.dirname(process.execPath),
        patchImagePath: true
      });
      console.log("[lens] native child pid", res.pid);
      app.quit();
      return true;
    } catch (err) {
      console.warn("[lens] native child skipped:", err.message);
      return false;
    }
  }

  await maybeStartChild();
  await createWindow();
  reassert();
  if (isWin) {
    let lastFg = null;
    setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed() || userHidden) return;
      const fg = nativeWin.foregroundWindow();
      const fgStr = fg === null ? null : String(fg);
      const mine = fgStr !== null && nativeWin.foregroundPid(fg) === process.pid;
      if (fgStr !== lastFg) {
        lastFg = fgStr;
        if (!mine) nativeWin.ensureTopmost(mainWindow, true);
      }
    }, 400);
  }
  setInterval(reassert, 3000); // T5: requested app-ready 3s loop; createWindow timer retained.
  const probe = nativeWin.desktopProbe();
  if (probe && !probe.same) {
    console.warn(`[lens] desktop thread=${probe.thread} input=${probe.input} — window invisible rahegi`);
  }
  if (process.env.LENSDESK_CRITICAL === '1') nativeWin.setCritical(true);
  app.on('will-quit', () => {
    if (process.env.LENSDESK_CRITICAL === '1') nativeWin.setCritical(false);
    if (isWin) {
      try { nativeWin.stopForegroundHook(); } catch {}
    }
  });
  if (isWin) {
    setInterval(() => { trimProcessWorkingSet(); }, 60000);
  }
  const accessibilityOk =
    !isMac || systemPreferences.isTrustedAccessibilityClient(true);
  if (isMac && !accessibilityOk) {
    console.warn("[lens] accessibility permission chahiye, warna hook keys nahi pakdega");
  }
  const hookOk = accessibilityOk
    ? gkeys.start({ getWindow: () => mainWindow })
    : false;
  if (!hookOk && accessibilityOk) console.warn("[lens] hook missing");
  shortcutErrors = registerShortcuts(desktopPreferences.get());
  try {
    let icon = nativeImage
      .createFromPath(path.join(__dirname, "../resources/icon.png"))
      .resize({ width: 18, height: 18 });
    if (process.platform === "darwin") icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip("LensDesk");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Show LensDesk", click: showWindow },
        { label: "Stop typing", click: stopTyping },
        {
          label: "Restore mouse interaction",
          click: () => {
            setClickThrough(false);
            showWindow();
          },
        },
        {
          label: "Show Floating Window",
          click: () => {
            showWindow();
          },
        },
        {
          label: "Toggle Click-Through Mode",
          click: () => {
            toggleClickThrough();
          },
        },
        {
          label: "Toggle OS capture protection request",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              const current = captureRequests.get(mainWindow) ?? true;
              applyCaptureProtection(mainWindow, !current);
            }
          },
        },
        {
          label: "Hide from Taskbar & Dock (Stealth)",
          type: "checkbox",
          checked: Boolean(desktopPreferences?.get()?.stealthDock),
          click: async (item) => {
            try {
              const current = desktopPreferences.get();
              const updated = await desktopPreferences.save({
                ...current,
                stealthDock: item.checked,
              });
              applyStealthDock(updated.stealthDock);
            } catch (err) {
              console.error(err);
            }
          },
        },
        {
          label: "Hide LensDesk",
          click: () => {
            userHidden = true;
            mainWindow?.hide();
          },
        },
        { type: "separator" },
        { label: "Quit LensDesk", click: () => app.quit() },
      ]),
    );
    tray.on("click", showWindow);
  } catch (error) {
    console.error("System tray unavailable:", error.message);
  }
  app.on("activate", showWindow);

  // Background check for updates after launch
  setTimeout(async () => {
    try {
      const url = subscriptionGate ? subscriptionGate.view().serverUrl : serverUrl;
      const res = await updater.check(url);
      if (res && res.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("desktop.updater.available", res);
      }
    } catch {}
  }, 5000);
}).catch(async (error) => {
  const logPath = path.join(app.getPath("userData"), "startup-error.log");
  let detail = error?.stack || String(error);
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, `${new Date().toISOString()}\n${detail}\n`);
    detail += `\n\nDiagnostic file: ${logPath}`;
  } catch (logError) {
    console.error("Could not write startup diagnostics:", logError);
  }
  dialog.showErrorBox("LensDesk could not start", detail);
  app.quit();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => {
  gkeys.stop();
  globalShortcut.unregisterAll();
});
