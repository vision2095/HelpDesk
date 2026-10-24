import fs from "node:fs";
/** Respect a configured browser; otherwise use installed Chrome or Playwright Chromium. */
export function browserOptions() {
  const candidates = [
    process.env.CHROME_PATH,
    ...(process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "win32"
        ? [
            `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium"]),
  ];
  const executablePath = candidates.find((p) => p && fs.existsSync(p));
  return { headless: true, ...(executablePath ? { executablePath } : {}) };
}
