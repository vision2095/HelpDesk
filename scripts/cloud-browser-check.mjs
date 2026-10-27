import { browserOptions } from "./browser-runtime.mjs";
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-cloud-browser-"));
const child = spawn(process.execPath, ["server/cloud/app.mjs"], {
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: "4321",
    PUBLIC_URL: "http://127.0.0.1:4321",
    CLOUD_DATA_DIR: data,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});
const browser = await chromium.launch(browserOptions());
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4321/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4321");
  await page
    .getByRole("heading", {
      name: /Think clearly/i,
    })
    .waitFor();
  await page.screenshot({
    path: "resources/hosted-home-preview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Sign in|Create an account|Open workspace/i }).first().click();
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Your name", { exact: true }).fill("Cloud QA");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("cloud-ui@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-browser-test-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const unverifiedNotice = page.getByText("Verify your email to use hosted AI.", { exact: true });
  if (await unverifiedNotice.isVisible({ timeout: 2000 }).catch(() => false)) {
    const outbox = path.join(data, "outbox"),
      mail = JSON.parse(
        fs.readFileSync(path.join(outbox, fs.readdirSync(outbox)[0]), "utf8"),
      );
    await page.goto(mail.url);
    await page
      .getByRole("status")
      .filter({ hasText: "Email verified." })
      .waitFor();
  }
  await page.screenshot({
    path: "resources/cloud-account-preview.png",
    fullPage: true,
  });
  assert.equal(
    await page
      .getByText("Verify your email to use hosted AI.", { exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page
    .getByRole("button", { name: "New session", exact: true })
    .first()
    .click();
  await page
    .getByPlaceholder("e.g. Backend engineering practice")
    .fill("Synced browser session");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByLabel("Session notes").fill("Saved to my cloud account.");
  await page.getByLabel("Session notes").blur();
  await page
    .getByRole("button", { name: "Account & cloud", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("cloud-ui@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Cloud QA", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Session history", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({ hasText: "Synced browser session" })
    .last()
    .click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  assert.equal(
    await page.getByLabel("Session notes").inputValue(),
    "Saved to my cloud account.",
  );
  await page
    .getByRole("button", { name: "Account & cloud", exact: true })
    .click();
  await page.setViewportSize({ width: 768, height: 1000 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "resources/cloud-tablet-preview.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Hosted browser checks passed: homepage, signup, email verification, account page, sign-out, sign-in, session persistence across authentication, responsive layout, no renderer errors.",
  );
} finally {
  await browser.close();
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  fs.rmSync(data, { recursive: true, force: true });
}
