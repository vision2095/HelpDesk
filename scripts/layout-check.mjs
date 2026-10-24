import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-layout-"));
const output = path.resolve("docs/audit/evidence-mac-layout-2026-10-20");
fs.mkdirSync(output, { recursive: true });
const server = createServer((_, response) => response.end("<!doctype html><title>Layout preview</title><h1>Workspace browser</h1><p>Local layout fixture.</p>"));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const application = await electron.launch({ args: [".", `--user-data-dir=${data}`] });
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Your thinking space." }).waitFor();
  await page.getByRole("button", { name: "New session", exact: true }).first().click();
  await page.getByPlaceholder("e.g. Backend engineering practice").fill("Layout check");
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await page.getByLabel("Session title").waitFor();
  await page.evaluate(async (url) => {
    const preferences = await window.lens.invoke("desktop.preferences");
    await window.lens.invoke("desktop.preferences.save", { ...preferences, browser: { ...preferences.browser, homePage: url } });
  }, `http://127.0.0.1:${server.address().port}`);

  async function checkWidth(label) {
    const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, content: document.documentElement.scrollWidth }));
    assert.ok(metrics.content <= metrics.width + 1, `${label}: horizontal overflow ${JSON.stringify(metrics)}`);
    await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true });
    return metrics;
  }
  for (const [width, height] of [[1280, 800], [1000, 700]]) {
    await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), { width, height });
    for (const theme of ["light", "dark"]) {
      await page.getByLabel("Color theme").selectOption(theme);
      await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme);
    for (const [label, name] of [["assistant", "Assistant"], ["history", "Session history"], ["profiles", "Interview profiles"], ["account", "Account & cloud"], ["settings", "Settings"], ["desktop", "Desktop & shortcuts"], ["browser", "Browser"]]) {
      await page.getByRole("button", { name, exact: true }).first().click();
      await page.locator(label === "browser" ? ".browser-page" : ".page-heading").first().waitFor();
      if (label === "browser") {
        const browserState = await page.evaluate(() => window.lens.invoke("browser.state"));
        if (!browserState.tabs.length)
          await page.getByRole("button", { name: "Open browser tab", exact: true }).click();
        await page.getByRole("tab", { name: "Layout preview", exact: true }).waitFor();
      }
      const viewport = await checkWidth(`${label}-${theme}-${width}`);
      if (label === "assistant") {
        const composer = await page.locator(".composer").boundingBox();
        assert.ok(composer.y + composer.height <= viewport.height, "Workspace composer must fit without scrolling the page");
      }
    }
    }
  }
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Floating window", exact: true }).click();
  await page.locator(".hintlens-overlay-shell").waitFor();
  const initial = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.ok(initial.width > initial.height, "Floating window must open in landscape");
  for (const [width, height] of [[1040, 620], [720, 440]]) {
    await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), { width, height });
    await checkWidth(`floating-${width}`);
    const metrics = await page.evaluate(() => {
      const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
      return { height: innerHeight, width: innerWidth, chat: rect(".hintlens-main-split"), composer: rect(".hintlens-composer"), toolbar: rect(".hintlens-toolbar-row"), buttons: [...document.querySelectorAll(".toolbar-left-buttons button")].map((el) => ({ text: el.textContent, y: el.getBoundingClientRect().y })) };
    });
    assert.ok(metrics.chat.height >= 180, `Chat is compressed: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.composer.right <= metrics.width && metrics.toolbar.bottom <= metrics.height + 1, "Composer and toolbar must fit the window");
    assert.equal(new Set(metrics.buttons.map((b) => Math.round(b.y))).size, 1, "Primary actions must stay on one horizontal row");
    await page.getByRole("button", { name: "Keys", exact: true }).click();
    await checkWidth(`floating-keys-${width}`);
    await page.getByRole("button", { name: "Keys", exact: true }).click();
    await page.locator(".toolbar-btn.browser").click();
    await page.locator(".floating-browser-container .browser-viewport").waitFor();
    await page.getByRole("tab", { name: "Layout preview", exact: true }).waitFor();
    await checkWidth(`floating-browser-${width}`);
    await page.locator(".toolbar-btn.browser").click();
    await page.getByTitle(/Open Settings/).click();
    const dialog = page.getByRole("dialog", { name: "LensDesk Settings" });
    for (const tab of ["Model", "Appearance", "Capture", "Typing", "Hotkeys", "Mouse", "Browser", "Local LLM", "Account"]) {
      await dialog.getByRole("button", { name: tab, exact: true }).click();
      await dialog.getByRole("heading", { name: tab, exact: true }).waitFor();
      assert.equal(await page.locator(".hintlens-tab-content").evaluate((el) => el.scrollWidth > el.clientWidth + 1), false, `${tab} tab overflows at ${width}`);
      await page.screenshot({ path: path.join(output, `settings-${tab.replaceAll(" ", "-")}-${width}.png`) });
    }
    await checkWidth(`floating-settings-${width}`);
    await dialog.getByRole("button", { name: "Close settings" }).click();
  }
  assert.deepEqual(errors, []);
  console.log("Mac layout checks passed: landscape opening, seven workspace screens in light/dark at two sizes, local embedded browser, horizontal floating controls, chat/composer visibility, hotkey drawer and all nine settings tabs at two floating sizes.");
} finally {
  await application.close();
  fs.rmSync(data, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
}
