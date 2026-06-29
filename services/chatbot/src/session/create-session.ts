/**
 * Create a new conversation session in PostgreSQL.
 */

import type { Session } from "@st-lucie/shared-types";
import { createChatSession } from "@st-lucie/data-access";
import { createEmptyContext } from "./structured-context.js";

export interface CreateSessionOptions {
  tenantId: string;
  channel: "web" | "walkin" | "sms";
  walkInLocationId?: string;
  betaTesterEmail?: string;
  isTestSession?: boolean;
}

export async function createSession(options: CreateSessionOptions): Promise<Session> {
  const { tenantId, channel, walkInLocationId, betaTesterEmail, isTestSession } = options;

  const structuredContext = createEmptyContext();

  const row = await createChatSession({
    email: betaTesterEmail,
    state: "landing",
    structuredContext: {
      ...structuredContext,
      _meta: {
        tenantId,
        channel,
        walkInLocationId,
        isTestSession: isTestSession || undefined,
        stateConversationTurns: [],
        incompletePreWork: false,
        authIdAccountNumber: betaTesterEmail ?? `dev-${Date.now()}`,
      },
    },
  });

  return {
    tenantId,
    sessionId: row.session_uuid,
    currentState: "landing",
    structuredContext,
    stateConversationTurns: [],
    incompletePreWork: false,
    channel,
    walkInLocationId,
    betaTesterEmail,
    authIdAccountNumber: betaTesterEmail ?? `dev-${row.session_uuid}`,
    ...(isTestSession ? { isTestSession: true } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
