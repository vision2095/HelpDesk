const { execSync } = require("node:child_process");
const fs = require("node:fs");

let cachedGuid = null;

function getMachineGuid() {
  if (cachedGuid) return cachedGuid;

  if (process.platform === "win32") {
    try {
      const output = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: "utf8", timeout: 2500, stdio: ["pipe", "pipe", "ignore"] }
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+([A-Fa-f0-9-]+)/i);
      if (match && match[1]) {
        cachedGuid = match[1].trim().toLowerCase();
        return cachedGuid;
      }
    } catch {}
  } else if (process.platform === "darwin") {
    try {
      const output = execSync(
        "ioreg -rd1 -c IOPlatformExpertDevice",
        { encoding: "utf8", timeout: 2500, stdio: ["pipe", "pipe", "ignore"] }
      );
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
      if (match && match[1]) {
        cachedGuid = match[1].trim().toLowerCase();
        return cachedGuid;
      }
    } catch {}
  } else {
    // Linux /etc/machine-id or /var/lib/dbus/machine-id
    try {
      if (fs.existsSync("/etc/machine-id")) {
        cachedGuid = fs.readFileSync("/etc/machine-id", "utf8").trim().toLowerCase();
        return cachedGuid;
      }
      if (fs.existsSync("/var/lib/dbus/machine-id")) {
        cachedGuid = fs.readFileSync("/var/lib/dbus/machine-id", "utf8").trim().toLowerCase();
        return cachedGuid;
      }
    } catch {}
  }

  // Fallback persistent UUID
  cachedGuid = "hw-" + require("node:crypto").randomUUID();
  return cachedGuid;
}

module.exports = { getMachineGuid };
