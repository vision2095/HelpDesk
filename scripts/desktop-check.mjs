import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createCloudServer } from "../server/cloud/app.mjs";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-desktop-"));
const cloudDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "lensdesk-desktop-cloud-"),
);
const cloud = createCloudServer({
  directory: cloudDirectory,
  publicUrl: "https://desktop-check.invalid",
  encryptionKey: randomBytes(32).toString("hex"),
});
let application;
let cloudUrl = "";
try {
  await new Promise((resolve) =>
    cloud.server.listen(0, "127.0.0.1", resolve),
  );
  cloudUrl = "http://127.0.0.1:" + cloud.server.address().port;
  const registered = await cloud.accounts.register({
    email: "desktop-check@example.test",
    password: "desktop-check-password",
    name: "Desktop Check",
  });
  cloud.accounts.db
    .prepare("UPDATE users SET verified=1 WHERE id=?")
    .run(registered.user.id);
  const now = Date.now();
  cloud.accounts.db
    .prepare(
      `INSERT INTO entitlements(
         id,user_id,plan_id,payment_id,activation_timestamp,expiration_timestamp,
         subscription_status,created_at,updated_at)
       VALUES(?,?,'hourly',NULL,?,?,'active',?,?)`,
    )
    .run(
      randomUUID(),
      registered.user.id,
      now - 1000,
      now + 60 * 60 * 1000,
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    );

  application = await electron.launch({
    args: [".", `--user-data-dir=${data}`],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator(".floating-gate-shell").waitFor();
  await page
    .getByRole("heading", { name: "Sign in to your workspace." })
    .waitFor();
  assert.equal(
    await page.locator(".hintlens-overlay-shell").count(),
    0,
    "Protected floating UI must not mount before sign-in",
  );
  await page.evaluate(
    ({ url }) => window.lens.invoke("cloud.configure", { url }),
    { url: cloudUrl },
  );
  await page.evaluate(() =>
    window.lens.invoke("gate.login", {
      email: "desktop-check@example.test",
      password: "desktop-check-password",
    }),
  );
  await page.locator(".hintlens-overlay-shell").waitFor();
  assert.equal(
    (await page.evaluate(() => window.lens.invoke("gate.state"))).phase,
    "active",
  );
  const launched = await application.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return { count: windows.length, bounds: windows[0]?.getBounds() };
  });
  assert.equal(launched.count, 1, "Desktop must open one window only");
  assert.ok(
    launched.bounds.width >= 420 && launched.bounds.height >= 520,
    "The floating surface must remain usable",
  );
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  const captureStatus = () =>
    page.evaluate(() => window.lens.invoke("desktop.captureProtection"));
  assert.equal((await captureStatus()).appliedRequest, true);
  const applyProtection = async (captureProtection) => {
    await page.evaluate(async (captureProtection) => {
      const state = await window.lens.invoke("state");
      await window.lens.invoke("settings.save", {
        ...state.settings,
        captureProtection,
      });
      await window.lens.invoke("desktop.appearance");
    }, captureProtection);
    const status = await captureStatus();
    assert.equal(status.requested, captureProtection);
    assert.equal(status.appliedRequest, captureProtection);
    assert.equal(typeof status.nativeFlag, "boolean");
    if (status.platform === "win32")
      assert.equal(status.nativeFlag, captureProtection);
    else if (status.nativeFlag !== captureProtection)
      console.log("OS capture flag differs from request:", status);
  };
  await applyProtection(false);
  assert.equal(
    (await captureStatus()).appliedRequest,
    false,
    "The single floating window respects disabled protection",
  );
  await applyProtection(true);
  assert.equal(
    (await captureStatus()).appliedRequest,
    true,
    "The floating window respects enabled protection",
  );
  await page.reload();
  await page.locator(".hintlens-overlay-shell").waitFor();
  assert.equal((await captureStatus()).appliedRequest, true);
  const s = await page.evaluate(async () => {
    const state = await window.lens.invoke("state");
    const now = new Date().toISOString();
    const s = {
      id: crypto.randomUUID(),
      title: "Native QA",
      mode: "general",
      profileId: "",
      createdAt: now,
      updatedAt: now,
      notes: "PDF export verification",
      transcript: "A native desktop session.",
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          content: "How does the export work?",
          createdAt: now,
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "This PDF is generated by the desktop app.",
          createdAt: now,
        },
      ],
    };
    await window.lens.invoke("session.save", s);
    return s;
  });
  await application.evaluate(({ dialog }, data) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: data + "/export.pdf",
    });
  }, data);
  await page.evaluate(
    (id) => window.lens.invoke("desktop.export", { id, format: "pdf" }),
    s.id,
  );
  assert.equal(
    fs.readFileSync(path.join(data, "export.pdf")).subarray(0, 4).toString(),
    "%PDF",
  );
  await page.evaluate(() => window.lens.invoke("desktop.overlay"));
  let bounds = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  assert.ok(bounds.width > bounds.height, "Floating window opens in landscape");
  await page.screenshot({ path: path.join(data, "floating-preview.png") });
  assert.equal(
    (
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().length,
      )
    ),
    1,
    "The overlay command must not create a second window",
  );
  const prefs = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.nodeIntegration, false);
  const preferences = await page.evaluate(() =>
    window.lens.invoke("desktop.preferences"),
  );
  await assert.rejects(
    page.evaluate(
      (p) =>
        window.lens.invoke("desktop.preferences.save", {
          ...p,
          shortcuts: { ...p.shortcuts, capture: p.shortcuts.toggle },
        }),
      preferences,
    ),
    /different shortcut/,
  );
  const updated = await page.evaluate(
    (p) =>
      window.lens.invoke("desktop.preferences.save", {
        ...p,
        closeToTray: true,
      }),
    preferences,
  );
  assert.equal(updated.closeToTray, true);
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].show(),
  );
  await page.evaluate(
    (p) => window.lens.invoke("desktop.preferences.save", p),
    preferences,
  );
  assert.deepEqual(errors, []);
  fs.copyFileSync(
    path.join(data, "export.pdf"),
    "resources/export-example.pdf",
  );
  console.log(
    "Native desktop checks passed: packaged frontend startup, isolated preload, IPC persistence, PDF generation, floating window, shortcut validation, tray-close behavior, sandbox preferences, no renderer errors.",
  );
} finally {
  await application?.close();
  await cloud.close().catch(() => {});
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(cloudDirectory, { recursive: true, force: true });
}
