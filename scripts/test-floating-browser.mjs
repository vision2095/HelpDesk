import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

async function testFloatingBrowser() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-floating-test-"));

  const app = await electron.launch({
    args: [".", `--user-data-dir=${data}`],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    console.log("App loaded. Toggling floating mode...");
    // Trigger floating overlay mode
    await page.evaluate(async () => {
      await window.lens.invoke("desktop.overlay");
    });

    await page.waitForTimeout(1000);

    // Verify floating HUD is active
    const isFloating = await page.evaluate(async () => {
      const res = await window.lens.invoke("desktop.overlayState");
      return res.floating;
    });
    assert.equal(isFloating, true, "Overlay should be in floating mode");
    console.log("Floating mode confirmed active!");

    // Verify floating toolbar has Browser button
    const browserBtn = page.locator(".toolbar-btn.browser");
    await browserBtn.waitFor({ timeout: 5000 });
    const btnText = await browserBtn.innerText();
    console.log("Initial floating browser button text:", btnText);

    // Click "Browser" button in floating window
    await browserBtn.click();
    await page.waitForTimeout(1500);

    // Verify floating view switched to browser
    const afterClickText = await browserBtn.innerText();
    console.log("Floating browser button text after click:", afterClickText);
    assert.ok(afterClickText.includes("Assistant"), "Button should now indicate option to switch back to Assistant");

    // Verify browser viewport exists in floating window
    const browserViewport = page.locator(".floating-browser-container .browser-viewport");
    await browserViewport.waitFor({ timeout: 5000 });
    console.log("Floating browser viewport successfully rendered!");

    // Test navigating to https://chatgpt.com in floating window
    const addressInput = page.locator(".floating-browser-container input[aria-label='Browser address or search']");
    await addressInput.waitFor({ timeout: 5000 });
    await addressInput.fill("https://chatgpt.com");
    await page.keyboard.press("Enter");

    console.log("Submitted https://chatgpt.com in floating browser...");
    await page.waitForTimeout(8000);

    // Check ChatGPT status inside floating window
    const gptStatus = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const tab = win.contentView.children.find((c) => c.webContents);
      if (!tab) return { error: "No tab view attached" };
      const wc = tab.webContents;

      return await wc.executeJavaScript(`
        (() => {
          const body = document.body.innerText;
          return {
            title: document.title,
            hasTurnstileError: body.includes("An error occurred during verification"),
            textareaFound: Boolean(document.querySelector("#prompt-textarea, textarea, [contenteditable='true']"))
          };
        })()
      `).catch(err => ({ evalError: err.message }));
    });

    console.log("Floating window ChatGPT status:", JSON.stringify(gptStatus, null, 2));
    assert.equal(gptStatus.hasTurnstileError, false, "ChatGPT must not have Turnstile error in floating window");
    assert.equal(gptStatus.textareaFound, true, "ChatGPT textarea must exist in floating window");

    // Now switch back to Assistant in floating window
    await browserBtn.click();
    await page.waitForTimeout(1000);

    const finalBtnText = await browserBtn.innerText();
    console.log("Button text after switching back to Assistant:", finalBtnText);
    assert.ok(finalBtnText.includes("Browser"), "Button should now show Browser again");

    const chatContainer = page.locator(".hintlens-messages-container");
    await chatContainer.waitFor({ timeout: 5000 });
    console.log("Floating Assistant chat container successfully restored!");

  } finally {
    await app.close();
  }
}

testFloatingBrowser().then(() => {
  console.log("✅ Floating window browser E2E test passed successfully!");
}).catch((err) => {
  console.error("❌ Floating window browser test failed:", err);
  process.exit(1);
});
