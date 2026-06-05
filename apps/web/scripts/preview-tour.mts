import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await ctx.newPage();
await page.goto("http://localhost:3333/en", { waitUntil: "networkidle", timeout: 30_000 });
const box = await page
  .locator("section[aria-labelledby='platform-tour-heading']")
  .boundingBox();
if (box) {
  await page.evaluate((y: number) => window.scrollTo(0, y - 20), box.y);
}
await page.waitForTimeout(1800);
await page.screenshot({
  path: ".cache/tour-preview.png",
  clip: { x: 0, y: 0, width: 1440, height: 900 },
});
await browser.close();
console.log("OK");
