const fallback: Record<string, string> = {
  toggle: "CommandOrControl+Shift+L",
  hide: "Shift+H",
  overlay: "CommandOrControl+Shift+O",
  capture: "CommandOrControl+Shift+S",
  hideAnswer: "CommandOrControl+Shift+A",
  autoType: "CommandOrControl+Shift+T",
  clickThrough: "Shift+M",
};
export function shortcutLabel(
  action: string,
  shortcuts: Record<string, string> | undefined,
  mac: boolean,
) {
  const value = shortcuts
    ? shortcuts[action] || "Not assigned"
    : fallback[action] || "Not assigned";
  return value
    .replaceAll("CommandOrControl", mac ? "⌘" : "Ctrl")
    .replaceAll("Command", "⌘")
    .replaceAll("Control", "Ctrl")
    .replaceAll("Alt", mac ? "⌥" : "Alt")
    .replaceAll("Shift", mac ? "⇧" : "Shift");
}
