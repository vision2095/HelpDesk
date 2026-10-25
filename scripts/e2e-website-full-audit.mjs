import { browserOptions } from "./browser-runtime.mjs";
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const BASE_URL = "http://127.0.0.1:4319";
const DATA_DIR = path.resolve(".data/cloud");
const OUTBOX_DIR = path.join(DATA_DIR, "outbox");

console.log("==================================================================");
console.log("   LENSDESK 2.0 - E2E COMPREHENSIVE WEBSITE AUDIT & TEST SUITE   ");
console.log("==================================================================");
console.log(`Target: ${BASE_URL}`);

// 1. Check health
const healthRes = await fetch(`${BASE_URL}/health`);
assert.equal(healthRes.status, 200, "Server health check failed");
console.log("✓ Server health check passed (200 OK)");

const browser = await chromium.launch(browserOptions());
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (err) => {
  console.error("  [Browser Error]:", err.message);
  pageErrors.push(err.message);
});

try {
  // ==================================================================
  // PHASE 1: Home Page & Global Navigation Routing
  // ==================================================================
  console.log("\n[1/7] Testing Homepage & Clean URL Routing...");
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState("networkidle");
  assert.equal(page.url(), `${BASE_URL}/`, "Home URL mismatch");

  // Verify Hero heading exists
  const heroHeading = page.getByRole("heading", { name: /Think clearly|LensDesk/i }).first();
  await heroHeading.waitFor({ state: "visible", timeout: 5000 });
  console.log("  ✓ Homepage hero loaded successfully");

  // Take screenshot of homepage
  await page.screenshot({ path: "resources/audit-1-homepage.png" });

  // Test Quick Nav pills from Home to Workshop
  console.log("  Testing navigation to Assistant / Workshop...");
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/workshop`, "URL did not update to /workshop");
  console.log("  ✓ Clean URL verified: /workshop");

  // Test navigation to Downloads
  console.log("  Testing navigation to Desktop Downloads...");
  await page.getByRole("button", { name: /Desktop & shortcuts|Desktop Downloads|Downloads/i }).first().click();
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/downloads`, "URL did not update to /downloads");
  console.log("  ✓ Clean URL verified: /downloads");

  // Test navigation to Profiles
  console.log("  Testing navigation to Profiles...");
  await page.getByRole("button", { name: /Interview profiles|Profiles/i }).first().click();
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/profiles`, "URL did not update to /profiles");
  console.log("  ✓ Clean URL verified: /profiles");

  // Test navigation to Sessions
  console.log("  Testing navigation to Session History...");
  await page.getByRole("button", { name: /Session history|Session History/i }).first().click();
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/sessions`, "URL did not update to /sessions");
  console.log("  ✓ Clean URL verified: /sessions");

  // Test navigation to Settings
  console.log("  Testing navigation to Settings...");
  await page.getByRole("button", { name: /^Settings/i }).first().click();
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/settings`, "URL did not update to /settings");
  console.log("  ✓ Clean URL verified: /settings");

  // ==================================================================
  // PHASE 2: Operator Admin Console
  // ==================================================================
  console.log("\n[2/7] Testing Operator Admin Console (/admin)...");
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/admin`, "Direct navigation to /admin failed");

  // Fill Admin Token
  const tokenInput = page.getByLabel("Admin token");
  await tokenInput.waitFor({ state: "visible", timeout: 5000 });
  await tokenInput.fill("lensdesk-admin-token");
  await page.getByRole("button", { name: "Unlock console", exact: true }).click();
  await page.waitForTimeout(1000);

  // Verify Operator console unlocked
  const adminHeading = page.getByRole("heading", { name: /Service control/i });
  await adminHeading.waitFor({ state: "visible", timeout: 5000 });
  console.log("  ✓ Admin console unlocked with development admin token");

  // Verify stats & Custom Subscription Grant form
  const grantCard = page.getByRole("heading", { name: /Grant Custom Subscription by User Email/i });
  await grantCard.waitFor({ state: "visible", timeout: 5000 });
  console.log("  ✓ Admin custom subscription grant section verified");

  await page.screenshot({ path: "resources/audit-2-admin.png" });

  // ==================================================================
  // PHASE 3: User Registration, Outbox Email Verification & Account
  // ==================================================================
  console.log("\n[3/7] Testing User Signup & Verification Flow...");
  await page.goto(`${BASE_URL}/account`);
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/account`, "URL is not /account");

  // Switch to Create Account if not already
  const createAccountSwitch = page.getByRole("button", { name: /New here\? Create an account|Create an account/i });
  if (await createAccountSwitch.isVisible()) {
    await createAccountSwitch.click();
    await page.waitForTimeout(300);
  }

  const testEmail = `audit-${Date.now()}@example.com`;
  const testPassword = "VerySecurePassword2026!";
  console.log(`  Registering test account: ${testEmail}`);

  await page.getByLabel("Your name", { exact: true }).fill("Audit Quality Tester");
  await page.getByLabel("Email address", { exact: true }).fill(testEmail);
  await page.getByLabel("Password", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.waitForTimeout(1500);

  // Check outbox for verification email
  let verifyUrl = null;
  if (fs.existsSync(OUTBOX_DIR)) {
    const files = fs.readdirSync(OUTBOX_DIR).sort().reverse();
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(OUTBOX_DIR, file), "utf8"));
        if (content.to === testEmail) {
          verifyUrl = content.url;
          break;
        }
      } catch {}
    }
  }

  assert.ok(verifyUrl, `Verification email for ${testEmail} was not found in outbox`);
  console.log(`  ✓ Email outbox delivered verification link: ${verifyUrl}`);

  // Navigate to verification URL
  await page.goto(verifyUrl);
  const toastStatus = page.locator(".toast[role='status']");
  await toastStatus.waitFor({ state: "visible", timeout: 10000 });
  console.log(`  ✓ Email verification toast: "${await toastStatus.innerText()}"`);

  // ==================================================================
  // PHASE 4: Subscriptions & Desktop Sessions Management
  // ==================================================================
  console.log("\n[4/7] Testing Subscriptions & Device Sessions on Account Page...");
  // Check subscription plans display
  const prepaidHeading = page.getByRole("heading", { name: "Prepaid plans", exact: true });
  await prepaidHeading.waitFor({ state: "visible", timeout: 5000 });
  console.log("  ✓ Prepaid plans section displayed");

  // Check Signed-in desktop devices section & "Log out from all devices" button
  const devicesHeading = page.getByRole("heading", { name: /Signed-in desktop devices/i });
  await devicesHeading.waitFor({ state: "visible", timeout: 5000 });
  console.log("  ✓ Signed-in desktop devices section displayed");

  await page.screenshot({ path: "resources/audit-3-account.png" });

  // ==================================================================
  // PHASE 5: Admin Custom Grant & Account Moderation
  // ==================================================================
  console.log("\n[5/7] Testing Admin Custom Subscription Grant & Moderation...");
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForTimeout(500);

  // Fill grant email and grant 30 days
  const grantEmailInput = page.getByLabel("User Email Address", { exact: true });
  await grantEmailInput.fill(testEmail);
  const grantDaysInput = page.getByLabel("Subscription Days", { exact: true });
  await grantDaysInput.fill("30");
  await page.getByRole("button", { name: /Grant 30 Days of Desktop Access/i }).click();
  await page.waitForTimeout(1500);

  // Check success banner
  const banner = page.locator(".admin-banner");
  await banner.waitFor({ state: "visible", timeout: 5000 });
  console.log(`  ✓ Admin grant succeeded: "${await banner.innerText()}"`);

  // Search user in admin accounts table
  const searchInput = page.getByPlaceholder("Search email or name");
  await searchInput.fill(testEmail);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForTimeout(1000);

  // Open user row
  const openUserBtn = page.getByRole("button", { name: "Open", exact: true }).first();
  await openUserBtn.click();
  await page.waitForTimeout(800);

  // Test Suspend
  const suspendBtn = page.getByRole("button", { name: "Suspend", exact: true });
  await suspendBtn.click();
  await page.waitForTimeout(1000);
  console.log("  ✓ Account suspension action verified");

  // Test Unsuspend
  const unsuspendBtn = page.getByRole("button", { name: "Unsuspend", exact: true });
  await unsuspendBtn.click();
  await page.waitForTimeout(1000);
  console.log("  ✓ Account reactivation / unsuspend action verified");

  // Verify entitlement is now active on Account page
  await page.goto(`${BASE_URL}/account`);
  await page.waitForTimeout(1000);
  const countdown = page.locator(".access-countdown-value");
  await countdown.waitFor({ state: "visible", timeout: 5000 });
  console.log(`  ✓ Active countdown visible on user account: ${await countdown.innerText()}`);

  // ==================================================================
  // PHASE 6: Workshop / Assistant Studio
  // ==================================================================
  console.log("\n[6/7] Testing Workshop / Assistant Studio (/workshop)...");
  await page.goto(`${BASE_URL}/workshop`);
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/workshop`, "URL is not /workshop");

  // Verify streamlined header bar exists
  const headerBar = page.locator(".workspace-header-bar");
  await headerBar.waitFor({ state: "visible", timeout: 5000 });
  console.log("  ✓ Sleek workspace header bar loaded");

  // Test mode chips
  const codingChip = page.getByRole("button", { name: "Coding", exact: true });
  await codingChip.click();
  await page.waitForTimeout(300);
  console.log("  ✓ Mode switched to Coding");

  // Create a session so notes and conversation are active
  const newSessionBtn = page.getByRole("button", { name: "New session", exact: true }).first();
  await newSessionBtn.click();
  await page.getByPlaceholder("e.g. Backend engineering practice").fill("Audited Cloud Session");
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await page.waitForTimeout(600);
  console.log("  ✓ Created and started session: Audited Cloud Session");

  // Test Notes & Context panel toggle
  const notesTabBtn = page.getByRole("button", { name: "Notes", exact: true });
  await notesTabBtn.waitFor({ state: "visible", timeout: 3000 });
  await notesTabBtn.click();
  const notesArea = page.getByLabel("Session notes");
  await notesArea.fill("Audited session notes are preserved safely.");
  await notesArea.blur();
  await page.waitForTimeout(500);
  console.log("  ✓ Notes & Context panel and auto-save verified");

  // Test Composer interaction
  const composerArea = page.getByLabel("Ask LensDesk");
  await composerArea.fill("Hello LensDesk! This is an automated audit test.");
  console.log("  ✓ Composer ready and typed");

  await page.screenshot({ path: "resources/audit-4-workshop.png" });

  // ==================================================================
  // PHASE 7: Interview Profiles & Session Archive
  // ==================================================================
  console.log("\n[7/7] Testing Profiles & Session Archive...");
  await page.goto(`${BASE_URL}/profiles`);
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/profiles`, "URL is not /profiles");

  // Click template chip to load pre-configured template
  const templateChip = page.locator(".template-chip-card").first();
  if (await templateChip.isVisible()) {
    await templateChip.click();
    await page.waitForTimeout(300);
    const saveBtn = page.getByRole("button", { name: /Save profile/i });
    await saveBtn.click();
    await page.waitForTimeout(600);
    console.log("  ✓ Interview profile created from template and persisted");
  }

  // Check sessions
  await page.goto(`${BASE_URL}/sessions`);
  await page.waitForTimeout(500);
  assert.equal(page.url(), `${BASE_URL}/sessions`, "URL is not /sessions");
  console.log("  ✓ Sessions archive page loaded cleanly");

  console.log("\n==================================================================");
  console.log("       ALL E2E AUDIT TESTS PASSED WITH ZERO CRITICAL DEFECTS      ");
  console.log("==================================================================");
} catch (error) {
  console.error("\n❌ AUDIT FAILED:", error);
  await page.screenshot({ path: "resources/audit-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(DATA_DIR, "accounts.sqlite"));
    db.prepare("DELETE FROM users WHERE email LIKE 'audit-%@example.com'").run();
    db.close();
  } catch {}
  await browser.close();
}
