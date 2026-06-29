/**
 * Retrieve session state from DynamoDB.
 */

import type { Session } from "@st-lucie/shared-types";
import { getItem } from "@st-lucie/data-access";

export async function getSession(tenantId: string, sessionId: string): Promise<Session | null> {
  const item = await getItem(tenantId, "SESSION", sessionId, "METADATA");
  if (!item) return null;

  return {
    tenantId: item.tenantId as string,
    sessionId: item.sessionId as string,
    currentState: item.currentState as Session["currentState"],
    structuredContext: item.structuredContext as Session["structuredContext"],
    stateConversationTurns: (item.stateConversationTurns ||
      []) as Session["stateConversationTurns"],
    incompletePreWork: (item.incompletePreWork || false) as boolean,
    channel: (item.channel || "web") as Session["channel"],
    walkInLocationId: item.walkInLocationId as string | undefined,
    betaTesterEmail: item.betaTesterEmail as string | undefined,
    isTestSession: item.isTestSession as boolean | undefined,
    authIdAccountNumber: item.authIdAccountNumber as string | undefined,
    authIdOperationId: item.authIdOperationId as string | undefined,
    authIdProofResult: item.authIdProofResult as Session["authIdProofResult"],
    pendingAuthIdProof: item.pendingAuthIdProof as Session["pendingAuthIdProof"],
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    ttl: item.ttl as number | undefined,
  };
}
