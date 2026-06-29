/**
 * Retrieve session state from PostgreSQL.
 */

import type { Session } from "@st-lucie/shared-types";
import { getChatSession } from "@st-lucie/data-access";

export async function getSession(tenantId: string, sessionId: string): Promise<Session | null> {
  const row = await getChatSession(sessionId);
  if (!row) return null;

  const ctx = row.structured_context as Record<string, unknown>;
  const meta = (ctx._meta ?? {}) as Record<string, unknown>;

  return {
    tenantId: (meta.tenantId as string) ?? tenantId,
    sessionId: row.session_uuid,
    currentState: row.state as Session["currentState"],
    structuredContext: stripMeta(ctx) as unknown as Session["structuredContext"],
    stateConversationTurns: ((meta.stateConversationTurns as unknown[]) ??
      []) as Session["stateConversationTurns"],
    incompletePreWork: (meta.incompletePreWork as boolean) ?? false,
    channel: ((meta.channel as string) ?? "web") as Session["channel"],
    walkInLocationId: meta.walkInLocationId as string | undefined,
    betaTesterEmail: row.email ?? (meta.betaTesterEmail as string | undefined),
    isTestSession: meta.isTestSession as boolean | undefined,
    authIdAccountNumber: meta.authIdAccountNumber as string | undefined,
    authIdOperationId: meta.authIdOperationId as string | undefined,
    authIdProofResult: meta.authIdProofResult as Session["authIdProofResult"],
    pendingAuthIdProof: meta.pendingAuthIdProof as Session["pendingAuthIdProof"],
    reviewed: row.reviewed_at !== null ? true : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stripMeta(ctx: Record<string, unknown>): Record<string, unknown> {
  const out = { ...ctx };
  delete out._meta;
  return out;
}
