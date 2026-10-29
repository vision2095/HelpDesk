/** Opt-in focus telemetry for the desktop overlay HUD.
 *
 * Verify focus preservation manually:
 *   1. Toggle the floating overlay on.
 *   2. In the overlay's DevTools console run
 *      `localStorage.setItem("lens:debugFocus", "1")` and reload.
 *   3. Focus another application, then use the overlay shortcut and type in
 *      the HUD. Every focus loss increments the counters and, while debug
 *      mode is on, a console line reports changes every few seconds
 *      (`blurs=N hides=N`). `window.__lensFocusSnapshot()` always returns the
 *      current counters, even with logging disabled.
 *
 * While the HUD floats above other windows the counters should stay put: the
 * window is shown with showInactive() and macOS windows use the panel option.
 */

declare global {
  interface Window {
    __lensFocusSnapshot?: () => { blurs: number; hides: number };
  }
}

export function installOverlayFocusDebug(intervalMs = 2000): () => void {
  const counters = { blurs: 0, hides: 0 };
  let reported = { blurs: -1, hides: -1 };

  function enabled() {
    try {
      return localStorage.getItem("lens:debugFocus") === "1";
    } catch {
      return false;
    }
  }

  const onBlur = () => {
    counters.blurs++;
    if (enabled()) console.log(`%cBLUR #${counters.blurs}`, "color:red");
  };
  const onVisibility = () => {
    if (!document.hidden) return;
    counters.hides++;
    if (enabled()) console.log("%cHIDDEN", "color:red");
  };
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  window.__lensFocusSnapshot = () => ({ ...counters });

  const timer = window.setInterval(() => {
    if (!enabled()) return;
    if (counters.blurs === reported.blurs && counters.hides === reported.hides)
      return; // console stays quiet until something changes
    reported = { ...counters };
    console.log(`blurs=${counters.blurs} hides=${counters.hides}`);
  }, intervalMs);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    delete window.__lensFocusSnapshot;
  };
}
