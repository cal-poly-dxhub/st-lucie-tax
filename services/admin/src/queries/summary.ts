/**
 * Dashboard summary via PostgreSQL.
 *
 * Cached in module scope for 30s to absorb the periodic dashboard refresh.
 */

import { getPool } from "@st-lucie/data-access";

export interface ActivityEvent {
  kind: "session.created" | "feedback.message" | "feedback.submission";
  sessionId: string;
  at: string;
  detail?: string;
}

export interface Summary {
  generatedAt: string;
  sessionCounts: { today: number; last7d: number; total: number };
  stateBreakdown: Record<string, number>;
  feedback: {
    good: number;
    bad: number;
    comment: number;
    submissions: number;
    sessionsWithAny: number;
  };
  recentActivity: ActivityEvent[];
  recentComments: RecentComment[];
}

export interface RecentComment {
  kind: "message-comment" | "submission-notes";
  sessionId: string;
  at: string;
  text: string;
  betaTesterEmail?: string;
}

const SUMMARY_TTL_MS = 30_000;

let cached: { at: number; value: Summary } | null = null;

export async function getSummary(force = false): Promise<Summary> {
  if (!force && cached && Date.now() - cached.at < SUMMARY_TTL_MS) {
    return cached.value;
  }

  const pool = getPool();

  const [
    sessionCounts,
    stateRows,
    feedbackCounts,
    recentSessions,
    recentFeedback,
    recentSubmissions,
  ] = await Promise.all([
    pool.query<{ total: string; today: string; last7d: string }>(`
        SELECT count(*) AS total,
               count(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS today,
               count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS last7d
        FROM chat_sessions`),
    pool.query<{ state: string; cnt: string }>(`
        SELECT state, count(*) AS cnt FROM chat_sessions GROUP BY state`),
    pool.query<{
      good: string;
      bad: string;
      comment_cnt: string;
      submissions: string;
      sessions_with_any: string;
    }>(`
        SELECT count(*) FILTER (WHERE feedback_reaction = 'up') AS good,
               count(*) FILTER (WHERE feedback_reaction = 'down') AS bad,
               count(*) FILTER (WHERE feedback_comment IS NOT NULL AND feedback_reaction IS NULL) AS comment_cnt,
               count(*) FILTER (WHERE role = 'system' AND content->>'type' = 'feedback_submission') AS submissions,
               count(DISTINCT session_id) FILTER (WHERE feedback_reaction IS NOT NULL OR feedback_comment IS NOT NULL) AS sessions_with_any
        FROM chat_messages`),
    pool.query<{ session_uuid: string; state: string; created_at: string }>(`
        SELECT session_uuid, state, created_at::text
        FROM chat_sessions
        ORDER BY created_at DESC LIMIT 25`),
    pool.query<{
      session_uuid: string;
      feedback_reaction: string;
      feedback_comment: string;
      created_at: string;
      email: string;
    }>(`
        SELECT cs.session_uuid, cm.feedback_reaction, cm.feedback_comment, cm.created_at::text, cs.email
        FROM chat_messages cm
        JOIN chat_sessions cs ON cs.id = cm.session_id
        WHERE cm.feedback_reaction IS NOT NULL OR cm.feedback_comment IS NOT NULL
        ORDER BY cm.created_at DESC LIMIT 25`),
    pool.query<{
      session_uuid: string;
      content: Record<string, unknown>;
      created_at: string;
      email: string;
    }>(`
        SELECT cs.session_uuid, cm.content, cm.created_at::text, cs.email
        FROM chat_messages cm
        JOIN chat_sessions cs ON cs.id = cm.session_id
        WHERE cm.role = 'system' AND cm.content->>'type' = 'feedback_submission'
        ORDER BY cm.created_at DESC LIMIT 10`),
  ]);

  const stateBreakdown: Record<string, number> = {};
  for (const row of stateRows.rows) {
    stateBreakdown[row.state] = parseInt(row.cnt);
  }

  const events: ActivityEvent[] = [];
  for (const row of recentSessions.rows) {
    events.push({
      kind: "session.created",
      sessionId: row.session_uuid,
      at: row.created_at,
      detail: row.state,
    });
  }
  for (const row of recentFeedback.rows) {
    events.push({
      kind: "feedback.message",
      sessionId: row.session_uuid,
      at: row.created_at,
      detail: row.feedback_reaction,
    });
  }
  events.sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  const comments: RecentComment[] = [];
  for (const row of recentFeedback.rows) {
    if (row.feedback_comment) {
      comments.push({
        kind: "message-comment",
        sessionId: row.session_uuid,
        at: row.created_at,
        text: row.feedback_comment,
        betaTesterEmail: row.email ?? undefined,
      });
    }
  }
  for (const row of recentSubmissions.rows) {
    const content = row.content;
    const notes = content?.notes as string | undefined;
    if (notes?.trim()) {
      comments.push({
        kind: "submission-notes",
        sessionId: row.session_uuid,
        at: row.created_at,
        text: notes,
        betaTesterEmail: row.email ?? undefined,
      });
    }
  }
  comments.sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  const fc = feedbackCounts.rows[0];
  const summary: Summary = {
    generatedAt: new Date().toISOString(),
    sessionCounts: {
      today: parseInt(sessionCounts.rows[0].today),
      last7d: parseInt(sessionCounts.rows[0].last7d),
      total: parseInt(sessionCounts.rows[0].total),
    },
    stateBreakdown,
    feedback: {
      good: parseInt(fc.good),
      bad: parseInt(fc.bad),
      comment: parseInt(fc.comment_cnt),
      submissions: parseInt(fc.submissions),
      sessionsWithAny: parseInt(fc.sessions_with_any),
    },
    recentActivity: events.slice(0, 25),
    recentComments: comments.slice(0, 10),
  };

  cached = { at: Date.now(), value: summary };
  return summary;
}
