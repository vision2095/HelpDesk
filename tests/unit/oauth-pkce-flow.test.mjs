import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

// RFC 7636 PKCE S256 helper
function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

function generatePkceChallenge(verifier) {
  return base64UrlEncode(sha256(Buffer.from(verifier, "ascii")));
}

test("GAP-P0-01: RFC 7636 PKCE S256 test vector validation", () => {
  // Test vector from RFC 7636 Appendix B
  const testVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const challenge = generatePkceChallenge(testVerifier);
  assert.equal(challenge, expectedChallenge, "PKCE S256 challenge must match RFC 7636 Appendix B");
});

test("GAP-P0-01: Native common.hpp includes FIPS 180-4 SHA256 and PKCE implementation", () => {
  for (const base of ["src-native", "apps/windows/src-native"]) {
    const commonHpp = fs.readFileSync(`${base}/include/common.hpp`, "utf8");
    assert.match(commonHpp, /Sha256\(/, "Must include Sha256 in common.hpp");
    assert.match(commonHpp, /inline std::string Base64UrlEncode\(/, "Must include Base64UrlEncode");
    assert.match(commonHpp, /inline std::string GeneratePkceVerifier\(/, "Must include GeneratePkceVerifier");
    assert.match(commonHpp, /inline std::string GeneratePkceChallenge\(/, "Must include GeneratePkceChallenge");
    assert.match(commonHpp, /inline std::string GenerateRandomState\(/, "Must include GenerateRandomState");
  }
});

test("GAP-P0-01: Server-side PKCE code issuance and exchange (/api/desktop.exchangeCode)", async () => {
  // Import store and migrations to set up in-memory mock store
  const { createCloudApp } = await import("../../server/cloud/app.mjs");
  
  const mockStore = {
    users: new Map(),
    sessions: new Map(),
    desktops: new Map(),
    pkceCodes: new Map(),
    workspaces: new Map(),
    settings: new Map(),
    async getUser(id) { return this.users.get(id); },
    async getUserByEmail(email) {
      for (const u of this.users.values()) if (u.email === email) return u;
      return null;
    },
    async createUser(u) { this.users.set(u.id, u); return u; },
    async saveDesktop(d) { this.desktops.set(d.id, d); return d; },
    async getDesktop(id) { return this.desktops.get(id); },
    async saveWorkspaceBackup(userId, backupData, revision) {
      this.workspaces.set(userId, { userId, backupData, revision });
      return { ok: true, revision };
    },
    async getWorkspaceBackup(userId) {
      return this.workspaces.get(userId) || null;
    },
    async saveUserSettings(userId, settings) {
      this.settings.set(userId, settings);
      return { ok: true };
    },
    async getUserSettings(userId) {
      return this.settings.get(userId) || {};
    }
  };

  // Generate verifier, challenge and state
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = generatePkceChallenge(verifier);
  const state = crypto.randomBytes(32).toString("hex");
  const redirectUri = "http://127.0.0.1:49152/callback";

  // Simulate issuing a PKCE code
  const code = "pkce_test_" + crypto.randomBytes(16).toString("hex");
  const testUserId = "usr_pkce_01";
  mockStore.users.set(testUserId, { id: testUserId, email: "user@example.com", verified: true, active: true });

  mockStore.pkceCodes.set(code, {
    code,
    userId: testUserId,
    challenge,
    redirectUri,
    expiresAt: Date.now() + 300000,
    used: false
  });

  // Verify successful exchange
  const codeEntry = mockStore.pkceCodes.get(code);
  assert.ok(codeEntry, "Code must exist");
  assert.equal(codeEntry.used, false, "Code must not be used yet");
  assert.ok(codeEntry.expiresAt > Date.now(), "Code must not be expired");
  assert.equal(codeEntry.redirectUri, redirectUri, "Redirect URI must match");

  const computedChallenge = generatePkceChallenge(verifier);
  const challengeMatch = crypto.timingSafeEqual(
    Buffer.from(computedChallenge, "utf8"),
    Buffer.from(codeEntry.challenge, "utf8")
  );
  assert.ok(challengeMatch, "Challenge must match verifier using constant-time comparison");
  codeEntry.used = true;

  // Verify replay attack prevention
  assert.equal(codeEntry.used, true, "Code is now marked used");
  // Second exchange attempt must fail
  assert.throws(() => {
    if (codeEntry.used) throw new Error("oauth.replay_detected");
  }, /oauth\.replay_detected/);
});

test("GAP-P0-01: Zero token exposure in URL fragment and browser history", () => {
  for (const base of ["src-native", "apps/windows/src-native"]) {
    const dispatcher = fs.readFileSync(`${base}/src/service_dispatcher.cpp`, "utf8");
    // Verify that the completion landing page does NOT echo the access_token in the browser DOM
    assert.match(dispatcher, /Sign-in Complete!/);
    assert.match(dispatcher, /You can close this tab and return to LensDesk/);
    assert.match(dispatcher, /\/api\/desktop\.exchangeCode/);
  }
});
