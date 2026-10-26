const { randomUUID } = require("node:crypto");
const path = require("node:path");
const CHROME_VERSION = "131.0.0.0";
const CHROME_UA =
  process.platform === "darwin"
    ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`
    : process.platform === "win32"
      ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`
      : `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
const PLATFORM_NAME =
  process.platform === "darwin"
    ? '"macOS"'
    : process.platform === "win32"
      ? '"Windows"'
      : '"Linux"';
function browserURL(input, preferences = {}) {
  const home = preferences.homePage || "https://www.google.com/";
  if (typeof input !== "string" || input.length > 8000)
    throw new Error("Enter a web address or search.");
  const value = input.trim();
  if (!value) return browserURL(home, {});
  let candidate = value;
  if (!/^https?:\/\//i.test(value)) {
    if (
      /^(localhost|[\w.-]+\.[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?([/?#]|$)/i.test(
        value,
      ) &&
      !/\s/.test(value)
    )
      candidate = "https://" + value;
    else if (/^[a-z][a-z\d+.-]*:/i.test(value))
      throw new Error("Only HTTP and HTTPS pages are supported.");
    else {
      const query = encodeURIComponent(value);
      const search = {
        google: `https://www.google.com/search?q=${query}`,
        bing: `https://www.bing.com/search?q=${query}`,
        duckduckgo: `https://duckduckgo.com/?q=${query}`,
      }[preferences.searchEngine || "google"];
      return search || `https://www.google.com/search?q=${query}`;
    }
  }
  const url = new URL(candidate);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Use an HTTP or HTTPS address without embedded credentials.",
    );
  return url.href;
}
function createBrowser({
  WebContentsView,
  browserSession,
  getWindow,
  dialog,
  downloadDirectory,
  getPreferences = () => ({}),
  onUpdate = () => {},
}) {
  if (typeof browserSession?.setUserAgent === "function") {
    browserSession.setUserAgent(CHROME_UA);
  }
  if (typeof browserSession?.webRequest?.onBeforeSendHeaders === "function") {
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      headers["User-Agent"] = CHROME_UA;
      headers["sec-ch-ua"] =
        '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
      headers["sec-ch-ua-mobile"] = "?0";
      headers["sec-ch-ua-platform"] = PLATFORM_NAME;
      callback({ requestHeaders: headers });
    });
  }
  const tabs = new Map(),
    downloads = new Map(),
    grants = new Set();
  let activeId = null,
    attached = null,
    visible = false,
    bounds = null;
  function snapshot() {
    return {
      activeId,
      tabs: [...tabs.values()].map((t) => ({
        id: t.id,
        url: t.view.webContents.getURL() || t.url,
        title: t.title,
        loading: t.loading,
        error: t.error,
        canGoBack: t.view.webContents.navigationHistory.canGoBack(),
        canGoForward: t.view.webContents.navigationHistory.canGoForward(),
        zoom: t.view.webContents.getZoomFactor(),
      })),
      downloads: [...downloads.values()].map(({ item, ...data }) => data),
    };
  }
  const emit = () => onUpdate(snapshot());
  function detach() {
    const win = getWindow();
    if (attached && win && !win.isDestroyed())
      win.contentView.removeChildView(attached);
    attached = null;
  }
  function layout() {
    const win = getWindow(),
      tab = tabs.get(activeId);
    if (!visible || !bounds || !win || win.isDestroyed() || !tab) {
      detach();
      return;
    }
    const [width, height] = win.getContentSize();
    const x = Math.max(0, Math.min(Math.floor(bounds.x), width)),
      y = Math.max(0, Math.min(Math.floor(bounds.y), height));
    const rect = {
      x,
      y,
      width: Math.max(0, Math.min(Math.floor(bounds.width), width - x)),
      height: Math.max(0, Math.min(Math.floor(bounds.height), height - y)),
    };
    if (rect.width < 1 || rect.height < 1) {
      detach();
      return;
    }
    if (attached !== tab.view) {
      detach();
      win.contentView.addChildView(tab.view);
      attached = tab.view;
      if (typeof tab.view.webContents?.focus === "function") {
        tab.view.webContents.focus();
      }
    }
    tab.view.setBounds(rect);
  }
  async function navigate(tab, input) {
    const url = browserURL(input, getPreferences()?.browser || {});
    tab.error = "";
    tab.url = url;
    emit();
    try {
      await tab.view.webContents.loadURL(url);
    } catch (error) {
      if (error.code !== "ERR_ABORTED" && tabs.has(tab.id)) {
        tab.error =
          "Could not load this page. Check the address, connection, or certificate.";
        emit();
      }
    }
  }
  function open(input) {
    const prefs = getPreferences()?.browser || {};
    const url = browserURL(input ?? "", prefs);
    if (tabs.size >= 12)
      throw new Error("Close a tab before opening more than 12 tabs.");
    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
      },
    });
    const tab = {
      id: randomUUID(),
      view,
      url,
      title: "New tab",
      loading: true,
      error: "",
      initialZoomPending: true,
    };
    tabs.set(tab.id, tab);
    activeId = tab.id;
    view.setBackgroundColor("#ffffff");
    const wc = view.webContents;
    if (typeof wc.setUserAgent === "function") {
      wc.setUserAgent(CHROME_UA);
    }
    wc.setZoomFactor(prefs.zoom || 1);
    wc.setWindowOpenHandler(({ url, frameName, disposition }) => {
      if (disposition === "new-window" || disposition === "other") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            parent: getWindow(),
            modal: false,
            webPreferences: {
              session: browserSession,
              contextIsolation: true,
              sandbox: true,
              nodeIntegration: false,
            },
          },
        };
      }
      try {
        open(url);
      } catch {}
      return { action: "deny" };
    });
    wc.on("did-finish-load", () => {
      if (typeof wc.executeJavaScript === "function") {
        wc.executeJavaScript(
          "try{Object.defineProperty(navigator,'webdriver',{get:()=>undefined,configurable:true})}catch(e){}",
        ).catch(() => {});
      }
      if (activeId === tab.id && visible && typeof wc.focus === "function") {
        wc.focus();
      }
    });
    wc.on("will-navigate", (event, url) => {
      try {
        browserURL(url);
      } catch {
        event.preventDefault();
        tab.error = "Navigation to this address is blocked.";
        emit();
      }
    });
    wc.on("will-redirect", (event, url) => {
      try {
        browserURL(url);
      } catch {
        event.preventDefault();
      }
    });
    wc.on("did-start-loading", () => {
      tab.loading = true;
      emit();
    });
    wc.on("did-stop-loading", () => {
      tab.loading = false;
      if (tab.initialZoomPending) {
        tab.initialZoomPending = false;
        wc.setZoomFactor(getPreferences()?.browser?.zoom || 1);
      }
      emit();
    });
    wc.on("did-navigate", () => {
      tab.error = "";
      emit();
    });
    wc.on("did-navigate-in-page", () => emit());
    wc.on("page-title-updated", (_event, title) => {
      tab.title = String(title).slice(0, 180);
      emit();
    });
    wc.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        tab.error =
          "Could not load this page. Check the address, connection, or certificate.";
        emit();
      }
    });
    wc.on("render-process-gone", () => {
      tab.loading = false;
      tab.error = "This tab stopped unexpectedly. Reload to continue.";
      emit();
    });
    wc.on("before-input-event", handleInput);
    layout();
    emit();
    void navigate(tab, url);
    return snapshot();
  }
  function handleInput(event, input) {
    if (!visible || input.type !== "keyDown") return;
    const key = input.key.toLowerCase(),
      tab = tabs.get(activeId);

    // Forward global shortcuts from embedded browser
    if (input.shift) {
      if (key === "s") {
        event.preventDefault();
        getWindow()?.webContents.send("lens:shortcut", "capture");
        return;
      }
      if (key === "a") {
        event.preventDefault();
        getWindow()?.webContents.send("lens:shortcut", "getAnswer");
        return;
      }
      if (key === "b") {
        event.preventDefault();
        getWindow()?.webContents.send("lens:shortcut", "browser");
        return;
      }
      if (key === "i") {
        event.preventDefault();
        getWindow()?.webContents.send("lens:shortcut", "opacityUp");
        return;
      }
      if (key === "j") {
        event.preventDefault();
        getWindow()?.webContents.send("lens:shortcut", "opacityDown");
        return;
      }
      if (key === "h") {
        event.preventDefault();
        getWindow()?.webContents.send("lens:shortcut", "hide");
        return;
      }
      if (key === "m") {
        event.preventDefault();
        getWindow()?.webContents.send("lens:shortcut", "clickThrough");
        return;
      }
    }

    if (!(input.control || input.meta)) return;
    if (!["l", "t", "w", "r", "f"].includes(key)) return;
    event.preventDefault();
    if (key === "l" || key === "f") {
      getWindow()?.webContents.focus();
      getWindow()?.webContents.send(
        key === "l" ? "lens:browser-focus-address" : "lens:browser-focus-find",
      );
    } else if (key === "t") {
      try {
        open();
      } catch {}
    } else if (key === "w" && tab) {
      controller.dispatch("close", { id: tab.id });
      if (!activeId) getWindow()?.webContents.focus();
    } else if (key === "r" && tab) tab.view.webContents.reload();
  }
  const owns = (wc) =>
    [...tabs.values()].some((t) => t.view.webContents === wc);
  browserSession.setPermissionCheckHandler((wc, permission, origin) =>
    Boolean(wc && owns(wc) && grants.has(`${origin}|${permission}`)),
  );
  browserSession.setPermissionRequestHandler(
    async (wc, permission, callback, details) => {
      if (
        !owns(wc) ||
        ![
          "media",
          "geolocation",
          "notifications",
          "fullscreen",
          "pointerLock",
        ].includes(permission)
      ) {
        callback(false);
        return;
      }
      let origin;
      try {
        origin = new URL(details.requestingUrl || wc.getURL()).origin;
      } catch {
        callback(false);
        return;
      }
      const key = `${origin}|${permission}`;
      if (grants.has(key)) {
        callback(true);
        return;
      }
      try {
        const { response } = await dialog.showMessageBox(getWindow(), {
          type: "question",
          title: "Website permission",
          message: `Allow ${origin} to use ${permission}?`,
          detail:
            "This permission applies to the embedded browser for this app session.",
          buttons: ["Block", "Allow"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        const allow = response === 1 && owns(wc);
        if (allow) grants.add(key);
        callback(allow);
      } catch {
        callback(false);
      }
    },
  );
  const downloadHandler = (_event, item, wc) => {
    if (!owns(wc)) return;
    item.setSaveDialogOptions({
      title: "Save browser download",
      defaultPath: path.join(
        downloadDirectory,
        path.basename(item.getFilename()),
      ),
    });
    const id = randomUUID(),
      record = {
        id,
        item,
        name: item.getFilename(),
        received: 0,
        total: item.getTotalBytes(),
        state: "progressing",
      };
    downloads.set(id, record);
    while (downloads.size > 30) {
      const old = [...downloads].find(([, d]) => d.state !== "progressing");
      if (!old) break;
      downloads.delete(old[0]);
    }
    item.on("updated", (_event, state) => {
      record.received = item.getReceivedBytes();
      record.state = state;
      emit();
    });
    item.once("done", (_event, state) => {
      record.received = item.getReceivedBytes();
      record.state = state;
      emit();
    });
    emit();
  };
  browserSession.on("will-download", downloadHandler);
  const controller = {
    snapshot,
    layout,
    handleInput,
    hide() {
      visible = false;
      layout();
    },
    destroy() {
      detach();
      const closing = [...tabs.values()];
      tabs.clear();
      activeId = null;
      for (const t of closing)
        t.view.webContents.close({ waitForBeforeUnload: false });
      grants.clear();
      for (const d of downloads.values())
        if (d.state === "progressing") d.item.cancel();
      browserSession.removeListener("will-download", downloadHandler);
    },
    dispatch(action, payload = {}) {
      if (action === "state") return snapshot();
      if (action === "open") return open(payload.url);
      if (action === "home") {
        const tab = tabs.get(activeId);
        if (tab) void navigate(tab, "");
        else return open("");
        return snapshot();
      }
      if (action === "clearData")
        return Promise.all([
          browserSession.clearStorageData({
            storages: [
              "cookies",
              "filesystem",
              "indexdb",
              "localstorage",
              "serviceworkers",
              "cachestorage",
              "websql",
            ],
            quotas: true,
          }),
          browserSession.clearCache(),
          browserSession.clearAuthCache(),
        ]).then(() => snapshot());
      if (action === "layout") {
        if (payload.visible === false) {
          visible = false;
          layout();
          return { ok: true };
        }
        if (
          !payload.bounds ||
          !["x", "y", "width", "height"].every(
            (k) =>
              Number.isFinite(payload.bounds[k]) &&
              payload.bounds[k] >= 0 &&
              payload.bounds[k] <= 20000,
          )
        )
          throw new Error("Invalid browser viewport.");
        bounds = { ...payload.bounds };
        visible = true;
        layout();
        return { ok: true };
      }
      if (action === "download.cancel") {
        const d = downloads.get(payload.id);
        if (d?.state === "progressing") d.item.cancel();
        return snapshot();
      }
      if (action === "focus") {
        const t = tabs.get(payload.id || activeId);
        if (t && typeof t.view.webContents?.focus === "function") {
          t.view.webContents.focus();
        }
        return snapshot();
      }
      if (action === "assistantFocus") {
        const win = getWindow();
        if (win && !win.isDestroyed() && typeof win.webContents?.focus === "function") {
          win.webContents.focus();
        }
        return snapshot();
      }
      if (action === "pasteBundle") {
        const tab = tabs.get(payload.id || activeId);
        if (!tab) throw new Error("Choose an open browser tab.");
        const imgs = Array.isArray(payload.images) ? payload.images : [];
        const note = typeof payload.note === "string" ? payload.note : "";
        if (imgs.length === 0 && !note) {
          throw new Error("No screenshots in the bundle to paste");
        }
        const wc = tab.view.webContents;
        const code = `;(function(){try{
          var imgs = ${JSON.stringify(imgs)};
          var note = ${JSON.stringify(note)};
          var dt = new DataTransfer();
          for(var i=0; i<imgs.length; i++){
            var raw = imgs[i].replace(/^data:image\\/[^;]+;base64,/, '');
            var bs = atob(raw);
            var arr = new Uint8Array(bs.length);
            for(var j=0; j<bs.length; j++) arr[j] = bs.charCodeAt(j);
            var blob = new Blob([arr], {type:'image/png'});
            dt.items.add(new File([blob], 'screenshot-' + (i+1) + '.png', {type:'image/png'}));
          }
          var fi = document.querySelector('input[type=file]');
          if(fi){
            fi.files = dt.files;
            fi.dispatchEvent(new Event('change', {bubbles:true}));
          } else {
            var el = document.activeElement || document.body;
            el.dispatchEvent(new ClipboardEvent('paste', {bubbles:true, cancelable:true, clipboardData:dt}));
          }
          if(note){
            var el2 = document.activeElement;
            if(el2 && (el2.tagName == 'TEXTAREA' || el2.tagName == 'INPUT')){
              var st = el2.selectionStart == null ? el2.value.length : el2.selectionStart;
              el2.value = el2.value.slice(0, st) + note + el2.value.slice(st);
              el2.dispatchEvent(new Event('input', {bubbles:true}));
            } else if(el2 && el2.isContentEditable){
              document.execCommand('insertText', false, note);
            }
          }
          return 'ok';
        } catch(e){ return 'error: ' + e.message; }})();`;
        return wc.executeJavaScript(code).then((result) => ({ ok: true, result }));
      }
      const tab = tabs.get(payload.id || activeId);
      if (!tab) throw new Error("Choose an open browser tab.");
      if (action === "select") {
        activeId = tab.id;
        layout();
        emit();
        if (typeof tab.view.webContents?.focus === "function") {
          tab.view.webContents.focus();
        }
        return snapshot();
      }
      if (action === "close") {
        if (attached === tab.view) detach();
        tabs.delete(tab.id);
        tab.view.webContents.close({ waitForBeforeUnload: false });
        if (activeId === tab.id) activeId = [...tabs.keys()].at(-1) || null;
        layout();
        emit();
        return snapshot();
      }
      const wc = tab.view.webContents;
      if (action === "navigate") {
        void navigate(tab, browserURL(payload.url));
        if (typeof tab.view.webContents?.focus === "function") {
          tab.view.webContents.focus();
        }
        return snapshot();
      }
      if (action === "back" && wc.navigationHistory.canGoBack())
        wc.navigationHistory.goBack();
      else if (action === "forward" && wc.navigationHistory.canGoForward())
        wc.navigationHistory.goForward();
      else if (action === "reload") wc.reload();
      else if (action === "stop") wc.stop();
      else if (action === "zoom") {
        if (
          !Number.isFinite(payload.factor) ||
          payload.factor < 0.5 ||
          payload.factor > 2.5
        )
          throw new Error("Zoom must be between 50% and 250%.");
        wc.setZoomFactor(payload.factor);
      } else if (action === "find") {
        if (typeof payload.text !== "string" || payload.text.length > 1000)
          throw new Error("Enter search text.");
        if (payload.text)
          wc.findInPage(payload.text, {
            forward: payload.forward !== false,
            findNext: payload.next === true,
          });
        else wc.stopFindInPage("clearSelection");
      } else if (!["back", "forward"].includes(action))
        throw new Error("Unknown browser command.");
      emit();
      return snapshot();
    },
  };
  return controller;
}
module.exports = { createBrowser, browserURL };
