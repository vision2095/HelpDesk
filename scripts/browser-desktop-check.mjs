import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "lensdesk-browser-native-"),
);
let visits = 0,
  localAiAuthorization;
const handleRequest = async (req, res) => {
  if (req.url === "/slow/v1/models") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "stale-model" }] }));
    return;
  }
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "fixture-local-model" }] }));
    return;
  }
  if (req.url === "/v1/chat/completions") {
    localAiAuthorization = req.headers.authorization;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "Local model online." } }],
      }),
    );
    return;
  }
  if (req.url === "/download") {
    res.writeHead(200, {
      "content-type": "text/plain",
      "content-disposition": 'attachment; filename="browser-check.txt"',
    });
    res.end("Browser download verification");
    return;
  }
  visits++;
  res.setHeader("content-type", "text/html");
  res.setHeader("set-cookie", "browser-check=present; Path=/; SameSite=Lax");
  res.end(
    `<!doctype html><title>${req.url === "/second" ? "Second page" : "Browser fixture"}</title><h1>${req.url === "/second" ? "Second page" : "Browser fixture"}</h1><a href="/second" id="next">Next</a><a href="/second" target="_blank" id="popup">New tab</a><a href="/download" id="download">Download</a><input aria-label="Page input"><p>Find this sample phrase.</p>`,
  );
};
const server = http.createServer(handleRequest);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const detectionServer = http.createServer(handleRequest);
let detectedOrigin;
for (const port of [1234, 11434, 8080, 8000]) {
  try {
    await new Promise((resolve, reject) => {
      detectionServer.once("error", reject);
      detectionServer.listen(port, "127.0.0.1", resolve);
    });
    detectionServer.removeAllListeners("error");
    detectedOrigin = `http://127.0.0.1:${port}`;
    break;
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
  }
}
assert.ok(
  detectedOrigin,
  "One standard loopback model port must be free for the detection fixture",
);
const application = await electron.launch({
  args: [".", `--user-data-dir=${directory}`],
});
try {
  const networkDiagnostic = await application.evaluate(
    async ({ session }, url) => ({
      proxy: await session
        .fromPartition("persist:lensdesk-browser")
        .resolveProxy(url),
      fetch: await fetch(url)
        .then((response) => response.status)
        .catch((error) => error.message),
    }),
    origin,
  );
  assert.equal(
    networkDiagnostic.fetch,
    200,
    `Native browser fixture is unreachable (${networkDiagnostic.proxy})`,
  );
  const page = await application.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText("Desktop connected", { exact: true }).waitFor();
  await page.getByLabel("Color theme").selectOption("dark");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--panel")
        .trim(),
    ),
    "#192537",
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".starter-list button"))
        .backgroundColor === "rgb(29, 44, 64)",
  );
  await page.screenshot({
    path: "resources/dark-workspace-preview.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByText("Desktop connected", { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  assert.equal(await page.getByLabel("Color theme").inputValue(), "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your assistant, your way." })
    .waitFor();
  await page
    .getByText("Auto-Typing Configuration", { exact: true })
    .scrollIntoViewIfNeeded();
  const darkSettingsColors = await page.evaluate(() => ({
    section: getComputedStyle(document.querySelector(".settings-section"))
      .backgroundColor,
    shortcutRow: getComputedStyle(document.querySelector(".shortcut-row"))
      .backgroundColor,
    shortcutInput: getComputedStyle(
      document.querySelector(".shortcut-row input"),
    ).color,
  }));
  assert.deepEqual(darkSettingsColors, {
    section: "rgb(29, 44, 64)",
    shortcutRow: "rgb(25, 37, 55)",
    shortcutInput: "rgb(226, 234, 245)",
  });
  await page.screenshot({
    path: "resources/dark-shortcuts-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Account & cloud", exact: true })
    .click();
  await page.getByLabel("Cloud server URL").waitFor();
  await page.screenshot({
    path: "resources/dark-account-preview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByLabel("Color theme").selectOption("light");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.getByLabel("Color theme").selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".settings-grid .form-card")
    .first()
    .locator("select")
    .first()
    .selectOption("local");
  await page
    .getByRole("button", { name: "Detect local servers", exact: true })
    .click();
  await page
    .getByLabel("Detected local server")
    .selectOption(detectedOrigin + "/v1");
  assert.equal(
    await page.getByLabel("Local model server address").inputValue(),
    detectedOrigin + "/v1",
  );
  assert.equal(
    await page.getByLabel("Model ID").inputValue(),
    "fixture-local-model",
  );
  await page.getByLabel("Local model server address").fill(origin + "/slow/v1");
  await page.getByRole("button", { name: "Load available models" }).click();
  await page.getByLabel("Local model server address").fill(origin + "/v1");
  await page.getByLabel("Model ID").fill("fixture-local-model");
  await page.getByRole("button", { name: "Load available models" }).click();
  await page.getByText(/1 models returned/).waitFor();
  await page.waitForTimeout(600);
  assert.equal(
    await page
      .getByRole("option", { name: "stale-model", exact: true })
      .count(),
    0,
    "Late results from another endpoint must not enter the model picker",
  );
  await page.getByRole("button", { name: "Test selected model" }).click();
  await page.getByText("Connection works: Local model online.").waitFor();
  assert.equal(localAiAuthorization, undefined);
  await page
    .getByLabel("light theme text color", { exact: true })
    .fill("#17324d");
  await page
    .getByLabel("dark theme text color", { exact: true })
    .fill("#cfdef1");
  await page
    .getByLabel("Session layout", { exact: true })
    .selectOption("compact");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.getByText("Settings saved.", { exact: true }).waitFor();
  await page
    .locator(".appearance-controls")
    .screenshot({ path: "resources/appearance-controls-preview.png" });
  await page.waitForFunction(
    () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--ink")
        .trim() === "#17324d",
  );
  await page.reload();
  await page.getByText("Desktop connected", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(
    await page.getByLabel("Session layout", { exact: true }).inputValue(),
    "compact",
  );
  assert.equal(
    await page
      .getByLabel("dark theme text color", { exact: true })
      .inputValue(),
    "#cfdef1",
  );
  await page.getByLabel("Browser home page").fill(origin + "/");
  const archiveDirectory = path.join(directory, "screenshots");
  fs.mkdirSync(archiveDirectory);
  await application.evaluate(({ dialog }, directory) => {
    global.__originalOpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, archiveDirectory);
  await page
    .getByRole("button", { name: "Choose archive folder", exact: true })
    .click();
  await page.getByLabel("Save screenshots to disk", { exact: true }).check();
  await page.getByLabel("Move window up shortcut", { exact: true }).focus();
  await page
    .getByLabel("Move window up shortcut", { exact: true })
    .press("Control+Alt+ArrowUp");
  assert.equal(
    await page
      .getByLabel("Move window up shortcut", { exact: true })
      .inputValue(),
    "Control+Alt+Up",
  );
  await application.evaluate(({ dialog }) => {
    dialog.showOpenDialog = global.__originalOpenDialog;
  });
  await page.getByLabel("Browser search engine").selectOption("bing");
  await page.getByLabel("Default browser page zoom").focus();
  await page.getByLabel("Default browser page zoom").press("ArrowRight");
  await page.getByRole("button", { name: "Save Desktop Settings" }).click();
  await page
    .getByText("Desktop hotkeys and settings saved successfully.")
    .waitFor();
  await application.evaluate(
    ({ desktopCapturer, systemPreferences, nativeImage }) => {
      global.__originalGetSources = desktopCapturer.getSources;
      global.__originalMediaStatus = systemPreferences.getMediaAccessStatus;
      systemPreferences.getMediaAccessStatus = () => "granted";
      desktopCapturer.getSources = async () => [
        {
          id: "screen:archive-fixture",
          name: "Synthetic capture",
          thumbnail: nativeImage.createFromBitmap(
            Buffer.from([255, 255, 255, 255]),
            { width: 1, height: 1 },
          ),
        },
      ];
    },
  );
  const archived = await page.evaluate(() =>
    window.lens.invoke("desktop.capture", { id: "screen:archive-fixture" }),
  );
  assert.equal(archived.archive.saved, true);
  assert.equal(
    fs
      .readFileSync(path.join(archiveDirectory, archived.archive.filename))
      .subarray(1, 4)
      .toString(),
    "PNG",
  );
  assert.equal(
    (
      await page.evaluate(() =>
        window.lens.invoke("desktop.captureArchive.status"),
      )
    ).files,
    1,
  );
  await page
    .getByRole("button", { name: "Refresh archive usage", exact: true })
    .click();
  await page.getByText(/1 saved captures/).waitFor();
  await page
    .getByRole("region", { name: "Screenshot archive", exact: true })
    .screenshot({ path: "resources/capture-archive-preview.png" });
  const archivePreferences = await page.evaluate(() =>
    window.lens.invoke("desktop.preferences"),
  );
  await page.evaluate(
    (p) =>
      window.lens.invoke("desktop.preferences.save", {
        ...p,
        captureArchive: {
          ...p.captureArchive,
          directory: p.captureArchive.directory + "/missing",
        },
      }),
    archivePreferences,
  );
  const failedArchive = await page.evaluate(() =>
    window.lens.invoke("desktop.capture", { id: "screen:archive-fixture" }),
  );
  assert.ok(failedArchive.image.startsWith("data:image/png"));
  assert.match(failedArchive.archiveError, /not saved to archive/);
  await page.evaluate(
    (p) => window.lens.invoke("desktop.preferences.save", p),
    archivePreferences,
  );
  await application.evaluate(({ desktopCapturer, systemPreferences }) => {
    desktopCapturer.getSources = global.__originalGetSources;
    systemPreferences.getMediaAccessStatus = global.__originalMediaStatus;
  });
  assert.equal(
    (await page.evaluate(() => window.lens.invoke("desktop.preferences")))
      .browser.zoom,
    1.25,
  );
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  await page.getByRole("button", { name: "New browser tab" }).click();
  const getState = () =>
    page.evaluate(() => window.lens.invoke("browser.state"));
  async function waitState(predicate) {
    for (let i = 0; i < 100; i++) {
      const state = await getState();
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `Browser state timed out after ${visits} fixture requests: ` +
        JSON.stringify(await getState()),
    );
  }
  await waitState(
    (s) =>
      s.tabs.length === 1 &&
      !s.tabs[0].loading &&
      s.tabs[0].url === origin + "/" &&
      s.tabs[0].zoom === 1.25,
  );
  await page.getByLabel("Browser address or search").fill(origin);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await waitState(
    (s) =>
      s.tabs.length === 1 &&
      !s.tabs[0].loading &&
      s.tabs[0].title === "Browser fixture",
  );
  const isolation = await application.evaluate(({ webContents }, origin) => {
    const wc = webContents
      .getAllWebContents()
      .find((w) => w.getURL() === origin + "/");
    const p = wc.getLastWebPreferences();
    return {
      contextIsolation: p.contextIsolation,
      sandbox: p.sandbox,
      nodeIntegration: p.nodeIntegration,
      preload: p.preload,
      partition: wc.session.getStoragePath(),
    };
  }, origin);
  assert.equal(isolation.contextIsolation, true);
  assert.equal(isolation.sandbox, true);
  assert.equal(isolation.nodeIntegration, false);
  assert.ok(!isolation.preload);
  assert.ok(isolation.partition.includes("lensdesk-browser"));
  const remote = async (script) =>
    application.evaluate(
      async ({ webContents }, { origin, script }) => {
        const wc = webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith(origin));
        return wc.executeJavaScript(script, true);
      },
      { origin, script },
    );
  assert.deepEqual(
    await remote("({bridge:typeof window.lens,require:typeof window.require})"),
    { bridge: "undefined", require: "undefined" },
  );
  await remote('document.querySelector("#next").click()');
  await waitState(
    (s) => s.tabs[0].url.endsWith("/second") && !s.tabs[0].loading,
  );
  await page.getByRole("button", { name: "Browser back", exact: true }).click();
  await waitState((s) => s.tabs[0].url === origin + "/" && !s.tabs[0].loading);
  await page
    .getByRole("button", { name: "Browser forward", exact: true })
    .click();
  await waitState(
    (s) => s.tabs[0].url.endsWith("/second") && !s.tabs[0].loading,
  );
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  await waitState((s) => !s.tabs[0].loading);
  assert.ok(visits >= 3);
  await page.getByLabel("Browser zoom").selectOption("1.25");
  await waitState((s) => s.tabs[0].zoom === 1.25);
  await page.getByRole("button", { name: "Find in page", exact: true }).click();
  await page.getByLabel("Find text in page").fill("sample phrase");
  await page.getByRole("button", { name: "Close find", exact: true }).click();
  await remote('document.querySelector("#popup").click()');
  await waitState(
    (s) => s.tabs.length === 2 && s.tabs.every((t) => !t.loading),
  );
  await page
    .getByRole("button", { name: "Browser downloads", exact: true })
    .click();
  await application.evaluate(({ session }, directory) => {
    session
      .fromPartition("persist:lensdesk-browser")
      .once("will-download", (_event, item) =>
        item.setSavePath(directory + "/browser-check.txt"),
      );
  }, directory);
  await remote('document.querySelector("#download").click()');
  await waitState((s) => s.downloads.some((d) => d.state === "completed"));
  assert.equal(
    fs.readFileSync(path.join(directory, "browser-check.txt"), "utf8"),
    "Browser download verification",
  );
  const beforeClear = await application.evaluate(
    ({ session }, origin) =>
      session
        .fromPartition("persist:lensdesk-browser")
        .cookies.get({ url: origin }),
    origin,
  );
  assert.ok(beforeClear.some((cookie) => cookie.name === "browser-check"));
  await page.evaluate(() => window.lens.invoke("browser.clearData"));
  const afterClear = await application.evaluate(
    ({ session }, origin) =>
      session
        .fromPartition("persist:lensdesk-browser")
        .cookies.get({ url: origin }),
    origin,
  );
  assert.equal(
    afterClear.some((cookie) => cookie.name === "browser-check"),
    false,
  );
  await assert.rejects(
    page.evaluate(() =>
      window.lens.invoke("browser.navigate", { url: "file:///etc/passwd" }),
    ),
    /HTTP/,
  );
  const count = (await getState()).tabs.length;
  const id = (await getState()).activeId;
  await page.evaluate((id) => window.lens.invoke("browser.close", { id }), id);
  await waitState((s) => s.tabs.length === count - 1);
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  assert.equal(
    await application.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].contentView.children.length,
    ),
    0,
    "browser detached when leaving its page",
  );
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  await page.getByLabel("Browser address or search").waitFor();
  assert.equal((await getState()).tabs.length, 1, "tabs survive navigation");
  await page
    .getByRole("button", { name: "New session", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .waitFor();
  assert.equal(
    await application.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].contentView.children.length,
    ),
    0,
    "native view must not cover a workspace dialog",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("Browser address or search").waitFor();
  // Exercise callbacks actually installed with Electron without synthesizing keys into other apps.
  await application.evaluate(({ globalShortcut }) => {
    global.__shortcutCallbacks = new Map();
    global.__register = globalShortcut.register.bind(globalShortcut);
    globalShortcut.register = (key, fn) => {
      global.__shortcutCallbacks.set(key, fn);
      return global.__register(key, fn);
    };
  });
  const preferences = await page.evaluate(() =>
    window.lens.invoke("desktop.preferences"),
  );
  preferences.shortcuts.hide = "Shift+H";
  preferences.shortcuts.autoType = "Shift+T";
  preferences.shortcuts.overlay = "CommandOrControl+Alt+O";
  preferences.shortcuts.browser = "CommandOrControl+Alt+B";
  preferences.shortcuts.theme = "CommandOrControl+Alt+Z";
  preferences.shortcuts.moveRight = "CommandOrControl+Alt+Right";
  preferences.shortcuts.shortcuts = "CommandOrControl+Alt+J";
  preferences.shortcuts.opacityDown = "CommandOrControl+Alt+F";
  preferences.shortcuts.clearLastCapture = "CommandOrControl+Alt+U";
  preferences.shortcuts.clearCaptures = "CommandOrControl+Alt+I";
  await page.evaluate(
    (p) => window.lens.invoke("desktop.preferences.save", p),
    preferences,
  );
  const shortcutState = await page.evaluate(() =>
    window.lens.invoke("desktop.preferences"),
  );
  assert.deepEqual(
    shortcutState.shortcutErrors,
    [],
    "all configured shortcuts must register",
  );
  for (const accelerator of [
    "Shift+H",
    "Shift+M",
    "Control+Shift+Space",
  ]) {
    const global = await application.evaluate(
      ({ globalShortcut }, key) => globalShortcut.isRegistered(key),
      accelerator,
    );
    const hooked =
      shortcutState.hookAvailable &&
      shortcutState.hookCombos.includes(accelerator);
    assert.ok(
      global || hooked,
      `${accelerator} must be registered globally or through the hook`,
    );
  }
  const fire = async (action) =>
    application.evaluate(
      (_electron, key) => global.__shortcutCallbacks.get(key)(),
      preferences.shortcuts[action],
    );
  await fire("browser");
  await page.getByRole("heading", { name: "Your thinking space." }).waitFor();
  await page.locator(".compact-interview").waitFor();
  await fire("browser");
  await page.getByLabel("Browser address or search").waitFor();
  await fire("theme");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--ink")
        .trim(),
    ),
    "#cfdef1",
  );
  await fire("theme");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await fire("opacityDown");
  await page.waitForFunction(
    async () => (await window.lens.invoke("state")).settings.opacity === 0.9,
  );
  const nativeOpacity = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getOpacity(),
  );
  assert.ok(nativeOpacity > 0.89 && nativeOpacity < 0.91);
  await fire("shortcuts");
  await page
    .getByRole("heading", { name: "Your assistant, your way." })
    .waitFor();
  await fire("shortcuts");
  await page.getByRole("heading", { name: "Your thinking space." }).waitFor();
  const beforeMove = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  await fire("moveRight");
  const afterMove = await application.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0].getBounds();
    return { bounds, area: screen.getDisplayMatching(bounds).workArea };
  });
  assert.equal(
    afterMove.bounds.x,
    Math.max(
      afterMove.area.x,
      Math.min(
        beforeMove.x + 40,
        afterMove.area.x + afterMove.area.width - beforeMove.width,
      ),
    ),
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+O" : "Control+Shift+O",
  );
  assert.equal(
    await page.locator(".overlay-hud-container").count(),
    0,
    "The replaced default shortcut must not keep triggering in the renderer",
  );
  const imageInput = page.locator(
    'input[type="file"][accept="image/png,image/jpeg,image/webp"]',
  );
  const captureFile = path.join(archiveDirectory, archived.archive.filename);
  await imageInput.setInputFiles(captureFile);
  await page.getByRole("img", { name: "Screenshot 1", exact: true }).waitFor();
  await imageInput.setInputFiles(captureFile);
  await page.getByRole("img", { name: "Screenshot 2", exact: true }).waitFor();
  await fire("clearLastCapture");
  await page.waitForFunction(
    () => document.querySelectorAll(".attachments img").length === 1,
  );
  await fire("clearCaptures");
  await page.waitForFunction(
    () => document.querySelectorAll(".attachments img").length === 0,
  );
  await page
    .getByTitle("Toggle floating overlay over any browser window", {
      exact: true,
    })
    .click();
  // The saved session layout is compact, so the floating overlay starts in
  // Interview mode. Exercise that compact transcript, then switch to the full
  // workbench so the expandable standard transcript is deterministic.
  const overlayLayout = await page.evaluate(
    async () => (await window.lens.invoke("state")).settings.interviewLayout,
  );
  if (overlayLayout === "compact") {
    await page.locator(".overlay-transcript-content").waitFor();
    await page
      .getByTitle(/^Switch back to Full Workbench layout/)
      .click();
  }
  await page.locator(".overlay-transcript").waitFor();
  for (const width of [360, 480]) {
    await application.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setContentSize(width, 720),
      width,
    );
    const expandBounds = await page
      .getByTitle(/^Expand to full workspace/)
      .boundingBox();
    assert.ok(
      expandBounds.x >= 0 && expandBounds.x + expandBounds.width <= width,
      "Floating controls must remain visible at the minimum supported width",
    );
  }
  assert.equal(
    await page.getByTitle(/^Hide window/).getAttribute("title"),
    process.platform === "darwin"
      ? "Hide window (⇧+H)"
      : "Hide window (Shift+H)",
  );
  assert.equal(
    await page.locator(".overlay-transcript").getAttribute("open"),
    null,
  );
  await page.locator(".overlay-transcript summary").click();
  assert.equal(
    await page.locator(".overlay-transcript").getAttribute("open"),
    "",
  );
  await page.screenshot({ path: "resources/floating-transcript-preview.png" });
  await page.evaluate(() => window.lens.invoke("desktop.overlay"));
  await page.getByRole("heading", { name: "Your thinking space." }).waitFor();
  await page.evaluate(() => window.lens.invoke("desktop.hide"));
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  await page.waitForTimeout(900);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
    "topmost timer self-heals userHidden after the window is shown again",
  );
  await application.evaluate(
    (_electron, key) => global.__shortcutCallbacks.get(key)(),
    preferences.shortcuts.toggle,
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  await application.evaluate(
    (_electron, key) => global.__shortcutCallbacks.get(key)(),
    preferences.shortcuts.toggle,
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
  );
  await application.evaluate(({ dialog }) => {
    global.__oldTypingDialog = dialog.showMessageBox;
    dialog.showMessageBox = (_window, options) => {
      if (options.title !== "Type into another application")
        return global.__oldTypingDialog(_window, options);
      global.__typingDialogOpen = true;
      return new Promise((resolve) =>
        options.signal.addEventListener(
          "abort",
          () => {
            global.__typingDialogOpen = false;
            resolve({ response: 0 });
          },
          { once: true },
        ),
      );
    };
  });
  await page.evaluate(() => {
    window.__typingAttempt = window.lens.invoke("desktop.autoType", {
      text: "Do not type this test text",
    });
  });
  for (let i = 0; i < 50; i++) {
    if (await application.evaluate(() => global.__typingDialogOpen)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(
    await application.evaluate(() => global.__typingDialogOpen),
    true,
  );
  await application.evaluate(
    (_electron, key) => global.__shortcutCallbacks.get(key)(),
    preferences.shortcuts.autoType,
  );
  assert.equal(
    (await page.evaluate(() => window.__typingAttempt)).canceled,
    true,
    "same typing shortcut cancels the pending operation without entering text",
  );
  assert.equal(
    await application.evaluate(() => global.__typingDialogOpen),
    false,
  );
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = global.__oldTypingDialog;
  });
  assert.deepEqual(errors, []);
  console.log(
    "Native desktop E2E passed: custom theme colors and compact layout persist; local-server detection and stale-response isolation; no-key model checks; opt-in screenshot archive and save-failure recovery using synthetic images; browser preferences/navigation/tabs/downloads/data clearing; theme/browser/settings/opacity/movement shortcuts; expandable floating transcript; same-shortcut hide/restore and auto-type cancellation. External AI was not used.",
  );
} finally {
  await application.close();
  server.close();
  detectionServer.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
