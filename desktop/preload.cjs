const { contextBridge, ipcRenderer } = require("electron");
const actions = new Set([
  "browser.state",
  "browser.open",
  "browser.navigate",
  "browser.home",
  "browser.select",
  "browser.close",
  "browser.back",
  "browser.forward",
  "browser.reload",
  "browser.stop",
  "browser.layout",
  "browser.find",
  "browser.zoom",
  "browser.clearData",
  "browser.focus",
  "browser.download.cancel",
  "cloud.configure",
  "cloud.request",
  "state",
  "workspace.list",
  "session.get",
  "session.search",
  "session.patch",
  "transcript.append",
  "sync.changes",
  "recovery.snapshots",
  "recovery.restore",
  "history.list",
  "history.restore",
  "session.save",
  "session.delete",
  "profile.save",
  "profile.delete",
  "settings.save",
  "key.save",
  "chat",
  "chat.cancel",
  "model.list",
  "model.test",
  "transcribe",
  "document.read",
  "image.ocr",
  "backup",
  "backup.restore",
  "desktop.sources",
  "desktop.preferences",
  "desktop.info",
  "desktop.displays",
  "desktop.restart",
  "desktop.quit",
  "desktop.models.detect",
  "desktop.captureArchive.choose",
  "desktop.captureArchive.status",
  "desktop.captureArchive.open",
  "desktop.captureArchive.save",
  "desktop.preferences.save",
  "desktop.capture",
  "desktop.openScreenSettings",
  "desktop.overlay",
  "desktop.overlayState",
  "desktop.appearance",
  "desktop.captureProtection",
  "desktop.export",
  "desktop.openExternal",
  "desktop.autoType",
  "desktop.autoType.stop",
  "desktop.focusWindow",
  "desktop.hide",
  "desktop.clickThrough",
  "desktop.clickThroughState",
  "gate.login",
  "gate.mfa",
  "gate.state",
  "gate.validate",
  "gate.logout",
  "gate.purchase",
]);
contextBridge.exposeInMainWorld("lens", {
  onGate: (listener) => {
    const fn = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on("lens:gate", fn);
    return () => ipcRenderer.removeListener("lens:gate", fn);
  },
  onPreferences: (listener) => {
    const fn = (_event, preferences) => listener(preferences);
    ipcRenderer.on("lens:preferences", fn);
    return () => ipcRenderer.removeListener("lens:preferences", fn);
  },
  onBrowserState: (listener) => {
    const fn = (_event, state) => listener(state);
    ipcRenderer.on("lens:browser-state", fn);
    return () => ipcRenderer.removeListener("lens:browser-state", fn);
  },
  onBrowserFocusAddress: (listener) => {
    const fn = () => listener();
    ipcRenderer.on("lens:browser-focus-address", fn);
    return () => ipcRenderer.removeListener("lens:browser-focus-address", fn);
  },
  onBrowserFocusFind: (listener) => {
    const fn = () => listener();
    ipcRenderer.on("lens:browser-focus-find", fn);
    return () => ipcRenderer.removeListener("lens:browser-focus-find", fn);
  },
  platform: process.platform,
  invoke: (action, payload = {}) => {
    if (!actions.has(action))
      return Promise.reject(new Error("Unknown action"));
    return ipcRenderer.invoke("lens:request", action, payload);
  },
  onChatEvent: (listener) => {
    const fn = (_event, data) => listener(data);
    ipcRenderer.on("lens:chat", fn);
    return () => ipcRenderer.removeListener("lens:chat", fn);
  },
  onShortcut: (listener) => {
    const fn = (_event, action) => listener(action);
    ipcRenderer.on("lens:shortcut", fn);
    return () => ipcRenderer.removeListener("lens:shortcut", fn);
  },
  onOverlay: (listener) => {
    const fn = (_event, data) => listener(data);
    ipcRenderer.on("lens:overlay", fn);
    return () => ipcRenderer.removeListener("lens:overlay", fn);
  },
  onClickThrough: (listener) => {
    const fn = (_event, data) => listener(data);
    ipcRenderer.on("lens:clickThrough", fn);
    return () => ipcRenderer.removeListener("lens:clickThrough", fn);
  },
  onGlobalKey: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('gkey', h);
    return () => ipcRenderer.off('gkey', h);
  },
});
