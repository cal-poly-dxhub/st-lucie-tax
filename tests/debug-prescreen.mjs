import { chromium } from "playwright";

const BASE = "https://EXAMPLEDIST0003.cloudfront.net";
// Use a confirmation code from a previous booking
const CODE = "DEMOCODE";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Listen for API errors
  const page = await context.newPage();
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/")) {
      const status = res.status();
      if (status >= 400) {
        let body = "";
        try { body = (await res.text()).substring(0, 200); } catch {}
        console.log(`  [API ${status}] ${url} → ${body}`);
      } else if (url.includes("prescreen")) {
        let body = "";
        try { body = (await res.text()).substring(0, 300); } catch {}
        console.log(`  [API ${status}] ${url} → ${body}`);
      }
    }
  });

  // Test prescreen page with the code (public route, no auth needed)
  console.log(`=== Testing prescreen page with code: ${CODE} ===`);
  await page.goto(`${BASE}/prescreen/${CODE}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "tests/screenshots/e2e/debug-prescreen-load.png" });

  const body = await page.textContent("body");
  console.log("  Page text (first 500):", body.substring(0, 500));

  // Check for questions
  const radioCount = await page.locator('input[type="radio"]').count();
  console.log(`\n  Radio buttons found: ${radioCount}`);

  if (radioCount > 0) {
    // Answer all questions with "Yes" (first radio in each group)
    console.log("\n=== Answering prescreen questions ===");
    const allRadios = await page.locator('input[type="radio"]').all();
    const names = new Set();
    for (const el of allRadios) {
      const name = await el.getAttribute("name");
      if (name) names.add(name);
    }
    console.log(`  Question groups: ${[...names].join(", ")}`);

    for (const name of names) {
      const firstRadio = page.locator(`input[name="${name}"]`).first();
      await firstRadio.click();
    }
    await page.screenshot({ path: "tests/screenshots/e2e/debug-prescreen-answered.png" });

    // Submit
    const submitBtn = page.locator('button:has-text("Submit")');
    if (await submitBtn.count() > 0) {
      console.log("  Clicking Submit...");
      await submitBtn.click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: "tests/screenshots/e2e/debug-prescreen-submitted.png" });
      const afterSubmit = await page.textContent("body");
      console.log("\n  After submit:", afterSubmit.substring(0, 400));
    } else {
      console.log("  No submit button found");
    }
  } else {
    console.log("  No questions rendered — checking status");
    const hasAlready = body.includes("Already Completed");
    const hasError = body.includes("not found") || body.includes("Invalid");
    const hasLoading = body.includes("Loading");
    console.log(`  Already completed: ${hasAlready}, Error: ${hasError}, Loading: ${hasLoading}`);
  }

  await browser.close();
  console.log("\nDone.");
}

run().catch(console.error);
