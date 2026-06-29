/**
 * Load transaction-type-specific system prompt.
 *
 * Falls back to default prompts (no DB override in the Postgres schema).
 */

import type { ConversationState } from "@st-lucie/shared-types";
import { DEFAULT_PROMPTS, universalBlockersPrompt } from "./default-prompts.js";
import { buildContextSummary } from "../session/structured-context.js";
import type { Session } from "@st-lucie/shared-types";
import { loadFactDefinitions } from "../data-loaders/fact-definitions.js";
import { getDecisionTree } from "../data-loaders/decision-trees.js";
import {
  sessionHasDlFamilyTxn,
  sessionHasNoLicenseToScan,
} from "../tools/universal-blockers/family.js";

export interface BuildSystemPromptOptions {
  /**
   * When set (truthy fingerprint), the loop-guard detected the bot has asked
   * essentially the same question 2+ times in a row in the current state.
   * Inject a one-shot remediation note instructing the LLM to acknowledge
   * the customer's volunteered info, capture any other extractable facts,
   * and re-ask differently or accept "unknown" — never repeat verbatim.
   */
  stuckOnQuestion?: string | null;

  /**
   * When set, the input-scrub layer removed a sensitive number (SSN / card /
   * bank) from the user's message this turn. The note instructs the bot to
   * briefly reassure the user it never needs such numbers, then continue.
   * See middleware/input-scrub.ts:scrubNoticeForPrompt.
   */
  scrubNotice?: string | null;
}

/**
 * Build the full system prompt for a Bedrock call.
 * Combines: state-specific prompt + structured context summary
 */
export async function buildSystemPrompt(
  session: Session,
  options: BuildSystemPromptOptions = {},
): Promise<string> {
  let statePrompt = await loadStatePrompt(session.tenantId, session.currentState);

  // Universal-blockers prompt is built per-session: Q1 (license suspension)
  // only applies when an active txn is DL-family, and the photo-ID question is
  // dropped when every active txn is a first-time-issuance type (no photo ID
  // expected). When a tenant has overridden the prompt in DynamoDB, that
  // override is used verbatim — operators can encode their own logic if needed.
  if (
    session.currentState === "universal-blockers" &&
    statePrompt === DEFAULT_PROMPTS["universal-blockers"]
  ) {
    statePrompt = universalBlockersPrompt(
      sessionHasDlFamilyTxn(session),
      !sessionHasNoLicenseToScan(session),
    );
  }

  const contextSummary = buildContextSummary(session.structuredContext);

  // Global formatting rules applied to every state
  const formatting = `FORMATTING RULES (apply to all responses):
- Use **bold** for emphasis and section labels, NOT ## markdown headings.
- For lists of options the customer must pick from, use a numbered list ("1.", "2.", "3."), one option per line. Never put two options on the same line.
- For lists of facts or items (not multiple-choice), use - dashes, one item per line.
- Always insert a blank line between the introductory prose and the first list item so the list renders correctly.
- Keep responses concise and conversational.

CONTACT INFO (never invent it):
- NEVER make up a phone number, email, address, fax, or URL. Inventing contact details for a government office is a serious error — a customer could call a wrong or fraudulent number.
- The ONLY St. Lucie County Tax Collector phone number you may give is the main line: **772-462-1650**. If a customer needs to call the office (e.g. a complex eligibility situation, or scheduling isn't available online), give that number.
- For other agencies (FLHSMV, the Clerk of Court, the Property Appraiser, FDOR, FWC, etc.), only provide a phone number or URL if it appears verbatim in a tool result (e.g. a knowledge-base answer or a document/item note). If you don't have it, say so and direct the customer to the main Tax Collector line above rather than guessing.`;

  const parts = [formatting, statePrompt];
  if (contextSummary) {
    parts.push(contextSummary);
  }

  // resolve-facts state: inject value-label maps so the LLM's prose options
  // match the quick-reply chips the customer will click. Without this, the
  // bot might say "current-year vs past due" but chips render as "Yes/No".
  if (session.currentState === "resolve-facts") {
    const labelGuide = buildValueLabelGuide(session);
    if (labelGuide) parts.push(labelGuide);
  }

  // Loop-guard remediation: fires when the bot has asked essentially the
  // same question 2+ times in a row. The soft remediation nudges the bot
  // to acknowledge volunteered information before re-asking — preserves
  // conversation quality even on legitimate single-re-ask cases.
  if (options.stuckOnQuestion) {
    parts.push(`--- LOOP-GUARD WARNING ---
You have asked essentially the same question 2+ times in a row in this state. The customer is not answering it directly. Possible causes: question is unclear, the answer they gave was rejected as not-on-the-allowed-list, or they are trying to volunteer related information first.

DO NOT repeat the question a third time verbatim. Instead, on this turn:
1. Briefly acknowledge what the customer DID say in 1 sentence (e.g., "Got it — I've noted X").
2. Call record_facts to capture EVERY fact the customer volunteered, including off-topic ones — if they said anything that maps to ANY known factKey, record it now. Do not filter for "relevant to current question."
3. Re-ask differently: rephrase, give concrete examples of acceptable answers, or accept "unknown" / "not sure" as an answer and move on.

Never punish the customer for off-topic answers. Always advance the conversation.
--- END LOOP-GUARD WARNING ---`);
  }

  // Input-scrub notice: a sensitive number (SSN/card/bank) was stripped from the
  // user's message before it reached the model. Tell the bot to reassure, not re-ask.
  if (options.scrubNotice) {
    parts.push(
      `--- SENSITIVE INPUT REMOVED ---\n${options.scrubNotice}\n--- END SENSITIVE INPUT REMOVED ---`,
    );
  }

  return parts.join("\n\n");
}

/**
 * Build a "use these phrases verbatim" guide for the LLM. Lists every fact
 * relevant to active transactions that has authored valueLabels, with the
 * exact label text the chips will display. Empty string when no relevant
 * fact has labels (the prompt section is skipped entirely).
 */
function buildValueLabelGuide(session: Session): string {
  const activeIds = session.structuredContext.transactions
    .filter((t) => t.status === "active")
    .map((t) => t.txnTypeId);
  if (activeIds.length === 0) return "";

  const requiredKeys = new Set<string>();
  for (const id of activeIds) {
    const tree = getDecisionTree(id);
    if (!tree) continue;
    for (const fk of tree.factsRequired) requiredKeys.add(fk);
    for (const branch of tree.branches) {
      for (const fk of Object.keys(branch.when)) requiredKeys.add(fk);
    }
  }

  const defsByKey = new Map(loadFactDefinitions().map((d) => [d.factKey, d]));
  const lines: string[] = [];
  for (const fk of requiredKeys) {
    const def = defsByKey.get(fk);
    if (!def?.valueLabels) continue;
    const items = Object.entries(def.valueLabels).map(([v, label]) => `    "${label}" → ${v}`);
    if (items.length === 0) continue;
    lines.push(`  ${fk} — when listing options, use these exact phrases:\n${items.join("\n")}`);
  }
  if (lines.length === 0) return "";

  return `--- QUICK-REPLY CHIP LABELS ---
The customer will see clickable buttons rendered from authored labels for each fact below. When you ask one of these questions, your numbered options MUST use the exact label text shown — the customer's click sends that label back to you, so paraphrasing breaks the matching.

${lines.join("\n\n")}
--- END CHIP LABELS ---`;
}

async function loadStatePrompt(_tenantId: string, state: ConversationState): Promise<string> {
  return DEFAULT_PROMPTS[state];
}
