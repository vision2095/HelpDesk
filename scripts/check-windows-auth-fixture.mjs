// Check that the fixture credential marker is absent from the release host and
// present in the separately named fixture host. This is not an auth E2E test.
import fs from "node:fs";
import assert from "node:assert/strict";

const [releasePath, nestedReleasePath, fixturePath] = process.argv.slice(2);
assert.ok(releasePath && nestedReleasePath && fixturePath, "Expected both release and fixture binary paths");
const marker = Buffer.from("test-ci-access-token", "utf8");
assert.equal(fs.readFileSync(releasePath).includes(marker), false, "Release host contains test auth fixture");
assert.equal(fs.readFileSync(nestedReleasePath).includes(marker), false, "Nested release host contains test auth fixture");
assert.equal(fs.readFileSync(fixturePath).includes(marker), true, "Fixture host lacks test auth fixture");
console.log("Release host excludes the test-auth marker; isolated fixture host includes it.");
