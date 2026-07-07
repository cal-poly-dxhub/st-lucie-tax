import { chromium } from "playwright";
import { getOfficeCredentials, getCloudFrontUrl } from "./test-credentials.mjs";

async function run() {
  const CREDS = getOfficeCredentials();
  const BASE = getCloudFrontUrl();

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: "tests/screenshots/e2e/debug-login-page.png" });
  console.log("=== Login page text ===");
  const bodyText = await page.textContent("body");
  console.log(bodyText.substring(0, 500));

  await page.fill('input[type="email"]', CREDS.email);
  await page.fill('input[type="password"]', CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "tests/screenshots/e2e/debug-after-login.png" });
  console.log("\n=== After login text ===");
  const afterText = await page.textContent("body");
  console.log(afterText.substring(0, 800));

  // Check for error messages
  const errorEl = await page.locator("[class*='red'], [role='alert']").allTextContents();
  if (errorEl.length > 0) console.log("\n=== Errors ===", errorEl);

  await browser.close();
}

run().catch(console.error);
