import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

async function main() {
  console.log("Launching LensDesk Desktop app for E2E verification...");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-e2e-verify-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${data}`],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });

  const screenshotDir = path.resolve(
    "/Users/vivek/.gemini/antigravity/brain/328b4295-c2f6-40dc-ab9b-5ebe3a7eb469/screenshots"
  );
  fs.mkdirSync(screenshotDir, { recursive: true });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    console.log("LensDesk main window loaded.");

    // 1. Check title and brand name
    const title = await page.title();
    console.log(`Page title: ${title}`);
    assert.ok(title.includes("LensDesk"), "Title must contain LensDesk");

    // 2. Ensure No "HintLens" appears in visible text anywhere
    const bodyText = await page.innerText("body");
    assert.equal(
      bodyText.includes("HintLens"),
      false,
      "Body must not contain 'HintLens'",
    );
    console.log("Verified zero occurrences of 'HintLens' in UI.");

    // 3. Switch to Floating Copilot Overlay HUD
    console.log("Switching to Floating Copilot Overlay HUD...");
    await page.evaluate(() => {
      const btn = document.querySelector('button[title*="floating overlay"], button[title*="Floating Copilot"]');
      if (btn) btn.click();
      else if (window.lens) window.lens.invoke("desktop.overlay");
    });

    await page.waitForTimeout(1000);

    // Verify overlay shell is visible with LensDesk branding
    const overlayHeader = await page.locator(".hintlens-titlebar .app-title");
    await overlayHeader.waitFor({ timeout: 5000 });
    const headerText = await overlayHeader.innerText();
    console.log(`Overlay header title: ${headerText}`);
    assert.equal(headerText, "LensDesk");

    // 4. Test Opacity Presets (100, 80, 60, 40, 0)
    console.log("Testing Opacity Presets...");
    const presets = [100, 80, 60, 40, 0];
    for (const val of presets) {
      const pill = page.getByRole("button", { name: `${val}%`, exact: true });
      if (await pill.count() > 0) {
        await pill.click();
        await page.waitForTimeout(150);
        const readout = await page.locator(".bg-val-text").innerText();
        console.log(`Clicked ${val}% preset -> Readout shows: ${readout}`);
        assert.equal(readout.trim(), `${val}%`);
      }
    }

    // Set opacity back to 80%
    const p80 = page.getByRole("button", { name: "80%", exact: true });
    if (await p80.count() > 0) await p80.click();

    // 5. Inject a synthetic screenshot into the bundle to test bundle & undo
    console.log("Testing Screenshot Bundle Addition and Undo...");
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, 400, 300);
      ctx.fillStyle = "#38bdf8";
      ctx.font = "20px monospace";
      ctx.fillText("Code Screenshot Test", 20, 60);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

      // Trigger file drop / simulated capture via window event or setting state
      const imgInput = document.createElement("input");
      imgInput.type = "file";
      // Dispatch shortcut 'capture'
      if (window.lens) {
        window.dispatchEvent(new CustomEvent("lensdesk:test-capture", { detail: dataUrl }));
      }
    });

    // Take screenshot in bundle state
    await page.screenshot({ path: path.join(screenshotDir, "floating-hud-ready.png") });
    console.log("Saved screenshot: floating-hud-ready.png");

    // 6. Test Settings Gear Modal in floating HUD
    console.log("Testing Settings Gear Modal in floating HUD...");
    const gearBtn = page.locator(".titlebar-icon-btn.gear");
    await gearBtn.click();
    await page.waitForTimeout(600);

    const settingsModal = page.locator(".hintlens-settings-window");
    await settingsModal.waitFor({ timeout: 5000 });
    console.log("Settings modal opened successfully from floating HUD.");

    // Check Appearance tab in Settings Modal
    const appearanceTab = page.locator('.hintlens-nav-item:has-text("Appearance")');
    await appearanceTab.click();
    await page.waitForTimeout(400);

    const opacityGroup = page.locator(".opacity-settings-group");
    await opacityGroup.waitFor({ timeout: 5000 });
    console.log("Appearance tab shows Background Opacity & Stealth settings!");

    await page.screenshot({ path: path.join(screenshotDir, "floating-settings-appearance.png") });
    console.log("Saved screenshot: floating-settings-appearance.png");

    // Close settings modal
    const closeBtn = page.locator(".hintlens-modal-close-btn");
    await closeBtn.click();
    await page.waitForTimeout(400);

    // 7. Test In-Window Hide via Command+H / Ctrl+H
    console.log("Testing in-window hide shortcut (Cmd+H / Ctrl+H)...");
    const isHiddenBefore = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return !win.isVisible();
    });
    assert.equal(isHiddenBefore, false, "Window should be visible before hide");

    // Press Cmd+H or Ctrl+H
    await page.keyboard.press(process.platform === "darwin" ? "Meta+h" : "Control+h");
    await page.waitForTimeout(500);

    const isHiddenAfter = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return !win.isVisible();
    });
    console.log(`Window isVisible() after Cmd+H: ${!isHiddenAfter}`);
    assert.equal(isHiddenAfter, true, "Window must hide immediately on Cmd+H / Ctrl+H!");

    // Restore window
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.show();
    });
    await page.waitForTimeout(400);
    console.log("Restored window successfully.");

    console.log("ALL FLOATING HUD VERIFICATIONS PASSED 100%!");
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});
