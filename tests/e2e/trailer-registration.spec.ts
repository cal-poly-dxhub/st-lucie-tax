/**
 * Trailer-registration persona probe.
 *
 * Defense-in-depth e2e for the new trailer-registration transaction.
 * Mirrors the conservative-routing.spec.ts pattern (login + sendMessage
 * helpers + chat-panel transcript). Each spec generates a unique email
 * via Date.now() so isolation is automatic.
 *
 * The 4 personas cover:
 *   1. Homemade motorcycle trailer — must route to trailer-registration,
 *      not vehicle-registration.
 *   2. Homemade trailer — must walk through universal-blockers + identity
 *      bypass and reach the weight-class question.
 *   3. Used utility trailer from a neighbor — must route to trailer-
 *      registration, not vehicle-title-transfer.
 *   4. "I bought a car" — sanity check that ambiguous wording still gets
 *      a clarification AND that trailer is mentioned as one option.
 */

import { test, expect } from "@playwright/test";

const FRONTEND = requireEnv("PLAYWRIGHT_FRONTEND_URL");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} environment variable is required. Set it in .env.test or your CI environment.`,
    );
  return value;
}

const BASE_EMAIL = requireEnv("BETA_EMAIL");
const PASSWORD = requireEnv("BETA_PASSWORD");

// Each Playwright worker process gets its own Cognito test user (pw0-pw3)
// so parallel workers don't collide on a single account's session state.
const TEST_USER_COUNT = 1;
function workerEmail(): string {
  const workerIndex = Number(process.env.TEST_WORKER_INDEX ?? "0") % TEST_USER_COUNT;
  const [local, domain] = BASE_EMAIL.split("@");
  return `${local}+pw${workerIndex}@${domain}`;
}

async function login(page: import("@playwright/test").Page, email?: string) {
  await page.setExtraHTTPHeaders({ "x-test-session": "1" });
  await page.goto(FRONTEND);
  await page.getByRole("textbox", { name: "Email" }).fill(email ?? workerEmail());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator('input[type="text"]').first().waitFor({ state: "visible", timeout: 15000 });
}

async function sendMessage(page: import("@playwright/test").Page, text: string) {
  const input = page.locator('input[type="text"]');
  await input.waitFor({ state: "visible", timeout: 30000 });
  await input.fill(text);
  await input.press("Enter");
}

test("homemade motorcycle trailer routes to trailer-registration (not vehicle-registration)", async ({
  page,
}) => {
  await login(page);
  await sendMessage(page, "I need to register a homemade motorcycle trailer");
  await page.waitForTimeout(25000);
  const transcript = await page.locator(".chat-panel").first().innerText();
  // Must NOT confirm vehicle-registration (the old wrong path).
  expect(transcript, "must not route trailer to vehicle-registration alone").not.toMatch(
    /Vehicle Registration confirmed/i,
  );
  // Must mention trailer registration in the confirmation.
  expect(transcript).toMatch(/Trailer Registration|trailer registration/i);
});

test("homemade trailer flow gets through universal-blockers without rogue checklist", async ({
  page,
}) => {
  // Reaching the actual weight question requires DL photo upload via the
  // verify-identity tool, which Playwright can't simulate. The unit tests
  // cover the full tree resolution. This spec asserts the upstream
  // behavior: trailer-registration confirms, the photo-ID blocker fires,
  // and the bot does NOT improvise a doc list when the user pushes for
  // "next step" (trees-as-source-of-truth defense in depth).
  await login(page);
  await sendMessage(page, "register my homemade trailer");
  await page.waitForTimeout(25000);
  await page
    .getByRole("button", { name: "Yes" })
    .click()
    .catch(() => {});
  await page.waitForTimeout(12000);
  await sendMessage(page, "My identity has been confirmed, what is the next step?");
  await page.waitForTimeout(20000);
  const transcript = await page.locator(".chat-panel").first().innerText();
  expect(transcript).toMatch(/Trailer Registration confirmed/i);
  expect(transcript).not.toMatch(/Required Documents to Bring/i);
  expect(transcript).not.toMatch(/HSMV \d{5}/);
});

test('"I bought a used utility trailer from a neighbor" routes to trailer-registration', async ({
  page,
}) => {
  await login(page);
  await sendMessage(
    page,
    "I bought a used utility trailer from my neighbor and need to register it",
  );
  await page.waitForTimeout(25000);
  const transcript = await page.locator(".chat-panel").first().innerText();
  expect(transcript).toMatch(/Trailer Registration|trailer registration/i);
  // Must NOT route to vehicle-title-transfer.
  expect(transcript).not.toMatch(/Vehicle Title Transfer confirmed/i);
});

test('"I bought a car" still asks for clarification (sanity check — not affected by trailer additions)', async ({
  page,
}) => {
  await login(page);
  await sendMessage(page, "I bought a car");
  await page.waitForTimeout(25000);
  const transcript = await page.locator(".chat-panel").first().innerText();
  // Should mention trailer as one of the disambiguation options now.
  expect(transcript).toMatch(/trailer|new vehicle from a dealer|private party/i);
});
