import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("Windows auth fixture is opt-in, isolated, and absent from release binaries", () => {
  for (const base of ["src-native", "apps/windows/src-native"]) {
    const cmake = fs.readFileSync(`${base}/CMakeLists.txt`, "utf8");
    const client = fs.readFileSync(`${base}/src/cloud_client.cpp`, "utf8");
    const common = fs.readFileSync(`${base}/include/common.hpp`, "utf8");
    const dispatcher = fs.readFileSync(`${base}/src/service_dispatcher.cpp`, "utf8");
    assert.match(cmake, /option\(LENSDESK_ENABLE_TEST_AUTH[^\n]* OFF\)/);
    assert.match(cmake, /set\(LENSDESK_HOST_OUTPUT_NAME "RuntimeHostTest"\)/);
    assert.match(cmake, /else\(\)\s*set\(LENSDESK_HOST_OUTPUT_NAME "RuntimeHost"\)/);
    assert.match(common, /#ifdef LENSDESK_ENABLE_TEST_AUTH[\s\S]*LENSDESK_FIXTURE_DATA_DIR[\s\S]*#else[\s\S]*CSIDL_APPDATA/);
    assert.match(dispatcher, /action == "desktop\.wipeAllData"[\s\S]*#ifdef LENSDESK_ENABLE_TEST_AUTH[\s\S]*Data wipe is disabled/);
    assert.match(client, /#ifdef LENSDESK_ENABLE_TEST_AUTH[\s\S]*test-ci-access-token[\s\S]*#endif[\s\S]*Request\("desktop\.login"/);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-auth-fixture-"));
  try {
    const release = path.join(dir, "release.exe");
    const fixture = path.join(dir, "fixture.exe");
    fs.writeFileSync(release, "release host");
    fs.writeFileSync(fixture, "test-ci-access-token");
    const check = () => spawnSync(process.execPath, ["scripts/check-windows-auth-fixture.mjs", release, release, fixture]);
    assert.equal(check().status, 0);
    fs.writeFileSync(release, "test-ci-access-token");
    assert.notEqual(check().status, 0);
    fs.writeFileSync(release, "release host");
    fs.writeFileSync(fixture, "no marker");
    assert.notEqual(check().status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
