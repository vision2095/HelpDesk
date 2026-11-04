import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveNativeWindowsInputs } from "../scripts/windows-native-inputs.mjs";

test("native packaging uses the same build and loader as the installer, never stale release copies", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lensdesk-native-inputs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const release = path.join(root, "release");
  fs.mkdirSync(release, { recursive: true });
  fs.writeFileSync(path.join(release, "RuntimeHost.exe"), "stale");
  fs.writeFileSync(path.join(release, "WebView2Loader.dll"), "stale");
  assert.throws(() => resolveNativeWindowsInputs(root), /native build output/);
  const exe = path.join(root, "build-native", "bin", "Release", "RuntimeHost.exe");
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, "new build");
  assert.throws(() => resolveNativeWindowsInputs(root), /WebView2Loader/);
  const dll = path.join(root, "src-native", "third_party", "webview2", "lib", "x64", "WebView2Loader.dll");
  fs.mkdirSync(path.dirname(dll), { recursive: true });
  fs.writeFileSync(dll, "native loader");
  assert.deepEqual(resolveNativeWindowsInputs(root), { runtimeHost: exe, webView2Dll: dll });
});
