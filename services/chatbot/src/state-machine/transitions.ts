/**
 * State transition logic.
 */

import type { ConversationState, Session } from "@st-lucie/shared-types";
import { getNextState, isTerminal } from "./states.js";
import { getDecisionTree } from "../data-loaders/decision-trees.js";
import { anyDocumentIsUploadable } from "../tools/upload-docs/classify.js";
import {
  sessionHasNoLicenseToScan,
  sessionHasDlFamilyTxn,
} from "../tools/universal-blockers/family.js";

export interface StateTransitionResult {
  previousState: ConversationState;
  newState: ConversationState;
  turnsReset: boolean;
}

/**
 * Advance the state machine to the next state.
 * Resets conversation turns per spec: "Turns reset at each state transition."
 */
export function advanceState(session: Session): StateTransitionResult {
  if (isTerminal(session.currentState)) {
    throw new Error(`Cannot advance from terminal state: ${session.currentState}`);
  }

  const nextState = getNextState(session.currentState);
  if (!nextState) {
    throw new Error(`No next state after: ${session.currentState}`);
  }

  const previousState = session.currentState;
  session.currentState = nextState;
  session.stateConversationTurns = []; // Reset turns at state boundary
  session.updatedAt = new Date().toISOString();

  return {
    previousState,
    newState: nextState,
    turnsReset: true,
  };
}

/**
 * Check if the session should auto-advance based on current state conditions.
 * Some states are pass-through if conditions are already met.
 */
export function shouldAutoAdvance(session: Session): boolean {
  const state = session.currentState;
  const ctx = session.structuredContext;

  switch (state) {
    case "universal-blockers": {
      // Skip the eligibility screen when it has NO question to ask: neither the
      // suspension question (no DL-family txn) nor the photo-ID question (every
      // active txn is first-time issuance, where a photo ID isn't expected).
      // Without this, a learner-permit-only / id-card-only session would sit in
      // an empty eligibility state with nothing to ask.
      const active = ctx.transactions.filter((t) => t.status === "active");
      if (active.length === 0) return false;
      return !sessionHasDlFamilyTxn(session) && sessionHasNoLicenseToScan(session);
    }
    case "confirm-facts": {
      // Never auto-advances. The user must explicitly confirm their facts via
      // POST /chatbot/sessions/:id/confirm-facts before we move on.
      return false;
    }
    case "resolve-facts": {
      // If every transaction is blocked, there is nothing more to resolve —
      // but we should NOT advance to upload-docs / scheduling either, because
      // the customer still needs to see the blocker message and react. Stay
      // put; the customer can either resolve the blocker (which restores
      // status='active') or describe a different intent.
      const allBlocked =
        ctx.transactions.length > 0 && ctx.transactions.every((t) => t.status === "blocked");
      if (allBlocked) return false;
      // If none of the active transactions have a decision tree yet,
      // skip past this state rather than blocking on a no-op.
      const active = ctx.transactions.filter((t) => t.status === "active");
      if (active.length === 0) return true;
      return active.every((t) => !getDecisionTree(t.txnTypeId));
    }
    case "upload-docs": {
      // Skip this state if there is nothing the customer could act on here.
      // That covers two cases:
      //   1. No pending docs at all.
      //   2. Every pending doc is bring-in / form — i.e. no optional_upload,
      //      so sitting in upload-docs would only let them press "Skip".
      const requiredDocs = ctx.documents.filter((d) => d.status === "pending");
      if (requiredDocs.length === 0) return true;
      return !anyDocumentIsUploadable(session);
    }
    case "verify-identity": {
      // Skip AuthID identity verification when there is no driver license to
      // scan — every active transaction is a first-time / non-driver type
      // (learner-permit, written-test, road-test, id-card). AuthID Proof
      // captures a DL + selfie, which these applicants don't have; pushing them
      // into a "scan your driver license" step is nonsensical. Per FLHSMV
      // policy these prove identity with a birth certificate / passport / SSN.
      return sessionHasNoLicenseToScan(session);
    }
    case "checkout-check": {
      // This state is always handled by the conversation engine
      // It auto-advances if no eligible transactions
      return false;
    }
    default:
      return false;
  }
}
