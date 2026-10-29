// Mouse gestures are intentionally scoped to the supplied LensDesk window target.
// This does not register an operating-system mouse hook.
export function radialSlotAt({
  x,
  y,
  center,
  slots = 6,
  size = 100,
  style = "wheel",
}) {
  if (![4, 6, 8].includes(slots) || !Number.isFinite(x) || !Number.isFinite(y))
    return null;
  const scale = Math.max(50, Math.min(150, Number(size) || 100)) / 100;
  const distance = Math.hypot(x - center.x, y - center.y);
  if (distance < 45 * scale || (style !== "flick" && distance > 135 * scale))
    return null;
  const slice = 360 / slots;
  // Slot 1 is centered on twelve o'clock; the rest run clockwise.
  const angle =
    ((((Math.atan2(y - center.y, x - center.x) * 180) / Math.PI +
      90 +
      slice / 2) %
      360) +
      360) %
    360;
  return Math.floor(angle / slice) + 1;
}

export function installMouseGestures(target, config, onOpen, onCancel) {
  if (!config?.enabled) return () => {};
  const button = config.trigger === "right" ? 2 : 1;
  const holdMs = Math.max(0, Math.min(1000, Number(config.holdMs) || 0));
  let gesture = null,
    timer = null,
    suppressUntil = 0,
    disposed = false;
  const stopTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const clear = (cancelOpened = false) => {
    stopTimer();
    const wasOpen = gesture?.opened;
    gesture = null;
    if (cancelOpened && wasOpen) onCancel();
  };
  const open = (center) => {
    if (disposed || !gesture || gesture.opened) return;
    stopTimer();
    gesture.opened = true;
    suppressUntil = Date.now() + 300;
    onOpen({ x: center.x, y: center.y });
  };
  const down = (event) => {
    if (event.button !== button || gesture) return;
    gesture = {
      start: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
      opened: false,
    };
    if (holdMs > 0)
      timer = setTimeout(() => {
        if (gesture) open(gesture.current);
      }, holdMs);
  };
  const move = (event) => {
    if (!gesture) return;
    gesture.current = { x: event.clientX, y: event.clientY };
    if (
      !gesture.opened &&
      holdMs === 0 &&
      Math.hypot(
        event.clientX - gesture.start.x,
        event.clientY - gesture.start.y,
      ) >= 8
    )
      open(gesture.start);
    if (gesture.opened) event.preventDefault();
  };
  const up = (event) => {
    if (event.button !== button || !gesture) return;
    const opened = gesture.opened;
    clear();
    if (opened) {
      suppressUntil = Date.now() + 300;
      event.preventDefault();
    }
    // The rendered wheel owns release selection. Let the event reach its listener.
  };
  const cancel = () => clear(true);
  const key = (event) => {
    if (event.key === "Escape" && gesture) {
      if (gesture.opened) event.preventDefault();
      cancel();
    }
  };
  const suppress = (event) => {
    if (
      event.button === button &&
      (gesture?.opened || Date.now() < suppressUntil)
    ) {
      event.preventDefault();
    }
  };
  const bindings = [
    ["mousedown", down],
    ["mousemove", move],
    ["mouseup", up],
    ["keydown", key],
    ["blur", cancel],
    ["contextmenu", suppress],
    ["auxclick", suppress],
  ];
  for (const [name, listener] of bindings)
    target.addEventListener(name, listener, { passive: false });
  return () => {
    if (disposed) return;
    disposed = true;
    for (const [name, listener] of bindings)
      target.removeEventListener(name, listener);
    clear(true);
  };
}
