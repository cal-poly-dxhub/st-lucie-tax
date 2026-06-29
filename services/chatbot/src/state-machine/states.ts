/**
 * State machine states and metadata.
 *
 * Flow: landing -> identify-transaction -> universal-blockers -> resolve-facts
 *       -> verify-identity -> confirm-facts -> upload-docs -> checkout-check
 *       -> schedule
 *
 * verify-identity sits AFTER resolve-facts so AuthID's official DL data can
 * overwrite self-reported answers before the confirm-facts review.
 *
 * Pre-screen was removed from the web flow on 2026-05-05: every transaction now
 * has a decision tree, so fact-gated resolution produces the same (and better)
 * readiness guarantee the legacy pre-screen path offered, and cross-cutting
 * blockers are caught earlier by universal-blockers. The `pre-screen` literal
 * remains in the ConversationState enum because the SMS walk-in endpoints
 * (local-server.ts /api/chatbot/prescreening + /chatbot/prescreening) still
 * reference it — those are TBD on whether they ship.
 *
 * Scheduling is the terminal state in the current prototype — booking isn't
 * wired up yet, so `schedule` just presents a closing message. The `confirm`
 * state is kept in the enum for future use but is unreachable.
 */

import type { ConversationState } from "@st-lucie/shared-types";

export interface StateMetadata {
  name: ConversationState;
  order: number;
  skippable: boolean;
  description: string;
  /**
   * If true, when the state machine advances INTO this state mid-turn,
   * process-message will run an additional Bedrock round under this state's
   * prompt before responding to the user. The two assistant messages get
   * concatenated so the customer sees one coherent reply that includes the
   * confirmation from the prior state AND the opening question of this one.
   * Use sparingly — only for states that exist primarily to ask one question.
   */
  autoGreet?: boolean;
}

export const STATE_FLOW: StateMetadata[] = [
  {
    name: "landing",
    order: 0,
    skippable: false,
    description: "Show hot buttons, accept first message",
  },
  {
    name: "identify-transaction",
    order: 1,
    skippable: false,
    description: "Identify transaction type(s) via Bedrock NLP",
  },
  {
    name: "universal-blockers",
    order: 1.5,
    skippable: false,
    description: "Cross-transaction eligibility screen — suspension, FL presence, photo ID",
    autoGreet: true,
  },
  // autoGreet so the first tree question is asked immediately on entry from
  // universal-blockers (previously resolve-facts was entered via the AuthID
  // side-channel routes, which greeted it explicitly; now it's an in-band
  // transition and needs the flag, or the customer is stranded after the
  // eligibility check with no question).
  {
    name: "resolve-facts",
    order: 3,
    skippable: false,
    description:
      "Fact-gated decision-tree resolution — ask each unresolved factKey, then emit the three-bucket item list",
    autoGreet: true,
  },
  // verify-identity runs AFTER the tree questions (order 3.5) so AuthID's
  // official DL data (DOB-derived facts) can overwrite self-reported answers,
  // with any resulting conflict reconciled in the confirm-facts review.
  {
    name: "verify-identity",
    order: 3.5,
    skippable: false,
    description: "AuthID Proof (DL + selfie + liveness)",
    autoGreet: true,
  },
  {
    name: "confirm-facts",
    order: 4,
    skippable: false,
    description: "User reviews + edits collected facts before proceeding; can request email copy",
  },
  {
    name: "upload-docs",
    order: 5,
    skippable: true,
    description: "Supporting document uploads with AI validation",
  },
  {
    name: "checkout-check",
    order: 7,
    skippable: false,
    description: "Check online checkout eligibility",
  },
  {
    name: "schedule",
    order: 8,
    skippable: false,
    description: "Appointment scheduling",
    autoGreet: true,
  },
  { name: "confirm", order: 9, skippable: false, description: "Confirmation with QR code" },
];

export function getStateMetadata(state: ConversationState): StateMetadata {
  const meta = STATE_FLOW.find((s) => s.name === state);
  if (!meta) throw new Error(`Unknown state: ${state}`);
  return meta;
}

export function getNextState(current: ConversationState): ConversationState | null {
  const meta = getStateMetadata(current);
  // Next state = smallest strictly-greater order. Using `>` rather than
  // `order + 1` accommodates fractional orders (e.g. `1.5` for
  // `universal-blockers` inserted between integer slots).
  const next = [...STATE_FLOW]
    .filter((s) => s.order > meta.order)
    .sort((a, b) => a.order - b.order)[0];
  return next?.name ?? null;
}

export function isSkippable(state: ConversationState): boolean {
  return getStateMetadata(state).skippable;
}

export function isTerminal(state: ConversationState): boolean {
  return state === "schedule" || state === "confirm";
}
