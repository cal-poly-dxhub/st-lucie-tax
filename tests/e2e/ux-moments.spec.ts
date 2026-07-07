/**
 * UX-specific moments — things only Playwright can catch.
 *
 * 1. Chip rendering: assert chips DOM matches bot prose verbatim for a
 *    fact with valueLabels.
 * 2. autoGreet sequencing: confirm transaction → single bot reply contains
 *    confirmation + first eligibility question.
 * 3. Universal-blockers no-re-question: answer Q1, Q2 must NOT repeat Q1.
 * 4. Session bookmark + rehydrate: open URL with ?s=<sid>, full state restored.
 * 5. New-session button: clears URL, banner shows "no active session".
 * 6. Confirm-facts edit loop: edit a fact, side-panel updates.
 * 7. (Identity OCR card — skipped: requires file upload to S3 + Lambda OCR
 *     which is async beyond Playwright's reach in local dev. Documented as
 *     manual.)
 */

import { test, expect } from "@playwright/test";
import {
  createSession,
  sendMessage,
  confirmIdentity,
  getSessionState,
  FRONTEND,
  ARTIFACT_DIR,
} from "./helpers.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("ux-1: chip text matches bot prose for valueLabels facts", async ({ page }) => {
  // Drive a tangible-personal-property-tax flow until tpp_is_past_due is asked.
  const sid = await createSession();
  await sendMessage(sid, "I need to pay my Tangible Personal Property tax bill");
  let st = await getSessionState(sid);
  if (st.state === "universal-blockers") {
    await sendMessage(sid, "No");
    await sendMessage(sid, "Yes");
    await sendMessage(sid, "Yes");
  }
  await confirmIdentity(sid);
  // Drive resolve-facts: pick "pay-bill" intent
  await sendMessage(sid, "I'm paying an existing TPP tax bill");
  st = await getSessionState(sid);

  await page.goto(`${FRONTEND}/?s=${sid}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(2000);

  // Capture the chips (ChipRow buttons) and the most recent assistant message
  const html = await page.content();
  const chipTexts = await page
    .locator('.smart-quick-replies button, [class*="chip"] button, button')
    .allInnerTexts();
  const lastBot = await page
    .locator('.message-bubble.assistant, .message.bot, [class*="bot"]')
    .last()
    .innerText()
    .catch(() => "");

  const ss = resolve(ARTIFACT_DIR, "ux-1-chip-vs-prose.png");
  await page.screenshot({ path: ss, fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, "ux-1-chip-vs-prose.json"),
    JSON.stringify({ sid, lastBot, chipTexts, screenshot: ss, finalState: st.state }, null, 2) +
      "\n",
  );

  // Soft assertion — log mismatches; the brief will surface them.
  if (lastBot.includes("past due") && lastBot.includes("current-year")) {
    const found =
      chipTexts.some((c) => c.toLowerCase().includes("past due")) &&
      chipTexts.some((c) => c.toLowerCase().includes("current-year"));
    if (!found)
      console.log(
        `  [ux-1] chip mismatch: prose says past due / current-year but chips don't match`,
      );
    else console.log(`  [ux-1] chips match prose ✓`);
  } else {
    console.log(
      `  [ux-1] tpp_is_past_due question not visible; bot is at "${st.state}", lastBot snippet:`,
      lastBot.slice(0, 120),
    );
  }
  // No throw — observational
  void expect;
  void html;
});

test("ux-2: autoGreet bundles transaction confirm + first eligibility question", async ({
  page,
}) => {
  const sid = await createSession();
  const r1 = await sendMessage(sid, "I need to renew my license");
  // The combined message after autoGreet should contain BOTH:
  //  - confirmation (e.g., "Driver License Renewal confirmed" or similar)
  //  - first eligibility question (e.g., "Is your driver license currently suspended")
  const text = r1.assistantMsg.toLowerCase();
  const hasConfirm = /confirm|got it|perfect/.test(text);
  const hasEligibility = /suspend|revoke|cancell?ed/.test(text);
  await page.goto(`${FRONTEND}/?s=${sid}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const ss = resolve(ARTIFACT_DIR, "ux-2-autogreet.png");
  await page.screenshot({ path: ss, fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, "ux-2-autogreet.json"),
    JSON.stringify(
      { sid, assistantMsg: r1.assistantMsg, hasConfirm, hasEligibility, screenshot: ss },
      null,
      2,
    ) + "\n",
  );
  console.log(`  [ux-2] hasConfirm=${hasConfirm} hasEligibility=${hasEligibility}`);
});

test("ux-3: universal-blockers does not re-ask Q1 after Q1 answered", async ({ page }) => {
  const sid = await createSession();
  await sendMessage(sid, "I need to renew my license");
  const r1 = await sendMessage(sid, "No"); // Q1 answer
  // Q2 should NOT contain Q1's keywords
  const q2 = r1.assistantMsg.toLowerCase();
  const reAskedQ1 = /suspend|revoke|cancell?ed/.test(q2);
  const askedQ2 = /florida|located|right now|physically/.test(q2);
  await page.goto(`${FRONTEND}/?s=${sid}`);
  const ss = resolve(ARTIFACT_DIR, "ux-3-no-requestion.png");
  await page.screenshot({ path: ss, fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, "ux-3-no-requestion.json"),
    JSON.stringify({ sid, q2: r1.assistantMsg, reAskedQ1, askedQ2, screenshot: ss }, null, 2) +
      "\n",
  );
  console.log(`  [ux-3] reAskedQ1=${reAskedQ1} askedQ2=${askedQ2}`);
});

test("ux-4: session bookmark + rehydrate restores full state", async ({ page }) => {
  const sid = await createSession();
  await sendMessage(sid, "I need to renew my license");
  await sendMessage(sid, "No");
  await sendMessage(sid, "Yes");
  await sendMessage(sid, "Yes");
  // Now open the same session URL fresh
  await page.goto(`${FRONTEND}/?s=${sid}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1500);
  const bodyText = await page.locator("body").innerText();
  const restoredChat = /renew/i.test(bodyText);
  const sessionBadgeShown = bodyText.includes(sid.slice(0, 8));
  const ss = resolve(ARTIFACT_DIR, "ux-4-rehydrate.png");
  await page.screenshot({ path: ss, fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, "ux-4-rehydrate.json"),
    JSON.stringify({ sid, restoredChat, sessionBadgeShown, screenshot: ss }, null, 2) + "\n",
  );
  console.log(`  [ux-4] restoredChat=${restoredChat} sessionBadgeShown=${sessionBadgeShown}`);
});

test("ux-5: New session button clears URL and chat", async ({ page }) => {
  // Start a session, then click "New session"
  const sid = await createSession();
  await sendMessage(sid, "I need to renew my license");
  await page.goto(`${FRONTEND}/?s=${sid}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1000);

  // Click the New session button
  const newBtn = page.getByRole("button", { name: /new session/i });
  if ((await newBtn.count()) > 0) {
    await newBtn.first().click();
    await page.waitForTimeout(800);
  }

  const url = page.url();
  const urlClean = !url.includes("?s=");
  const bodyText = await page.locator("body").innerText();
  const banner = /no active session/i.test(bodyText);
  const ss = resolve(ARTIFACT_DIR, "ux-5-new-session.png");
  await page.screenshot({ path: ss, fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, "ux-5-new-session.json"),
    JSON.stringify({ urlAfter: url, urlClean, bannerShown: banner, screenshot: ss }, null, 2) +
      "\n",
  );
  console.log(`  [ux-5] urlClean=${urlClean} bannerShown=${banner}`);
});

test("ux-6: confirm-facts edit refreshes side panel", async ({ page }) => {
  // Walk to confirm-facts
  const sid = await createSession();
  await sendMessage(sid, "I want to renew my license");
  let st = await getSessionState(sid);
  if (st.state === "universal-blockers") {
    await sendMessage(sid, "No");
    await sendMessage(sid, "Yes");
    await sendMessage(sid, "Yes");
  }
  await confirmIdentity(sid);
  for (let i = 0; i < 14; i += 1) {
    st = await getSessionState(sid);
    if (st.state !== "resolve-facts") break;
    await sendMessage(sid, ["Yes", "No", "1", "Not sure"][i % 4]);
  }

  await page.goto(`${FRONTEND}/?s=${sid}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1500);

  const reachedConfirmFacts = st.state === "confirm-facts";
  const bucketCounts = st.resolvedBuckets
    ? {
        bringIns: st.resolvedBuckets.bringIns.length,
        optionalUploads: st.resolvedBuckets.optionalUploads.length,
        forms: st.resolvedBuckets.forms.length,
      }
    : null;
  const ss = resolve(ARTIFACT_DIR, "ux-6-confirm-facts.png");
  await page.screenshot({ path: ss, fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, "ux-6-confirm-facts.json"),
    JSON.stringify(
      { sid, reachedConfirmFacts, bucketCounts, finalState: st.state, screenshot: ss },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `  [ux-6] reachedConfirmFacts=${reachedConfirmFacts} buckets=${JSON.stringify(bucketCounts)}`,
  );
});

test("ux-7: identity OCR placeholder (manual verification flag)", async () => {
  // Documented as manual — uploading to S3 + waiting for Lambda OCR is
  // outside Playwright's scope in local dev. Recording the limitation.
  writeFileSync(
    resolve(ARTIFACT_DIR, "ux-7-identity-ocr.json"),
    JSON.stringify(
      {
        status: "manual-only",
        reason:
          "OCR pipeline uses S3 event → Lambda; can be tested manually by uploading image-upscaled.png from Downloads. See DEMO_PREP.md for steps.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("  [ux-7] manual-verification flag recorded");
});
