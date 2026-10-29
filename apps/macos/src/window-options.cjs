/** Focus-preserving window options, one source for every BrowserWindow.
 *
 * darwin: the window is an NSPanel ("panel" type) that does not activate the
 * app when clicked and stays hidden from Mission Control, so the floating HUD
 * never pulls focus away from the window the user is working in.
 *
 * win32/linux: no extra creation options. Taskbar/Alt+Tab exclusion is applied
 * at runtime with setSkipTaskbar while the overlay is floating
 * (see toggleOverlay in main.cjs).
 */
function windowOptions(platform = process.platform) {
  if (platform === "darwin") {
    return { type: "panel", hiddenInMissionControl: true };
  }
  return {};
}

module.exports = { windowOptions };
