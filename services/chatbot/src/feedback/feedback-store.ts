/**
 * Beta-tester feedback persistence.
 *
 * Two write paths:
 *   - appendMessageFeedback: a tester clicks Good / Bad / Comment under a
 *     specific assistant message. SK = FEEDBACK#MESSAGE#<messageId>#<reaction>.
 *   - appendSessionFeedback: a tester clicks "Submit Transcript" in the debug
 *     panel, sending freeform notes + a snapshot of all per-message reactions.
 *     SK = FEEDBACK#SUBMISSION#<ISO8601>.
 *
 * Mirrors raw-history.ts / debug-log.ts: same PK as the session, no PII TTL
 * (3-year retention to match the public-records artifacts they describe).
 */
import { buildPk, getDocClient, getTableName } from "@st-lucie/data-access";
import { PutCommand } from "@aws-sdk/lib-dynamodb";

export type MessageFeedbackReaction = "good" | "bad" | "comment";

export interface MessageFeedbackPayload {
  messageId: string;
  reaction: MessageFeedbackReaction;
  comment?: string;
}

export async function appendMessageFeedback(
  tenantId: string,
  sessionId: string,
  payload: MessageFeedbackPayload,
): Promise<void> {
  const client = getDocClient();
  const tableName = getTableName();
  const submittedAt = new Date().toISOString();

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: buildPk(tenantId, "SESSION", sessionId),
        SK: `FEEDBACK#MESSAGE#${payload.messageId}#${payload.reaction}`,
        entityType: "SESSION_FEEDBACK_MESSAGE",
        sessionId,
        messageId: payload.messageId,
        reaction: payload.reaction,
        comment: payload.comment ?? null,
        submittedAt,
      },
    }),
  );
}

export interface SessionFeedbackPayload {
  notes: string;
  messageFeedback: Record<
    string,
    {
      reaction?: "good" | "bad";
      comment?: string;
      submittedAt?: string;
    }
  >;
  capturedAt: string;
  stateSnapshot?: {
    state?: string;
    transactions?: unknown;
    factsCount?: number;
  };
  /**
   * Email of the tester who submitted this feedback. Sourced from the
   * session (which captured it at login). Persists into DDB for triage.
   */
  betaTesterEmail?: string;
}

export async function appendSessionFeedback(
  tenantId: string,
  sessionId: string,
  payload: SessionFeedbackPayload,
): Promise<{ submissionSk: string }> {
  const client = getDocClient();
  const tableName = getTableName();
  const submittedAt = new Date().toISOString();
  const sk = `FEEDBACK#SUBMISSION#${submittedAt}`;

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: buildPk(tenantId, "SESSION", sessionId),
        SK: sk,
        entityType: "SESSION_FEEDBACK_SUBMISSION",
        sessionId,
        notes: payload.notes ?? "",
        messageFeedback: payload.messageFeedback ?? {},
        capturedAt: payload.capturedAt,
        stateSnapshot: payload.stateSnapshot ?? {},
        submittedAt,
        ...(payload.betaTesterEmail ? { betaTesterEmail: payload.betaTesterEmail } : {}),
      },
    }),
  );

  return { submissionSk: sk };
}
