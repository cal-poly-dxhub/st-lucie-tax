/**
 * Admin API client. Uses Cognito ID tokens for auth (Bearer header).
 */

import { getIdToken, getRuntimeConfig } from "./auth";

export type { AuthUser } from "./auth";
export { getCurrentUser, signIn, signOut } from "./auth";

async function getApiBase(): Promise<string> {
  const config = await getRuntimeConfig();
  return config.adminApiUrl || "";
}

async function buildGetHeaders(): Promise<Record<string, string>> {
  const apiKey = import.meta.env.VITE_API_KEY;
  const h: Record<string, string> = {};
  if (apiKey) h["x-api-key"] = apiKey;
  const token = await getIdToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function buildHeaders(): Promise<Record<string, string>> {
  const h = await buildGetHeaders();
  h["Content-Type"] = "application/json";
  return h;
}

export interface ApiError extends Error {
  displayMessage: string;
  status?: number;
}

function httpError(status: number, displayMessage: string, technical?: string): ApiError {
  return Object.assign(new Error(technical ?? `HTTP ${status}`), {
    displayMessage,
    status,
  }) as ApiError;
}

// --- Summary ---

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
  recentComments?: RecentComment[];
}

export interface RecentComment {
  kind: "message-comment" | "submission-notes";
  sessionId: string;
  at: string;
  text: string;
  betaTesterEmail?: string;
}

export async function fetchSummary(): Promise<Summary> {
  const base = await getApiBase();
  const res = await fetch(`${base}/admin/summary`, { headers: await buildGetHeaders() });
  if (res.status === 401 || res.status === 403) throw httpError(res.status, "Sign in to continue.");
  if (!res.ok) throw httpError(res.status, "Couldn't load the dashboard summary.");
  return res.json();
}

// --- Session list ---

export interface SessionRow {
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
}

export interface ListSessionsResponse {
  items: SessionRow[];
}

export interface ListSessionsParams {
  hasFeedback?: boolean;
  hasBad?: boolean;
  hasSubmission?: boolean;
  state?: string;
  email?: string;
  includeTestSessions?: boolean;
}

export async function fetchSessions(
  params: ListSessionsParams = {},
): Promise<ListSessionsResponse> {
  const base = await getApiBase();
  const qs = new URLSearchParams();
  if (params.hasFeedback) qs.set("hasFeedback", "1");
  if (params.hasBad) qs.set("hasBad", "1");
  if (params.hasSubmission) qs.set("hasSubmission", "1");
  if (params.state) qs.set("state", params.state);
  if (params.email) qs.set("email", params.email);
  if (params.includeTestSessions) qs.set("includeTestSessions", "1");
  const url = qs.toString().length ? `${base}/admin/sessions?${qs}` : `${base}/admin/sessions`;
  const res = await fetch(url, { headers: await buildGetHeaders() });
  if (res.status === 401 || res.status === 403) throw httpError(res.status, "Sign in to continue.");
  if (!res.ok) throw httpError(res.status, "Couldn't load the session list.");
  return res.json();
}

// --- Session detail ---

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

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetail> {
  const base = await getApiBase();
  const res = await fetch(`${base}/admin/sessions/${sessionId}`, {
    headers: await buildGetHeaders(),
  });
  if (res.status === 401 || res.status === 403) throw httpError(res.status, "Sign in to continue.");
  if (res.status === 404) throw httpError(404, "Session not found.");
  if (!res.ok) throw httpError(res.status, "Couldn't load that session.");
  return res.json();
}

// --- Admin write: mark a session reviewed / not-reviewed ---

export async function setSessionReviewed(sessionId: string, reviewed: boolean): Promise<void> {
  const base = await getApiBase();
  const res = await fetch(`${base}/admin/sessions/${sessionId}/reviewed`, {
    method: "PATCH",
    headers: await buildHeaders(),
    body: JSON.stringify({ reviewed }),
  });
  if (res.status === 401 || res.status === 403) throw httpError(res.status, "Sign in to continue.");
  if (!res.ok) throw httpError(res.status, "Couldn't update the reviewed status.");
}
