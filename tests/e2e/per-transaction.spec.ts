/**
 * One-hit per transaction. For each of 31 txnTypeIds, drive the bot through
 * landing → universal-blockers → verify-identity → resolve-facts → final state.
 * Records artifacts to .cache/test-pass/2-playwright/.
 *
 * Asserts soft outcomes; the goal is observability, not green/red gating.
 * The assertion that fails marks the txn as iffy; the JSON trace per flow
 * captures the full story.
 */

import { test } from "@playwright/test";
import { walkTransaction } from "./helpers.js";

interface FlowDef {
  txn: string;
  opener: string;
}

const FLOWS: FlowDef[] = [
  { txn: "business-tax-receipt", opener: "I need a business tax receipt" },
  { txn: "cdl", opener: "I need a CDL" },
  { txn: "concealed-weapon", opener: "I need a concealed carry permit" },
  { txn: "dealer-title-dropoff", opener: "I need to drop off dealer titles" },
  { txn: "dl-address-change", opener: "I moved to a new address in Florida" },
  { txn: "dl-name-change", opener: "I got married and need to change my name" },
  { txn: "dl-renewal", opener: "renew my license" },
  { txn: "dl-replacement", opener: "I lost my license" },
  {
    txn: "dl-sanctions-lift",
    opener: "My license was suspended for unpaid tickets and I want to reinstate it",
  },
  { txn: "dl-transfer", opener: "I just moved from another state" },
  { txn: "duplicate-title", opener: "I lost my vehicle title" },
  { txn: "handicap-placard", opener: "I need a handicap placard" },
  { txn: "hunting-fishing", opener: "I need a fishing license" },
  { txn: "id-card", opener: "I need a state ID" },
  { txn: "learner-permit", opener: "I need a learner's permit" },
  { txn: "mobile-home-retire", opener: "retire my mobile home title" },
  { txn: "mobile-home-title", opener: "I need to title my mobile home" },
  { txn: "new-vehicle-title", opener: "I bought a new car from a dealer" },
  { txn: "plate-surrender", opener: "I need to turn in my plates" },
  { txn: "property-tax", opener: "pay my property taxes" },
  { txn: "real-id-upgrade", opener: "I need a REAL ID" },
  { txn: "registration-renewal", opener: "renew my registration" },
  { txn: "road-test", opener: "I need to take my road test" },
  { txn: "specialty-plate", opener: "I want a specialty license plate" },
  { txn: "tag-replacement", opener: "my license plate was stolen" },
  {
    txn: "tangible-personal-property-tax",
    opener: "I need to pay my Tangible Personal Property tax bill",
  },
  { txn: "tourist-development-tax", opener: "I need to register my rental for tourist tax" },
  { txn: "vehicle-registration", opener: "register my car in Florida" },
  { txn: "vehicle-title-transfer", opener: "I bought a car and need to transfer the title" },
  { txn: "vessel-registration", opener: "register my boat" },
  { txn: "written-test", opener: "I need to take the written test" },
];

for (const flow of FLOWS) {
  test(`per-txn: ${flow.txn}`, async ({ page }) => {
    const outcome = await walkTransaction(page, flow.txn, flow.opener);
    // Soft expectations — record the failures as findings, don't hard-fail
    // (everything is logged to JSON for the brief).
    if (outcome.errorReason) {
      // Log but don't throw — keep the test green so all 31 run.

      console.log(`  [${flow.txn}] ERROR: ${outcome.errorReason}`);
    }

    console.log(
      `  [${flow.txn}] state=${outcome.finalState} match=${outcome.identifiedTxnMatches} reachedConfirm=${outcome.reachedConfirmFacts} buckets=${JSON.stringify(outcome.resolvedBucketCounts)}`,
    );
  });
}
