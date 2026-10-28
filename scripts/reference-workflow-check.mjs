import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createCloudServer } from "../server/cloud/app.mjs";
const { version } = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url)),
);
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "lensdesk-reference-e2e-"),
);
const cloudDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "lensdesk-reference-cloud-"),
);
// The desktop application is subscription-gated. Give this check its own
// throwaway cloud service with a verified account and a live entitlement so
// the protected reference workflows run exactly as a paying user would see
// them — no gate bypass.
const cloud = createCloudServer({
  directory: cloudDirectory,
  publicUrl: "https://reference.invalid",
  encryptionKey: randomBytes(32).toString("hex"),
});
const referenceEmail = "reference-check@example.test";
const referencePassword = "reference-check-password";
let application;
let cloudUrl = "";
try {
  await new Promise((resolve) => cloud.server.listen(0, "127.0.0.1", resolve));
  cloudUrl = "http://127.0.0.1:" + cloud.server.address().port;
  const registered = await cloud.accounts.register({
    email: referenceEmail,
    password: referencePassword,
    name: "Reference Check",
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
    args: [".", `--user-data-dir=${profile}`],
    // This check exercises capture/reference workflows, not the heartbeat
    // schedule; keep the gate active from login for the whole run.
    env: { ...process.env, LENSDESK_HEARTBEAT_SECONDS: "3600" },
  });
  await application.evaluate(
    ({ desktopCapturer, nativeImage, screen, systemPreferences }) => {
      const bitmap = Buffer.alloc(400 * 200 * 4);
      for (let i = 0; i < bitmap.length; i += 4) {
        bitmap[i + 2] = 255;
        bitmap[i + 3] = 255;
      }
      const image = nativeImage.createFromBitmap(bitmap, {
        width: 400,
        height: 200,
        scaleFactor: 1,
      });
      const id = String(screen.getPrimaryDisplay().id);
      desktopCapturer.getSources = async () => [
        {
          id: "screen:fixture-one",
          display_id: id,
          name: "Owned red fixture",
          thumbnail: image,
        },
        {
          id: "screen:fixture-two",
          display_id: "fixture-two",
          name: "Second owned fixture",
          thumbnail: image,
        },
      ];
      systemPreferences.getMediaAccessStatus = () => "granted";
    },
  );
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Launch is login-first and has no protected workshop surface behind it.
  await page.locator(".floating-gate-shell").waitFor();
  await page
    .getByRole("heading", { name: "Sign in to your workspace." })
    .waitFor();
  assert.equal(
    await page.locator(".hintlens-overlay-shell").count(),
    0,
    "The floating assistant must not mount before authentication",
  );
  assert.equal(
    await page.locator(".app-shell").count(),
    0,
    "The desktop product must not mount the website/workshop shell",
  );
  // Establish the real subscription-gated desktop session: configure this
  // throwaway cloud origin, then perform the normal desktop login IPC.
  const login = await page.evaluate(
    ({ url, email, password }) =>
      window.lens
        .invoke("cloud.configure", { url })
        .then(() => window.lens.invoke("gate.login", { email, password })),
    { url: cloudUrl, email: referenceEmail, password: referencePassword },
  );
  assert.ok(login?.session, "Desktop login must create a session");
  assert.equal(login.entitlement.planId, "hourly");
  assert.equal(
    (await page.evaluate(() => window.lens.invoke("gate.state"))).phase,
    "active",
  );
  await page.locator(".hintlens-overlay-shell").waitFor();
  assert.equal(
    await page.locator(".floating-gate-shell").count(),
    0,
    "The sign-in surface must be replaced after authentication",
  );
  assert.equal(
    await page.locator(".app-shell").count(),
    0,
    "Authentication must reveal only the floating assistant, not the website shell",
  );
  const windowState = await application.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return {
      count: windows.length,
      bounds: windows[0]?.getBounds(),
      visible: windows[0]?.isVisible(),
    };
  });
  assert.equal(windowState.count, 1, "Desktop must use exactly one window");
  assert.equal(windowState.visible, true, "The single floating window must be visible");
  assert.ok(
    windowState.bounds.width >= 420 && windowState.bounds.height >= 520,
    "The authenticated floating window must retain a usable surface",
  );
  assert.equal(
    (await page.evaluate(() => window.lens.invoke("desktop.info"))).version,
    version,
  );
  const displays = await page.evaluate(() =>
    window.lens.invoke("desktop.displays"),
  );
  assert.ok(displays.length);
  assert.equal(
    (await page.evaluate(() => window.lens.invoke("desktop.overlay"))).floating,
    true,
    "The desktop overlay command must only address the single floating window",
  );
  await page.locator(".hintlens-overlay-shell").waitFor();
  await page
    .getByRole("heading", { name: "Connect an AI provider", exact: true })
    .waitFor();
  await page.getByText("API key required", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Open AI connection settings" })
    .click();
  await page.getByLabel("API key", { exact: true }).waitFor();
  await page.evaluate(() => window.lens.invoke("desktop.overlay"));
  await page.locator(".hintlens-overlay-shell").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Get Answer", exact: true })
      .getAttribute("title"),
    "Get Answer (Not assigned)",
    "Unassigned shortcuts must not advertise fallback keys",
  );
  await page.getByRole("button", { name: "Keys", exact: true }).click();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByAltText("Capture 1", { exact: true }).first().waitFor();
  assert.equal(
    (await page.evaluate(() => window.lens.invoke("state"))).sessions.flatMap(
      (s) => s.messages,
    ).length,
    0,
    "Capture must not invoke AI or create chat messages",
  );
  await page.getByTitle(/Region Snipping/).click();
  const dialog = page.getByRole("dialog", { name: "Select screenshot region" });
  await dialog.waitFor();
  const image = dialog.getByAltText("Screenshot to crop");
  const box = await image.boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75);
  await page.mouse.up();
  await dialog.getByRole("button", { name: "Attach selected region" }).click();
  await page.getByAltText("Capture 2", { exact: true }).first().waitFor();
  const dimensions = await page
    .getByAltText("Capture 2", { exact: true })
    .first()
    .evaluate(async (element) => {
      await element.decode();
      return [element.naturalWidth, element.naturalHeight];
    });
  assert.deepEqual(
    dimensions,
    [200, 100],
    "The attached image must be cropped, not full-screen",
  );
  await page.getByTitle(/Region Snipping/).click();
  await dialog.getByRole("button", { name: "Cancel selection" }).click();
  assert.equal(
    (await page
      .locator(
        ".bundle-thumbnail img, .bundle-capture-card img, .bundle-list img",
      )
      .count()) || (await page.locator('img[alt^="Capture "]').count()),
    2,
  );
  await page.evaluate(async () => {
    const prefs = await window.lens.invoke("desktop.preferences");
    prefs.capture = { mode: "all", displayId: "" };
    await window.lens.invoke("desktop.preferences.save", prefs);
  });
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByAltText("Capture 4", { exact: true }).waitFor();
  const all = await page.evaluate(() =>
    window.lens.invoke("desktop.capture", {
      mode: "specific",
      displayId: "fixture-two",
      deferArchive: true,
    }),
  );
  assert.equal(all.images.length, 1);
  await assert.rejects(
    page.evaluate(() =>
      window.lens.invoke("desktop.capture", {
        mode: "specific",
        displayId: "missing",
      }),
    ),
    /unavailable/,
  );
  // Disabled gestures preserve middle clicks; enabled gestures consume only a drag/hold.
  await page.mouse.move(200, 200);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(220, 200);
  await page.mouse.up({ button: "middle" });
  assert.equal(
    await page.getByRole("dialog", { name: "Mouse action wheel" }).count(),
    0,
  );
  await page.evaluate(async () => {
    const p = await window.lens.invoke("desktop.preferences");
    p.mouse.enabled = true;
    p.mouse.holdMs = 0;
    await window.lens.invoke("desktop.preferences.save", p);
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.evaluate(() => {
    window.fixtureEvents = [];
    for (const type of ["mousedown", "mousemove", "mouseup", "blur"])
      window.addEventListener(type, (event) =>
        window.fixtureEvents.push({
          type,
          button: event.button,
          x: event.clientX,
        }),
      );
  });
  await page.mouse.move(200, 200);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(220, 200, { steps: 3 });
  try {
    await page.locator(".radial-wheel-backdrop").waitFor({ timeout: 5000 });
  } catch (error) {
    console.log(
      await page.evaluate(async () => ({
        events: window.fixtureEvents,
        prefs: await window.lens.invoke("desktop.preferences"),
        url: location.href,
      })),
    );
    throw error;
  }
  await page.mouse.move(200, 200);
  await page.mouse.up({ button: "middle" });
  await page.locator(".radial-wheel-backdrop").waitFor({ state: "detached" });
  await page.reload();
  await page.locator(".hintlens-overlay-shell").waitFor();
  const persisted = await page.evaluate(() =>
    window.lens.invoke("desktop.preferences"),
  );
  assert.equal(persisted.capture.mode, "all");
  assert.equal(persisted.mouse.enabled, true);
  await page.getByTitle(/Open Settings/).click();
  const settings = page.getByRole("dialog", { name: "LensDesk Settings" });
  for (const tab of [
    "Model",
    "Appearance",
    "Capture",
    "Typing",
    "Hotkeys",
    "Mouse",
    "Browser",
    "Local LLM",
    "Account",
  ]) {
    await settings.getByRole("button", { name: tab, exact: true }).click();
    await settings.getByRole("heading", { name: tab, exact: true }).waitFor();
  }
  await settings.getByRole("button", { name: "Close settings" }).click();
  await application.evaluate(({ desktopCapturer }) => {
    desktopCapturer.getSources = () => new Promise(() => {});
  });
  const stalledCapture = page.evaluate(() =>
    window.lens.invoke("desktop.capture", { id: "screen:fixture-one" }),
  );
  const rejectedCapture = assert.rejects(stalledCapture, /timed out/);
  await page.waitForTimeout(300);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  await application.evaluate(({ app }) => app.emit("activate"));
  const recovered = await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { visible: win.isVisible(), opacity: win.getOpacity() };
  });
  assert.equal(
    recovered.visible,
    true,
    "Dock reopen restores a pending capture window",
  );
  assert.ok(
    recovered.opacity > 0,
    "Reopened capture window must not stay transparent",
  );
  await rejectedCapture;
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Reference workflow passed: actual Electron IPC, Capture without AI, region crop, cancellation, display routing, settings persistence, stalled capture timeout and Dock reopen visibility/opacity recovery. Screenshot sources are synthetic owned images; no real OS capture or external AI proof.",
  );
} finally {
  await application?.close();
  await cloud.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(cloudDirectory, { recursive: true, force: true });
}
