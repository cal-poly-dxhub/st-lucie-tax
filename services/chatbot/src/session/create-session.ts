/**
 * Create a new conversation session in DynamoDB.
 */

import { randomUUID } from "crypto";
import type { Session } from "@st-lucie/shared-types";
import { buildPk, putItem, piiTtl } from "@st-lucie/data-access";
import { createEmptyContext } from "./structured-context.js";

export interface CreateSessionOptions {
  tenantId: string;
  channel: "web" | "walkin" | "sms";
  walkInLocationId?: string;
  /**
   * Beta-tester email captured from the auth token. Stored on the session so
   * (a) rehydrate can lock the session to its original creator,
   * (b) debug-log events and transcript artifacts can be tagged with who
   *     was driving when the issue occurred.
   */
  betaTesterEmail?: string;
  /**
   * Set true when the request that created this session was a Playwright
   * probe / curl smoke check / dev tool. The admin dashboard hides flagged
   * sessions by default. Real testers never set this — even if their
   * email pattern looks suspicious, no session is auto-flagged.
   */
  isTestSession?: boolean;
}

export async function createSession(options: CreateSessionOptions): Promise<Session> {
  const { tenantId, channel, walkInLocationId, betaTesterEmail, isTestSession } = options;
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  const session: Session = {
    tenantId,
    sessionId,
    currentState: "landing",
    structuredContext: createEmptyContext(),
    stateConversationTurns: [],
    incompletePreWork: false,
    channel,
    walkInLocationId,
    betaTesterEmail,
    authIdAccountNumber: betaTesterEmail ?? `dev-${sessionId}`,
    ...(isTestSession ? { isTestSession: true } : {}),
    createdAt: now,
    updatedAt: now,
    ttl: piiTtl(),
  };

  await putItem(tenantId, {
    PK: buildPk(tenantId, "SESSION", sessionId),
    SK: "METADATA",
    entityType: "SESSION",
    ...session,
  });

  return session;
}
