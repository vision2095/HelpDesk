const path = require("node:path");
const { fileURLToPath } = require("node:url");

function createRequestPolicy({ entryURL, dev = false, platform = process.platform }) {
  function localPath(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:" || parsed.search) return null;
    parsed.hash = "";
    const windows = platform === "win32";
    const filename = fileURLToPath(parsed, { windows });
    return windows ? path.win32.normalize(filename).toLowerCase() : filename;
  }
  function trusted(url) {
    try {
      if (dev) return new URL(url).origin === "http://127.0.0.1:5173";
      return localPath(url) !== null && localPath(url) === localPath(entryURL);
    } catch {
      return false;
    }
  }
  function allows(event, window) {
    if (!window || window.isDestroyed() || event.sender !== window.webContents) return false;
    const frame = event.senderFrame;
    const mainFrame = window.webContents.mainFrame;
    return Boolean(
      frame && mainFrame && !frame.isDestroyed() &&
      frame.processId === mainFrame.processId &&
      frame.routingId === mainFrame.routingId &&
      trusted(frame.url),
    );
  }
  return { trusted, allows };
}
module.exports = { createRequestPolicy };
