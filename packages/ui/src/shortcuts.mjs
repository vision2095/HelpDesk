/** Match web fallbacks exactly; Command and Control are different modifiers. */
export function matchesShortcut(
  event,
  accelerator,
  mac = /Mac/.test(globalThis.navigator?.platform || ""),
) {
  const tokens = accelerator.toLowerCase().split("+");
  const key = tokens.pop();
  const modifiers = new Set(tokens);
  const common =
    modifiers.has("commandorcontrol") || modifiers.has("cmdorctrl");
  const meta =
    modifiers.has("command") || modifiers.has("cmd") || (common && mac);
  const ctrl =
    modifiers.has("control") || modifiers.has("ctrl") || (common && !mac);
  return (
    Boolean(event.metaKey) === meta &&
    Boolean(event.ctrlKey) === ctrl &&
    Boolean(event.shiftKey) === modifiers.has("shift") &&
    Boolean(event.altKey) ===
      (modifiers.has("alt") || modifiers.has("option")) &&
    event.key.toLowerCase().replace(/^arrow/, "") === key
  );
}
