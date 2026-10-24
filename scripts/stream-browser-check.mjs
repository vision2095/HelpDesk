import { TOTP, Secret } from "otpauth";
import { chromium } from "playwright-core";
import { browserOptions } from "./browser-runtime.mjs";
import { createCloudServer } from "../server/cloud/app.mjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "lens-stream-browser-"),
);
let mail,
  providerCalls = 0,
  abortCount = 0,
  transcriptionCalls = 0;
let authNow = Date.now();
const app = createCloudServer({
  directory,
  publicUrl: "http://127.0.0.1:4323",
  encryptionKey: randomBytes(32).toString("hex"),
  mfaClock: () => authNow,
  platformKeys: { openai: "test-only" },
  mailer: {
    sendMail: async (m) => {
      mail = m;
    },
  },
  fetchImpl: async (_url, { signal }) => {
    if (_url.endsWith("/audio/transcriptions")) {
      transcriptionCalls++;
      return Response.json({ text: "A captured audio sample." });
    }
    providerCalls++;
    let timer;
    const frame = (data) =>
      new TextEncoder().encode(
        `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
      );
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(
            frame({ choices: [{ delta: { content: "An incremental " } }] }),
          );
          timer = setTimeout(() => {
            c.enqueue(
              frame({
                choices: [
                  {
                    delta: { content: "answer with evidence." },
                    finish_reason: "stop",
                  },
                ],
              }),
            );
            c.enqueue(
              frame({ usage: { prompt_tokens: 20, completion_tokens: 10 } }),
            );
            c.enqueue(frame("[DONE]"));
            c.close();
          }, 1500);
          signal.addEventListener(
            "abort",
            () => {
              abortCount++;
              clearTimeout(timer);
              try {
                c.error(signal.reason);
              } catch {}
            },
            { once: true },
          );
        },
        cancel() {
          clearTimeout(timer);
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  },
});
await new Promise((r) => app.server.listen(4323, "127.0.0.1", r));
const browser = await chromium.launch({
  ...browserOptions(),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
try {
  const page = await browser.newPage({ permissions: ["microphone"] });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let response = await page.request.post(
    "http://127.0.0.1:4323/api/auth.register",
    {
      data: {
        email: "stream@example.com",
        password: "browser-test-password",
        name: "Streaming QA",
      },
    },
  );
  assert.ok(response.ok());
  const token = new URL(mail.text.match(/http:\/\/[^\s]+/)[0]).searchParams.get(
    "verify",
  );
  response = await page.request.post("http://127.0.0.1:4323/api/auth.verify", {
    data: { token },
  });
  assert.ok(response.ok());
  await page.goto("http://127.0.0.1:4323/?workspace");
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page
    .getByRole("button", { name: "New session", exact: true })
    .first()
    .click();
  await page
    .getByPlaceholder("e.g. Backend engineering practice")
    .fill("Streaming E2E");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Session notes")
    .fill("Autosave without leaving this field.");
  await page.waitForFunction(async () => {
    const r = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const s = await r.json();
    return s.sessions[0]?.notes === "Autosave without leaving this field.";
  });
  await page.getByRole("button", { name: "Record audio", exact: true }).click();
  await page.getByLabel("Audio input level").waitFor();
  await page.getByLabel("Ask LensDesk").fill("Explain streaming");
  await page.getByRole("button", { name: "Send question" }).click();
  await page.getByText("An incremental", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Answer stopped." })
    .waitFor();
  assert.equal(
    await page.getByLabel("Ask LensDesk").inputValue(),
    "Explain streaming",
  );
  await page.waitForFunction(async () => {
    const r = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return (await r.json()).sessions[0].messages.length === 0;
  });
  await page.waitForFunction(async () => {
    const r = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return (await r.json()).sessions[0].transcript.includes(
      "A captured audio sample.",
    );
  });
  assert.equal(abortCount, 1);
  await page.getByRole("button", { name: "Send question" }).click();
  await page
    .getByText("An incremental answer with evidence.", { exact: true })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Ask LensDesk"]').value === "",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Session history", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({ hasText: "Streaming E2E" })
    .last()
    .click();
  await page
    .getByText("An incremental answer with evidence.", { exact: true })
    .waitFor();
  const saved = await page.request
    .post("http://127.0.0.1:4323/api/state", { data: {} })
    .then((r) => r.json());
  assert.equal(saved.sessions[0].messages.length, 2);
  assert.equal(saved.sessions[0].messages[1].usage.completion_tokens, 10);
  // A lost append response must retain encrypted cached text across reload,
  // then retry the same segment without uploading/billing audio again.
  const originalTranscriptions = transcriptionCalls;
  await page.route("**/api/transcript.append", (route) =>
    route.abort("failed"),
  );
  await page.getByRole("button", { name: "Record audio", exact: true }).click();
  await page.getByLabel("Audio input level").waitFor();
  await page.waitForTimeout(700);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  const pending = page.locator('[aria-label="Pending audio"]');
  await pending
    .getByRole("button", { name: "Retry clip", exact: true })
    .waitFor();
  assert.equal(transcriptionCalls, originalTranscriptions + 1);
  await page.reload();
  await page
    .getByRole("button", { name: "Session history", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({ hasText: "Streaming E2E" })
    .last()
    .click();
  await pending
    .getByText(
      "Recovered audio. Retry when the original session is available.",
      { exact: true },
    )
    .waitFor();
  await page.unroute("**/api/transcript.append");
  await pending
    .getByRole("button", { name: "Retry clip", exact: true })
    .click();
  await pending.waitFor({ state: "detached" });
  assert.equal(
    transcriptionCalls,
    originalTranscriptions + 1,
    "append retry must use encrypted cached transcription",
  );
  const afterRecovery = await page.request
    .post("http://127.0.0.1:4323/api/state", { data: {} })
    .then((response) => response.json());
  assert.equal(afterRecovery.sessions[0].segments.length, 2);

  // Failed raw capture is account-scoped across a real cookie switch/reload.
  await page.route("**/api/transcribe", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Record audio", exact: true }).click();
  await page.getByLabel("Audio input level").waitFor();
  await page.waitForTimeout(700);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await pending
    .getByRole("button", { name: "Retry clip", exact: true })
    .waitFor();
  const accountB = await page.request.post(
    "http://127.0.0.1:4323/api/auth.register",
    {
      data: {
        email: "audio-other@example.com",
        password: "other-browser-password",
        name: "Audio Other",
      },
    },
  );
  assert.ok(accountB.ok());
  await page.reload();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  assert.equal(
    await pending.count(),
    0,
    "account B must not see account A clips",
  );
  await page.request.post("http://127.0.0.1:4323/api/auth.logout", {
    data: {},
  });
  await page.reload();
  assert.equal(
    await pending.count(),
    0,
    "signed-out browser must not expose recovery clips",
  );
  const accountA = await page.request.post(
    "http://127.0.0.1:4323/api/auth.login",
    {
      data: { email: "stream@example.com", password: "browser-test-password" },
    },
  );
  assert.ok(accountA.ok());
  await page.reload();
  await page
    .getByRole("button", { name: "Session history", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({ hasText: "Streaming E2E" })
    .last()
    .click();
  await pending
    .getByRole("button", { name: "Discard clip", exact: true })
    .waitFor();
  const downloadEvent = page.waitForEvent("download");
  await pending
    .getByRole("button", { name: "Download clip", exact: true })
    .click();
  const audioDownload = await downloadEvent;
  assert.match(
    audioDownload.suggestedFilename(),
    /^lensdesk-audio-.*\.(webm|m4a|mp4)$/,
  );
  await pending
    .getByRole("button", { name: "Discard clip", exact: true })
    .click();
  await pending.waitFor({ state: "detached" });
  await page.unroute("**/api/transcribe");

  await page
    .getByRole("button", { name: "Account & cloud", exact: true })
    .click();
  await page
    .getByLabel("Password for authenticator settings")
    .fill("browser-test-password");
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const mfaSection = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Authenticator verification",
      exact: true,
    }),
  });
  const secret = await mfaSection.locator("code").textContent();
  const totp = new TOTP({
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
  });
  await page
    .getByLabel("Authenticator setup code")
    .fill(totp.generate({ timestamp: authNow }));
  await page
    .getByRole("button", { name: "Enable authenticator", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Save your recovery codes now", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "I saved my codes", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("stream@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Sign-in verification code").waitFor();
  authNow += 31000;
  await page
    .getByLabel("Sign-in verification code")
    .fill(totp.generate({ timestamp: authNow }));
  await page
    .getByRole("button", { name: "Verify and sign in", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Streaming QA", exact: true })
    .waitFor();
  assert.equal(providerCalls, 2);
  assert.deepEqual(errors, []);
  console.log(
    "Streaming browser E2E passed: debounced autosave, visible incremental text, stop aborts upstream, canceled drafts remain, retry saves exactly two messages with usage, persistence after reload, authenticator enrollment, MFA sign-in, recording while chatting, real WebM duration metering, encrypted failed-clip recovery after reload without retranscription, account-scoped recovery, clip download and discard. Provider responses were controlled fixtures.",
  );
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
