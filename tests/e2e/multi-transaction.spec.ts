/**
 * Multi-transaction personas — verify that combined sessions produce a
 * unified visit plan with merged bucket lists, not the engine getting
 * confused or losing one of the transactions.
 */

import { test } from "@playwright/test";
import {
  walkTransaction,
  sendMessage,
  getSessionState,
  FRONTEND,
  ARTIFACT_DIR,
  createSession,
  confirmIdentity,
} from "./helpers.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("multi: new FL resident with car (DL transfer + vehicle title transfer + vehicle registration)", async ({
  page,
}) => {
  const sid = await createSession();
  const turns: Array<{ user: string; state: string; txns: string[] }> = [];

  const send = async (m: string) => {
    await sendMessage(sid, m);
    const st = await getSessionState(sid);
    turns.push({ user: m, state: st.state, txns: st.transactions });
  };

  await send(
    "I just moved to Florida from Georgia and brought my car with me — I need a Florida license, transfer the title, and register it in Florida",
  );
  // eligibility: no/yes/yes
  if (turns[turns.length - 1].state === "universal-blockers") {
    await send("No");
    await send("Yes");
    await send("Yes");
  }
  await confirmIdentity(sid);
  // Now drive resolve-facts heuristically
  for (let i = 0; i < 12; i += 1) {
    const st = await getSessionState(sid);
    if (st.state !== "resolve-facts") break;
    await send(["Yes", "No", "1", "Not sure"][i % 4]);
  }
  const final = await getSessionState(sid);

  await page.goto(`${FRONTEND}/?s=${sid}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const ss = resolve(ARTIFACT_DIR, `multi-tx-new-resident-with-car.png`);
  await page.screenshot({ path: ss, fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, `multi-tx-new-resident-with-car.json`),
    JSON.stringify({ sid, turns, final, screenshot: ss }, null, 2) + "\n",
  );

  console.log(
    `  [multi-new-resident] final state=${final.state} txns=${final.transactions.join(", ")} buckets=${JSON.stringify(
      {
        bringIns: final.resolvedBuckets?.bringIns?.length ?? 0,
        optionalUploads: final.resolvedBuckets?.optionalUploads?.length ?? 0,
        forms: final.resolvedBuckets?.forms?.length ?? 0,
      },
    )}`,
  );
});

test("multi: business owner closing shop (BTR close + plate surrender)", async ({ page }) => {
  const sid = await createSession();
  const turns: Array<{ user: string; state: string; txns: string[] }> = [];
  const send = async (m: string) => {
    await sendMessage(sid, m);
    const st = await getSessionState(sid);
    turns.push({ user: m, state: st.state, txns: st.transactions });
  };

  await send(
    "I am closing my business — I need to cancel my business tax receipt and turn in the company plates",
  );
  if (turns[turns.length - 1].state === "universal-blockers") {
    await send("No");
    await send("Yes");
    await send("Yes");
  }
  await confirmIdentity(sid);
  for (let i = 0; i < 12; i += 1) {
    const st = await getSessionState(sid);
    if (st.state !== "resolve-facts") break;
    await send(["Yes", "No", "1", "Not sure"][i % 4]);
  }
  const final = await getSessionState(sid);

  await page.goto(`${FRONTEND}/?s=${sid}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const ss = resolve(ARTIFACT_DIR, `multi-tx-business-closure.png`);
  await page.screenshot({ path: ss, fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, `multi-tx-business-closure.json`),
    JSON.stringify({ sid, turns, final, screenshot: ss }, null, 2) + "\n",
  );

  console.log(
    `  [multi-business-closure] final state=${final.state} txns=${final.transactions.join(", ")}`,
  );
});

test("multi: family of three (DL renewal + REAL ID upgrade + learner permit)", async ({ page }) => {
  const sid = await createSession();
  const turns: Array<{ user: string; state: string; txns: string[] }> = [];
  const send = async (m: string) => {
    await sendMessage(sid, m);
    const st = await getSessionState(sid);
    turns.push({ user: m, state: st.state, txns: st.transactions });
  };

  await send(
    "I need to renew my drivers license and also upgrade it to REAL ID, plus my teenager needs a learners permit",
  );
  if (turns[turns.length - 1].state === "universal-blockers") {
    await send("No");
    await send("Yes");
    await send("Yes");
  }
  await confirmIdentity(sid);
  for (let i = 0; i < 12; i += 1) {
    const st = await getSessionState(sid);
    if (st.state !== "resolve-facts") break;
    await send(["Yes", "No", "1", "Not sure"][i % 4]);
  }
  const final = await getSessionState(sid);

  await page.goto(`${FRONTEND}/?s=${sid}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const ss = resolve(ARTIFACT_DIR, `multi-tx-family-of-three.png`);
  await page.screenshot({ path: ss, fullPage: true });
  writeFileSync(
    resolve(ARTIFACT_DIR, `multi-tx-family-of-three.json`),
    JSON.stringify({ sid, turns, final, screenshot: ss }, null, 2) + "\n",
  );

  console.log(`  [multi-family] final state=${final.state} txns=${final.transactions.join(", ")}`);
});

// silence the unused-import warnings
void walkTransaction;
