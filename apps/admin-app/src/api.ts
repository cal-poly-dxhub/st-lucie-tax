/**
 * Admin API client. Independent from apps/chatbot-app/src/api.ts so the
 * surface stays focused on the read-only admin endpoints. Same buildHeaders
 * + httpError shape so the UX patterns transfer.
 */

const API_BASE = import.meta.env.VITE_API_URL || "";

const AUTH_STORAGE_KEY = "stlucie-admin-auth-v1";

export interface AdminAuthState {
  token: string;
  email: string;
}

export function loadAdminAuth(): AdminAuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminAuthState>;
    if (!parsed.token || !parsed.email) return null;
    return { token: parsed.token, email: parsed.email };
  } catch {
    return null;
  }
}

export function saveAdminAuth(state: AdminAuthState): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
}

export function clearAdminAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const apiKey = import.meta.env.VITE_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const auth = loadAdminAuth();
  if (auth) headers["Authorization"] = `Bearer ${auth.token}`;
  if (extra) Object.assign(headers, extra);
  return headers;
}

function buildGetHeaders(): Record<string, string> {
  const apiKey = import.meta.env.VITE_API_KEY;
  const h: Record<string, string> = {};
  if (apiKey) h["x-api-key"] = apiKey;
  const auth = loadAdminAuth();
  if (auth) h["Authorization"] = `Bearer ${auth.token}`;
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

// --- Auth ---

export async function login(
  email: string,
  password: string,
): Promise<AdminAuthState | { error: string }> {
  const apiKey = import.meta.env.VITE_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(`${API_BASE}/admin/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 400 || res.status === 401) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    return { error: typeof body.error === "string" ? body.error : "Sign-in failed." };
  }
  if (!res.ok) throw new Error(`Login HTTP ${res.status}`);
  return (await res.json()) as AdminAuthState;
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
  const res = await fetch(`${API_BASE}/admin/summary`, { headers: buildGetHeaders() });
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
  const qs = new URLSearchParams();
  if (params.hasFeedback) qs.set("hasFeedback", "1");
  if (params.hasBad) qs.set("hasBad", "1");
  if (params.hasSubmission) qs.set("hasSubmission", "1");
  if (params.state) qs.set("state", params.state);
  if (params.email) qs.set("email", params.email);
  if (params.includeTestSessions) qs.set("includeTestSessions", "1");
  const url = qs.toString().length
    ? `${API_BASE}/admin/sessions?${qs}`
    : `${API_BASE}/admin/sessions`;
  const res = await fetch(url, { headers: buildGetHeaders() });
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
  /** Fallback join key for old sessions (matched assistant message's sk). */
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
  const res = await fetch(`${API_BASE}/admin/sessions/${sessionId}`, {
    headers: buildGetHeaders(),
  });
  if (res.status === 401 || res.status === 403) throw httpError(res.status, "Sign in to continue.");
  if (res.status === 404) throw httpError(404, "Session not found.");
  if (!res.ok) throw httpError(res.status, "Couldn't load that session.");
  return res.json();
}

// --- Admin write: mark a session reviewed / not-reviewed ---

export async function setSessionReviewed(sessionId: string, reviewed: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/sessions/${sessionId}/reviewed`, {
    method: "PATCH",
    headers: buildHeaders(),
    body: JSON.stringify({ reviewed }),
  });
  if (res.status === 401 || res.status === 403) throw httpError(res.status, "Sign in to continue.");
  if (!res.ok) throw httpError(res.status, "Couldn't update the reviewed status.");
}

// Used by buildHeaders if a future POST endpoint is added.
export { buildHeaders };
