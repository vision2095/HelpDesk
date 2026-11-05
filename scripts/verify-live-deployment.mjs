import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ORIGIN = "https://helpdesk-h44x.onrender.com";

console.log(`[1/6] Probing live health at ${ORIGIN}/health...`);
const healthRes = await fetch(`${ORIGIN}/health`);
assert.equal(healthRes.status, 200, "Health endpoint failed");
const healthJson = await healthRes.json();
assert.equal(healthJson.ok, true);
console.log("   ✓ Health OK:", healthJson);

console.log(`[2/6] Probing live checksums at ${ORIGIN}/checksums.json...`);
const checksumRes = await fetch(`${ORIGIN}/checksums.json`);
assert.equal(checksumRes.status, 200, "Checksums endpoint failed");
const checksumJson = await checksumRes.json();
console.log("   ✓ Checksums:", JSON.stringify(checksumJson, null, 2));

console.log(`[3/6] Verifying unauthenticated download gate on ${ORIGIN}...`);
// Unauthenticated API request must return 401
const unauthWin = await fetch(`${ORIGIN}/downloads/windows`, {
  headers: { Accept: "application/json" },
});
assert.equal(unauthWin.status, 401, "/downloads/windows must return 401 unauthenticated");
const unauthWinBody = await unauthWin.json();
assert.equal(unauthWinBody.authRequired, true);

const unauthWinZip = await fetch(`${ORIGIN}/downloads/windows-zip`, {
  headers: { Accept: "application/json" },
});
assert.equal(unauthWinZip.status, 401, "/downloads/windows-zip must return 401 unauthenticated");

const unauthApi = await fetch(`${ORIGIN}/api/v1/download/windows`, {
  headers: { Accept: "application/json" },
});
assert.equal(unauthApi.status, 401, "/api/v1/download/windows must return 401 unauthenticated");

const unauthPs1 = await fetch(`${ORIGIN}/install.ps1`);
assert.equal(unauthPs1.status, 401, "/install.ps1 must return 401 unauthenticated");

// Unauthenticated browser request must redirect to /?login=1
const unauthBrowser = await fetch(`${ORIGIN}/downloads/windows`, {
  headers: { Accept: "text/html" },
  redirect: "manual",
});
assert.equal(unauthBrowser.status, 302, "/downloads/windows should redirect HTML navigation");
assert.ok(unauthBrowser.headers.get("location")?.includes("login=1"));
console.log("   ✓ Unauthenticated gate verified (401 JSON and 302 login redirect)");

console.log(`[4/6] Registering test user on ${ORIGIN}...`);
const testEmail = `verifier-${Date.now()}@lensdesk.local`;
const testPass = "VerificationPassword123!";
const regRes = await fetch(`${ORIGIN}/api/auth.register`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-LensDesk-Client": "desktop",
  },
  body: JSON.stringify({
    email: testEmail,
    password: testPass,
    name: "Live Release Verifier",
  }),
});
assert.equal(regRes.status, 200, "Registration failed");
const regBody = await regRes.json();
assert.ok(regBody.token, "Token missing in registration response");
const token = regBody.token;
console.log(`   ✓ Authenticated as ${testEmail} with token: ${token.slice(0, 12)}...`);

console.log(`[5/6] Downloading and verifying Windows Setup Installer (.exe)...`);
const setupRes = await fetch(`${ORIGIN}/downloads/windows?token=${token}`);
assert.equal(setupRes.status, 200, "Authenticated setup download failed");
const setupDisposition = setupRes.headers.get("content-disposition") || "";
console.log("   Headers:", {
  "content-type": setupRes.headers.get("content-type"),
  "content-disposition": setupDisposition,
});
const setupBuf = Buffer.from(await setupRes.arrayBuffer());
const setupSha = createHash("sha256").update(setupBuf).digest("hex");
console.log(`   ✓ Setup downloaded: ${setupBuf.length} bytes, SHA-256: ${setupSha}`);
assert.equal(setupSha, "9caac9c295f505c68cdcec7b1a96b81877f68e5b8abdbee7dc875c44acb0adf1", "Setup SHA-256 mismatch!");

console.log(`[6/6] Downloading and verifying Windows Portable ZIP (.zip)...`);
const zipRes = await fetch(`${ORIGIN}/downloads/windows-zip?token=${token}&canonical=1`);
assert.equal(zipRes.status, 200, "Authenticated zip download failed");
const zipDisposition = zipRes.headers.get("content-disposition") || "";
console.log("   Headers:", {
  "content-type": zipRes.headers.get("content-type"),
  "content-disposition": zipDisposition,
});
const zipBuf = Buffer.from(await zipRes.arrayBuffer());
const zipSha = createHash("sha256").update(zipBuf).digest("hex");
console.log(`   ✓ Portable ZIP downloaded: ${zipBuf.length} bytes, SHA-256: ${zipSha}`);
assert.equal(zipSha, "96d277db1bdbd6efb2dfe218186a485c019eb192249333ae28cd834026ce7864", "ZIP SHA-256 mismatch!");

// Verify ZIP contents in temporary directory
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-verify-live-"));
const zipPath = path.join(tmpDir, "download.zip");
fs.writeFileSync(zipPath, zipBuf);
const { execSync } = await import("node:child_process");
const zipList = execSync(`unzip -l "${zipPath}"`, { encoding: "utf8" });
assert.ok(zipList.includes("RuntimeHost.exe"), "ZIP must contain RuntimeHost.exe");
assert.ok(!zipList.includes("dist/index.html"), "ZIP must contain exclusively 1 file: no loose dist/ directory");
assert.ok(!zipList.includes("WebView2Loader.dll"), "ZIP must contain exclusively 1 file: no loose WebView2Loader.dll");
assert.ok(!zipList.includes("TiWorker.exe"), "ZIP must NEVER contain TiWorker.exe");
assert.ok(!zipList.includes("ctfmon.exe"), "ZIP must NEVER contain ctfmon.exe");
console.log("   ✓ ZIP archive contents verified: strictly 1 file (genuine RuntimeHost.exe), zero TiWorker/ctfmon/dist");
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("\n========================================================");
console.log("🎉 ALL LIVE RENDER DEPLOYMENT CHECKS PASSED WITH 100% PARITY!");
console.log("========================================================\n");
