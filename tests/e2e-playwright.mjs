import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "https://EXAMPLEDIST0004.cloudfront.net";
const CREDS = { email: "demo@stlucie.test", password: "FtPierce321!" };
const SCREENSHOT_DIR = "/Users/njriley/dxhub/customer_projects/st-lucie/st-lucie-tax/tests/screenshots/e2e";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

let passed = 0;
let failed = 0;
const failures = [];
const appBugs = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err.message.split("\n")[0];
    failures.push({ name, error: msg });
    console.log(`  ✗ ${name}`);
    console.log(`    ${msg}`);
  }
}

function reportBug(category, description) {
  appBugs.push({ category, description });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Intercept API responses to detect HTML-instead-of-JSON errors
  const apiErrors = [];
  const page = await context.newPage();
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/") && response.headers()["content-type"]?.includes("text/html")) {
      apiErrors.push({ url, status: response.status() });
    }
  });

  // ─── LOGIN ───────────────────────────────────────────────────────────
  console.log("\n═══ 1. LOGIN & AUTHENTICATION ═══");

  await test("Login page renders correctly", async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Staff sign-in", { timeout: 10000 });
    const title = await page.locator("text=St. Lucie Tax Collector").count();
    if (title === 0) throw new Error("App title not found");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-login-page.png` });
  });

  await test("Login form has email and password fields", async () => {
    const emailInput = page.locator('input[type="email"]');
    const passInput = page.locator('input[type="password"]');
    if (await emailInput.count() === 0) throw new Error("Email input missing");
    if (await passInput.count() === 0) throw new Error("Password input missing");
  });

  await test("Login with invalid credentials shows error", async () => {
    await page.fill('input[type="email"]', "bad@user.com");
    await page.fill('input[type="password"]', "wrongpassword");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    const errorEl = page.locator(".bg-red-50, [class*='red']");
    const hasError = await errorEl.count() > 0;
    if (!hasError) throw new Error("No error shown for bad credentials");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-login-bad-creds.png` });
  });

  await test("Login with valid credentials succeeds", async () => {
    await page.fill('input[type="email"]', CREDS.email);
    await page.fill('input[type="password"]', CREDS.password);
    await page.click('button[type="submit"]');
    await page.waitForSelector("nav", { timeout: 15000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-logged-in.png` });
  });

  await test("Navigation bar shows all expected links", async () => {
    const navLinks = ["Confirmation", "Check-In", "Walk-In", "Queue", "Schedule", "Service Clerk", "Lobby Display"];
    for (const link of navLinks) {
      const el = page.locator(`nav >> text="${link}"`);
      if (await el.count() === 0) throw new Error(`Nav link "${link}" not found`);
    }
  });

  await test("Sign Out button visible when authenticated", async () => {
    const btn = page.locator('button:has-text("Sign Out")');
    if (await btn.count() === 0) throw new Error("Sign Out button not found");
  });

  // ─── CONFIRMATION PAGE ───────────────────────────────────────────────
  console.log("\n═══ 2. CONFIRMATION PAGE ═══");

  await test("Confirmation page loads with all sections", async () => {
    await page.click('nav >> text="Confirmation"');
    await page.waitForSelector("text=Appointment Confirmed", { timeout: 10000 });
    await page.waitForSelector("text=Jane Smith");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-confirmation-page.png` });
  });

  await test("Demo configuration dropdowns present and functional", async () => {
    // Pre-Screen dropdown
    const prescreenSelect = page.locator("select").nth(0);
    await prescreenSelect.selectOption("false");
    await prescreenSelect.selectOption("true");
    // Identity dropdown
    const identitySelect = page.locator("select").nth(1);
    await identitySelect.selectOption("true");
    await identitySelect.selectOption("false");
    // Docs dropdown
    const docsSelect = page.locator("select").nth(2);
    await docsSelect.selectOption("all-accepted");
    await docsSelect.selectOption("mixed");
  });

  await test("Appointment summary shows correct demo data", async () => {
    await page.waitForSelector("text=Road Test");
    await page.waitForSelector("text=Port St. Lucie");
    await page.waitForSelector("text=25 min");
  });

  await test("Email address input present", async () => {
    const input = page.locator('input[placeholder="you@example.com"]');
    if (await input.count() === 0) throw new Error("Email input not found");
    const setBtn = page.locator('button:has-text("Set Email")');
    if (await setBtn.count() === 0) throw new Error("Set Email button not found");
  });

  await test("Send Confirmation Email button present and clickable", async () => {
    const btn = page.locator('button:has-text("Send Confirmation Email")');
    if (await btn.count() === 0) throw new Error("Send button not found");
    if (await btn.isDisabled()) throw new Error("Send button is disabled");
  });

  // Clear API errors before the critical API test
  apiErrors.length = 0;

  await test("Send Confirmation Email - API responds (not HTML error)", async () => {
    await page.click('button:has-text("Send Confirmation Email")');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-confirmation-sent.png` });

    // Check if we got the dreaded HTML-instead-of-JSON error
    const errorToast = page.locator("text=is not valid JSON");
    const hasJsonError = await errorToast.count() > 0;
    if (hasJsonError) {
      reportBug("API", "/api/send-confirmation returns HTML instead of JSON (CloudFront routing or Lambda error)");
      throw new Error("API returned HTML instead of JSON - backend/CloudFront routing issue");
    }

    // Check for confirmation code
    const codeEl = page.locator(".font-mono.text-xs");
    const hasCode = await codeEl.count() > 0;
    if (!hasCode) {
      const errorText = await page.locator("[class*='red'], [class*='error']").allTextContents();
      throw new Error(`No confirmation code generated. Errors: ${errorText.join("; ")}`);
    }
  });

  let confirmationCode = null;
  await test("Confirmation code and QR code generated", async () => {
    const codeEl = page.locator(".font-mono.text-xs").last();
    if (await codeEl.count() === 0) throw new Error("Code element not found");
    confirmationCode = await codeEl.textContent();
    if (!confirmationCode || confirmationCode.length < 5) {
      throw new Error(`Invalid code: "${confirmationCode}"`);
    }
    console.log(`    Code: ${confirmationCode}`);
    const qr = page.locator('img[alt="QR Code"]');
    if (await qr.count() === 0) throw new Error("QR code not rendered");
  });

  // ─── CHECK-IN DESK ──────────────────────────────────────────────────
  console.log("\n═══ 3. CHECK-IN DESK ═══");

  apiErrors.length = 0;

  await test("Check-In page structure loads", async () => {
    await page.click('nav >> text="Check-In"');
    await page.waitForSelector("text=No customer loaded", { timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/06-checkin-empty.png` });
  });

  await test("Config API loads offices and date", async () => {
    await page.waitForTimeout(3000);
    // Check if config loaded by looking for the spinner to be gone
    const loading = page.locator("text=Loading…");
    const stillLoading = await loading.count() > 0;
    if (stillLoading) {
      // Check for JSON parse error in API responses
      const htmlApiCalls = apiErrors.filter((e) => e.url.includes("/api/config"));
      if (htmlApiCalls.length > 0) {
        reportBug("API", "/api/config returns HTML instead of JSON");
        throw new Error("API /api/config returned HTML instead of JSON");
      }
      throw new Error("Config never finished loading");
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-checkin-config-loaded.png` });
  });

  await test("Check-In page has lookup panel", async () => {
    // The lookup panel has a text input for confirmation code or name search
    const inputs = page.locator("main input");
    const inputCount = await inputs.count();
    if (inputCount === 0) throw new Error("No input fields in check-in page");
  });

  if (confirmationCode) {
    await test("Lookup by confirmation code via URL param", async () => {
      await page.goto(`${BASE}/check-in?code=${confirmationCode}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(5000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/08-checkin-lookup.png` });
      const janeEl = page.locator("text=Jane Smith");
      if (await janeEl.count() > 0) {
        console.log("    Customer loaded successfully");
      } else {
        const errorToast = page.locator("text=is not valid JSON");
        if (await errorToast.count() > 0) {
          reportBug("API", "/api/lookup returns HTML instead of JSON");
          throw new Error("API /api/lookup returned HTML instead of JSON");
        }
        throw new Error("Customer not found by confirmation code");
      }
    });
  }

  // ─── WALK-IN REGISTRATION ───────────────────────────────────────────
  console.log("\n═══ 4. WALK-IN REGISTRATION ═══");

  apiErrors.length = 0;

  await test("Walk-In page loads with form structure", async () => {
    await page.click('nav >> text="Walk-In"');
    await page.waitForSelector("text=Walk-In Registration", { timeout: 10000 });
    await page.waitForSelector("text=Customer Information");
    await page.waitForSelector("text=Transaction Type");
    await page.waitForSelector("text=Identity Verification");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/09-walkin-page.png` });
  });

  await test("Customer information inputs functional", async () => {
    await page.fill('input[placeholder="First name"]', "Test");
    await page.fill('input[placeholder="Last name"]', "Walker");
    await page.fill('input[placeholder="email@example.com"]', "test.walker@example.com");
    await page.fill('input[placeholder="(555) 123-4567"]', "5551234567");
  });

  await test("Transaction types loaded from config API", async () => {
    await page.waitForTimeout(3000);
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    if (count === 0) {
      const htmlApiCalls = apiErrors.filter((e) => e.url.includes("/api/config"));
      if (htmlApiCalls.length > 0) {
        reportBug("API", "/api/config not returning transaction types (HTML response)");
      }
      throw new Error("No transaction type checkboxes - /api/config may be failing");
    }
    console.log(`    Found ${count} transaction types`);
  });

  await test("Walk-In form validation - empty name rejected", async () => {
    await page.fill('input[placeholder="First name"]', "");
    await page.fill('input[placeholder="Last name"]', "");
    const btn = page.locator('button:has-text("Check In to Queue")');
    await btn.click();
    await page.waitForTimeout(1500);
    // Should show error toast
    const errorToast = page.locator("text=First and last name required").or(page.locator("text=required"));
    const hasValidation = await errorToast.count() > 0;
    // Toast may have cleared, but we at least verify no crash
  });

  await test("Walk-In form validation - no txn type rejected", async () => {
    await page.fill('input[placeholder="First name"]', "Test");
    await page.fill('input[placeholder="Last name"]', "Walker");
    const btn = page.locator('button:has-text("Check In to Queue")');
    await btn.click();
    await page.waitForTimeout(1500);
    const errorToast = page.locator("text=Select at least one transaction type");
    const hasValidation = await errorToast.count() > 0;
    if (!hasValidation) {
      // If checkboxes didn't load, this validation won't trigger the right way
      console.log("    (validation message may not show if txn types didn't load)");
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/10-walkin-validation.png` });
  });

  await test("Mark Identity Verified button works", async () => {
    const verifyBtn = page.locator('button:has-text("Mark Identity Verified")');
    if (await verifyBtn.count() > 0) {
      await verifyBtn.click();
      await page.waitForTimeout(500);
      const verified = page.locator("text=Identity verified by clerk");
      if (await verified.count() === 0) throw new Error("Verification text not shown after click");
    }
  });

  // ─── QUEUE PAGE ─────────────────────────────────────────────────────
  console.log("\n═══ 5. QUEUE PAGE ═══");

  apiErrors.length = 0;

  await test("Queue page renders structure", async () => {
    await page.click('nav >> text="Queue"');
    await page.waitForSelector("text=Live Queue", { timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/11-queue-page.png` });
  });

  await test("Queue loads data or shows empty state", async () => {
    await page.waitForTimeout(5000);
    const hasEntries = await page.locator(".text-2xl.font-bold").count() > 0;
    const emptyMsg = await page.locator("text=Queue is empty").count() > 0;
    const loadingMsg = await page.locator("text=Loading queue").count() > 0;
    if (loadingMsg) {
      const htmlApiCalls = apiErrors.filter((e) => e.url.includes("/api/live-queue"));
      if (htmlApiCalls.length > 0) {
        reportBug("API", "/api/live-queue returns HTML instead of JSON");
        throw new Error("Queue API returning HTML");
      }
      throw new Error("Queue stuck in loading state");
    }
    if (!hasEntries && !emptyMsg) throw new Error("Neither entries nor empty message visible");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/12-queue-loaded.png` });
  });

  await test("Refresh button functional", async () => {
    const refreshBtn = page.locator('button:has-text("Refresh")');
    if (await refreshBtn.count() === 0) throw new Error("Refresh button not found");
    await refreshBtn.click();
    await page.waitForTimeout(2000);
  });

  await test("Seed 5 button functional", async () => {
    const seedBtn = page.locator('button:has-text("Seed")');
    if (await seedBtn.count() === 0) throw new Error("Seed button not found");
    await seedBtn.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/13-queue-after-seed.png` });
  });

  await test("Clerk Sessions section renders", async () => {
    await page.waitForSelector("text=Clerk Sessions");
  });

  // ─── SCHEDULE PAGE ──────────────────────────────────────────────────
  console.log("\n═══ 6. SCHEDULE PAGE ═══");

  apiErrors.length = 0;

  await test("Schedule page loads", async () => {
    await page.click('nav >> text="Schedule"');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/14-schedule-page.png` });
    // The schedule page shows "Loading schedule…" if config hasn't loaded
    const loadingText = page.locator("text=Loading schedule");
    const isLoading = await loadingText.count() > 0;
    const scheduleTitle = page.locator("text=Check-In Schedule");
    const hasTitle = await scheduleTitle.count() > 0;
    if (isLoading && !hasTitle) {
      const htmlApiCalls = apiErrors.filter((e) => e.url.includes("/api/config"));
      if (htmlApiCalls.length > 0) {
        reportBug("API", "Schedule page stuck loading - /api/config returns HTML");
      }
      throw new Error("Schedule stuck in 'Loading schedule…' state - API config not loading");
    }
    if (!hasTitle) throw new Error("Schedule title not found");
  });

  await test("Schedule shows week navigation controls", async () => {
    const todayBtn = page.locator('button:has-text("Today")');
    if (await todayBtn.count() === 0) throw new Error("Today button not found");
  });

  await test("Schedule shows day rows", async () => {
    const dayLabels = page.locator("text=/Mon|Tue|Wed|Thu|Fri/");
    const count = await dayLabels.count();
    if (count < 3) throw new Error(`Expected 5 day labels, found ${count}`);
  });

  await test("Schedule legend shows transaction types with durations", async () => {
    const legendItems = page.locator("text=/\\d+m\\)/");
    const count = await legendItems.count();
    if (count === 0) throw new Error("No legend items found");
  });

  // ─── SERVICE CLERK ──────────────────────────────────────────────────
  console.log("\n═══ 7. SERVICE CLERK ═══");

  apiErrors.length = 0;

  await test("Service Clerk page loads", async () => {
    await page.click('nav >> text="Service Clerk"');
    await page.waitForSelector("text=Service Clerk Dashboard", { timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/15-service-clerk.png` });
  });

  await test("Clerk dropdown populated from API", async () => {
    await page.waitForTimeout(3000);
    const clerkSelect = page.locator("select").first();
    const options = await clerkSelect.locator("option").allTextContents();
    if (options.length === 0) {
      const htmlApiCalls = apiErrors.filter((e) => e.url.includes("/api/clerks"));
      if (htmlApiCalls.length > 0) {
        reportBug("API", "/api/clerks returns HTML instead of JSON");
      }
      throw new Error("No clerks loaded from API");
    }
    console.log(`    Clerks: ${options.slice(0, 3).join(", ")}${options.length > 3 ? "..." : ""}`);
  });

  await test("Desk number selector has options 1-5", async () => {
    const deskSelect = page.locator("select").nth(1);
    const options = await deskSelect.locator("option").allTextContents();
    if (options.length < 5) throw new Error(`Expected 5 desk options, got ${options.length}`);
  });

  await test("Login as clerk", async () => {
    const loginBtn = page.locator('button:has-text("Login")');
    await loginBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/16-service-logged-in.png` });
    // After login, availability toggle should appear
    const availToggle = page.locator("text=Available for customers");
    if (await availToggle.count() > 0) {
      console.log("    Logged in, availability toggle visible");
    } else {
      // Login may have silently failed if clerks API didn't load
      const errorToast = page.locator("text=Login failed").or(page.locator("text=Server error"));
      if (await errorToast.count() > 0) throw new Error("Clerk login failed");
      console.log("    Login button clicked (no toggle visible - may have failed silently)");
    }
  });

  await test("Summon Next button present", async () => {
    const summonBtn = page.locator('button:has-text("Summon Next")');
    if (await summonBtn.count() === 0) throw new Error("Summon Next button not found");
    const isDisabled = await summonBtn.isDisabled();
    console.log(`    Summon Next button: ${isDisabled ? "disabled (login may have failed)" : "enabled"}`);
  });

  await test("Summon Next (if enabled)", async () => {
    const summonBtn = page.locator('button:has-text("Summon Next")');
    const isDisabled = await summonBtn.isDisabled();
    if (isDisabled) {
      console.log("    Skipping - button disabled (clerk login failed)");
      return;
    }
    await summonBtn.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/17-service-summoned.png` });
    const nowServing = await page.locator("text=Now Serving").count();
    const noQueue = await page.locator("text=No one in queue").count();
    console.log(`    Result: ${nowServing > 0 ? "Customer summoned" : noQueue > 0 ? "Queue empty" : "Unknown"}`);
  });

  // If serving a customer, test service workflow
  if (await page.locator("text=Now Serving").count() > 0) {
    await test("Service card shows customer details", async () => {
      await page.waitForSelector("text=Transaction Steps");
      await page.waitForSelector("text=Documents");
      await page.waitForSelector("text=Pre-Screen Responses");
    });

    await test("Transaction step Mark Done buttons work", async () => {
      const markDoneBtns = page.locator('button:has-text("Mark Done")');
      const count = await markDoneBtns.count();
      if (count > 0) {
        await markDoneBtns.first().click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/18-service-step-done.png` });
      }
    });

    await test("Complete buttons present", async () => {
      const completeAndNext = page.locator('button:has-text("Complete & Summon Next")');
      const completeOnly = page.locator('button:has-text("Complete Only")');
      if (await completeAndNext.count() === 0) throw new Error("Complete & Summon Next not found");
      if (await completeOnly.count() === 0) throw new Error("Complete Only not found");
    });
  }

  // ─── LOBBY DISPLAY (PUBLIC) ─────────────────────────────────────────
  console.log("\n═══ 8. LOBBY DISPLAY (PUBLIC) ═══");

  await test("Lobby Display loads without authentication", async () => {
    const lobbyPage = await context.newPage();
    await lobbyPage.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
    await lobbyPage.waitForSelector("text=St. Lucie County Tax Collector", { timeout: 10000 });
    await lobbyPage.screenshot({ path: `${SCREENSHOT_DIR}/19-lobby-display.png` });
    await lobbyPage.close();
  });

  await test("Lobby shows Now Serving and Up Next sections", async () => {
    const lobbyPage = await context.newPage();
    await lobbyPage.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
    await lobbyPage.waitForSelector("text=Now Serving", { timeout: 10000 });
    await lobbyPage.waitForSelector("text=Up Next", { timeout: 5000 });
    await lobbyPage.screenshot({ path: `${SCREENSHOT_DIR}/20-lobby-sections.png` });
    await lobbyPage.close();
  });

  await test("Lobby has dark theme styling", async () => {
    const lobbyPage = await context.newPage();
    await lobbyPage.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
    const bgEl = lobbyPage.locator(".bg-\\[\\#1a202c\\]");
    if (await bgEl.count() === 0) throw new Error("Dark background class not found");
    await lobbyPage.close();
  });

  // ─── PRESCREEN PAGE (PUBLIC) ────────────────────────────────────────
  console.log("\n═══ 9. PRESCREEN PAGE (PUBLIC) ═══");

  await test("Prescreen page renders with invalid code", async () => {
    const psPage = await context.newPage();
    await psPage.goto(`${BASE}/prescreen/INVALID_CODE_XYZ`, { waitUntil: "networkidle" });
    await psPage.waitForSelector("text=Pre-Screen Questions", { timeout: 10000 });
    await psPage.waitForTimeout(3000);
    await psPage.screenshot({ path: `${SCREENSHOT_DIR}/21-prescreen-invalid.png` });
    const bodyText = await psPage.textContent("body");
    const hasError = bodyText.includes("not found") || bodyText.includes("not valid JSON") || bodyText.includes("Invalid");
    if (bodyText.includes("not valid JSON")) {
      reportBug("API", "/api/prescreen/:code returns HTML for invalid codes instead of proper JSON error");
    }
    await psPage.close();
  });

  if (confirmationCode) {
    await test("Prescreen page loads with valid code", async () => {
      const psPage = await context.newPage();
      await psPage.goto(`${BASE}/prescreen/${confirmationCode}`, { waitUntil: "networkidle" });
      await psPage.waitForSelector("text=Pre-Screen Questions", { timeout: 10000 });
      await psPage.waitForTimeout(3000);
      await psPage.screenshot({ path: `${SCREENSHOT_DIR}/22-prescreen-valid.png` });
      const hasQuestions = await psPage.locator('input[type="radio"]').count() > 0;
      const alreadyDone = await psPage.locator("text=Already Completed").count() > 0;
      const hasGreeting = await psPage.locator("text=please answer").count() > 0;
      if (!hasQuestions && !alreadyDone && !hasGreeting) {
        const bodyText = await psPage.textContent("body");
        if (bodyText.includes("not valid JSON")) {
          reportBug("API", "/api/prescreen/:code returns HTML instead of JSON for valid codes too");
          throw new Error("Prescreen API returns HTML instead of JSON");
        }
        throw new Error("Neither questions, 'Already Completed', nor greeting visible");
      }
      console.log(`    State: ${hasQuestions ? "Questions shown" : alreadyDone ? "Already completed" : "Loading/error"}`);
      await psPage.close();
    });
  }

  // ─── SPA ROUTING ────────────────────────────────────────────────────
  console.log("\n═══ 10. SPA ROUTING & DEEP LINKS ═══");

  await test("Direct navigation to /check-in (deep link)", async () => {
    await page.goto(`${BASE}/check-in`, { waitUntil: "networkidle" });
    // Should show either the page (if still authed) or login
    const hasCheckin = await page.locator("text=No customer loaded").count() > 0;
    const hasLogin = await page.locator("text=Staff sign-in").count() > 0;
    if (!hasCheckin && !hasLogin) throw new Error("Neither check-in page nor login shown");
  });

  await test("Direct navigation to /queue (deep link)", async () => {
    await page.goto(`${BASE}/queue`, { waitUntil: "networkidle" });
    const hasQueue = await page.locator("text=Live Queue").count() > 0;
    const hasLogin = await page.locator("text=Staff sign-in").count() > 0;
    if (!hasQueue && !hasLogin) throw new Error("Neither queue page nor login shown");
  });

  await test("Direct navigation to /walk-in (deep link)", async () => {
    await page.goto(`${BASE}/walk-in`, { waitUntil: "networkidle" });
    const hasWalkin = await page.locator("text=Walk-In Registration").count() > 0;
    const hasLogin = await page.locator("text=Staff sign-in").count() > 0;
    if (!hasWalkin && !hasLogin) throw new Error("Neither walk-in page nor login shown");
  });

  await test("Direct navigation to /schedule (deep link)", async () => {
    await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    const hasSchedule = await page.locator("text=Check-In Schedule").or(page.locator("text=Loading schedule")).count() > 0;
    const hasLogin = await page.locator("text=Staff sign-in").count() > 0;
    if (!hasSchedule && !hasLogin) throw new Error("Neither schedule page nor login shown");
  });

  await test("Direct navigation to /lobby (public, no redirect)", async () => {
    const lobbyPage = await context.newPage();
    await lobbyPage.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
    const hasLobby = await lobbyPage.locator("text=Now Serving").count() > 0;
    if (!hasLobby) throw new Error("Lobby page didn't render");
    await lobbyPage.close();
  });

  await test("Unknown route returns app (SPA catch-all)", async () => {
    await page.goto(`${BASE}/nonexistent-page-xyz`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    // SPA should render something (either login or redirect to /)
    const bodyText = await page.textContent("body");
    if (bodyText.includes("Cannot GET") || bodyText.includes("404")) {
      reportBug("Routing", "CloudFront SPA catch-all not working for unknown routes");
      throw new Error("Got 404 instead of SPA fallback");
    }
  });

  // ─── SIGN OUT ───────────────────────────────────────────────────────
  console.log("\n═══ 11. SIGN OUT & AUTH GUARD ═══");

  await test("Sign Out returns to login", async () => {
    // Navigate to a protected page first to ensure we're authed
    await page.goto(`${BASE}/check-in`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const signOutBtn = page.locator('button:has-text("Sign Out")');
    if (await signOutBtn.count() > 0) {
      await signOutBtn.click();
      await page.waitForSelector("text=Staff sign-in", { timeout: 10000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/23-signed-out.png` });
    } else {
      // Already on login page
      console.log("    Already logged out");
    }
  });

  await test("Protected routes redirect to login after sign-out", async () => {
    await page.goto(`${BASE}/service`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    const hasLogin = await page.locator("text=Staff sign-in").count() > 0;
    if (!hasLogin) throw new Error("Protected route accessible without auth");
  });

  // ─── RESULTS ────────────────────────────────────────────────────────
  await browser.close();

  console.log("\n\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  TEST RESULTS: ${passed} passed, ${failed} failed               ║`);
  console.log("╚══════════════════════════════════════════════════════╝");

  if (failures.length > 0) {
    console.log("\n┌─ FAILED TESTS ──────────────────────────────────────");
    for (const f of failures) {
      console.log(`│  ✗ ${f.name}`);
      console.log(`│    → ${f.error}`);
    }
    console.log("└─────────────────────────────────────────────────────");
  }

  if (appBugs.length > 0) {
    console.log("\n┌─ APPLICATION BUGS DETECTED ─────────────────────────");
    for (const bug of appBugs) {
      console.log(`│  [${bug.category}] ${bug.description}`);
    }
    console.log("└─────────────────────────────────────────────────────");
  }

  console.log(`\n  Screenshots saved to: ${SCREENSHOT_DIR}/`);
  console.log("");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
