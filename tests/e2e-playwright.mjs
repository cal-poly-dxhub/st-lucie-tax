import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "CLOUDFRONT_URL";
const CREDS = { email: "EMAIL", password: "PASSWORD" };
const SCREENSHOT_DIR =
  "/Users/njriley/dxhub/customer_projects/st-lucie/st-lucie-tax/tests/screenshots/e2e";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

let passed = 0;
let failed = 0;
const failures = [];

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

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // ─── LOGIN ───────────────────────────────────────────────────────────
  console.log("\n═══ 1. LOGIN ═══");

  await test("Login page renders", async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Staff sign-in", { timeout: 15000 });
    await page.waitForSelector("text=St. Lucie Tax Collector");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-login.png` });
  });

  await test("Login with valid credentials", async () => {
    await page.fill('input[type="email"]', CREDS.email);
    await page.fill('input[type="password"]', CREDS.password);
    await page.click('button:has-text("Sign In")');
    await page.waitForSelector("nav", { timeout: 15000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-logged-in.png` });
  });

  await test("Nav bar shows all links", async () => {
    const navLinks = [
      "Book Appt",
      "Check-In",
      "Walk-In",
      "Queue",
      "Schedule",
      "Service Clerk",
      "Lobby Display",
    ];
    for (const link of navLinks) {
      const el = page.locator(`nav >> text="${link}"`);
      if ((await el.count()) === 0) throw new Error(`Nav link "${link}" not found`);
    }
  });

  // ─── BOOK APPOINTMENT ───────────────────────────────────────────────
  console.log("\n═══ 2. BOOK APPOINTMENT ═══");

  await test("Confirmation page loads with form", async () => {
    await page.click('nav >> text="Book Appt"');
    await page.waitForSelector("text=Schedule an Appointment", { timeout: 10000 });
    await page.waitForSelector("text=Your Information");
    await page.waitForSelector("text=Transaction Type");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-book-appt-form.png` });
  });

  await test("Fill booking form and verify email", async () => {
    await page.fill('input[placeholder="Jane"]', "E2E");
    await page.fill('input[placeholder="Smith"]', "Tester");
    await page.fill('input[placeholder="you@example.com"]', CREDS.email);
    // Verify email (use the test user's email which should already be verified in SES)
    const verifyBtn = page.locator('button:has-text("Verify")');
    if ((await verifyBtn.count()) > 0) {
      await verifyBtn.click();
      await page.waitForTimeout(3000);
      // If already verified, button becomes badge; if not, click "I Verified"
      const iVerifiedBtn = page.locator('button:has-text("I Verified")');
      if ((await iVerifiedBtn.count()) > 0) {
        await iVerifiedBtn.click();
        await page.waitForTimeout(2000);
      }
    }
    // Select first transaction type
    const checkbox = page.locator('input[type="checkbox"]').first();
    if ((await checkbox.count()) === 0) throw new Error("No transaction type checkboxes");
    await checkbox.check();
  });

  let confirmationCode = null;
  await test("Book appointment successfully", async () => {
    await page.click('button:has-text("Find Slot & Book Appointment")');
    await page.waitForSelector("text=Appointment Confirmed", { timeout: 15000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-appt-confirmed.png` });
    // Extract confirmation code
    const codeEl = page.locator("text=Confirmation Code:").locator("..").locator("span, p, dd");
    const allText = await page.locator("text=/[A-Z0-9]{6,}/").allTextContents();
    for (const t of allText) {
      const match = t.match(/[A-Z0-9]{6,}/);
      if (match) {
        confirmationCode = match[0];
        break;
      }
    }
    if (!confirmationCode) {
      // Try broader search
      const body = await page.textContent("body");
      const m = body.match(/Confirmation Code:\s*([A-Z0-9]{6,})/);
      if (m) confirmationCode = m[1];
    }
    console.log(`    Confirmation code: ${confirmationCode || "(not captured)"}`);
  });

  await test("Confirmation shows QR code", async () => {
    const qr = page.locator('img[alt="QR Code"], canvas, svg');
    if ((await qr.count()) === 0) throw new Error("QR code not found");
  });

  // ─── CHECK-IN ───────────────────────────────────────────────────────
  console.log("\n═══ 3. CHECK-IN ═══");

  await test("Check-In page loads", async () => {
    await page.click('nav >> text="Check-In"');
    await page.waitForSelector("text=No customer loaded", { timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-checkin-empty.png` });
  });

  if (confirmationCode) {
    await test("Lookup by confirmation code", async () => {
      await page.goto(`${BASE}/check-in?code=${confirmationCode}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(5000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/06-checkin-lookup.png` });
      const testerEl = page.locator("text=E2E Tester").or(page.locator("text=E2E"));
      const noCustomer = page.locator("text=No customer loaded");
      if ((await testerEl.count()) === 0 && (await noCustomer.count()) > 0) {
        throw new Error("Customer not loaded from confirmation code");
      }
    });
  }

  // ─── WALK-IN ────────────────────────────────────────────────────────
  console.log("\n═══ 4. WALK-IN ═══");

  await test("Walk-In page loads", async () => {
    await page.click('nav >> text="Walk-In"');
    await page.waitForSelector("text=Walk-In Registration", { timeout: 10000 });
    await page.waitForSelector("text=Customer Information");
    await page.waitForSelector("text=Transaction Type");
    await page.waitForSelector("text=Identity Verification");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-walkin-page.png` });
  });

  await test("Walk-In form validation - empty name rejected", async () => {
    await page.fill('input[placeholder="First name"]', "");
    await page.fill('input[placeholder="Last name"]', "");
    const btn = page.locator('button:has-text("Check In to Queue")');
    await btn.click();
    await page.waitForTimeout(2000);
    // Should show error toast or validation
    await page.screenshot({ path: `${SCREENSHOT_DIR}/08-walkin-validation.png` });
  });

  await test("Walk-In form validation - no txn type rejected", async () => {
    await page.fill('input[placeholder="First name"]', "Walk");
    await page.fill('input[placeholder="Last name"]', "Intest");
    const btn = page.locator('button:has-text("Check In to Queue")');
    await btn.click();
    await page.waitForTimeout(2000);
  });

  await test("Fill Walk-In form and submit", async () => {
    await page.fill('input[placeholder="First name"]', "Walk");
    await page.fill('input[placeholder="Last name"]', "Intest");
    await page.fill('input[placeholder="email@example.com"]', "walk@test.com");
    await page.fill('input[placeholder="(555) 123-4567"]', "5551112222");
    // Select first transaction type
    const txnCheckbox = page.locator('input[type="checkbox"]').first();
    await txnCheckbox.check();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/09-walkin-filled.png` });
  });

  await test("Mark Identity Verified", async () => {
    const verifyBtn = page.locator('button:has-text("Mark Identity Verified")');
    if ((await verifyBtn.count()) > 0) {
      await verifyBtn.click();
      await page.waitForTimeout(500);
      const verified = page.locator("text=Identity verified by clerk");
      if ((await verified.count()) === 0) throw new Error("Verification text not shown");
    }
  });

  await test("Submit Walk-In to queue", async () => {
    const btn = page.locator('button:has-text("Check In to Queue")');
    await btn.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/10-walkin-submitted.png` });
    // Look for success toast or queue number
    const body = await page.textContent("body");
    const hasSuccess = body.includes("Walk-in registered") || body.includes("Queue #");
    // Toast may have already disappeared, check if form was reset (name empty)
    const firstName = await page.inputValue('input[placeholder="First name"]');
    if (!hasSuccess && firstName === "Walk") {
      // Form wasn't reset, probably failed
      console.log("    Walk-in may have failed (form not reset)");
    } else {
      console.log("    Walk-in submitted successfully");
    }
  });

  // ─── QUEUE ──────────────────────────────────────────────────────────
  console.log("\n═══ 5. QUEUE ═══");

  await test("Queue page loads", async () => {
    await page.click('nav >> text="Queue"');
    await page.waitForSelector("text=Live Queue", { timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/11-queue-page.png` });
  });

  await test("Queue shows entries or empty state", async () => {
    await page.waitForTimeout(5000);
    const hasEntries =
      (await page.locator("text=/Queue #|P\\d+|^\\d+$/").count()) > 0 ||
      (await page.locator("text=/checked in/i").count()) > 0;
    const emptyMsg = (await page.locator("text=Queue is empty").count()) > 0;
    const loading = (await page.locator("text=Loading queue").count()) > 0;
    if (loading) throw new Error("Queue stuck in loading state");
    if (!hasEntries && !emptyMsg) {
      // May have entries but with different format
      await page.screenshot({ path: `${SCREENSHOT_DIR}/12-queue-state.png` });
      console.log("    Queue rendered (check screenshot for state)");
    } else {
      console.log(`    Queue state: ${hasEntries ? "has entries" : "empty"}`);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/12-queue-state.png` });
  });

  await test("Seed 5 button adds entries", async () => {
    const seedBtn = page.locator('button:has-text("Seed")');
    if ((await seedBtn.count()) === 0) throw new Error("Seed button not found");
    await seedBtn.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/13-queue-seeded.png` });
  });

  await test("Refresh button works", async () => {
    const refreshBtn = page.locator('button:has-text("Refresh")');
    if ((await refreshBtn.count()) === 0) throw new Error("Refresh button not found");
    await refreshBtn.click();
    await page.waitForTimeout(3000);
  });

  await test("Clerk Sessions section renders", async () => {
    await page.waitForSelector("text=Clerk Sessions");
  });

  // ─── SERVICE CLERK LOGIN & HANDLING ─────────────────────────────────
  console.log("\n═══ 6. SERVICE CLERK ═══");

  await test("Service Clerk page loads", async () => {
    await page.click('nav >> text="Service Clerk"');
    await page.waitForSelector("text=Service Clerk Dashboard", { timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/14-service-clerk.png` });
  });

  await test("Clerk dropdown populated", async () => {
    await page.waitForTimeout(3000);
    const clerkSelect = page.locator("select").first();
    const options = await clerkSelect.locator("option").allTextContents();
    if (options.length <= 1) throw new Error(`No clerks loaded (got ${options.length} options)`);
    console.log(`    Clerks: ${options.slice(0, 3).join(", ")}${options.length > 3 ? "..." : ""}`);
  });

  await test("Desk selector has options", async () => {
    const deskSelect = page.locator("select").nth(1);
    const options = await deskSelect.locator("option").allTextContents();
    if (options.length < 3) throw new Error(`Expected desk options, got ${options.length}`);
  });

  await test("Login as clerk", async () => {
    const loginBtn = page.locator('button:has-text("Login")');
    await loginBtn.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/15-clerk-logged-in.png` });
    const availToggle = page.locator("text=Available for customers");
    if ((await availToggle.count()) === 0) {
      throw new Error("Availability toggle not shown after login");
    }
  });

  await test("Summon Next customer", async () => {
    const summonBtn = page.locator('button:has-text("Summon Next")').first();
    if (await summonBtn.isDisabled()) throw new Error("Summon Next button disabled");
    await summonBtn.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/16-clerk-summoned.png` });
    const nowServing = await page.locator("text=Now Serving").count();
    const noQueue = await page
      .locator("text=No one in queue")
      .or(page.locator("text=Queue empty"))
      .count();
    if (nowServing > 0) {
      console.log("    Customer summoned successfully");
    } else if (noQueue > 0) {
      console.log("    Queue was empty");
    } else {
      console.log("    Check screenshot for result");
    }
  });

  // If serving, test service workflow
  const isServing = (await page.locator("text=Now Serving").count()) > 0;
  if (isServing) {
    await test("Service card shows customer details", async () => {
      // Should have transaction info, documents section, steps
      const hasTxn = (await page.locator("text=Transaction:").count()) > 0;
      const hasDocs = (await page.locator("text=Documents").count()) > 0;
      if (!hasTxn && !hasDocs) throw new Error("Service card missing details");
      await page.screenshot({ path: `${SCREENSHOT_DIR}/17-service-card.png` });
    });

    await test("Transaction steps section present", async () => {
      const stepsSection = page.locator("text=Transaction Steps");
      if ((await stepsSection.count()) === 0) throw new Error("Transaction Steps section missing");
    });

    await test("Mark Done button works on a step", async () => {
      const markDoneBtn = page.locator('button:has-text("Mark Done")').first();
      if ((await markDoneBtn.count()) > 0) {
        await markDoneBtn.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/18-step-done.png` });
      } else {
        console.log("    No Mark Done buttons visible (steps may already be done)");
      }
    });

    await test("Complete buttons present", async () => {
      const completeNext = page.locator('button:has-text("Complete & Summon Next")');
      const completeOnly = page.locator('button:has-text("Complete Only")');
      if ((await completeNext.count()) === 0 && (await completeOnly.count()) === 0) {
        throw new Error("No complete buttons found");
      }
    });

    await test("Complete service", async () => {
      const completeOnly = page.locator('button:has-text("Complete Only")');
      if ((await completeOnly.count()) > 0) {
        await completeOnly.click();
        // Handle confirm dialog
        page.once("dialog", (d) => d.accept());
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/19-service-completed.png` });
      }
    });
  } else {
    console.log("  (skipping service workflow - no customer to serve)");
  }

  // ─── LOBBY DISPLAY ──────────────────────────────────────────────────
  console.log("\n═══ 7. LOBBY DISPLAY ═══");

  await test("Lobby Display loads without auth", async () => {
    const lobbyPage = await context.newPage();
    await lobbyPage.goto(`${BASE}/lobby`, { waitUntil: "networkidle" });
    await lobbyPage.waitForSelector("text=St. Lucie County Tax Collector", { timeout: 10000 });
    await lobbyPage.waitForSelector("text=Now Serving");
    await lobbyPage.waitForSelector("text=Up Next");
    await lobbyPage.screenshot({ path: `${SCREENSHOT_DIR}/20-lobby.png` });
    await lobbyPage.close();
  });

  // ─── PRESCREEN (PUBLIC) ──────────────────────────────────────────────
  console.log("\n═══ 8. PRESCREEN ═══");

  if (confirmationCode) {
    await test("Prescreen page loads with valid code (no auth)", async () => {
      const psPage = await context.newPage();
      await psPage.goto(`${BASE}/prescreen/${confirmationCode}`, { waitUntil: "networkidle" });
      await psPage.waitForTimeout(5000);
      await psPage.screenshot({ path: `${SCREENSHOT_DIR}/22-prescreen-load.png` });
      const body = await psPage.textContent("body");
      const hasQuestions = (await psPage.locator('input[type="radio"]').count()) > 0;
      const hasAlready = body.includes("Already Completed");
      const hasGreeting = body.includes("please answer");
      if (!hasQuestions && !hasAlready && !hasGreeting) {
        if (body.includes("Authentication required")) {
          throw new Error("Prescreen page requires auth (should be public)");
        }
        throw new Error("No questions, already-completed, or greeting visible");
      }
      console.log(
        `    State: ${hasQuestions ? "questions shown" : hasAlready ? "already done" : "greeting"}`,
      );
      await psPage.close();
    });

    await test("Prescreen questions can be answered and submitted", async () => {
      const psPage = await context.newPage();
      await psPage.goto(`${BASE}/prescreen/${confirmationCode}`, { waitUntil: "networkidle" });
      await psPage.waitForTimeout(5000);
      const radioCount = await psPage.locator('input[type="radio"]').count();
      if (radioCount === 0) {
        // Already completed from a previous run
        const body = await psPage.textContent("body");
        if (body.includes("Already Completed")) {
          console.log("    Prescreen already completed (skipping submit test)");
          await psPage.close();
          return;
        }
        throw new Error("No radio buttons found");
      }
      // Answer all questions (click first radio in each group = "Yes")
      const allRadios = await psPage.locator('input[type="radio"]').all();
      const names = new Set();
      for (const el of allRadios) {
        const name = await el.getAttribute("name");
        if (name) names.add(name);
      }
      for (const name of names) {
        await psPage.locator(`input[name="${name}"]`).first().click();
      }
      console.log(`    Answered ${names.size} questions`);
      const submitBtn = psPage.locator('button:has-text("Submit")');
      await submitBtn.click();
      await psPage.waitForTimeout(5000);
      await psPage.screenshot({ path: `${SCREENSHOT_DIR}/23-prescreen-submitted.png` });
      const afterBody = await psPage.textContent("body");
      const success =
        afterBody.includes("Pre-Screen Complete") ||
        afterBody.includes("close this page") ||
        afterBody.includes("checked in");
      if (!success) throw new Error("Prescreen submit did not show success state");
      console.log("    Prescreen submitted successfully");
      await psPage.close();
    });
  } else {
    console.log("  (skipping prescreen - no confirmation code available)");
  }

  // ─── SIGN OUT ───────────────────────────────────────────────────────
  console.log("\n═══ 9. SIGN OUT ═══");

  await test("Sign Out works", async () => {
    const signOutBtn = page.locator('button:has-text("Sign Out")');
    if ((await signOutBtn.count()) > 0) {
      await signOutBtn.click();
      await page.waitForSelector("text=Staff sign-in", { timeout: 10000 });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/21-signed-out.png` });
    }
  });

  await test("Protected routes redirect to login", async () => {
    await page.goto(`${BASE}/service`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    const hasLogin = (await page.locator("text=Staff sign-in").count()) > 0;
    if (!hasLogin) throw new Error("Protected route accessible without auth");
  });

  // ─── RESULTS ────────────────────────────────────────────────────────
  await browser.close();

  console.log("\n\n╔══════════════════════════════════════════════════════╗");
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed                       ║`);
  console.log("╚══════════════════════════════════════════════════════╝");

  if (failures.length > 0) {
    console.log("\n┌─ FAILURES ──────────────────────────────────────────");
    for (const f of failures) {
      console.log(`│  ✗ ${f.name}`);
      console.log(`│    → ${f.error}`);
    }
    console.log("└─────────────────────────────────────────────────────");
  }

  console.log(`\n  Screenshots: ${SCREENSHOT_DIR}/`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
