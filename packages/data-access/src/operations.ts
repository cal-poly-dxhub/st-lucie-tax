/**
 * PostgreSQL operations for chat sessions and messages.
 *
 * Replaces the DynamoDB single-table operations with typed SQL queries
 * against chat_sessions / chat_messages / chat_auth_tokens.
 */

import type { PoolClient } from "pg";
import { getPool } from "./client.js";

// ─── Session Operations ─────────────────────────────────────────────────────

export interface ChatSessionRow {
  id: number;
  session_uuid: string;
  email: string | null;
  state: string;
  structured_context: Record<string, unknown>;
  appointment_id: number | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  expires_at: string;
}

export async function createChatSession(opts: {
  email?: string;
  state?: string;
  structuredContext?: Record<string, unknown>;
}): Promise<ChatSessionRow> {
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(
    `INSERT INTO chat_sessions (email, state, structured_context)
     VALUES ($1, $2, $3)
     RETURNING id, session_uuid, email, state, structured_context,
               appointment_id, created_at::text, updated_at::text,
               reviewed_at::text, expires_at::text`,
    [opts.email ?? null, opts.state ?? "landing", JSON.stringify(opts.structuredContext ?? {})],
  );
  return result.rows[0];
}

export async function getChatSession(sessionUuid: string): Promise<ChatSessionRow | null> {
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(
    `SELECT id, session_uuid, email, state, structured_context,
            appointment_id, created_at::text, updated_at::text,
            reviewed_at::text, expires_at::text
     FROM chat_sessions
     WHERE session_uuid = $1`,
    [sessionUuid],
  );
  return result.rows[0] ?? null;
}

export async function getChatSessionById(id: number): Promise<ChatSessionRow | null> {
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(
    `SELECT id, session_uuid, email, state, structured_context,
            appointment_id, created_at::text, updated_at::text,
            reviewed_at::text, expires_at::text
     FROM chat_sessions
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function updateChatSession(
  sessionUuid: string,
  updates: {
    state?: string;
    structuredContext?: Record<string, unknown>;
    email?: string;
    appointmentId?: number | null;
  },
): Promise<ChatSessionRow | null> {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];

  if (updates.state !== undefined) {
    values.push(updates.state);
    sets.push(`state = $${values.length}`);
  }
  if (updates.structuredContext !== undefined) {
    values.push(JSON.stringify(updates.structuredContext));
    sets.push(`structured_context = $${values.length}`);
  }
  if (updates.email !== undefined) {
    values.push(updates.email);
    sets.push(`email = $${values.length}`);
  }
  if (updates.appointmentId !== undefined) {
    values.push(updates.appointmentId);
    sets.push(`appointment_id = $${values.length}`);
  }

  values.push(sessionUuid);
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(
    `UPDATE chat_sessions SET ${sets.join(", ")}
     WHERE session_uuid = $${values.length}
     RETURNING id, session_uuid, email, state, structured_context,
               appointment_id, created_at::text, updated_at::text,
               reviewed_at::text, expires_at::text`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function setSessionReviewedAt(
  sessionUuid: string,
  reviewed: boolean,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE chat_sessions SET reviewed_at = $1
     WHERE session_uuid = $2`,
    [reviewed ? new Date().toISOString() : null, sessionUuid],
  );
  return (result.rowCount ?? 0) > 0;
}

// ─── Message Operations ─────────────────────────────────────────────────────

export interface ChatMessageRow {
  id: number;
  session_id: number;
  role: string;
  content: unknown;
  state: string;
  feedback_reaction: string | null;
  feedback_comment: string | null;
  created_at: string;
}

export async function insertChatMessage(opts: {
  sessionId: number;
  role: "user" | "assistant" | "system";
  content: unknown;
  state: string;
}): Promise<ChatMessageRow> {
  const pool = getPool();
  const result = await pool.query<ChatMessageRow>(
    `INSERT INTO chat_messages (session_id, role, content, state)
     VALUES ($1, $2, $3, $4)
     RETURNING id, session_id, role, content, state,
               feedback_reaction, feedback_comment, created_at::text`,
    [opts.sessionId, opts.role, JSON.stringify(opts.content), opts.state],
  );
  return result.rows[0];
}

export async function getChatMessages(
  sessionId: number,
  opts?: { role?: string },
): Promise<ChatMessageRow[]> {
  const pool = getPool();
  let sql = `SELECT id, session_id, role, content, state,
                    feedback_reaction, feedback_comment, created_at::text
             FROM chat_messages
             WHERE session_id = $1`;
  const values: unknown[] = [sessionId];
  if (opts?.role) {
    sql += ` AND role = $2`;
    values.push(opts.role);
  }
  sql += ` ORDER BY created_at ASC, id ASC`;
  const result = await pool.query<ChatMessageRow>(sql, values);
  return result.rows;
}

export async function setMessageFeedback(
  messageId: number,
  reaction: "up" | "down",
  comment?: string,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE chat_messages SET feedback_reaction = $1, feedback_comment = $2
     WHERE id = $3`,
    [reaction, comment ?? null, messageId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ─── Auth Token Operations ──────────────────────────────────────────────────

export async function insertAuthToken(email: string, tokenHash: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO chat_auth_tokens (email, token_hash)
     VALUES ($1, $2)
     ON CONFLICT (email, token_hash) DO NOTHING`,
    [email, tokenHash],
  );
}

export async function authTokenExists(email: string, tokenHash: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT 1 FROM chat_auth_tokens
     WHERE email = $1 AND token_hash = $2 AND expires_at > now()`,
    [email, tokenHash],
  );
  return (result.rowCount ?? 0) > 0;
}

// ─── Admin Queries ──────────────────────────────────────────────────────────

export interface AdminSessionListRow {
  session_uuid: string;
  state: string;
  email: string | null;
  structured_context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  message_count: number;
  feedback_up: number;
  feedback_down: number;
}

export async function listChatSessions(opts?: {
  limit?: number;
  state?: string;
  email?: string;
  hasReview?: boolean;
}): Promise<AdminSessionListRow[]> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts?.state) {
    values.push(opts.state);
    conditions.push(`cs.state = $${values.length}`);
  }
  if (opts?.email) {
    values.push(`%${opts.email}%`);
    conditions.push(`cs.email ILIKE $${values.length}`);
  }
  if (opts?.hasReview === true) {
    conditions.push(`cs.reviewed_at IS NOT NULL`);
  } else if (opts?.hasReview === false) {
    conditions.push(`cs.reviewed_at IS NULL`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 200;

  const sql = `
    SELECT cs.session_uuid, cs.state, cs.email, cs.structured_context,
           cs.created_at::text, cs.updated_at::text, cs.reviewed_at::text,
           COALESCE(msg.cnt, 0)::int AS message_count,
           COALESCE(msg.fb_up, 0)::int AS feedback_up,
           COALESCE(msg.fb_down, 0)::int AS feedback_down
    FROM chat_sessions cs
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             count(*) FILTER (WHERE feedback_reaction = 'up') AS fb_up,
             count(*) FILTER (WHERE feedback_reaction = 'down') AS fb_down
      FROM chat_messages cm
      WHERE cm.session_id = cs.id
    ) msg ON true
    ${where}
    ORDER BY cs.created_at DESC
    LIMIT ${limit}`;

  const result = await pool.query<AdminSessionListRow>(sql, values);
  return result.rows;
}

export interface AdminSessionDetail {
  session: ChatSessionRow;
  messages: ChatMessageRow[];
}

export async function getAdminSessionDetail(
  sessionUuid: string,
): Promise<AdminSessionDetail | null> {
  const session = await getChatSession(sessionUuid);
  if (!session) return null;
  const messages = await getChatMessages(session.id);
  return { session, messages };
}

export async function getAdminSummary(): Promise<{
  totalSessions: number;
  todaySessions: number;
  last7dSessions: number;
  stateBreakdown: Record<string, number>;
  feedbackUp: number;
  feedbackDown: number;
}> {
  const pool = getPool();
  const [counts, states, feedback] = await Promise.all([
    pool.query<{ total: string; today: string; last7d: string }>(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS today,
             count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS last7d
      FROM chat_sessions`),
    pool.query<{ state: string; cnt: string }>(`
      SELECT state, count(*) AS cnt
      FROM chat_sessions
      GROUP BY state`),
    pool.query<{ fb_up: string; fb_down: string }>(`
      SELECT count(*) FILTER (WHERE feedback_reaction = 'up') AS fb_up,
             count(*) FILTER (WHERE feedback_reaction = 'down') AS fb_down
      FROM chat_messages`),
  ]);

  const stateBreakdown: Record<string, number> = {};
  for (const row of states.rows) {
    stateBreakdown[row.state] = parseInt(row.cnt);
  }

  return {
    totalSessions: parseInt(counts.rows[0].total),
    todaySessions: parseInt(counts.rows[0].today),
    last7dSessions: parseInt(counts.rows[0].last7d),
    stateBreakdown,
    feedbackUp: parseInt(feedback.rows[0].fb_up),
    feedbackDown: parseInt(feedback.rows[0].fb_down),
  };
}

// ─── Utilities (provide PoolClient for transactional use) ───────────────────

export type { PoolClient };
