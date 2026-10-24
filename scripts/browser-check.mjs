import { browserOptions } from "./browser-runtime.mjs";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "lensdesk-workspace-e2e-"),
);
const apiPort = await freePort(),
  port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  LENSDESK_DATA_DIR: directory,
  LENSDESK_DEV_PORT: String(apiPort),
  LENSDESK_DEV_ORIGIN: origin,
  LENSDESK_DEV_API_URL: `http://127.0.0.1:${apiPort}`,
};
const processes = [
  spawn(process.execPath, ["server/dev.mjs"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  ),
];
let output = "";
for (const process of processes)
  for (const stream of [process.stdout, process.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-12000);
    });
let browser;
try {
  browser = await chromium.launch(browserOptions());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (processes.some((child) => child.exitCode !== null))
      throw new Error(`Browser fixture process exited: ${output}`);
    try {
      if (
        (
          await fetch(origin + "/api/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Browser fixture failed to start: ${output}`);
  const previous = await page.request
    .post(origin + "/api/state", { data: {} })
    .then((r) => r.json());
  for (const s of previous.sessions.filter((s) => s.title === "QA session"))
    await page.request.post(origin + "/api/session.delete", {
      data: { id: s.id },
    });
  for (const p of previous.profiles.filter((p) => p.name === "Frontend role"))
    await page.request.post(origin + "/api/profile.delete", {
      data: { id: p.id },
    });
  await page.goto(origin + "/?workspace");
  await page.getByRole("heading", { name: "Your thinking space." }).waitFor();
  await page.screenshot({
    path: "resources/workspace-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "New session", exact: true })
    .first()
    .click();
  await page
    .getByPlaceholder("e.g. Backend engineering practice")
    .fill("QA session");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.getByLabel("Session title").waitFor();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes")
    .fill("Keep answers concise and discuss tradeoffs.");
  await page.getByLabel("Session notes").blur();
  await page
    .getByRole("button", { name: "Interview profiles", exact: true })
    .click();
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  await page.getByLabel("Profile name", { exact: true }).fill("Frontend role");
  await page
    .getByLabel("Target role", { exact: true })
    .fill("Senior frontend engineer");
  await page.getByLabel("Company", { exact: true }).fill("Example company");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Profile saved." })
    .waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your assistant, your way." })
    .waitFor();
  await page.screenshot({
    path: "resources/settings-preview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page
    .getByLabel("Ask LensDesk")
    .fill("How do I explain React reconciliation?");
  await page.getByRole("button", { name: "Send question" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Add your openai API key" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Ask LensDesk").inputValue(),
    "How do I explain React reconciliation?",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Session history", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({ hasText: "QA session" })
    .last()
    .click();
  assert.equal(await page.getByLabel("Session notes").count(), 0);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  assert.equal(
    await page.getByLabel("Session notes").inputValue(),
    "Keep answers concise and discuss tradeoffs.",
  );
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({
    path: "resources/tablet-preview.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 480, height: 720 });
  await page.screenshot({
    path: "resources/floating-preview.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: session creation, notes persistence, profile save, settings, missing-key error, responsive layouts, no runtime errors.",
  );
  const state = await page.request
    .post(origin + "/api/state", { data: {} })
    .then((r) => r.json());
  for (const s of state.sessions.filter((s) => s.title === "QA session"))
    await page.request.post(origin + "/api/session.delete", {
      data: { id: s.id },
    });
  for (const p of state.profiles.filter((p) => p.name === "Frontend role"))
    await page.request.post(origin + "/api/profile.delete", {
      data: { id: p.id },
    });
} finally {
  await browser?.close();
  await Promise.all(
    processes.map(async (child) => {
      if (child.exitCode !== null) return;
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([
        stopped,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  );
  fs.rmSync(directory, { recursive: true, force: true });
}
