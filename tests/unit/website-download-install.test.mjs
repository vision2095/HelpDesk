import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createCloudServer } from "../../server/cloud/app.mjs";

const { version } = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const setupName = `LensDesk-${version}-Setup.exe`;
const zipName = `LensDesk-${version}-Windows-x64.zip`;

test("Website authentication gate protects Windows downloads", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-auth-dl-"));
  const releaseDir = path.join(directory, "releases");
  fs.mkdirSync(releaseDir, { recursive: true });

  const setupBytes = Buffer.from("MZ_MOCK_PE_HEADER_LENSDESK_SETUP_EXE");
  const zipBytes = Buffer.from("PK_MOCK_ZIP_HEADER_LENSDESK_PORTABLE_ZIP");
  fs.writeFileSync(path.join(releaseDir, setupName), setupBytes);
  fs.writeFileSync(path.join(releaseDir, zipName), zipBytes);

  process.env.DOWNLOAD_DIRECTORY = releaseDir;
  process.env.REQUIRE_DOWNLOAD_AUTH = "true";

  const app = createCloudServer({
    directory,
    publicUrl: "https://lensdesk.test",
    encryptionKey: randomBytes(32).toString("hex"),
    releasesDirectory: releaseDir,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const serverUrl = `http://127.0.0.1:${app.server.address().port}`;

  t.after(async () => {
    delete process.env.DOWNLOAD_DIRECTORY;
    delete process.env.REQUIRE_DOWNLOAD_AUTH;
    await app.close();
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {}
  });

  // 1. Unauthenticated browser navigation redirects to login
  const browserResp = await fetch(`${serverUrl}/downloads/windows`, {
    headers: { Accept: "text/html" },
    redirect: "manual",
  });
  assert.equal(browserResp.status, 302);
  assert.equal(
    browserResp.headers.get("location"),
    "/?login=1&notice=create_account_to_download",
  );

  // 2. Unauthenticated API download returns 401 JSON
  const apiResp = await fetch(`${serverUrl}/api/v1/download/windows`, {
    headers: { Accept: "application/json" },
  });
  assert.equal(apiResp.status, 401);
  const apiBody = await apiResp.json();
  assert.equal(apiBody.authRequired, true);
  assert.ok(apiBody.error.includes("account"));

  // 3. Register and obtain a valid user token and session cookie
  const regResp = await fetch(`${serverUrl}/api/auth.register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LensDesk-Client": "desktop",
    },
    body: JSON.stringify({
      email: "engineer@lensdesk.com",
      password: "StrongPassword123!",
      name: "LensDesk Engineer",
    }),
  });
  assert.equal(regResp.status, 200);
  const regBody = await regResp.json();
  assert.ok(regBody.token);
  const userToken = regBody.token;

  const setCookie = regResp.headers.get("set-cookie") || "";
  const sessionCookie = setCookie.split(";")[0]; // lens_session=...

  // 4. Authenticated request downloads the genuine Windows Setup installer (via token query)
  const dlResp = await fetch(`${serverUrl}/downloads/windows?token=${userToken}`);
  assert.equal(dlResp.status, 200);
  assert.equal(
    dlResp.headers.get("content-type"),
    "application/vnd.microsoft.portable-executable",
  );
  assert.equal(
    dlResp.headers.get("content-disposition"),
    `attachment; filename="${setupName}"`,
  );
  const downloadedBytes = Buffer.from(await dlResp.arrayBuffer());
  assert.deepEqual(downloadedBytes, setupBytes);
  const expectedHash = createHash("sha256").update(setupBytes).digest("hex");
  const actualHash = createHash("sha256").update(downloadedBytes).digest("hex");
  assert.equal(actualHash, expectedHash);

  // 4b. Authenticated request via browser cookie (lens_session) without token in URL
  const cookieDlResp = await fetch(`${serverUrl}/downloads/windows`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(cookieDlResp.status, 200);
  assert.equal(
    cookieDlResp.headers.get("content-disposition"),
    `attachment; filename="${setupName}"`,
  );
  const cookieDownloadedBytes = Buffer.from(await cookieDlResp.arrayBuffer());
  assert.deepEqual(cookieDownloadedBytes, setupBytes);

  // 5. Authenticated request downloads portable ZIP via format=zip query or /downloads/windows-zip
  const zipDlResp = await fetch(
    `${serverUrl}/downloads/windows-zip?token=${userToken}`,
  );
  assert.equal(zipDlResp.status, 200);
  assert.equal(zipDlResp.headers.get("content-type"), "application/zip");
  assert.equal(
    zipDlResp.headers.get("content-disposition"),
    `attachment; filename="${zipName}"`,
  );
  const downloadedZipBytes = Buffer.from(await zipDlResp.arrayBuffer());
  assert.deepEqual(downloadedZipBytes, zipBytes);

  // 6. Alternative route /download?platform=windows works with token
  const altResp = await fetch(
    `${serverUrl}/download?platform=windows&token=${userToken}`,
  );
  assert.equal(altResp.status, 200);
  assert.equal(
    altResp.headers.get("content-disposition"),
    `attachment; filename="${setupName}"`,
  );

  // 7. Authenticated PowerShell script includes correct hash verification
  const psResp = await fetch(`${serverUrl}/lensdesk-install.ps1?token=${userToken}`);
  assert.equal(psResp.status, 200);
  const psScript = await psResp.text();
  assert.ok(psScript.includes(expectedHash));
  assert.ok(psScript.includes("RuntimeHost.exe"));
  assert.ok(psScript.includes("Start-Process -FilePath $download"));
});

test("Windows installer configuration and packaging guarantee LensDesk 2.0 branding", () => {
  const root = path.resolve(".");

  // 1. installer.nsi product branding
  const nsi = fs.readFileSync(path.join(root, "installer/installer.nsi"), "utf8");
  assert.match(nsi, /!define PRODUCT_NAME "LensDesk"/);
  assert.match(nsi, /!define PRODUCT_VERSION "2\.0\.0"/);
  assert.match(nsi, /OutFile "\.\.\\release\\LensDesk-2\.0\.0-Setup\.exe"/);
  assert.match(nsi, /InstallDir "\$LOCALAPPDATA\\LensDesk"/);
  assert.match(nsi, /CreateShortcut "\$SMPROGRAMS\\LensDesk\\LensDesk\.lnk"/);
  assert.match(nsi, /CreateShortcut "\$DESKTOP\\LensDesk\.lnk"/);
  assert.match(nsi, /WriteRegStr \${PRODUCT_UNINST_ROOT_KEY} "\${PRODUCT_UNINST_KEY}" "DisplayName"/);

  // 2. package-windows-zip.mjs layout and security boundaries
  const pkgScript = fs.readFileSync(
    path.join(root, "scripts/package-windows-zip.mjs"),
    "utf8",
  );
  assert.match(pkgScript, /LensDesk-\${version}-Windows-x64\.zip/);
  assert.match(pkgScript, /TiWorker\.exe/);
  assert.match(pkgScript, /SearchProtocolHost\.exe/);
  assert.match(pkgScript, /Refusing to package process-impersonation names/);
  assert.match(pkgScript, /ZIP must contain RuntimeHost\.exe/);
  assert.match(pkgScript, /ZIP must contain dist\/index\.html/);

  // 3. app.rc Windows PE Version resources
  for (const rcPath of [
    "src-native/resources/app.rc",
    "apps/windows/src-native/resources/app.rc",
  ]) {
    const rc = fs.readFileSync(path.join(root, rcPath), "utf8");
    assert.match(rc, /VALUE "ProductName",\s+"LensDesk 2\.0\\0"/);
    assert.match(rc, /VALUE "FileDescription",\s+"LensDesk 2\.0 Native Windows Host\\0"/);
    assert.match(rc, /VALUE "OriginalFilename",\s+"RuntimeHost\.exe\\0"/);
    assert.match(rc, /VALUE "CompanyName",\s+"LensDesk Team\\0"/);
  }

  // 4. common.hpp APP_NAME and window metadata
  for (const hppPath of [
    "src-native/include/common.hpp",
    "apps/windows/src-native/include/common.hpp",
  ]) {
    const hpp = fs.readFileSync(path.join(root, hppPath), "utf8");
    assert.match(hpp, /constexpr const wchar_t\* APP_NAME = L"LensDesk 2\.0";/);
    assert.match(hpp, /constexpr const wchar_t\* APP_VERSION = L"2\.0\.0";/);
    assert.match(hpp, /constexpr const wchar_t\* WINDOW_CLASS_NAME = L"LensDesk_Overlay_Host_Class";/);
  }
});
