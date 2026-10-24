// Focused renderer integration tests with explicit IPC/cloud test doubles.
// These prove contract use, error handling and draft persistence, not live providers or OS hooks.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { browserOptions } from "../scripts/browser-runtime.mjs";
const server = await createServer({
  configFile: false,
  server: {
    host: "127.0.0.1",
    port: 0xc000 + Math.floor(Math.random() * 0x3000),
  },
});
await server.listen();
const address = server.httpServer.address();
let browser;
try {
  browser = await chromium.launch(browserOptions());
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  await context.addInitScript(() => {
    const settings = {
      provider: "openai",
      model: "gpt-4.1-mini",
      language: "English",
      systemPrompt: "Custom prompt",
      transcriptionProvider: "openai",
      transcriptionModel: "whisper-1",
      opacity: 1,
      captureProtection: false,
      alwaysOnTop: true,
      theme: "dark",
      lightTextColor: "#24384c",
      darkTextColor: "#e2eaf5",
      interviewLayout: "full",
    };
    if (!localStorage.getItem("modal-settings"))
      localStorage.setItem("modal-settings", JSON.stringify(settings));
    const prefs = {
      launchAtLogin: false,
      closeToTray: false,
      shortcuts: { capture: "Control+Shift+S" },
      browser: {
        homePage: "https://www.google.com/",
        searchEngine: "google",
        zoom: 1,
      },
      autoType: {
        speed: "human",
        wpm: 65,
        jitter: 0,
        pauses: 0,
        delaySeconds: 1,
        codeOnly: true,
      },
      captureArchive: { directory: "/tmp/modal-captures", enabled: false },
      capture: { mode: "active", displayId: "" },
      mouse: {
        enabled: false,
        trigger: "middle",
        size: 100,
        opacity: 85,
        slots: 6,
        holdMs: 0,
        style: "wheel",
        mappings: {},
      },
    };
    if (!localStorage.getItem("modal-prefs"))
      localStorage.setItem("modal-prefs", JSON.stringify(prefs));
    window.calls = [];
    window.failNativeSave = false;
    window.authSucceeded = false;
    window.authUser = null;
    window.lens = {
      platform: "darwin",
      invoke: async (action, payload = {}) => {
        window.calls.push({ action, payload });
        if (action === "desktop.preferences")
          return JSON.parse(localStorage.getItem("modal-prefs"));
        if (action === "desktop.preferences.save") {
          if (window.failNativeSave)
            throw new Error("Shortcut registration rejected");
          localStorage.setItem("modal-prefs", JSON.stringify(payload));
          return payload;
        }
        if (action === "desktop.info")
          return { version: "test-build", platform: "darwin" };
        if (action === "desktop.displays")
          return { displays: [{ id: "123", label: "Fixture display" }] };
        if (action === "desktop.captureArchive.status")
          return { bytes: 3072, files: 2, directory: "/tmp/modal-captures" };
        if (action === "desktop.captureArchive.choose")
          return { canceled: false, directory: "/tmp/chosen-modal-captures" };
        if (action === "browser.clearData")
          throw new Error("Browser data could not be cleared");
        if (action === "desktop.models.detect")
          return {
            servers: [
              {
                name: "LM Studio",
                baseUrl: "http://127.0.0.1:1234/v1",
                models: [{ id: "fixture-local" }],
              },
            ],
          };
        if (action === "model.list")
          return {
            models: [{ id: "fixture-local", name: "Fixture local model" }],
          };
        if (action === "model.test") return { preview: "Test model online" };
        if (action === "settings.save") return payload;
        if (action === "cloud.request") {
          if (payload.action === "cloud.state")
            return {
              user: window.authUser,
              plan: window.authUser ? "free" : undefined,
            };
          if (payload.action === "auth.login") {
            if (payload.payload.password !== "correct-password")
              throw new Error("Invalid credentials");
            return { mfaRequired: true, challenge: "fixture-challenge" };
          }
          if (payload.action === "auth.mfa") {
            if (payload.payload.code !== "123456")
              throw new Error("Invalid authenticator code");
            window.authUser = { email: "fixture@example.test" };
            return { user: window.authUser };
          }
          if (payload.action === "auth.logout") {
            window.authUser = null;
            return { ok: true };
          }
        }
        throw new Error(`Unexpected action: ${action}`);
      },
    };
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const url = `http://127.0.0.1:${address.port}/tests/fixtures/settings-modal.html`;
  await page.goto(url);
  const dialog = page.getByRole("dialog", { name: "LensDesk Settings" });
  await dialog.waitFor();
  await dialog.getByLabel("System Prompt", { exact: true }).fill("");
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await dialog.getByText("Settings saved.", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByLabel("System Prompt", { exact: true }).inputValue(),
    "",
    "Empty prompts are intentional and must not revert to the default",
  );
  await page.reload();
  await dialog.waitFor();
  assert.equal(
    await dialog.getByLabel("System Prompt", { exact: true }).inputValue(),
    "",
  );
  await dialog
    .getByRole("button", { name: "Reset to default", exact: true })
    .click();
  assert.equal(
    await dialog.getByLabel("System Prompt", { exact: true }).inputValue(),
    "Give clear, practical answers. Explain your reasoning, state assumptions, and ask for clarification when needed.",
  );
  assert.equal(
    await dialog
      .getByLabel("System Prompt", { exact: true })
      .getAttribute("maxlength"),
    "2000",
  );
  await dialog.getByRole("button", { name: "Appearance", exact: true }).click();
  await dialog.getByLabel("light text hex color", { exact: true }).fill("#xyz");
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Text colors must" })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("modal-settings")).lightTextColor,
    ),
    "#24384c",
  );
  await dialog
    .getByLabel("light text hex color", { exact: true })
    .fill("#aabbcc");
  await dialog.getByLabel("Color theme", { exact: true }).selectOption("light");
  await dialog.getByRole("button", { name: "Browser", exact: true }).click();
  await dialog.getByRole("button", { name: "Claude", exact: true }).click();
  await dialog
    .getByLabel("Browser search engine", { exact: true })
    .selectOption("duckduckgo");
  await dialog.getByLabel("Page zoom", { exact: true }).fill("140");
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await dialog.getByText("Settings saved.", { exact: true }).waitFor();
  await page.reload();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Browser", exact: true }).click();
  assert.equal(
    await dialog.getByLabel("Browser home page", { exact: true }).inputValue(),
    "https://claude.ai/",
  );
  assert.equal(
    await dialog
      .getByLabel("Browser search engine", { exact: true })
      .inputValue(),
    "duckduckgo",
  );
  assert.equal(
    await dialog.getByLabel("Page zoom", { exact: true }).inputValue(),
    "140",
  );
  await dialog
    .getByRole("button", { name: "Clear browsing data", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Browser data could not be cleared" })
    .waitFor();
  assert.equal(
    await dialog
      .getByText("Embedded browser data cleared.", { exact: true })
      .count(),
    0,
  );
  await dialog.getByRole("button", { name: "Mouse", exact: true }).click();
  await dialog.getByLabel("Enable mouse gestures", { exact: true }).check();
  await dialog
    .getByLabel("Mouse gesture style", { exact: true })
    .selectOption("flick");
  await dialog
    .getByLabel("Mouse gesture slots", { exact: true })
    .selectOption("8");
  await dialog
    .getByLabel("Mouse slot 8", { exact: true })
    .selectOption("browser");
  await dialog
    .getByRole("button", { name: "Reset mouse defaults", exact: true })
    .click();
  assert.equal(
    await dialog
      .getByLabel("Enable mouse gestures", { exact: true })
      .isChecked(),
    true,
  );
  assert.equal(
    await dialog
      .getByLabel("Mouse gesture slots", { exact: true })
      .inputValue(),
    "6",
  );
  assert.equal(
    await dialog
      .getByLabel("Mouse gesture style", { exact: true })
      .inputValue(),
    "wheel",
  );
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await dialog.getByText("Settings saved.", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Capture", exact: true }).click();
  await dialog.getByLabel("Specific monitor", { exact: true }).check();
  await dialog
    .getByLabel("Capture monitor", { exact: true })
    .selectOption("123");
  await dialog.getByLabel("Save screenshots to disk", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await dialog.getByText("Settings saved.", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Hotkeys", exact: true }).click();
  await dialog
    .getByRole("button", {
      name: "Record shortcut for Get Answer",
      exact: true,
    })
    .click();
  await page.keyboard.press("a");
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Include Control" })
    .waitFor();
  await page.keyboard.press("Control+Shift+S");
  await dialog
    .getByRole("alert")
    .filter({ hasText: "already assigned" })
    .waitFor();
  await page.keyboard.press("Control+Shift+ArrowUp");
  await page.evaluate(() => {
    window.failNativeSave = true;
  });
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Shortcut registration rejected" })
    .waitFor();
  await page.evaluate(() => {
    window.failNativeSave = false;
  });
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await dialog.getByText("Settings saved.", { exact: true }).waitFor();
  await page.reload();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Hotkeys", exact: true }).click();
  assert.equal(
    await dialog
      .getByRole("button", {
        name: "Record shortcut for Get Answer",
        exact: true,
      })
      .innerText(),
    "Control+Shift+Up",
  );
  await dialog.getByRole("button", { name: "Local LLM", exact: true }).click();
  await dialog.getByRole("button", { name: "Detect", exact: true }).click();
  await dialog
    .getByLabel("Detected local server", { exact: true })
    .selectOption("http://127.0.0.1:1234/v1");
  assert.equal(
    await dialog.getByLabel("Local model port", { exact: true }).inputValue(),
    "1234",
  );
  await dialog
    .getByRole("button", { name: "Use selected model", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await dialog.getByText("Settings saved.", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("modal-settings")).localBaseUrl,
    ),
    "http://127.0.0.1:1234/v1",
  );
  await dialog.getByRole("button", { name: "Account", exact: true }).click();
  await dialog.getByText("Not signed in.", { exact: false }).waitFor();
  assert.equal(await dialog.getByText("Plan: Pro", { exact: true }).count(), 0);
  await dialog
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open fixture auth", exact: true })
    .click();
  const auth = page.getByRole("dialog", { name: "Sign in to LensDesk" });
  await auth
    .getByLabel("Sign in email", { exact: true })
    .fill("fixture@example.test");
  await auth.getByLabel("Sign in password", { exact: true }).fill("incorrect");
  await auth.getByRole("button", { name: "Log in", exact: true }).click();
  await auth
    .getByRole("alert")
    .filter({ hasText: "Invalid credentials" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.authSucceeded), false);
  await auth
    .getByLabel("Sign in password", { exact: true })
    .fill("correct-password");
  await auth.getByRole("button", { name: "Log in", exact: true }).click();
  await auth
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill("000000");
  await auth.getByRole("button", { name: "Verify", exact: true }).click();
  await auth
    .getByRole("alert")
    .filter({ hasText: "Invalid authenticator code" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.authSucceeded), false);
  assert.equal(
    await auth
      .getByRole("button", {
        name: "Continue with Google — not configured",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  await auth
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill("123456");
  await auth.getByRole("button", { name: "Verify", exact: true }).click();
  await auth.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.authSucceeded), true);
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((call) => call.action.startsWith("account.")),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Settings/auth modal renderer integration passed: persistence, real contract names, reset, validation, save failures, model selection, login/MFA rejection/success, unavailable OAuth. Uses isolated IPC/cloud test doubles; no live provider or OS hook proof.",
  );
} finally {
  await browser?.close();
  await server.close();
}
