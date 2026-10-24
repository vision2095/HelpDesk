/** One source for global shortcut semantics, including a stop on repeated typing. */
function createShortcutActions({
  getWindow,
  showWindow,
  send,
  toggleOverlay,
  toggleClickThrough,
  toggleTypingFocus,
  isTyping,
  stopTyping,
  getWorkArea,
  onQuit,
}) {
  const safeSend = (ch, data) => {
    try {
      send?.(ch, data);
    } catch {}
  };

  const toggleWindow = () => {
    if (getWindow?.()?.isVisible?.()) getWindow().hide();
    else showWindow?.();
  };

  const move = (dx, dy) => {
    const win = getWindow?.();
    if (!win) return;
    const bounds = win.getBounds?.() || {};
    const area =
      typeof getWorkArea === "function"
        ? getWorkArea.length
          ? getWorkArea(bounds)
          : getWorkArea(bounds) || getWorkArea()
        : null;
    if (!area) return;
    win.setBounds?.({
      ...bounds,
      x: Math.max(
        area.x,
        Math.min(bounds.x + dx, area.x + area.width - bounds.width),
      ),
      y: Math.max(
        area.y,
        Math.min(bounds.y + dy, area.y + area.height - bounds.height),
      ),
    });
  };

  return {
    ...Object.fromEntries(
      [
        "browser",
        "theme",
        "opacityUp",
        "opacityDown",
        "clearLastCapture",
        "clearCaptures",
        "undo",
        "clearBundle",
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
      ].map((action) => [
        action,
        () => {
          safeSend(action);
          if (action === "quit" && typeof onQuit === "function") {
            try {
              onQuit();
            } catch {}
          }
        },
      ]),
    ),
    moveUp: () => move(0, -40),
    moveDown: () => move(0, 40),
    moveLeft: () => move(-40, 0),
    moveRight: () => move(40, 0),
    toggle: toggleWindow,
    hide: toggleWindow,
    capture: () => safeSend("capture"),
    overlay: () => {
      showWindow?.();
      toggleOverlay?.();
    },
    toggleOverlay: () => {
      toggleOverlay?.();
    },
    hideAnswer: () => safeSend("hideAnswer"),
    autoType: () => {
      if (isTyping?.()) {
        stopTyping?.();
        safeSend("typingStopped");
      } else {
        safeSend("autoType");
      }
    },
    stopTyping: () => {
      stopTyping?.();
      safeSend("typingStopped");
    },
    clickThrough: () => {
      toggleClickThrough?.();
    },
    // click-through on/off
    mouseMode: () => {
      toggleClickThrough?.();
    },
    // dobara dabaya to typing STOP, warna start
    toggleTyping: () => {
      if (isTyping?.()) {
        stopTyping?.();
        safeSend("typingStopped");
        return;
      }
      toggleTypingFocus?.();
      safeSend("toggleTyping");
    },
    // overlay ko current screen ke corner me snap karo
    snapToWorkArea: () => {
      const win = getWindow?.();
      if (!win || win.isDestroyed?.()) return;
      const bounds = win.getBounds?.() || {};
      const area =
        typeof getWorkArea === "function"
          ? getWorkArea.length
            ? getWorkArea(bounds)
            : getWorkArea(bounds) || getWorkArea()
          : null;
      if (!area) return;
      const [w] =
        typeof win.getSize === "function"
          ? win.getSize()
          : [bounds.width || 470];
      if (typeof win.setPosition === "function") {
        win.setPosition(area.x + area.width - w - 20, area.y + 20);
      } else if (typeof win.setBounds === "function") {
        win.setBounds({
          ...bounds,
          x: area.x + area.width - w - 20,
          y: area.y + 20,
        });
      }
      safeSend("snapped");
    },
  };
}

module.exports = { createShortcutActions };
