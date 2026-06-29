/**
 * Beta-tester feedback persistence via chat_messages table.
 *
 * Two write paths:
 *   - appendMessageFeedback: updates feedback_reaction/feedback_comment on an
 *     existing message row (matched by messageId in the content JSONB).
 *   - appendSessionFeedback: inserts a role='system' message with the feedback
 *     submission payload.
 */
import { getPool, getChatSession } from "@st-lucie/data-access";

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
  const pool = getPool();
  const session = await getChatSession(sessionId);
  if (!session) return;

  const pgReaction =
    payload.reaction === "good" ? "up" : payload.reaction === "bad" ? "down" : null;

  if (pgReaction) {
    await pool.query(
      `UPDATE chat_messages
       SET feedback_reaction = $1, feedback_comment = $2
       WHERE session_id = $3
         AND content->>'messageId' = $4
         AND role = 'assistant'`,
      [pgReaction, payload.comment ?? null, session.id, payload.messageId],
    );
  } else if (payload.reaction === "comment" && payload.comment) {
    await pool.query(
      `UPDATE chat_messages
       SET feedback_comment = $1
       WHERE session_id = $2
         AND content->>'messageId' = $3
         AND role = 'assistant'`,
      [payload.comment, session.id, payload.messageId],
    );
  }
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
  betaTesterEmail?: string;
}

export async function appendSessionFeedback(
  tenantId: string,
  sessionId: string,
  payload: SessionFeedbackPayload,
): Promise<{ submissionSk: string }> {
  const pool = getPool();
  const session = await getChatSession(sessionId);
  if (!session) return { submissionSk: "" };

  const submittedAt = new Date().toISOString();
  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content, state)
     VALUES ($1, 'system', $2, $3)`,
    [
      session.id,
      JSON.stringify({
        type: "feedback_submission",
        notes: payload.notes,
        messageFeedback: payload.messageFeedback,
        capturedAt: payload.capturedAt,
        stateSnapshot: payload.stateSnapshot,
        betaTesterEmail: payload.betaTesterEmail,
        submittedAt,
      }),
      session.state,
    ],
  );

  return { submissionSk: `FEEDBACK#SUBMISSION#${submittedAt}` };
}
