import { chromium } from "playwright-core";
import path from "node:path";
import { pathToFileURL } from "node:url";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(path.resolve("resources/icon.svg")).href);
  await page.screenshot({ path: "resources/icon.png", omitBackground: true });
} finally {
  await browser.close();
}
