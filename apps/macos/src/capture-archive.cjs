const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const archiveName = /^LensDesk-Capture-[\dTZ-]+-[0-9a-f-]{36}\.(png|jpg|jpeg)$/;
const limit = 200 * 1024 * 1024;
function createCaptureArchive({ getPreferences }) {
  let queue = Promise.resolve();
  async function status(directory = getPreferences().captureArchive.directory) {
    if (!directory) return { directory: "", files: 0, bytes: 0, limit };
    const entries = await fs.readdir(directory, { withFileTypes: true });
    let files = 0,
      bytes = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !archiveName.test(entry.name)) continue;
      const info = await fs.stat(path.join(directory, entry.name));
      files++;
      bytes += info.size;
    }
    return { directory, files, bytes, limit };
  }
  function save(image) {
    const preferences = getPreferences().captureArchive;
    if (!preferences.enabled) return Promise.resolve({ saved: false });
    const task = queue.then(async () => {
      if (!preferences.directory || !path.isAbsolute(preferences.directory))
        throw new Error("Choose an archive folder in Desktop settings.");
      if (
        typeof image !== "string" ||
        !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)
      )
        throw new Error("Only PNG or JPEG screenshots can be archived.");
      const bytes = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
      if (bytes.length > 10 * 1024 * 1024)
        throw new Error("Screenshot exceeds the 10 MB archive limit.");
      const current = await status(preferences.directory);
      if (current.bytes + bytes.length > limit)
        throw new Error(
          "Screenshot archive reached 200 MB. Move or remove older captures to continue saving.",
        );
      const ext = image.startsWith("data:image/jpeg") ? "jpg" : "png";
      const filename = `LensDesk-Capture-${new Date()
        .toISOString()
        .replaceAll(":", "-")
        .replace(/\.\d{3}/, "")}-${randomUUID()}.${ext}`;
      await fs.writeFile(path.join(preferences.directory, filename), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      return { saved: true, filename };
    });
    queue = task.catch(() => {});
    return task;
  }
  return { status, save };
}
module.exports = { createCaptureArchive };
