/**
 * API client for Chatbot Service.
 *
 * Routes match API Gateway structure so the same code works
 * in local dev (Vite proxy → Express) and production (CloudFront → API Gateway).
 */

import { getIdToken } from "./lib/auth";

const API_BASE = import.meta.env.VITE_API_URL || "";

let _cachedToken: string | null = null;

export function setCachedToken(token: string | null): void {
  _cachedToken = token;
}

async function buildHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const apiKey = import.meta.env.VITE_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const token = _cachedToken || (await getIdToken());
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (extra) Object.assign(headers, extra);
  return headers;
}

async function buildGetHeaders(): Promise<Record<string, string> | undefined> {
  const apiKey = import.meta.env.VITE_API_KEY;
  const token = _cachedToken || (await getIdToken());
  if (!apiKey && !token) return undefined;
  const h: Record<string, string> = {};
  if (apiKey) h["x-api-key"] = apiKey;
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

/**
 * Build an Error with both a technical `message` (for `console.error`) and a
 * `displayMessage` for user-facing toasts/banners. Callers that already handle
 * the technical message (existing log lines) keep working unchanged; callers
 * that surface the error to users should read `err.displayMessage`.
 */
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

export interface HotButton {
  label: string;
  transactionTypeId: string;
  category?: string;
}

export interface KBSource {
  title: string;
  url?: string;
  type: "page" | "pdf";
}

export interface ChatResponse {
  sessionId: string;
  message: string;
  state: string;
  structuredContext: SessionContext;
  identifiedTransactions: Array<{
    txnTypeId: string;
    name: string;
    durationMinutes: number;
  }>;
  combinedDocuments: string[];
  totalDurationMinutes: number;
  kbSources?: KBSource[];
  /** Server-assigned id for this assistant turn; used as the feedback key. */
  messageId?: string;
}

export interface FactValue {
  value: string;
  confidence: "asserted" | "inferred" | "unknown";
  source: "user-message" | "prescreening" | "ocr" | "inference";
  updatedAt: string;
}

export type ItemBucket = "bring_in" | "optional_upload" | "form";

export interface BucketItem {
  itemId: string;
  label: string;
  bucket: ItemBucket;
  source?: string;
  notes?: string;
  /** Number of upload slots this item needs (e.g. a two-sided permit = 2). Defaults to 1. */
  uploadSides?: number;
}

export interface ResolvedItemsByBucket {
  bringIns: BucketItem[];
  optionalUploads: BucketItem[];
  forms: BucketItem[];
}

export interface BlockingInfo {
  severity: "hard" | "conditional";
  reason: string;
  customerMessage: string;
  nextSteps?: string;
  sourceRefs?: string[];
  origin: "decision-tree" | "universal-blockers" | "pre-screen";
}

export interface TransactionSummary {
  txnTypeId: string;
  name: string;
  durationMinutes: number;
  status: string;
  blockedReason?: string;
  blockingInfo?: BlockingInfo;
}

export interface SessionContext {
  identity?: {
    name?: string;
    dob?: string;
    address?: string;
    confirmed: boolean;
  };
  transactions: TransactionSummary[];
  documents: Array<{
    documentType: string;
    status: string;
  }>;
  preScreening: {
    answers: Record<string, unknown>;
    completedTxnTypes: string[];
  };
  scheduling?: {
    appointmentId?: string;
    selectedSlot?: {
      locationName: string;
      date: string;
      startTime: string;
    };
    qrCodeUrl?: string;
  };
  facts?: Record<string, FactValue>;
  resolvedBuckets?: ResolvedItemsByBucket;
  suggestedReplies?: Array<{ label: string; value: string }>;
}

export interface SessionState {
  sessionId: string;
  state: string;
  structuredContext: SessionContext;
  incompletePreWork: boolean;
  pendingAuthIdProof?: { embedUrl: string; operationId: string; mode: "proof" | "verified" };
}

export interface UploadUrlResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export interface CreateSessionResponse {
  sessionId: string;
  state: string;
  hotButtons: HotButton[];
}

// --- Session lifecycle ---

export async function createSession(
  channel: "web" | "walkin" = "web",
  walkInLocationId?: string,
): Promise<CreateSessionResponse> {
  const res = await fetch(`${API_BASE}/chatbot/sessions`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({ channel, walkInLocationId }),
  });
  if (!res.ok)
    throw httpError(res.status, "We couldn't start your session. Please refresh and try again.");
  return res.json();
}

export async function fetchHotButtons(): Promise<HotButton[]> {
  const getHeaders = await buildGetHeaders();
  const res = await fetch(
    `${API_BASE}/chatbot/hot-buttons`,
    getHeaders ? { headers: getHeaders } : undefined,
  );
  if (!res.ok) return [];
  return res.json();
}

export interface AllTransaction {
  txnTypeId: string;
  name: string;
  category: string;
  opener: string;
  summary?: string;
}

export async function fetchAllTransactions(): Promise<AllTransaction[]> {
  const getHeaders = await buildGetHeaders();
  const res = await fetch(
    `${API_BASE}/chatbot/all-transactions`,
    getHeaders ? { headers: getHeaders } : undefined,
  );
  if (!res.ok) return [];
  return res.json();
}

// --- Messaging ---

export async function sendMessage(sessionId: string, message: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({ message }),
  });
  if (!res.ok)
    throw httpError(
      res.status,
      "We couldn't send that message. Try again, or refresh if it keeps happening.",
    );
  return res.json();
}

// --- Polling (5s interval) ---

export async function getSessionState(sessionId: string): Promise<SessionState> {
  const getHeaders = await buildGetHeaders();
  const res = await fetch(
    `${API_BASE}/chatbot/session-state/${sessionId}`,
    getHeaders ? { headers: getHeaders } : undefined,
  );
  if (!res.ok)
    throw httpError(
      res.status,
      "We lost track of your session for a moment. Refresh to pick up where you left off.",
    );
  return res.json();
}

// --- Rehydrate (session resume from URL) ---

export interface RehydrateResponse {
  session: {
    sessionId: string;
    currentState: string;
    structuredContext: SessionContext;
    channel: "web" | "walkin" | "sms";
    walkInLocationId?: string;
    pendingAuthIdProof?: { embedUrl: string; operationId: string; mode: "proof" | "verified" };
    createdAt: string;
    updatedAt: string;
  };
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>;
  reauth?: {
    embedUrl: string;
    transactionId: string;
  };
}

export async function rehydrateSession(sessionId: string): Promise<RehydrateResponse | null> {
  const getHeaders = await buildGetHeaders();
  const res = await fetch(
    `${API_BASE}/chatbot/sessions/${sessionId}/rehydrate`,
    getHeaders ? { headers: getHeaders } : undefined,
  );
  if (res.status === 404) return null;
  if (res.status === 403) {
    // Session belongs to a different tester. Surface a structured error so
    // App.tsx can show the email-mismatch notice rather than the generic
    // "we couldn't reload" message.
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw Object.assign(
      httpError(
        403,
        typeof body.message === "string"
          ? body.message
          : "This conversation belongs to a different beta tester.",
      ),
      {
        reason: typeof body.error === "string" ? body.error : "forbidden",
      },
    );
  }
  if (!res.ok)
    throw httpError(
      res.status,
      "We couldn't reload your saved conversation. Refresh to start fresh.",
    );
  return res.json();
}

// --- Uploads ---

export async function getUploadUrl(
  sessionId: string,
  documentType: string,
  filename: string,
): Promise<UploadUrlResponse> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/upload-url`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({ documentType, filename }),
  });
  if (!res.ok)
    throw httpError(res.status, "We couldn't get an upload ready. Try again in a moment.");
  return res.json();
}

export async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  // Note: this hits a presigned S3 URL directly, not our API. We intentionally
  // do NOT attach our API key here — S3 rejects unknown headers on presigned PUTs.
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok)
    throw httpError(
      res.status,
      "Your file didn't finish uploading. Check your connection and try once more.",
      `Upload failed: ${res.status}`,
    );
}

export interface ValidateDocumentResponse {
  verdict: "accept" | "reject";
  reason?: string;
  observedDocument?: string;
  confidence?: number;
  failOpen?: boolean;
  /** Non-blocking notice on an accepted upload (e.g. a content/status check
   *  flagged a concern). The slot still completes; shown as a soft warning. */
  advisory?: string;
}

/**
 * POST /chatbot/sessions/:id/validate-document — synchronous AI pass/reject
 * screen on a just-uploaded file. Client-side FAIL-OPEN: any non-OK response
 * (network blip, 5xx) resolves to accept so a real resident is never blocked
 * by a transport problem. Only an explicit `verdict: 'reject'` should block.
 */
export async function validateDocument(
  sessionId: string,
  documentType: string,
  s3Key: string,
  filename: string,
): Promise<ValidateDocumentResponse> {
  try {
    const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/validate-document`, {
      method: "POST",
      headers: await buildHeaders(),
      body: JSON.stringify({ documentType, s3Key, filename }),
    });
    if (!res.ok) return { verdict: "accept", failOpen: true };
    return res.json();
  } catch {
    return { verdict: "accept", failOpen: true };
  }
}

// --- Debug ---

export interface DebugTree {
  txnTypeId: string;
  baseItems: string[];
  factsRequired: string[];
  branches: Array<{
    when: Record<string, string>;
    addItems?: string[];
    removeItems?: string[];
    note?: string;
  }>;
}

export interface DebugFactDefinition {
  factKey: string;
  label: string;
  valueType: string;
  allowedValues: string[];
  questionText: string;
  scope: "global" | "transaction-specific";
  relevantTransactions: string[];
  valueLabels?: Record<string, string>;
}

export async function fetchDebugTrees(
  txnTypeIds: string[],
): Promise<{ trees: DebugTree[]; factDefinitions: DebugFactDefinition[] }> {
  const params =
    txnTypeIds.length > 0 ? `?txnTypeIds=${encodeURIComponent(txnTypeIds.join(","))}` : "";
  const getHeaders = await buildGetHeaders();
  const res = await fetch(
    `${API_BASE}/chatbot/debug/trees${params}`,
    getHeaders ? { headers: getHeaders } : undefined,
  );
  if (!res.ok) throw httpError(res.status, "Couldn't load the decision details just now.");
  return res.json();
}

export async function skipState(
  sessionId: string,
  stateName: string,
): Promise<{ previousState: string; newState: string; warning: string }> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/skip`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({ stateName }),
  });
  if (!res.ok) throw httpError(res.status, "We couldn't skip ahead — try the next step instead.");
  return res.json();
}

// --- Confirm-facts review ---

export interface EditFactsResponse {
  status: "ok";
  facts: Record<string, FactValue>;
  resolvedBuckets?: ResolvedItemsByBucket;
  transactions: TransactionSummary[];
  newlyUnresolved: string[];
  newHardBlocks: Array<{
    txnTypeId: string;
    name: string;
    blockingInfo: BlockingInfo;
  }>;
  rejected: Array<{ factKey: string; value: string; reason: string }>;
}

export async function editFacts(
  sessionId: string,
  edits: Array<{ factKey: string; value: string }>,
): Promise<EditFactsResponse> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/edit-facts`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({ edits }),
  });
  if (!res.ok) throw httpError(res.status, "We couldn't save that change. Try once more.");
  return res.json();
}

export interface ConfirmFactsResponse {
  previousState: string;
  newState: string;
}

export async function confirmFacts(
  sessionId: string,
  emailOptIn?: { address: string },
): Promise<ConfirmFactsResponse> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/confirm-facts`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(emailOptIn ? { emailOptIn } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(
      httpError(
        res.status,
        "We couldn't finalize your answers. Check the form above and try again.",
      ),
      { body },
    );
  }
  return res.json();
}

export async function sendTranscript(
  sessionId: string,
  to: string,
): Promise<{ status: "sent" | "skipped" | "failed"; messageId?: string; reason?: string }> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/send-transcript`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({ to }),
  });
  if (!res.ok)
    throw httpError(
      res.status,
      "We couldn't send the email transcript. Check the address and try again.",
    );
  return res.json();
}

// --- Beta-tester feedback ---

export type MessageFeedbackReaction = "good" | "bad" | "comment";

export async function submitMessageFeedback(
  sessionId: string,
  messageId: string,
  reaction: MessageFeedbackReaction,
  comment?: string,
): Promise<{ status: "ok" }> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/message-feedback`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({ messageId, reaction, comment }),
  });
  if (!res.ok) throw httpError(res.status, "We couldn't record your feedback right now.");
  return res.json();
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
}

export async function submitSessionFeedback(
  sessionId: string,
  payload: SessionFeedbackPayload,
): Promise<{ status: "ok"; submissionSk: string }> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/feedback`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok)
    throw httpError(res.status, "We couldn't submit your feedback bundle. Try again in a moment.");
  return res.json();
}

export interface TranscriptPdfMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  messageId?: string;
}

export async function downloadTranscriptPdf(
  sessionId: string,
  options: {
    notes?: string;
    messageFeedback?: SessionFeedbackPayload["messageFeedback"];
    messages?: TranscriptPdfMessage[];
  } = {},
): Promise<Blob> {
  // Accept: application/pdf is REQUIRED — API Gateway uses the request's
  // Accept header to decide whether to base64-decode the binary response.
  // Without it, the PDF arrives as a base64 string and renders as blank
  // pages.
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/transcript-pdf`, {
    method: "POST",
    headers: await buildHeaders({ Accept: "application/pdf" }),
    body: JSON.stringify(options),
  });
  if (!res.ok)
    throw httpError(res.status, "We couldn't build the transcript PDF. Try again in a moment.");
  return res.blob();
}

export interface AuthIdResultResponse {
  // `pending` = AuthID isn't terminal yet within this request's short poll
  // budget; the caller re-polls (non-blocking — the request never rides past
  // the API-Gateway timeout). All other statuses are terminal.
  status: "pending" | "pass" | "review" | "rejected" | "authid-failed";
  reasons?: string[];
  identity?: { name: string; dob: string; address: string };
  sessionState?: string;
  authIdStatus?: number;
  /**
   * Bot reply for the new state (resolve-facts in the happy path) — already
   * generated by the backend's autoGreet pass after the state advance, so
   * the SPA can drop it straight into the chat without a synthetic round-trip.
   */
  greeting?: string;
}

export async function submitAuthIdResult(sessionId: string): Promise<AuthIdResultResponse> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/authid-result`, {
    method: "POST",
    headers: await buildHeaders(),
  });
  if (!res.ok)
    throw httpError(
      res.status,
      "We couldn't fetch the verification result. Refresh and try once more.",
    );
  return res.json();
}

export interface SkipVerifyResponse {
  status: "skipped";
  sessionState: string;
  greeting?: string;
}

/** Customer chose "Skip For Now" at the verify-identity gate. */
export async function skipVerifyIdentity(sessionId: string): Promise<SkipVerifyResponse> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/skip-verify`, {
    method: "POST",
    headers: await buildHeaders(),
  });
  if (!res.ok) throw httpError(res.status, "We couldn't skip that step. Try again.");
  return res.json();
}

export interface RetryAuthIdResponse {
  // `retrying` = a fresh Proof transaction was created; `pendingAuthIdProof`
  // carries the new embed URL. `unavailable` = AuthID couldn't be reached.
  status: "retrying" | "unavailable";
  pendingAuthIdProof?: { embedUrl: string; operationId: string; mode: "proof" | "verified" };
}

/** Resident chose "Try again" after a recoverable rejection — mint a fresh Proof. */
export async function retryAuthIdProof(sessionId: string): Promise<RetryAuthIdResponse> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/authid-retry`, {
    method: "POST",
    headers: await buildHeaders(),
  });
  if (!res.ok)
    throw httpError(res.status, "We couldn't restart verification. Try again in a moment.");
  return res.json();
}

// --- Scheduling (proxied to the devs' scheduling service) ---

export interface SchedulingSlotResponse {
  schedulable?: boolean;
  unavailable?: boolean;
  slot?: { officeId: number; officeName: string; date: string; time: string } | null;
  reason?: string | null;
  unmapped?: string[];
}

export interface SchedulingOffice {
  id: number;
  name: string;
  openDays?: number[];
}

export interface SchedulingOfficesResponse {
  offices: SchedulingOffice[];
}

export interface SchedulingPreferences {
  preferredOffice?: number;
  preferredDow?: number;
  preferredTime?: "morning" | "afternoon";
}

export interface SchedulingBookResponse {
  status: "booked";
  appointmentId: number;
  qrCode: string;
  officeName: string;
  dateFormatted: string;
  timeFormatted: string;
  scheduling: {
    selectedSlot: { locationName: string; date: string; startTime: string };
    appointmentId: string;
  };
}

export async function fetchSchedulingSlot(
  sessionId: string,
  preferences?: SchedulingPreferences,
): Promise<SchedulingSlotResponse> {
  const getHeaders = await buildGetHeaders();
  const params = new URLSearchParams();
  if (preferences?.preferredOffice != null)
    params.set("preferredOffice", String(preferences.preferredOffice));
  if (preferences?.preferredDow != null)
    params.set("preferredDow", String(preferences.preferredDow));
  if (preferences?.preferredTime) params.set("preferredTime", preferences.preferredTime);
  const qs = params.toString();
  const url = `${API_BASE}/chatbot/sessions/${sessionId}/scheduling/slot${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, getHeaders ? { headers: getHeaders } : undefined);
  if (!res.ok)
    throw httpError(res.status, "We couldn't reach scheduling. You can call the office to book.");
  return res.json();
}

export async function fetchSchedulingOffices(
  sessionId: string,
): Promise<SchedulingOfficesResponse> {
  const getHeaders = await buildGetHeaders();
  const res = await fetch(
    `${API_BASE}/chatbot/sessions/${sessionId}/scheduling/offices`,
    getHeaders ? { headers: getHeaders } : undefined,
  );
  if (!res.ok) throw httpError(res.status, "Could not load office list.");
  return res.json();
}

export async function bookSchedulingAppointment(
  sessionId: string,
  body: {
    officeId: number;
    date: string;
    time: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  },
): Promise<SchedulingBookResponse> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/scheduling/book`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify(body),
  });
  if (res.status === 409)
    throw Object.assign(httpError(409, "That time was just taken — try again."), {
      reason: "slot-taken",
    });
  if (!res.ok) throw httpError(res.status, "We couldn't book that. Try again, or call the office.");
  return res.json();
}

export async function verifySchedulingEmail(
  sessionId: string,
  email: string,
): Promise<{ status: "verification_sent" | "already_verified" }> {
  const res = await fetch(`${API_BASE}/chatbot/sessions/${sessionId}/scheduling/verify-email`, {
    method: "POST",
    headers: await buildHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw httpError(res.status, "Could not verify email. Try again.");
  return res.json();
}

export async function checkSchedulingEmailStatus(
  sessionId: string,
  email: string,
): Promise<{ verified: boolean }> {
  const getHeaders = await buildGetHeaders();
  const res = await fetch(
    `${API_BASE}/chatbot/sessions/${sessionId}/scheduling/verify-email-status?email=${encodeURIComponent(email)}`,
    getHeaders ? { headers: getHeaders } : undefined,
  );
  if (!res.ok) throw httpError(res.status, "Could not check email status.");
  return res.json();
}
