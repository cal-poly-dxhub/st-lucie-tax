/**
 * Tools for the universal-blockers state.
 *
 * The universal-blockers state is a tiny pre-identity screener that catches
 * transaction-independent showstoppers before we invest minutes of fact
 * gathering.
 *
 * The tool schema is BUILT PER SESSION:
 *   - Q1 (driver-license suspension) is included ONLY when at least one
 *     active transaction is DL-family. Otherwise the LLM never sees the
 *     `licenseSuspended` field — no risk of it being asked.
 *   - Q3 (photo ID) is always required — every in-office service needs it.
 *
 * Q2 (physical presence in Florida) was removed on 2026-05-19: it was a
 * conditional warning, not a hard block; misleading for online-eligible
 * transactions, non-resident property owners, and out-of-state placard
 * applicants.
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session, BlockingInfo } from "@st-lucie/shared-types";
import { applyHardBlockToTransaction } from "../resolve-facts/tools.js";
import {
  isDlFamilyTransaction,
  sessionHasDlFamilyTxn,
  isNoLicenseToScanTransaction,
  sessionHasNoLicenseToScan,
} from "./family.js";

/**
 * Build the universal-blockers tool list scoped to a particular session.
 * When no active txn is DL-family, the licenseSuspended input is omitted
 * from the schema entirely so the LLM cannot ask about it.
 */
export function buildUniversalBlockersTools(session: Session): Tool[] {
  // The two eligibility questions are each included only when meaningful:
  //  - licenseSuspended: only when an active txn is DL-family (an existing
  //    license could be suspended).
  //  - hasAnyId: only when NOT every active txn is a first-time-issuance type.
  //    First-time applicants (learner-permit, written-test, road-test, id-card)
  //    have no photo ID and prove identity with breeder documents, so asking
  //    "do you have a photo ID?" is nonsensical and the block must not fire.
  const askLicense = sessionHasDlFamilyTxn(session);
  const askPhotoId = !sessionHasNoLicenseToScan(session);

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (askLicense) {
    properties.licenseSuspended = {
      type: "string",
      description:
        "yes if the customer's FL (or any) driver license is currently suspended, revoked, or cancelled; no otherwise. If the customer genuinely cannot say after a couple of tries, submit \"no\" (non-blocking — the counter will verify) per the prompt's clarification cap.",
      enum: ["yes", "no"],
    };
    required.push("licenseSuspended");
  }
  if (askPhotoId) {
    properties.hasAnyId = {
      type: "string",
      description:
        'yes if the customer has at least one form of government-issued photo ID (current or expired DL, passport, state ID card); no otherwise. If the customer genuinely cannot say after a couple of tries, submit "yes" (non-blocking) per the prompt\'s clarification cap.',
      enum: ["yes", "no"],
    };
    required.push("hasAnyId");
  }

  const fields =
    required.length === 2
      ? "license suspension, photo ID possession"
      : askLicense
        ? "license suspension"
        : "photo ID possession";

  return [
    {
      toolSpec: {
        name: "record_universal_blockers",
        description: `Record the universal blocker answer(s) (${fields}). This tool blocks affected transactions and advances past the universal-blockers state.`,
        inputSchema: {
          // The AWS ToolInputSchema `json` member is the opaque __DocumentType__;
          // a dynamically-built {type,properties,required} object is the correct
          // JSON-schema shape but doesn't match that nominal type, so cast it.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          json: { type: "object", properties, required } as any,
        },
      },
    },
  ];
}

export interface UniversalBlockersToolResult {
  content: ToolResultContentBlock[];
  shouldAdvance?: boolean;
  [key: string]: unknown;
}

export async function handleUniversalBlockersTool(
  toolName: string,
  input: Record<string, unknown>,
  session: Session,
): Promise<UniversalBlockersToolResult> {
  if (toolName !== "record_universal_blockers") {
    return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }

  const askLicense = sessionHasDlFamilyTxn(session);
  // When the LLM didn't have access to the licenseSuspended field, treat as
  // "no" deterministically. When it did, normalize whatever it sent.
  // The enum is yes/no only ("not sure" was removed). The blocking checks below
  // fire ONLY on an explicit "yes" (suspension) or "no" (photo ID), so any
  // unexpected value falls to the non-blocking side — eligibility never stalls
  // and never wrongly blocks; the counter verifies at the visit.
  const licenseSuspended = askLicense ? String(input.licenseSuspended ?? "").toLowerCase() : "no";
  // When the photo-ID question was suppressed (every active txn is first-time
  // issuance), the LLM never sees hasAnyId — treat as "yes" deterministically
  // so the no-photo-id block can't fire. The per-txn guard below is the real
  // safeguard, but this keeps the intent explicit and the answers payload clean.
  const askPhotoId = !sessionHasNoLicenseToScan(session);
  const hasAnyId = askPhotoId ? String(input.hasAnyId ?? "").toLowerCase() : "yes";

  const blocksApplied: Array<{ txnTypeId: string; reason: string }> = [];

  for (const txn of session.structuredContext.transactions) {
    if (txn.status !== "active") continue;

    // Q1: suspended license hard-blocks every DL-family transaction.
    if (licenseSuspended === "yes" && isDlFamilyTransaction(txn.txnTypeId)) {
      const blocking: BlockingInfo = {
        severity: "hard",
        reason: "suspended-license",
        customerMessage:
          "Your driver license is currently suspended, revoked, or cancelled. We cannot process driver-license transactions until the underlying issue is resolved and FLHSMV has been notified electronically.",
        nextSteps:
          "Visit flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/ to identify the suspension reason and the agency that must clear it (traffic court, FL Department of Revenue, insurance carrier, etc.). Come back once the clearance has been processed.",
        sourceRefs: [
          "https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-suspensions-revocations/",
        ],
        origin: "universal-blockers",
      };
      applyHardBlockToTransaction(txn, blocking);
      blocksApplied.push({ txnTypeId: txn.txnTypeId, reason: blocking.reason });
      continue;
    }

    // Q3: no photo ID hard-blocks transactions that REQUIRE an existing
    // credential. It does NOT block first-time-issuance transactions
    // (learner-permit, written-test, road-test, id-card): per FLHSMV policy
    // (IR15.4, CI03.4.1, IR09.3) a first-time applicant legitimately has no
    // photo ID and establishes identity with REAL ID "breeder" documents
    // (birth certificate / passport, SSN proof, address proof) — which those
    // decision trees already output. Blocking them was telling someone applying
    // for their FIRST ID to "go get a state ID first" (circular). See beta
    // session 5c99af4c.
    if (hasAnyId === "no" && !isNoLicenseToScanTransaction(txn.txnTypeId)) {
      const blocking: BlockingInfo = {
        severity: "hard",
        reason: "no-photo-id",
        customerMessage:
          "All in-office services require at least one form of government-issued photo ID. Without any identity document, we cannot process the transaction.",
        nextSteps:
          "Bring a current or expired driver license, passport, or state ID card with you when you visit. If you have none of these, start with a birth certificate and apply for an ID card.",
        origin: "universal-blockers",
      };
      applyHardBlockToTransaction(txn, blocking);
      blocksApplied.push({ txnTypeId: txn.txnTypeId, reason: blocking.reason });
      continue;
    }
  }

  return {
    content: [
      {
        text: JSON.stringify({
          status: "recorded",
          answers: {
            ...(askLicense ? { licenseSuspended } : {}),
            ...(askPhotoId ? { hasAnyId } : {}),
          },
          hardBlocks: blocksApplied,
          guidance:
            blocksApplied.length > 0
              ? "One or more transactions have been blocked. Acknowledge each to the customer using the customerMessage + nextSteps already shown in the side panel, then proceed."
              : "No universal blockers fired. Advancing to identity verification.",
        }),
      },
    ],
    shouldAdvance: true,
  };
}
