import fs from "node:fs";
import path from "node:path";

// The NSIS script embeds these exact files. Never fall back to a release copy:
// a previous same-version artifact may belong to a different source build.
export function resolveNativeWindowsInputs(root) {
  const runtimeHost = path.join(root, "build-native", "bin", "Release", "RuntimeHost.exe");
  const webView2Dll = path.join(root, "src-native", "third_party", "webview2", "lib", "x64", "WebView2Loader.dll");
  if (!fs.existsSync(runtimeHost)) {
    throw new Error("RuntimeHost.exe was not found in the native build output. Build the native host with CMake first.");
  }
  if (!fs.existsSync(webView2Dll)) {
    throw new Error("WebView2Loader.dll was not found in the native source dependencies.");
  }
  return { runtimeHost, webView2Dll };
}
