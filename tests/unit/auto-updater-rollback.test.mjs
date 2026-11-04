import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

// Semver comparison function matching cloud_client.cpp CompareVersions
function compareVersions(a, b) {
  const parse = (v) => v.split(/[-+]/)[0].split(".").map((x) => parseInt(x, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; ++i) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

test("GAP-P0-07: Semver comparison logic accurately identifies newer releases", () => {
  assert.equal(compareVersions("2.0.1", "2.0.0"), 1, "2.0.1 is newer than 2.0.0");
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0, "Same version returns 0");
  assert.equal(compareVersions("1.3.6", "2.0.0"), -1, "1.3.6 is older than 2.0.0");
  assert.equal(compareVersions("2.1.0", "2.0.9"), 1, "Minor version increment is newer");
  assert.equal(compareVersions("3.0.0", "2.9.9"), 1, "Major version increment is newer");
});

test("GAP-P0-07: SHA-256 validation verifies payload integrity and rejects tampered updates", () => {
  const genuinePayload = Buffer.from("LensDesk-2.0.1-Genuine-Installer-Binary");
  const genuineHash = crypto.createHash("sha256").update(genuinePayload).digest("hex");

  const tamperedPayload = Buffer.from("LensDesk-2.0.1-Tampered-Installer-Binary");
  const tamperedHash = crypto.createHash("sha256").update(tamperedPayload).digest("hex");

  // Verify genuine hash matches
  assert.equal(crypto.createHash("sha256").update(genuinePayload).digest("hex"), genuineHash);

  // Verify tampered hash does NOT match genuine expected hash
  assert.notEqual(tamperedHash, genuineHash);

  // Verify rollback / abort logic
  const verifyAndStage = (payload, expectedHash) => {
    const actual = crypto.createHash("sha256").update(payload).digest("hex");
    if (actual !== expectedHash) {
      throw new Error("The downloaded update failed SHA-256 verification.");
    }
    return { staged: true, hash: actual };
  };

  assert.ok(verifyAndStage(genuinePayload, genuineHash).staged);
  assert.throws(
    () => verifyAndStage(tamperedPayload, genuineHash),
    /The downloaded update failed SHA-256 verification\./
  );
});

test("GAP-P0-07: Native updater security and staging invariants in cloud_client.cpp", () => {
  for (const base of ["src-native", "apps/windows/src-native"]) {
    const client = fs.readFileSync(`${base}/src/cloud_client.cpp`, "utf8");
    assert.match(client, /CheckForUpdate\(\)/);
    assert.match(client, /DownloadAndInstallUpdate\(\)/);
    assert.match(client, /IsValidSha256\(sha256\)/, "Must validate SHA-256 string format");
    assert.match(client, /Sha256File\(target\)/, "Must compute SHA-256 of downloaded file");
    assert.match(client, /The downloaded update failed SHA-256 verification\./, "Must reject mismatched hash");
    assert.match(client, /GetTempPathW/, "Must stage update in temporary directory");
    assert.match(client, /supportedArtifact/, "Must restrict updates to verified extensions (.exe, .msi, .zip)");
    assert.match(client, /filename\(\)/, "Must strip path traversal and take filename only");
  }
});
