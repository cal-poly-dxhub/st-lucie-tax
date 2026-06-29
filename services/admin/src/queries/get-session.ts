/**
 * Fetch a session and all its messages from PostgreSQL.
 */

import { getChatSession, getChatMessages } from "@st-lucie/data-access";

export interface SessionDetail {
  metadata: Record<string, unknown> | null;
  history: HistoryEntry[];
  logs: LogEntry[];
  feedback: {
    perMessage: MessageFeedbackEntry[];
    submissions: SubmissionEntry[];
  };
  docs: DocEntry[];
}

export interface HistoryEntry {
  sk: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  messageId?: string;
}

export interface LogEntry {
  sk: string;
  timestamp: string;
  eventType: string;
  payload: unknown;
}

export interface MessageFeedbackEntry {
  sk: string;
  messageId: string;
  reaction: "good" | "bad" | "comment";
  comment?: string;
  submittedAt: string;
  resolvedMessageId?: string;
}

export interface SubmissionEntry {
  sk: string;
  capturedAt: string;
  notes?: string;
  messageFeedback?: Record<string, unknown>;
  stateSnapshot?: unknown;
}

export interface DocEntry {
  sk: string;
  documentType: string;
  status?: string;
  s3Key?: string;
  ocrResult?: unknown;
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const session = await getChatSession(sessionId);
  if (!session) return null;

  const messages = await getChatMessages(session.id);

  const detail: SessionDetail = {
    metadata: {
      sessionId: session.session_uuid,
      state: session.state,
      email: session.email,
      betaTesterEmail: session.email,
      structuredContext: session.structured_context,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      reviewed: session.reviewed_at !== null,
    },
    history: [],
    logs: [],
    feedback: { perMessage: [], submissions: [] },
    docs: [],
  };

  for (const msg of messages) {
    const content = msg.content as Record<string, unknown>;

    if (msg.role === "user" || msg.role === "assistant") {
      const entry: HistoryEntry = {
        sk: `HISTORY#${msg.created_at}#${msg.id}`,
        role: msg.role as "user" | "assistant",
        content: (content.text as string) ?? "",
        timestamp: msg.created_at,
        messageId: content.messageId as string | undefined,
      };
      detail.history.push(entry);

      if (msg.role === "assistant" && (msg.feedback_reaction || msg.feedback_comment)) {
        const reaction =
          msg.feedback_reaction === "up"
            ? "good"
            : msg.feedback_reaction === "down"
              ? "bad"
              : "comment";
        detail.feedback.perMessage.push({
          sk: `FEEDBACK#MESSAGE#${content.messageId ?? msg.id}#${reaction}`,
          messageId: (content.messageId as string) ?? String(msg.id),
          reaction,
          comment: msg.feedback_comment ?? undefined,
          submittedAt: msg.created_at,
        });
      }
    } else if (msg.role === "system") {
      if (content.type === "feedback_submission") {
        detail.feedback.submissions.push({
          sk: `FEEDBACK#SUBMISSION#${content.submittedAt ?? msg.created_at}`,
          capturedAt: (content.capturedAt as string) ?? msg.created_at,
          notes: content.notes as string | undefined,
          messageFeedback: content.messageFeedback as Record<string, unknown> | undefined,
          stateSnapshot: content.stateSnapshot,
        });
      } else if (content.eventType) {
        detail.logs.push({
          sk: `LOG#${content.timestamp ?? msg.created_at}#${content.eventType}`,
          timestamp: (content.timestamp as string) ?? msg.created_at,
          eventType: content.eventType as string,
          payload: content.payload,
        });
      }
    }
  }

  detail.history.sort((a, b) => a.sk.localeCompare(b.sk));
  detail.logs.sort((a, b) => a.sk.localeCompare(b.sk));

  return detail;
}
