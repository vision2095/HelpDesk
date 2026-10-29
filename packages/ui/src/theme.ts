export type Theme = "light" | "dark" | "system";
type TextColors = { lightTextColor?: string; darkTextColor?: string };
export function applyTheme(
  theme: Theme,
  target: Document = document,
  colors: TextColors = {},
) {
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  target.documentElement.dataset.theme = dark ? "dark" : "light";
  target.documentElement.style.colorScheme = dark ? "dark" : "light";
  const color = dark ? colors.darkTextColor : colors.lightTextColor;
  if (color && /^#[0-9a-fA-F]{6}$/.test(color))
    target.documentElement.style.setProperty("--ink", color);
  else target.documentElement.style.removeProperty("--ink");
}
export function cacheTheme(theme: Theme, colors: TextColors = {}) {
  try {
    localStorage.setItem("lensdesk-theme", theme);
  } catch {
    /* Theme still works when storage is unavailable. */
  }
  applyTheme(theme, document, colors);
}
try {
  const cached = localStorage.getItem("lensdesk-theme");
  applyTheme(cached === "dark" || cached === "light" ? cached : "system");
} catch {
  applyTheme("system");
}
