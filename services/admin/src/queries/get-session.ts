/**
 * Fetch every item in a session's partition and bucket by SK prefix.
 *
 * One DynamoDB Query under the session's PK returns metadata, history, logs,
 * feedback (per-message + submissions), and document records in a single
 * round-trip. The admin SPA renders these as tabs alongside the transcript.
 */

import { query } from "@st-lucie/data-access";

const TENANT_ID = process.env.TENANT_ID || "stlucie";

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
  /**
   * Best-effort fallback key for OLD sessions whose HISTORY rows predate
   * messageId. Set to the matched assistant message's `sk`. Absent when the
   * exact messageId join already works (new sessions). See getSessionDetail.
   */
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
  const items = await query(TENANT_ID, "SESSION", sessionId);
  if (items.length === 0) return null;

  const detail: SessionDetail = {
    metadata: null,
    history: [],
    logs: [],
    feedback: { perMessage: [], submissions: [] },
    docs: [],
  };

  for (const it of items) {
    const sk = String(it.SK ?? "");
    if (sk === "METADATA") {
      detail.metadata = it as Record<string, unknown>;
    } else if (sk.startsWith("HISTORY#")) {
      detail.history.push({
        sk,
        role: (it.role as "user" | "assistant") ?? "assistant",
        content: String(it.content ?? ""),
        timestamp: String(it.timestamp ?? sk.slice("HISTORY#".length)),
        messageId: typeof it.messageId === "string" ? it.messageId : undefined,
      });
    } else if (sk.startsWith("LOG#")) {
      detail.logs.push({
        sk,
        timestamp: String(it.timestamp ?? ""),
        eventType: String(it.eventType ?? ""),
        payload: it.payload,
      });
    } else if (sk.startsWith("FEEDBACK#MESSAGE#")) {
      // SK shape: FEEDBACK#MESSAGE#<messageId>#<reaction>
      const parts = sk.split("#");
      const messageId = parts[2] ?? "";
      const reaction = (parts[3] as "good" | "bad" | "comment") ?? "comment";
      detail.feedback.perMessage.push({
        sk,
        messageId,
        reaction,
        comment: typeof it.comment === "string" ? it.comment : undefined,
        submittedAt: String(it.submittedAt ?? ""),
      });
    } else if (sk.startsWith("FEEDBACK#SUBMISSION#")) {
      detail.feedback.submissions.push({
        sk,
        capturedAt: String(it.capturedAt ?? sk.slice("FEEDBACK#SUBMISSION#".length)),
        notes: typeof it.notes === "string" ? it.notes : undefined,
        messageFeedback: it.messageFeedback as Record<string, unknown> | undefined,
        stateSnapshot: it.stateSnapshot,
      });
    } else if (sk.startsWith("DOC#")) {
      detail.docs.push({
        sk,
        documentType:
          typeof it.documentType === "string" ? it.documentType : sk.slice("DOC#".length),
        status: typeof it.status === "string" ? it.status : undefined,
        s3Key: typeof it.s3Key === "string" ? it.s3Key : undefined,
        ocrResult: it.ocrResult,
      });
    }
  }

  detail.history.sort((a, b) => a.sk.localeCompare(b.sk));
  detail.logs.sort((a, b) => a.sk.localeCompare(b.sk));
  detail.feedback.perMessage.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  detail.feedback.submissions.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  // Correlate feedback to transcript messages.
  //
  // New sessions: the HISTORY row carries the same messageId the feedback was
  // keyed on, so the frontend join (feedbackByMessage.get(history.messageId))
  // works directly — nothing to do here.
  //
  // Old sessions (pre-messageId): HISTORY rows have no messageId, so the join
  // would miss. As a best-effort fallback we attach each such feedback row to
  // the nearest assistant message whose timestamp is at-or-before the
  // feedback's submittedAt, and stamp that message's synthetic key onto the
  // feedback as `resolvedMessageId`. The frontend prefers messageId and falls
  // back to resolvedMessageId. Heuristic — can mis-attribute when reactions
  // cluster in time — but far better than dumping everything in a side list.
  const historyMessageIds = new Set(
    detail.history.filter((h) => h.messageId).map((h) => h.messageId as string),
  );
  const assistantMsgs = detail.history.filter((h) => h.role === "assistant");
  for (const f of detail.feedback.perMessage) {
    if (f.messageId && historyMessageIds.has(f.messageId)) continue; // exact match exists
    // Find the last assistant message at or before this feedback's timestamp.
    let match: HistoryEntry | undefined;
    for (const h of assistantMsgs) {
      if (h.timestamp && f.submittedAt && h.timestamp <= f.submittedAt) match = h;
      else if (h.timestamp && f.submittedAt && h.timestamp > f.submittedAt) break;
    }
    // Fall back to the last assistant message if timing didn't resolve one.
    if (!match && assistantMsgs.length > 0) match = assistantMsgs[assistantMsgs.length - 1];
    if (match) f.resolvedMessageId = match.sk; // sk is always present + unique
  }

  // Backstop email lookup — see list-sessions.ts for context. If the
  // SESSION row didn't capture the email, surface whichever email any
  // feedback row in the partition carried.
  if (detail.metadata && !detail.metadata.betaTesterEmail) {
    for (const it of items) {
      if (typeof it.betaTesterEmail === "string" && it.betaTesterEmail) {
        detail.metadata.betaTesterEmail = it.betaTesterEmail;
        break;
      }
    }
  }

  return detail;
}
