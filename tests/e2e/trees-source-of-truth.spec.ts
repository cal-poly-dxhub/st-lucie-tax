/**
 * Trees-as-source-of-truth probe.
 *
 * Defense-in-depth e2e for the runtime gap where the LLM produced a
 * "Required Documents to Bring" list from training-data plausibility
 * instead of from the resolved decision tree. Both specs drive the bot
 * via the deployed UI (login form + chat input) on purpose — the bug
 * surfaces in the realtime chat output, so probing through the public
 * UI is the only faithful reproduction. The helpers.ts pattern is API-
 * driven (it skips the login form entirely) and would miss the regression.
 *
 * After Tasks 1-3 (NO_DOC_LIST_FROM_MEMORY rule, render_resolved_buckets
 * tool, assertNoRogueChecklist guard) deploy, both specs must pass.
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

const EMAIL = requireEnv("BETA_EMAIL");
const PASSWORD = requireEnv("BETA_PASSWORD");

async function login(page: import("@playwright/test").Page, email?: string) {
  await page.setExtraHTTPHeaders({ "x-test-session": "1" });
  await page.goto(FRONTEND);
  await page.getByRole("textbox", { name: "Email" }).fill(email ?? EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("textbox").first().waitFor({ timeout: 15000 });
}

async function sendMessage(page: import("@playwright/test").Page, text: string) {
  // The chat input is the only INPUT[type=text] on the page (the side panel
  // textarea is a TEXTAREA, the file upload is INPUT[type=file]). Wait for
  // it to settle, then fill.
  const input = page.locator('input[type="text"]');
  await input.waitFor({ state: "visible", timeout: 30000 });
  await input.fill(text);
  await input.press("Enter");
}

test("homemade trailer never gets a free-form checklist before confirm-facts", async ({ page }) => {
  await login(page);
  await sendMessage(page, "I need to register a homemade motorcycle trailer");
  await page.waitForTimeout(15000);
  await page.getByRole("button", { name: "Yes" }).click();
  await page.waitForTimeout(8000);
  // Push the bot — this is exactly the prompt that broke things in the live test.
  await sendMessage(page, "My identity has been confirmed, what is the next step?");
  await page.waitForTimeout(15000);

  // Read only the chat-panel column. The right rail has debug-panel text
  // that includes branch notes citing HSMV form numbers — those would
  // false-positive any assertion against the page body.
  const transcript = await page.locator(".chat-panel").first().innerText();
  // Hard assertions — the bot's reply must NOT contain checklist-shaped output here.
  expect(
    transcript,
    'must not contain "Required Documents to Bring" header in pre-summary state',
  ).not.toMatch(/Required Documents to Bring/i);
  expect(
    transcript,
    'must not list "Florida vehicle title" — homemade trailer has none',
  ).not.toMatch(/Florida vehicle title/i);
  // Either the rewrite-fallback fires, or the state advances naturally
  // (e.g. asking follow-up questions about the trailer).
  expect(transcript).toMatch(
    /full list (?:will be )?ready|verify your identity|let me ask|finalize your document|couple more questions|few.+questions/i,
  );
});

test('explicit "what do I need to bring?" gets the canonical list, never improvised', async ({
  page,
}) => {
  await login(page);
  await sendMessage(page, "Renew my driver license");
  await page.waitForTimeout(15000);
  // Mid-flow: ask for the list. Must get the canonical "I'll have your list ready" punt,
  // not an improvised list.
  await sendMessage(page, "What do I need to bring?");
  await page.waitForTimeout(10000);

  // Read only the chat-panel column. The right rail has debug-panel text
  // that includes branch notes citing HSMV form numbers — those would
  // false-positive any assertion against the page body.
  const transcript = await page.locator(".chat-panel").first().innerText();
  expect(transcript).toMatch(
    /full list (?:will be )?ready|once we'?ve finished|right side panel|finalize your document/i,
  );
  // Must NOT contain a canonical doc-list shape.
  expect(transcript).not.toMatch(/HSMV \d{5}/); // no specific form numbers from training
});
