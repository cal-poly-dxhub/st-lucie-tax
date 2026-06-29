/**
 * Persist session state changes to PostgreSQL.
 */

import type { Session } from "@st-lucie/shared-types";
import { updateChatSession } from "@st-lucie/data-access";

export async function updateSession(session: Session): Promise<void> {
  session.updatedAt = new Date().toISOString();

  const structuredContext: Record<string, unknown> = {
    ...session.structuredContext,
    _meta: {
      tenantId: session.tenantId,
      channel: session.channel,
      walkInLocationId: session.walkInLocationId,
      isTestSession: session.isTestSession,
      stateConversationTurns: session.stateConversationTurns,
      incompletePreWork: session.incompletePreWork,
      authIdAccountNumber: session.authIdAccountNumber,
      authIdOperationId: session.authIdOperationId,
      authIdProofResult: session.authIdProofResult,
      pendingAuthIdProof: session.pendingAuthIdProof,
      betaTesterEmail: session.betaTesterEmail,
    },
  };

  await updateChatSession(session.sessionId, {
    state: session.currentState,
    structuredContext,
    email: session.betaTesterEmail,
  });
}
