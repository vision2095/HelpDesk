import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeAccel } = require("../../desktop/global-keys.cjs");

test("normalizes Control+Shift+Space", () => {
  assert.equal(normalizeAccel("Control+Shift+Space"), "CS+Space");
});

test("normalizes plain Shift letter combos", () => {
  assert.equal(normalizeAccel("Shift+H"), "S+H");
  assert.equal(normalizeAccel("Shift+M"), "S+M");
});

test("normalizes CommandOrControl+Shift+Q", () => {
  assert.equal(normalizeAccel("CommandOrControl+Shift+Q"), "CS+Q");
});

test("normalizes Command+Shift+Q", () => {
  assert.equal(normalizeAccel("Command+Shift+Q"), "MS+Q");
});
