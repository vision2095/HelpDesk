import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import {
  createReleases,
  NEUTRAL_EXECUTABLE_IDENTITIES,
  parseZipEntries,
  rebuildZip,
  customizeZipExecutable,
  resolveDynamicExecutableName,
} from "../../server/cloud/releases.mjs";

const { version } = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const zipName = `LensDesk-${version}-Windows-x64.zip`;

// Helper to create a synthetic valid ZIP in-memory without external libraries
function createTestZip(entries) {
  const localParts = [];
  const cdParts = [];
  let currentOffset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const rawData = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const compressedData = zlib.deflateRawSync(rawData);

    // Calculate CRC32
    let crc = 0 ^ -1;
    for (let i = 0; i < rawData.length; i++) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ rawData[i]) & 0xff];
    }
    crc = (crc ^ -1) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8); // Deflated
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressedData);

    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(0, 8);
    cdHeader.writeUInt16LE(8, 10);
    cdHeader.writeUInt16LE(0, 12);
    cdHeader.writeUInt16LE(0, 14);
    cdHeader.writeUInt32LE(crc, 16);
    cdHeader.writeUInt32LE(compressedData.length, 20);
    cdHeader.writeUInt32LE(rawData.length, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt16LE(0, 34);
    cdHeader.writeUInt16LE(0, 36);
    cdHeader.writeUInt32LE(0x81ed0000, 38); // Standard file attributes
    cdHeader.writeUInt32LE(currentOffset, 42);

    cdParts.push(cdHeader, nameBuf);
    currentOffset += localHeader.length + nameBuf.length + compressedData.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(currentOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

async function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "lensdesk-dynamic-zip-"),
  );
  let releases;
  const server = createServer(async (req, res) => {
    if (!(await releases.serve(req, res, new URL(req.url, origin)))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  releases = createReleases(directory, origin, { allowRemoteFallback: false });
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    try {
      fs.rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch {}
  });
  return { directory, releases, origin };
}

test("1. Reference samples verify HintLens multi-identity packaging mechanism", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const zip1Path = path.join(root, "research", "HintlensApp.zip");
  const zip2Path = path.join(root, "research", "HintlensApp-latest.zip");

  if (fs.existsSync(zip1Path) && fs.existsSync(zip2Path)) {
    const entries1 = parseZipEntries(fs.readFileSync(zip1Path));
    const entries2 = parseZipEntries(fs.readFileSync(zip2Path));

    const exe1 = entries1.find((e) => e.name.endsWith(".exe"));
    const exe2 = entries2.find((e) => e.name.endsWith(".exe"));

    assert.ok(exe1, "HintlensApp.zip should contain an .exe");
    assert.ok(exe2, "HintlensApp-latest.zip should contain an .exe");

    // Both reference archives contain identically-sized binaries under different names
    assert.equal(exe1.compSize, exe2.compSize);
    assert.equal(exe1.uncompSize, exe2.uncompSize);
    assert.equal(exe1.crc32, exe2.crc32);
    assert.notEqual(exe1.name, exe2.name, "Reference samples exhibit different executable names");
  }
});

test("2. Neutral executable identity pool contains 8 legitimate unbranded identities", () => {
  assert.equal(NEUTRAL_EXECUTABLE_IDENTITIES.length, 8);
  const expected = [
    "RuntimeHost.exe",
    "DesktopHost.exe",
    "AppHost.exe",
    "DesktopRuntime.exe",
    "ClientHost.exe",
    "DesktopClient.exe",
    "ApplicationHost.exe",
    "OverlayHost.exe",
  ];
  for (const name of expected) {
    assert.ok(
      NEUTRAL_EXECUTABLE_IDENTITIES.includes(name),
      `Identity pool must include ${name}`,
    );
    // Guarantee no LensDesk or HintLens branding in the neutral identities
    assert.equal(
      name.toLowerCase().includes("lensdesk"),
      false,
      `${name} must not contain LensDesk branding`,
    );
    assert.equal(
      name.toLowerCase().includes("hintlens"),
      false,
      `${name} must not contain HintLens branding`,
    );
  }
});

test("3. Requests with prohibited system process names are strictly rejected with HTTP 400", async (t) => {
  const { directory, origin } = await fixture(t);
  const sampleZip = createTestZip([
    { name: "RuntimeHost.exe", data: "BINARY_CONTENT_LENS_DESK" },
    { name: "WebView2Loader.dll", data: "DLL_CONTENT" },
  ]);
  fs.writeFileSync(path.join(directory, zipName), sampleZip);

  const prohibited = [
    "TiWorker.exe",
    "ctfmon.exe",
    "SearchProtocolHost.exe",
    "RuntimeBroker.exe",
    "smartscreen.exe",
    "sihost.exe",
    "SecurityHealthSystray.exe",
    "svchost.exe",
    "explorer.exe",
  ];

  for (const name of prohibited) {
    const res = await fetch(`${origin}/downloads/windows-zip?exeName=${name}`);
    assert.equal(res.status, 400, `Must reject prohibited name: ${name}`);
    const text = await res.text();
    assert.ok(text.includes("Invalid neutral executable identity"));
  }
});

test("4. Dynamic ZIP customization on the fly with specific neutral identity", async (t) => {
  const { directory, origin } = await fixture(t);
  const exeContent = Buffer.from("NATIVE_CPP20_DIRECTX11_RUNTIME_BYTES");
  const sampleZip = createTestZip([
    { name: "RuntimeHost.exe", data: exeContent },
    { name: "WebView2Loader.dll", data: "DLL_CONTENT" },
    { name: "resources/app.html", data: "<html>Application UI</html>" },
  ]);
  fs.writeFileSync(path.join(directory, zipName), sampleZip);

  const res = await fetch(
    `${origin}/downloads/windows-zip?exeName=DesktopHost.exe`,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-lensdesk-executable"), "DesktopHost.exe");

  const customBytes = Buffer.from(await res.arrayBuffer());
  const actualSha = createHash("sha256").update(customBytes).digest("hex");
  assert.equal(res.headers.get("x-lensdesk-sha256"), actualSha);

  // Inspect the customized zip entries
  const entries = parseZipEntries(customBytes);
  assert.equal(entries.length, 3);
  const exeEntry = entries.find((e) => e.name === "DesktopHost.exe");
  assert.ok(exeEntry, "DesktopHost.exe must exist in customized ZIP");
  assert.equal(
    entries.find((e) => e.name === "RuntimeHost.exe"),
    undefined,
    "RuntimeHost.exe must have been replaced",
  );

  // Decompress and verify bitwise integrity of the executable
  const decompressed = zlib.inflateRawSync(exeEntry.compressedData);
  assert.deepEqual(decompressed, exeContent, "Decompressed executable must be bitwise identical");
});

test("5. Dynamic rotating ZIP generation cycles through neutral identity pool", async (t) => {
  const { directory, origin } = await fixture(t);
  const sampleZip = createTestZip([
    { name: "RuntimeHost.exe", data: "RUNTIME_PAYLOAD" },
  ]);
  fs.writeFileSync(path.join(directory, zipName), sampleZip);

  const seenIdentities = new Set();
  for (let i = 0; i < NEUTRAL_EXECUTABLE_IDENTITIES.length; i++) {
    const res = await fetch(`${origin}/downloads/windows-zip?dynamic=true`);
    assert.equal(res.status, 200);
    const exeName = res.headers.get("x-lensdesk-executable");
    assert.ok(
      NEUTRAL_EXECUTABLE_IDENTITIES.includes(exeName),
      `Returned name ${exeName} must be in neutral identity pool`,
    );
    seenIdentities.add(exeName);

    const buf = Buffer.from(await res.arrayBuffer());
    const entries = parseZipEntries(buf);
    assert.equal(entries[0].name, exeName);
  }

  // Confirmed that rotation visited identities
  assert.ok(seenIdentities.size > 1, "Dynamic rotation must cycle through identities");
});

test("6. Canonical download without query parameters preserves RuntimeHost.exe", async (t) => {
  const { directory, origin } = await fixture(t);
  const sampleZip = createTestZip([
    { name: "RuntimeHost.exe", data: "CANONICAL_HOST" },
  ]);
  fs.writeFileSync(path.join(directory, zipName), sampleZip);

  const res = await fetch(`${origin}/downloads/windows-zip`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-lensdesk-executable"), "RuntimeHost.exe");

  const buf = Buffer.from(await res.arrayBuffer());
  const entries = parseZipEntries(buf);
  assert.equal(entries[0].name, "RuntimeHost.exe");
});

test("7. PowerShell launch script cleans up prior identities and launches discovered executable", async (t) => {
  const { directory, origin } = await fixture(t);
  const sampleZip = createTestZip([
    { name: "RuntimeHost.exe", data: "CANONICAL_HOST" },
  ]);
  fs.writeFileSync(path.join(directory, zipName), sampleZip);

  const res = await fetch(`${origin}/install.ps1`);
  assert.equal(res.status, 200);
  const script = await res.text();

  // Verify cleanup of old executable identities before extraction
  assert.ok(
    script.includes("Remove-Item -Force"),
    "Install script must clean up previous executables before installation",
  );

  // Verify discovery and launch of neutral or RuntimeHost executable
  assert.ok(
    script.includes("RuntimeHost.exe"),
    "Install script must discover and launch legitimate executable",
  );
});
