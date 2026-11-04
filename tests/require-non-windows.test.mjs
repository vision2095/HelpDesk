import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNonWindowsPlatform } from "../scripts/require-non-windows.mjs";

test("Electron directory packaging rejects Windows while leaving macOS available", () => {
  assert.throws(() => assertNonWindowsPlatform("win32"), /disabled on Windows/);
  assert.doesNotThrow(() => assertNonWindowsPlatform("darwin"));
});
