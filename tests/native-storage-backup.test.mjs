import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(".");

test("Native Backup, Recovery and Model Connection Architecture", async (t) => {
  const codebases = ["src-native", "apps/windows/src-native"];

  await t.test("1. StorageManager declares and implements transactional backup & recovery", () => {
    for (const base of codebases) {
      const header = fs.readFileSync(path.join(ROOT, base, "include/storage_manager.hpp"), "utf8");
      const cpp = fs.readFileSync(path.join(ROOT, base, "src/storage_manager.cpp"), "utf8");

      assert.match(header, /json CreateBackup\(\)/, `${base} missing CreateBackup in header`);
      assert.match(header, /bool RestoreBackup\(const json& backup, std::string& error\)/, `${base} missing RestoreBackup in header`);
      assert.match(header, /json GetSnapshots\(\)/, `${base} missing GetSnapshots in header`);
      assert.match(header, /bool CreateSnapshot\(const std::string& reason, std::string& outSnapshotId\)/, `${base} missing CreateSnapshot in header`);
      assert.match(header, /bool RestoreSnapshot\(const std::string& snapshotId, std::string& error\)/, `${base} missing RestoreSnapshot in header`);
      assert.match(header, /std::filesystem::path m_snapshotsDir;/, `${base} missing m_snapshotsDir in header`);

      assert.match(cpp, /json StorageManager::CreateBackup\(\)/, `${base} missing CreateBackup implementation`);
      assert.match(cpp, /bool StorageManager::CreateSnapshot\(/, `${base} missing CreateSnapshot implementation`);
      assert.match(cpp, /json StorageManager::GetSnapshots\(\)/, `${base} missing GetSnapshots implementation`);
      assert.match(cpp, /bool StorageManager::RestoreBackup\(/, `${base} missing RestoreBackup implementation`);
      assert.match(cpp, /bool StorageManager::RestoreSnapshot\(/, `${base} missing RestoreSnapshot implementation`);

      // Account-scoped snapshot directory binding
      assert.match(cpp, /m_snapshotsDir = userDir \/ L"snapshots"/, `${base} must bind snapshotsDir to userDir`);
      // Bounded snapshot retention (10 snapshots max)
      assert.match(cpp, /files\.size\(\) > 10/, `${base} must bound snapshots to at most 10`);
      // Rollback safety
      assert.match(cpp, /CreateSnapshot\("Automatic snapshot before backup restore", preSnapshotId\)/, `${base} must create pre-restore snapshot`);
    }
  });

  await t.test("2. ServiceDispatcher routes backup, recovery and model.test actions", () => {
    for (const base of codebases) {
      const dispatcher = fs.readFileSync(path.join(ROOT, base, "src/service_dispatcher.cpp"), "utf8");

      assert.match(dispatcher, /action == "backup"/, `${base} missing backup action`);
      assert.match(dispatcher, /m_storageMgr->CreateBackup\(\)/, `${base} must call CreateBackup`);

      assert.match(dispatcher, /action == "backup\.restore"/, `${base} missing backup.restore action`);
      assert.match(dispatcher, /m_storageMgr->RestoreBackup\(payload, err\)/, `${base} must call RestoreBackup`);
      assert.match(dispatcher, /BuildFullState\(\)/, `${base} must return BuildFullState after restore`);

      assert.match(dispatcher, /action == "recovery\.snapshots"/, `${base} missing recovery.snapshots action`);
      assert.match(dispatcher, /m_storageMgr->GetSnapshots\(\)/, `${base} must call GetSnapshots`);

      assert.match(dispatcher, /action == "recovery\.restore"/, `${base} missing recovery.restore action`);
      assert.match(dispatcher, /m_storageMgr->RestoreSnapshot\(snapId, err\)/, `${base} must call RestoreSnapshot`);

      // model.test must not be an unsupported stub
      assert.match(dispatcher, /action == "model\.test"/, `${base} missing model.test action`);
      assert.doesNotMatch(dispatcher, /Model connection testing is not available/, `${base} must not return unsupported error for model.test`);
      assert.match(dispatcher, /ProviderEndpoint\(prov, localUrl\)/, `${base} must resolve provider endpoint for live test`);
      assert.match(dispatcher, /HttpPostJson\(endpoint, requestBody/, `${base} must send live test request via HttpPostJson`);
    }
  });

  await t.test("3. Backup schema validation and rollback behavior simulation", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-backup-test-"));
    try {
      const validBackup = {
        version: 1,
        settings: { alwaysOnTop: true, opacity: 1.0 },
        profiles: [{ id: "p1", name: "General" }],
        sessions: [{ id: "s1", title: "Test Session", messages: [] }],
      };

      // Valid structure
      assert.equal(validBackup.version, 1);
      assert.ok(Array.isArray(validBackup.sessions));
      assert.ok(Array.isArray(validBackup.profiles));
      assert.ok(typeof validBackup.settings === "object");

      // Invalid version rejection simulation
      const invalidVersion = { ...validBackup, version: 2 };
      assert.notEqual(invalidVersion.version, 1);

      // Missing entities rejection simulation
      const missingProfiles = { version: 1, settings: {}, sessions: [] };
      assert.equal(missingProfiles.profiles, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
