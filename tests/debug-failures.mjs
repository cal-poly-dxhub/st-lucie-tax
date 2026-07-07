import { chromium } from "playwright";
import { getOfficeCredentials, getCloudFrontUrl } from "./test-credentials.mjs";

async function run() {
  const CREDS = getOfficeCredentials();
  const BASE = getCloudFrontUrl();

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

  // Listen for API responses
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/")) {
      const status = res.status();
      const ct = res.headers()["content-type"] || "";
      if (status >= 400 || ct.includes("text/html")) {
        let body = "";
        try { body = (await res.text()).substring(0, 200); } catch {}
        console.log(`  [API ${status}] ${url} (${ct}) ${body}`);
      }
    }
  });

  // Login
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', CREDS.email);
  await page.fill('input[type="password"]', CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector("nav", { timeout: 15000 });

  // --- DEBUG 1: Book Appointment ---
  console.log("\n=== DEBUG: Book Appointment ===");
  await page.click('nav >> text="Book Appt"');
  await page.waitForSelector("text=Schedule an Appointment", { timeout: 10000 });
  await page.fill('input[placeholder="Jane"]', "Debug");
  await page.fill('input[placeholder="Smith"]', "Tester");
  await page.fill('input[placeholder="you@example.com"]', "debug@test.com");
  const checkbox = page.locator('input[type="checkbox"]').first();
  await checkbox.check();
  console.log("Clicking Book...");
  await page.click('button:has-text("Find Slot & Book Appointment")');
  await page.waitForTimeout(10000);
  await page.screenshot({ path: "tests/screenshots/e2e/debug-book-result.png" });
  const bookBodyText = await page.textContent("body");
  // Look for error messages or confirmation
  if (bookBodyText.includes("Appointment Confirmed")) {
    console.log("  SUCCESS: Appointment confirmed");
  } else if (bookBodyText.includes("Failed") || bookBodyText.includes("Error") || bookBodyText.includes("error")) {
    const errorParts = bookBodyText.match(/(Failed|Error|error)[^.]{0,100}/g);
    console.log("  ERROR:", errorParts ? errorParts.join(" | ") : "unknown");
  } else {
    console.log("  Page state:", bookBodyText.substring(0, 400));
  }

  // --- DEBUG 2: Service Clerk ---
  console.log("\n=== DEBUG: Service Clerk ===");
  await page.click('nav >> text="Service Clerk"');
  await page.waitForSelector("text=Service Clerk Dashboard", { timeout: 10000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "tests/screenshots/e2e/debug-service-clerk.png" });

  // Check all selects
  const selects = page.locator("select");
  const count = await selects.count();
  console.log(`  Found ${count} select elements`);
  for (let i = 0; i < count; i++) {
    const options = await selects.nth(i).locator("option").allTextContents();
    console.log(`  Select ${i}: [${options.join(", ")}]`);
  }

  // Check what's on screen
  const clerkBody = await page.textContent("main") || await page.textContent("body");
  console.log("  Page content (truncated):", clerkBody.substring(0, 400));

  await browser.close();
}

run().catch(console.error);
