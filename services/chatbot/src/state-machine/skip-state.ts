/**
 * State bypass for optional states.
 *
 * Skippable states: upload-docs. (pre-screen was retired from the web flow on
 * 2026-05-05; its warning string is kept below for the dormant SMS path.)
 * Skipping warns the customer and flags the appointment as "incomplete pre-work"
 */

import type { Session, ConversationState } from "@st-lucie/shared-types";
import { isSkippable } from "./states.js";
import { advanceState, type StateTransitionResult } from "./transitions.js";

export interface SkipResult extends StateTransitionResult {
  warning: string;
}

export function skipState(session: Session, stateName: ConversationState): SkipResult {
  if (session.currentState !== stateName) {
    throw new Error(`Cannot skip state ${stateName} — current state is ${session.currentState}`);
  }

  if (!isSkippable(stateName)) {
    throw new Error(`State ${stateName} is not skippable. Only upload-docs can be skipped.`);
  }

  // Flag as incomplete pre-work per spec
  session.incompletePreWork = true;

  // Mark any pending documents as skipped
  if (stateName === "upload-docs") {
    for (const doc of session.structuredContext.documents) {
      if (doc.status === "pending") {
        doc.status = "skipped";
      }
    }
  }

  const transition = advanceState(session);

  const warnings: Record<string, string> = {
    "upload-docs":
      "Skipping document upload will increase your time at the office. The clerk will need to collect documents when you arrive.",
    "pre-screen":
      "Skipping pre-screening means the clerk will need to complete the screening with you at the office, which may increase your wait time.",
  };

  return {
    ...transition,
    warning: warnings[stateName] || "This step has been skipped.",
  };
}
