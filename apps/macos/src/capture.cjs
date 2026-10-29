function createCapture({
  desktopCapturer,
  systemPreferences,
  dialog,
  getWindow,
  screen,
  platform = process.platform,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  captureTimeoutMs = 8000,
}) {
  let active = false;
  let restorePending;
  function restoreWindow() {
    restorePending?.();
  }
  async function getSources(options) {
    let timer;
    try {
      return await Promise.race([
        desktopCapturer.getSources(options),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            "Screen capture timed out. Your window has been restored. Check Screen & System Audio Recording permission in System Settings, then retry.",
          )), captureTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function requirePermission() {
    if (
      platform === "darwin" &&
      ["denied", "restricted"].includes(
        systemPreferences.getMediaAccessStatus("screen"),
      )
    )
      throw new Error(
        "Allow LensDesk in System Settings > Privacy & Security > Screen & System Audio Recording, then restart LensDesk.",
      );
  }
  async function capture(payload = {}) {
    requirePermission();
    if (
      !payload ||
      typeof payload !== "object" ||
      (payload.id !== undefined &&
        (typeof payload.id !== "string" || payload.id.length > 300)) ||
      (payload.mode !== undefined &&
        !["active", "all", "specific"].includes(payload.mode)) ||
      (payload.displayId !== undefined &&
        (typeof payload.displayId !== "string" ||
          payload.displayId.length > 100))
    )
      throw new Error("Choose a valid capture source.");
    if (active) throw new Error("A screenshot is already in progress.");
    active = true;
    let win,
      previousOpacity = 1,
      wasVisible = false;
    try {
      let selectedId = payload.id;
      let selectedIds;
      if (!selectedId) {
        const includeWindows =
          !payload.mode && !payload.silent && !payload.preferPrimary;
        const choices = await getSources({
          types: includeWindows ? ["screen", "window"] : ["screen"],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (!choices.length)
          throw new Error(
            "No capture sources are available. Check screen recording permission.",
          );
        if (payload.mode && !payload.id) {
          const displays = choices.filter((s) => s.id.startsWith("screen:"));
          if (payload.mode === "all") {
            if (displays.length > 5)
              throw new Error(
                "At most five displays can be attached in one capture. Choose a specific display.",
              );
            selectedIds = displays.map((s) => s.id);
          } else {
            const displayId =
              payload.mode === "specific"
                ? payload.displayId
                : String(
                    screen?.getDisplayNearestPoint(
                      screen.getCursorScreenPoint(),
                    ).id ?? "",
                  );
            const source =
              displays.find((s) => s.display_id === displayId) ||
              (payload.mode === "active" && displays.length === 1
                ? displays[0]
                : null);
            if (!source)
              throw new Error(
                "The configured display is unavailable. Choose another display in Capture settings.",
              );
            selectedId = source.id;
          }
        } else if (payload.silent || payload.preferPrimary) {
          const primary =
            choices.find((s) => s.id.startsWith("screen:")) || choices[0];
          selectedId = primary.id;
        } else {
          const { response } = await dialog.showMessageBox(getWindow(), {
            type: "question",
            title: "Choose screenshot source",
            message: "Select the screen or window to capture.",
            detail: "The selected image will be attached to your AI request.",
            buttons: [...choices.map((s) => s.name), "Cancel"],
            cancelId: choices.length,
            defaultId: choices.length,
            noLink: true,
          });
          if (
            !Number.isInteger(response) ||
            response < 0 ||
            response >= choices.length
          )
            throw new Error("Screen capture canceled.");
          selectedId = choices[response].id;
        }
      }
      win = getWindow();
      wasVisible = Boolean(win && !win.isDestroyed() && win.isVisible());
      previousOpacity =
        typeof win?.getOpacity === "function" ? win.getOpacity() : 1;
      if (wasVisible) {
        restorePending = () => {
          restorePending = undefined;
          if (win.isDestroyed()) return;
          try {
            win.setOpacity?.(previousOpacity);
          } catch {}
          if (typeof win.showInactive === "function") win.showInactive();
          else win.show();
        };
        try {
          if (typeof win.setOpacity === "function") win.setOpacity(0);
        } catch {}
        win.hide();
      }
      await wait(wasVisible ? 150 : 0);
      const targetIds = selectedIds || [selectedId];
      const onlyScreens = targetIds.every(
        (id) => typeof id === "string" && id.startsWith("screen:"),
      );
      const sources = await getSources({
        types: onlyScreens ? ["screen"] : ["screen", "window"],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      const selected = targetIds.map((id) =>
        sources.find((s) => s.id === id),
      );
      if (!selected.length || selected.some((s) => !s || s.thumbnail.isEmpty()))
        throw new Error(
          "The selected source is unavailable or permission was denied. Choose another source and check screen recording permission.",
        );
      // Keep desktop captures lossless. The archive promises readable PNG
      // files on disk, and the renderer also uses the same data URL for the
      // attached screenshot.
      const images = selected.map((source) => source.thumbnail.toDataURL());
      return { image: images[0], images };
    } finally {
      active = false;
      restoreWindow();
    }
  }
  return { capture, requirePermission, restoreWindow };
}
module.exports = { createCapture };
