// Synchronous bridge initialization for Windows WebView2 host.
// Runs before React mounts to guarantee window.lens is never undefined.
if (
  typeof window !== "undefined" &&
  !window.lens &&
  (window as any).chrome?.webview
) {
  (function () {
    const nextIdRef = { current: 1 };
    const pending = new Map<
      number,
      { resolve: (val: any) => void; reject: (err: any) => void }
    >();
    const listeners = {
      gate: new Set<(v: any) => void>(),
      preferences: new Set<(v: any) => void>(),
      browserState: new Set<(v: any) => void>(),
      browserFocusAddress: new Set<() => void>(),
      browserFocusFind: new Set<() => void>(),
      chat: new Set<(v: any) => void>(),
      shortcut: new Set<(v: any) => void>(),
      overlay: new Set<(v: any) => void>(),
      clickThrough: new Set<(v: any) => void>(),
      opacity: new Set<(v: any) => void>(),
      globalKey: new Set<(v: any) => void>(),
      updaterProgress: new Set<(v: any) => void>(),
      updaterAvailable: new Set<(v: any) => void>(),
      custom: new Map<string, Set<(v: any) => void>>(),
    };

    (window as any).chrome.webview.addEventListener(
      "message",
      function (event: any) {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === "response") {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            if (msg.error)
              p.reject(
                new Error(
                  typeof msg.error === "string"
                    ? msg.error
                    : msg.error.message || "Request failed",
                ),
              );
            else p.resolve(msg.result);
          }
        } else if (msg.type === "event") {
          const evName = msg.event;
          const data = msg.data;
          if (evName === "lens:gate")
            listeners.gate.forEach((fn) => fn(data));
          else if (evName === "lens:preferences")
            listeners.preferences.forEach((fn) => fn(data));
          else if (evName === "lens:browser-state")
            listeners.browserState.forEach((fn) => fn(data));
          else if (evName === "lens:browser-focus-address")
            listeners.browserFocusAddress.forEach((fn) => fn());
          else if (evName === "lens:browser-focus-find")
            listeners.browserFocusFind.forEach((fn) => fn());
          else if (evName === "lens:chat")
            listeners.chat.forEach((fn) => fn(data));
          else if (evName === "lens:shortcut")
            listeners.shortcut.forEach((fn) =>
              fn(
                typeof data === "object" && data && data.action
                  ? data.action
                  : data,
              ),
            );
          else if (evName === "lens:overlay")
            listeners.overlay.forEach((fn) => fn(data));
          else if (evName === "lens:clickThrough")
            listeners.clickThrough.forEach((fn) => fn(data));
          else if (evName === "lens:opacity-changed")
            listeners.opacity.forEach((fn) =>
              fn(
                typeof data === "number"
                  ? data
                  : data && data.opacity != null
                    ? data.opacity
                    : 1,
              ),
            );
          else if (evName === "gkey")
            listeners.globalKey.forEach((fn) => fn(data));
          else if (evName === "desktop.updater.progress")
            listeners.updaterProgress.forEach((fn) => fn(data));
          else if (evName === "desktop.updater.available")
            listeners.updaterAvailable.forEach((fn) => fn(data));

          const customSet = listeners.custom.get(evName);
          if (customSet) {
            customSet.forEach((fn) => fn(data));
          }
        }
      },
    );

    (window as any).lens = {
      platform: "win32",
      invoke: function (action: string, payload?: any) {
        return new Promise(function (resolve, reject) {
          const id = nextIdRef.current++;
          pending.set(id, { resolve, reject });
          (window as any).chrome.webview.postMessage({
            id,
            action,
            payload: payload || {},
          });
        });
      },
      capture: function (payload?: any) {
        return (window as any).lens.invoke("desktop.capture", payload || {});
      },
      relaunch: function () {
        return (window as any).lens.invoke("desktop.restart", {});
      },
      openScreenSettings: function () {
        return (window as any).lens.invoke(
          "desktop.openScreenSettings",
          {},
        );
      },
      openAccessibilitySettings: function () {
        return (window as any).lens.invoke(
          "desktop.openAccessibilitySettings",
          {},
        );
      },
      openSettings: function () {
        return (window as any).lens.invoke("desktop.openSettings", {});
      },
      onGate: function (fn: (v: any) => void) {
        listeners.gate.add(fn);
        return function () {
          listeners.gate.delete(fn);
        };
      },
      onPreferences: function (fn: (v: any) => void) {
        listeners.preferences.add(fn);
        return function () {
          listeners.preferences.delete(fn);
        };
      },
      onBrowserState: function (fn: (v: any) => void) {
        listeners.browserState.add(fn);
        return function () {
          listeners.browserState.delete(fn);
        };
      },
      onBrowserFocusAddress: function (fn: () => void) {
        listeners.browserFocusAddress.add(fn);
        return function () {
          listeners.browserFocusAddress.delete(fn);
        };
      },
      onBrowserFocusFind: function (fn: () => void) {
        listeners.browserFocusFind.add(fn);
        return function () {
          listeners.browserFocusFind.delete(fn);
        };
      },
      onChatEvent: function (fn: (v: any) => void) {
        listeners.chat.add(fn);
        return function () {
          listeners.chat.delete(fn);
        };
      },
      onShortcut: function (fn: (v: any) => void) {
        listeners.shortcut.add(fn);
        return function () {
          listeners.shortcut.delete(fn);
        };
      },
      onOverlay: function (fn: (v: any) => void) {
        listeners.overlay.add(fn);
        return function () {
          listeners.overlay.delete(fn);
        };
      },
      onClickThrough: function (fn: (v: any) => void) {
        listeners.clickThrough.add(fn);
        return function () {
          listeners.clickThrough.delete(fn);
        };
      },
      onOpacityChanged: function (fn: (v: any) => void) {
        listeners.opacity.add(fn);
        return function () {
          listeners.opacity.delete(fn);
        };
      },
      onGlobalKey: function (fn: (v: any) => void) {
        listeners.globalKey.add(fn);
        return function () {
          listeners.globalKey.delete(fn);
        };
      },
      onUpdaterProgress: function (fn: (v: any) => void) {
        listeners.updaterProgress.add(fn);
        return function () {
          listeners.updaterProgress.delete(fn);
        };
      },
      onUpdaterAvailable: function (fn: (v: any) => void) {
        listeners.updaterAvailable.add(fn);
        return function () {
          listeners.updaterAvailable.delete(fn);
        };
      },
      on: function (channel: string, listener: (data: any) => void) {
        if (channel === "desktop.updater.available")
          return (window as any).lens.onUpdaterAvailable(listener);
        if (channel === "desktop.updater.progress")
          return (window as any).lens.onUpdaterProgress(listener);
        if (channel === "gkey")
          return (window as any).lens.onGlobalKey(listener);
        if (!listeners.custom.has(channel)) {
          listeners.custom.set(channel, new Set());
        }
        const set = listeners.custom.get(channel)!;
        set.add(listener);
        return function () {
          set.delete(listener);
        };
      },
    };
  })();
}
