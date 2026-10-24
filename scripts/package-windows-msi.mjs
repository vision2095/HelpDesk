import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const releaseDir = path.resolve("release");
const msiName = `RuntimeHost-${version}-x64.msi`;
const msiPath = path.join(releaseDir, msiName);

if (!fs.existsSync(msiPath)) {
  throw new Error(`Windows installer not found at ${msiPath}`);
}

// An MSI is an OLE compound document. Reject an incorrectly renamed file
// before it is published as a Windows installer.
const signature = Buffer.alloc(8);
const handle = fs.openSync(msiPath, "r");
try {
  fs.readSync(handle, signature, 0, signature.length, 0);
} finally {
  fs.closeSync(handle);
}
if (
  !signature.equals(
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  )
) {
  throw new Error(`${msiName} is not an MSI (OLE compound document) package`);
}

const hash = createHash("sha256");
for await (const chunk of fs.createReadStream(msiPath)) hash.update(chunk);
const sha256 = hash.digest("hex");
const stat = fs.statSync(msiPath);

// Update release/checksums.json without disturbing macOS entries.
const checksumsPath = path.join(releaseDir, "checksums.json");
if (fs.existsSync(checksumsPath)) {
  const checksums = JSON.parse(fs.readFileSync(checksumsPath, "utf8"));
  if (checksums.artifacts) {
    const existing = checksums.artifacts.find(
      (a) => a.platform === "windows",
    );
    if (existing) {
      existing.name = msiName;
      existing.size = stat.size;
      existing.sha256 = sha256;
      existing.url = "/downloads/windows";
      existing.label = "Windows (x64)";
      delete existing.bytes;
    } else {
      checksums.artifacts.unshift({
        platform: "windows",
        label: "Windows (x64)",
        name: msiName,
        size: stat.size,
        sha256,
        url: "/downloads/windows",
      });
    }
  }
  checksums.generatedAt = new Date().toISOString();
  fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2) + "\n");
}

console.log(
  `Successfully packaged Windows MSI: ${msiName} (${stat.size} bytes, sha256: ${sha256})`,
);
