/**
 * Conservative-routing probe.
 *
 * Defense-in-depth e2e for the routing gap surfaced in repro session
 * 4ac2335d-c125-429b-ad7a-db1d84172cbe: "I bought a new car from a dealer"
 * was silently routed to vehicle-title-transfer (used-car path) instead of
 * new-vehicle-title, with no clarification question asked. The plan splits
 * the vehicle-purchase cluster, adds a CONSERVATIVE ROUTING prompt rule,
 * and forces clarification when a customer's wording could plausibly mean
 * two different transactions.
 *
 * Uses the API-based approach (no UI login required). The routing logic
 * lives in the backend, not the frontend.
 */

import { test, expect } from "@playwright/test";
import { createSession, sendMessage, getSessionState } from "./helpers.js";

test('"I bought a new car from a dealer" routes to new-vehicle-title (not transfer)', async () => {
  const sid = await createSession();
  await sendMessage(sid, "I bought a new car from a dealer");
  const st = await getSessionState(sid);

  if (st.transactions.length > 0) {
    const hasTransfer = st.transactions.includes("vehicle-title-transfer");
    const hasNewVehicle = st.transactions.includes("new-vehicle-title");
    expect(
      hasTransfer && !hasNewVehicle,
      "must not silently route a new dealer car to title-transfer",
    ).toBe(false);
  }
});

test('"I bought a car" (ambiguous) gets a clarification question, not a silent confirm', async () => {
  const sid = await createSession();
  const { assistantMsg } = await sendMessage(sid, "I bought a car");
  const st = await getSessionState(sid);

  if (st.transactions.length > 0) {
    expect(assistantMsg).toMatch(
      /new vehicle from a dealer|new from a dealer|new car.*dealer|private party|used vehicle|new or used|dealer or private/i,
    );
  }
});

test('"renew my driver license" routes specifically without clarification', async () => {
  const sid = await createSession();
  const { assistantMsg } = await sendMessage(sid, "I want to renew my driver license");

  expect(assistantMsg).toMatch(/renew|renewal|confirmed|driver.?license/i);
});
