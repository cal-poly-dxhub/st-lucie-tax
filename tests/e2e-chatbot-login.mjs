import { chromium } from "playwright";
import { getChatbotCredentials, getChatbotUrl } from "./test-credentials.mjs";

async function run() {
  const CREDS = getChatbotCredentials();
  const BASE = getChatbotUrl();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const failedRequests = [];
  page.on("response", (res) => {
    if (res.status() >= 400) {
      failedRequests.push({ url: res.url(), status: res.status() });
    }
  });

  // Step 1: Navigate to chatbot
  console.log("1. Navigating to", BASE);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: "tests/screenshots/e2e/chatbot-01-login-page.png" });

  // Check if login form is present
  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');
  const hasLogin = (await emailInput.count()) > 0;

  if (!hasLogin) {
    console.log("No login form found — checking if already logged in or auth disabled.");
    console.log("Page text:", (await page.textContent("body")).substring(0, 500));
    await browser.close();
    return;
  }

  // Step 2: Login (Cognito — client-side auth via the SPA's own flow)
  console.log("2. Logging in as", CREDS.email);
  await emailInput.fill(CREDS.email);
  await passwordInput.fill(CREDS.password);
  await page.click('button[type="submit"]');

  // Wait for either chat UI or error
  try {
    await page.waitForSelector('textarea, input[placeholder*="message"], [role="alert"], .welcome-hero', { timeout: 15000 });
  } catch {
    console.log("   Timed out waiting for post-login UI");
  }
  await page.screenshot({ path: "tests/screenshots/e2e/chatbot-02-after-login.png" });

  // Check for errors
  if (failedRequests.length > 0) {
    console.log("\n=== Failed requests ===");
    for (const r of failedRequests) {
      console.log(`  ${r.status} ${r.url}`);
    }
  }

  const errorEls = await page.locator("[role='alert'], [class*='error'], [class*='red-']").allTextContents();
  if (errorEls.length > 0) {
    console.log("\n=== UI Errors ===", errorEls);
  }

  // Step 3: Check if we're in the chat now
  const chatInput = page.locator('textarea, input[placeholder*="message"], input[placeholder*="type"]');
  if ((await chatInput.count()) === 0) {
    console.log("3. No chat input found after login. Page text:");
    console.log((await page.textContent("body")).substring(0, 800));
    await browser.close();
    return;
  }

  console.log("3. Chat UI loaded. Sending a test message...");

  // Step 4: Send a message
  await chatInput.first().fill("I need to renew my vehicle registration");
  await chatInput.first().press("Enter");

  // Wait for bot response (Bedrock can take up to 60s)
  try {
    await page.waitForFunction(() => {
      const msgs = document.querySelectorAll('.message-row');
      return msgs.length >= 2;
    }, { timeout: 60000 });
  } catch {
    console.log("   Timed out waiting for bot response");
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "tests/screenshots/e2e/chatbot-03-first-response.png" });

  const messages = await page.locator('[class*="message"], [class*="bubble"]').allTextContents();
  console.log("\n=== Conversation ===");
  for (const m of messages.slice(0, 6)) {
    console.log("  ", m.substring(0, 200));
  }

  if (failedRequests.length > 0) {
    console.log("\n=== All failed requests ===");
    for (const r of failedRequests) {
      console.log(`  ${r.status} ${r.url}`);
    }
  }

  console.log("\n✓ Test complete");
  await browser.close();
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
