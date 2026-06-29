/**
 * List chat sessions with feedback counts via PostgreSQL.
 */

import { getPool } from "@st-lucie/data-access";

export type SessionRow = {
  sessionId: string;
  currentState: string;
  channel: string;
  createdAt: string;
  updatedAt: string;
  betaTesterEmail?: string;
  isTestSession?: boolean;
  reviewed?: boolean;
  activeTxnTypeIds: string[];
  feedbackBadges: { good: number; bad: number; comment: number; submission: number } | null;
};

export interface ListSessionsOptions {
  limit?: number;
  hasFeedback?: boolean;
  hasBad?: boolean;
  hasSubmission?: boolean;
  state?: string;
  email?: string;
  includeTestSessions?: boolean;
}

export async function listSessions(
  opts: ListSessionsOptions = {},
): Promise<{ items: SessionRow[] }> {
  const pool = getPool();

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts.state) {
    values.push(opts.state);
    conditions.push(`cs.state = $${values.length}`);
  }
  if (opts.email) {
    values.push(`%${opts.email.trim().toLowerCase()}%`);
    conditions.push(`cs.email ILIKE $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 200;

  const sql = `
    SELECT cs.session_uuid,
           cs.state,
           cs.email,
           cs.structured_context,
           cs.created_at::text,
           cs.updated_at::text,
           cs.reviewed_at,
           COALESCE(fb.good, 0)::int AS good,
           COALESCE(fb.bad, 0)::int AS bad,
           COALESCE(fb.comment_cnt, 0)::int AS comment_cnt,
           COALESCE(fb.submission, 0)::int AS submission
    FROM chat_sessions cs
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE feedback_reaction = 'up') AS good,
             count(*) FILTER (WHERE feedback_reaction = 'down') AS bad,
             count(*) FILTER (WHERE feedback_comment IS NOT NULL AND feedback_reaction IS NULL) AS comment_cnt,
             count(*) FILTER (WHERE role = 'system' AND content->>'type' = 'feedback_submission') AS submission
      FROM chat_messages cm
      WHERE cm.session_id = cs.id
    ) fb ON true
    ${where}
    ORDER BY cs.created_at DESC
    LIMIT ${limit}`;

  const result = await pool.query(sql, values);

  let rows: SessionRow[] = result.rows.map((r: Record<string, unknown>) => {
    const ctx = r.structured_context as Record<string, unknown>;
    const meta = (ctx?._meta ?? {}) as Record<string, unknown>;
    const transactions = (ctx?.transactions ?? []) as Array<{
      txnTypeId: string;
      status: string;
    }>;

    return {
      sessionId: r.session_uuid as string,
      currentState: r.state as string,
      channel: (meta.channel as string) ?? "web",
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      betaTesterEmail: (r.email as string) ?? undefined,
      isTestSession: (meta.isTestSession as boolean) || undefined,
      reviewed: r.reviewed_at ? true : undefined,
      activeTxnTypeIds: transactions.filter((t) => t.status === "active").map((t) => t.txnTypeId),
      feedbackBadges: {
        good: r.good as number,
        bad: r.bad as number,
        comment: r.comment_cnt as number,
        submission: r.submission as number,
      },
    };
  });

  if (!opts.includeTestSessions) {
    rows = rows.filter((r) => r.isTestSession !== true);
  }
  if (opts.hasFeedback) {
    rows = rows.filter(
      (r) =>
        r.feedbackBadges &&
        r.feedbackBadges.good +
          r.feedbackBadges.bad +
          r.feedbackBadges.comment +
          r.feedbackBadges.submission >
          0,
    );
  }
  if (opts.hasBad) {
    rows = rows.filter((r) => r.feedbackBadges && r.feedbackBadges.bad > 0);
  }
  if (opts.hasSubmission) {
    rows = rows.filter((r) => r.feedbackBadges && r.feedbackBadges.submission > 0);
  }

  return { items: rows };
}
