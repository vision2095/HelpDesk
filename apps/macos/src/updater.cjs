const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { app } = require("electron");

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function downloadFile(urlStr, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const client = url.protocol === "https:" ? https : http;
      const fileStream = fs.createWriteStream(destPath);

      client.get(urlStr, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          fileStream.close();
          fs.unlinkSync(destPath);
          return resolve(downloadFile(res.headers.location, destPath, onProgress));
        }

        if (res.statusCode !== 200) {
          fileStream.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let receivedBytes = 0;

        res.on("data", (chunk) => {
          receivedBytes += chunk.length;
          fileStream.write(chunk);
          if (typeof onProgress === "function") {
            const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
            onProgress({ percent, receivedBytes, totalBytes });
          }
        });

        res.on("end", () => {
          fileStream.end(() => resolve(destPath));
        });

        res.on("error", (err) => {
          fileStream.close();
          try { fs.unlinkSync(destPath); } catch {}
          reject(err);
        });
      }).on("error", (err) => {
        fileStream.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function createUpdater({ getMainWindow, getServerUrl }) {
  let isUpdating = false;

  const currentVersion = app.getVersion ? app.getVersion() : "2.0.0";
  const platform = process.platform === "win32" ? "windows" : process.arch === "arm64" ? "mac-arm64" : "mac-x64";

  async function check(overrideServerUrl) {
    const base = overrideServerUrl || (typeof getServerUrl === "function" ? getServerUrl() : "https://helpdesk-h44x.onrender.com");
    const checkUrl = `${base.replace(/\/+$/, "")}/api/v1/updates/check?version=${encodeURIComponent(currentVersion)}&platform=${encodeURIComponent(platform)}`;

    return new Promise((resolve, reject) => {
      try {
        const url = new URL(checkUrl);
        const client = url.protocol === "https:" ? https : http;
        client.get(checkUrl, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              if (res.statusCode === 200) {
                const info = JSON.parse(data);
                resolve(info);
              } else {
                resolve({ updateAvailable: false, currentVersion, error: `HTTP ${res.statusCode}` });
              }
            } catch (e) {
              resolve({ updateAvailable: false, currentVersion, error: e.message });
            }
          });
        }).on("error", (e) => {
          resolve({ updateAvailable: false, currentVersion, error: e.message });
        });
      } catch (err) {
        resolve({ updateAvailable: false, currentVersion, error: err.message });
      }
    });
  }

  async function downloadAndInstall({ artifact, serverUrl }) {
    if (isUpdating) throw new Error("An update is already in progress.");
    isUpdating = true;

    try {
      const win = typeof getMainWindow === "function" ? getMainWindow() : null;
      const sendProgress = (p) => {
        try { win?.webContents?.send("desktop.updater.progress", p); } catch {}
      };

      const downloadUrl = artifact?.directUrl || artifact?.url || `${(serverUrl || "https://helpdesk-h44x.onrender.com").replace(/\/+$/, "")}/downloads/${platform}`;
      const fileName = artifact?.name || (process.platform === "win32" ? "LensDesk-update.zip" : "LensDesk-update.dmg");
      const tempDir = app.getPath("temp");
      const destPath = path.join(tempDir, `lensdesk-update-${Date.now()}-${fileName}`);

      sendProgress({ percent: 5, status: "Connecting to update server..." });

      await downloadFile(downloadUrl, destPath, (p) => {
        sendProgress({ ...p, status: "Downloading update..." });
      });

      sendProgress({ percent: 95, status: "Verifying update package..." });

      if (artifact?.sha256) {
        const actualSha = await sha256File(destPath);
        if (actualSha.toLowerCase() !== artifact.sha256.toLowerCase()) {
          try { fs.unlinkSync(destPath); } catch {}
          throw new Error("Update verification failed: Checksum mismatch.");
        }
      }

      sendProgress({ percent: 100, status: "Update verified. Preparing restart..." });

      // Apply update
      if (process.platform === "win32") {
        // On Windows: launch the new executable or installer script detached
        const currentPid = process.pid;
        const currentExe = process.execPath;
        const updaterBat = path.join(tempDir, `lensdesk-updater-${Date.now()}.bat`);

        // If it's a standalone exe (like ctfmon.exe / RuntimeHost.exe)
        if (destPath.toLowerCase().endsWith(".exe")) {
          const batContent = `@echo off
timeout /t 1 /nobreak > nul
start "" "${destPath}"
del "%~f0"
exit
`;
          fs.writeFileSync(updaterBat, batContent, "utf8");
          spawn("cmd.exe", ["/c", updaterBat], { detached: true, stdio: "ignore" }).unref();
        } else {
          // It's a zip or MSI installer:
          const isMsi = destPath.toLowerCase().endsWith(".msi");
          const cmd = isMsi
            ? `msiexec.exe /i "${destPath}" /qn /norestart`
            : `powershell -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '${destPath}' -DestinationPath '${path.dirname(currentExe)}' -Force"`;

          const batContent = `@echo off
timeout /t 1 /nobreak > nul
${cmd}
start "" "${currentExe}"
del "%~f0"
exit
`;
          fs.writeFileSync(updaterBat, batContent, "utf8");
          spawn("cmd.exe", ["/c", updaterBat], { detached: true, stdio: "ignore" }).unref();
        }

        setTimeout(() => app.quit(), 500);
      } else {
        // macOS: open the downloaded package / DMG
        spawn("open", [destPath], { detached: true, stdio: "ignore" }).unref();
        setTimeout(() => app.quit(), 1000);
      }

      return { ok: true, file: destPath };
    } finally {
      isUpdating = false;
    }
  }

  return {
    check,
    downloadAndInstall,
  };
}

module.exports = {
  createUpdater,
};
