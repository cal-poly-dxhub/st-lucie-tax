import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "http://localhost:5173";
const SCREENSHOT_DIR = "/Users/njriley/dxhub/customer_projects/st-lucie/st-lucie-tax/tests/screenshots";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Step 1: Confirmation Page - create an appointment
  console.log("Step 1: Confirmation Page - generating appointment...");
  await page.goto(`${BASE}/confirmation`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-confirmation-initial.png`, fullPage: true });

  // Click "Send Confirmation Email" to create the appointment
  await page.getByRole("button", { name: "Send Confirmation Email" }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-confirmation-qr-generated.png`, fullPage: true });

  // Get the confirmation code from the page
  const codeEl = page.locator(".font-mono.text-xs.text-civic-500");
  const code = await codeEl.textContent();
  console.log(`  Got confirmation code: ${code}`);

  // Step 2: Check-In Desk - look up the customer by code
  console.log("Step 2: Check-In Desk - looking up customer...");
  await page.goto(`${BASE}/check-in?code=${code}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-checkin-customer-loaded.png`, fullPage: true });

  // Step 3: Check in the customer
  console.log("Step 3: Checking customer in to queue...");
  const checkInBtn = page.getByRole("button", { name: /Check In/i }).first();
  const isEnabled = await checkInBtn.isEnabled({ timeout: 2000 }).catch(() => false);
  if (isEnabled) {
    await checkInBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-checkin-success.png`, fullPage: true });
  } else {
    console.log("  (Check-in button disabled - readiness checks not met, taking screenshot)");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-checkin-state.png`, fullPage: true });
  }

  // Step 4: Walk-In page
  console.log("Step 4: Walk-In Registration...");
  await page.goto(`${BASE}/walk-in`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/05-walkin-empty.png`, fullPage: true });

  // Fill in walk-in form
  await page.locator('input[placeholder="First name"]').fill("John");
  await page.locator('input[placeholder="Last name"]').fill("Doe");
  await page.locator('input[placeholder="email@example.com"]').fill("john.doe@example.com");
  // Select Road Test
  await page.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/06-walkin-filled.png`, fullPage: true });

  // Submit walk-in
  await page.getByRole("button", { name: /Check In to Queue/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/07-walkin-submitted.png`, fullPage: true });

  // Step 5: Queue page
  console.log("Step 5: Queue Page...");
  await page.goto(`${BASE}/queue`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/08-queue-view.png`, fullPage: true });

  // Step 6: Service Clerk - login and summon
  console.log("Step 6: Service Clerk - login and summon customer...");
  await page.goto(`${BASE}/service`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/09-service-initial.png`, fullPage: true });

  // Login as clerk
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/10-service-logged-in.png`, fullPage: true });

  // Summon next customer
  await page.getByRole("button", { name: "Summon Next", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/11-service-customer-loaded.png`, fullPage: true });

  // Step 7: Schedule page
  console.log("Step 7: Schedule Page...");
  await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/12-schedule-view.png`, fullPage: true });

  // Step 8: Lobby Display
  console.log("Step 8: Lobby Display...");
  await page.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/13-lobby-display.png`, fullPage: true });

  // Step 9: Prescreen page with valid code
  console.log("Step 9: Prescreen Page...");
  await page.goto(`${BASE}/prescreen/${code}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/14-prescreen-page.png`, fullPage: true });

  await browser.close();
  console.log(`\nDone! Screenshots saved to ${SCREENSHOT_DIR}/`);
}

run().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
