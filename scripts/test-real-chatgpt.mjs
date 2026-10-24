import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function testNativeAppChatGPT() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-native-chatgpt-"));

  // Notice: We launch WITHOUT any manual session hacks or manual commandline flags in test!
  // It tests the REAL desktop/main.cjs and desktop/browser.cjs implementation!
  const app = await electron.launch({
    args: [".", `--user-data-dir=${data}`],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    console.log("LensDesk native app window loaded.");

    // Switch to Browser in UI
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("button, a"));
      const browserBtn = links.find(el => el.innerText && el.innerText.toLowerCase().includes("browser"));
      if (browserBtn) browserBtn.click();
    });

    await page.waitForTimeout(1000);

    const addressInput = page.locator('input[aria-label="Browser address or search"]');
    await addressInput.waitFor({ timeout: 5000 });
    await addressInput.fill("https://chatgpt.com");
    await page.keyboard.press("Enter");

    console.log("Navigating to https://chatgpt.com via LensDesk address bar...");
    await page.waitForTimeout(8000);

    // Inspect WebContentsView state
    const result = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const tab = win.contentView.children.find((c) => c.webContents);
      if (!tab) return { error: "No tab view attached to window" };
      const wc = tab.webContents;

      return await wc.executeJavaScript(`
        (() => {
          const body = document.body.innerText;
          const hasTurnstileError = body.includes("An error occurred during verification");
          const textarea = document.querySelector("#prompt-textarea, textarea, [contenteditable='true']");
          const ua = navigator.userAgent;
          const webdriver = navigator.webdriver;

          return {
            title: document.title,
            ua,
            webdriver,
            hasTurnstileError,
            textareaFound: Boolean(textarea),
            textareaId: textarea ? textarea.id : null,
            bodySnippet: body.slice(0, 200)
          };
        })()
      `).catch(err => ({ evalError: err.message }));
    });

    console.log("ChatGPT Status:", JSON.stringify(result, null, 2));

    if (result.hasTurnstileError) {
      throw new Error("Turnstile verification error detected!");
    }

    if (!result.textareaFound) {
      throw new Error("Prompt textarea not found in ChatGPT page!");
    }

    // Now test entering prompt & submitting
    console.log("Asking question to ChatGPT: 'What is 5 * 5?'");
    const sendRes = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const tab = win.contentView.children.find((c) => c.webContents);
      const wc = tab.webContents;

      return await wc.executeJavaScript(`
        (() => {
          const textarea = document.querySelector("#prompt-textarea") || document.querySelector("textarea, [contenteditable='true']");
          if (!textarea) return { error: "No textarea found" };
          
          textarea.focus();
          if (textarea.tagName === "TEXTAREA") {
            textarea.value = "What is 5 * 5?";
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            textarea.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            textarea.innerText = "What is 5 * 5?";
            textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
          }

          const sendBtn = document.querySelector("button[data-testid='send-button'], button[aria-label*='Send'], button[aria-label*='send']");
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return { clicked: true };
          }
          return { clicked: false, sendDisabled: sendBtn ? sendBtn.disabled : null };
        })()
      `);
    });

    console.log("Send result:", sendRes);

    await page.waitForTimeout(5000);

    const replyCheck = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const tab = win.contentView.children.find((c) => c.webContents);
      const wc = tab.webContents;

      return await wc.executeJavaScript(`
        (() => {
          const body = document.body.innerText;
          return {
            hasTurnstileError: body.includes("An error occurred during verification"),
            snippet: body.slice(-300)
          };
        })()
      `);
    });

    console.log("Reply check:", JSON.stringify(replyCheck, null, 2));

  } finally {
    await app.close();
  }
}

testNativeAppChatGPT().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
