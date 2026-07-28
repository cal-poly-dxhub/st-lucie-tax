/**
 * Office-operations configuration API client.
 *
 * These routes live in the BackOffice stack's AppointmentFn under
 * `/api/ops-admin/*` — NOT the Chatbot stack's AdminFn that `api.ts` targets.
 * The name is "ops-admin" because CloudFront routes `/api/admin/*` to the
 * chatbot admin API, which would otherwise shadow these paths entirely.
 *
 * Auth is the same Cognito ID token used everywhere else; office-ops validates
 * it in Express middleware and requires the `admin` group.
 */

import { getIdToken, getRuntimeConfig } from "./auth";

async function base(): Promise<string> {
  const config = await getRuntimeConfig();
  return `${config.apiUrl}/ops-admin`;
}

async function headers(withBody: boolean): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  const token = await getIdToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (withBody) h["Content-Type"] = "application/json";
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

/** Extracts the server's error message when it sends one, else a fallback. */
async function readError(res: Response, fallback: string): Promise<ApiError> {
  if (res.status === 401 || res.status === 403) {
    return httpError(res.status, "Sign in as an administrator to continue.");
  }
  let detail: string | undefined;
  try {
    const body = await res.json();
    if (typeof body?.error === "string") detail = body.error;
  } catch {
    // Non-JSON error body — fall back to the caller's message.
  }
  return httpError(res.status, detail ?? fallback, detail);
}

async function req<T>(method: string, path: string, fallback: string, body?: unknown): Promise<T> {
  const res = await fetch(`${await base()}${path}`, {
    method,
    headers: await headers(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res, fallback);
  if (res.status === 204) return undefined as T;
  return res.json();
}

const get = <T>(path: string, fallback: string) => req<T>("GET", path, fallback);
const post = <T>(path: string, fallback: string, body?: unknown) =>
  req<T>("POST", path, fallback, body ?? {});
const put = <T>(path: string, fallback: string, body?: unknown) =>
  req<T>("PUT", path, fallback, body ?? {});
const del = <T>(path: string, fallback: string) => req<T>("DELETE", path, fallback);

type Ok = { ok: true };
type OkId = { ok: true; id: number };

// ─── Global config ───────────────────────────────────────────────────────────

export interface GlobalConfig {
  timezone: string;
  scheduling_block_padding: number;
  default_lookahead_days: number;
}

export const fetchConfig = () => get<GlobalConfig>("/config", "Couldn't load global settings.");

export const updateConfig = (body: {
  timezone?: string;
  schedulingBlockPadding?: number;
  defaultLookaheadDays?: number;
}) => put<Ok>("/config", "Couldn't save global settings.", body);

// ─── Offices ─────────────────────────────────────────────────────────────────

export interface Office {
  id: number;
  name: string;
  address: string | null;
  total_desks: number;
  run_rate_pct: number;
}

export interface OfficeHours {
  id: number;
  office_id: number;
  day_of_week: number;
  open_time: string;
  close_time: string;
}

export interface LunchShift {
  id: number;
  office_id: number;
  shift_num: number;
  start_time: string;
  end_time: string;
}

export interface OfficesResponse {
  offices: Office[];
  hours: OfficeHours[];
  lunches: LunchShift[];
}

export const fetchOffices = () => get<OfficesResponse>("/offices", "Couldn't load offices.");

export const createOffice = (body: {
  name: string;
  address?: string;
  totalDesks: number;
  runRatePct?: number;
}) => post<OkId>("/offices", "Couldn't create the office.", body);

export const updateOffice = (
  id: number,
  body: { name?: string; address?: string; totalDesks?: number; runRatePct?: number },
) => put<Ok>(`/offices/${id}`, "Couldn't save the office.", body);

export const deleteOffice = (id: number) =>
  del<Ok>(`/offices/${id}`, "Couldn't delete the office.");

/** Upserts by (officeId, dayOfWeek) server-side. */
export const setOfficeHours = (body: {
  officeId: number;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
}) => post<Ok>("/office-hours", "Couldn't save office hours.", body);

export const deleteOfficeHours = (id: number) =>
  del<Ok>(`/office-hours/${id}`, "Couldn't clear those office hours.");

export const createLunchShift = (body: {
  officeId: number;
  shiftNum: number;
  startTime: string;
  endTime: string;
}) => post<OkId>("/lunch-shifts", "Couldn't add the lunch shift.", body);

/**
 * Deleting a lunch shift also nulls `clerk_schedules.lunch_shift_id` for every
 * clerk assigned to it — see the Offices page for why saves diff rather than
 * delete-and-recreate.
 */
export const deleteLunchShift = (id: number) =>
  del<Ok>(`/lunch-shifts/${id}`, "Couldn't remove the lunch shift.");

// ─── Transaction types ───────────────────────────────────────────────────────

export interface TransactionType {
  id: number;
  txn_type_id: string;
  office_id: number | null;
  name: string;
  description: string | null;
  avg_duration_min: number;
  status: string;
  available_from: string | null;
  available_until: string | null;
  is_online_eligible: boolean;
  online_redirect_url: string | null;
}

export const fetchTransactionTypes = () =>
  get<TransactionType[]>("/transaction-types", "Couldn't load transaction types.");

export const createTransactionType = (body: {
  txnTypeId: string;
  officeId?: number | null;
  name: string;
  description?: string;
  avgDurationMin: number;
  status?: string;
  availableFrom?: string | null;
  availableUntil?: string | null;
  isOnlineEligible?: boolean;
  onlineRedirectUrl?: string | null;
}) => post<OkId>("/transaction-types", "Couldn't create the transaction type.", body);

export const updateTransactionType = (
  id: number,
  body: {
    name?: string;
    description?: string;
    avgDurationMin?: number;
    status?: string;
    availableFrom?: string | null;
    availableUntil?: string | null;
    isOnlineEligible?: boolean;
    onlineRedirectUrl?: string | null;
  },
) => put<Ok>(`/transaction-types/${id}`, "Couldn't save the transaction type.", body);

export const deleteTransactionType = (id: number) =>
  del<Ok>(`/transaction-types/${id}`, "Couldn't delete the transaction type.");

// ─── Transaction flows ───────────────────────────────────────────────────────

export interface TransactionFlow {
  id: number;
  txn_type_id: number;
  slug: string;
  txn_name: string;
  steps: unknown;
}

export const fetchTransactionFlows = () =>
  get<TransactionFlow[]>("/transaction-flows", "Couldn't load transaction flows.");

export const updateTransactionFlow = (txnTypeId: number, steps: unknown) =>
  put<Ok>(`/transaction-flows/${txnTypeId}`, "Couldn't save the flow.", { steps });

// ─── Transaction × office availability ───────────────────────────────────────

export interface TxnOfficeMatrix {
  offices: {
    id: number;
    name: string;
    earliest_open: string | null;
    latest_close: string | null;
  }[];
  globalTxns: { id: number; txn_type_id: string; name: string; status: string }[];
  overrides: {
    id: number;
    txn_type_id: string;
    office_id: number;
    name: string;
    status: string;
    available_from: string | null;
    available_until: string | null;
  }[];
}

export const fetchTxnOfficeMatrix = () =>
  get<TxnOfficeMatrix>("/txn-office-matrix", "Couldn't load the availability matrix.");

export const setTxnOfficeOverride = (body: {
  txnTypeId: string;
  officeId: number;
  status?: string;
  availableFrom?: string | null;
  availableUntil?: string | null;
}) => post<OkId>("/txn-office-override", "Couldn't update availability.", body);

export const deleteTxnOfficeOverride = (id: number) =>
  del<Ok>(`/txn-office-override/${id}`, "Couldn't clear that override.");

// ─── Clerks ──────────────────────────────────────────────────────────────────

export interface Clerk {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  skill_ids: number[];
  office_ids: number[];
}

export const fetchClerks = () => get<Clerk[]>("/clerks", "Couldn't load clerks.");

export const createClerk = (body: {
  firstName: string;
  lastName: string;
  email: string;
  status?: string;
  skillIds?: number[];
  officeIds?: number[];
}) => post<OkId>("/clerks", "Couldn't create the clerk.", body);

export const updateClerk = (
  id: number,
  body: {
    firstName?: string;
    lastName?: string;
    email?: string;
    status?: string;
    skillIds?: number[];
    officeIds?: number[];
  },
) => put<Ok>(`/clerks/${id}`, "Couldn't save the clerk.", body);

export const deleteClerk = (id: number) => del<Ok>(`/clerks/${id}`, "Couldn't delete the clerk.");

export const bulkImportClerks = (
  clerks: {
    firstName: string;
    lastName: string;
    email: string;
    status?: string;
    skillIds?: number[];
    officeIds?: number[];
  }[],
) =>
  post<{ ok: true; count: number; ids: number[] }>(
    "/clerks/bulk-import",
    "Couldn't import those clerks.",
    { clerks },
  );

// ─── Skills matrix ───────────────────────────────────────────────────────────

export interface SkillsMatrix {
  clerks: {
    id: number;
    first_name: string;
    last_name: string;
    skill_ids: number[];
    status: string;
  }[];
  txnTypes: { id: number; name: string }[];
}

export const fetchSkillsMatrix = () =>
  get<SkillsMatrix>("/skills-matrix", "Couldn't load the skills matrix.");

export const setClerkSkills = (clerkId: number, skillIds: number[]) =>
  put<Ok>(`/clerk-skills/${clerkId}`, "Couldn't save those skills.", { skillIds });

// ─── Hotbuttons ──────────────────────────────────────────────────────────────

export interface Hotbutton {
  id: number;
  sort_order: number;
  label: string;
  prompt: string;
}

export const fetchHotbuttons = () => get<Hotbutton[]>("/hotbuttons", "Couldn't load hotbuttons.");

export const createHotbutton = (body: { sortOrder?: number; label: string; prompt: string }) =>
  post<OkId>("/hotbuttons", "Couldn't create the hotbutton.", body);

export const updateHotbutton = (
  id: number,
  body: { sortOrder?: number; label?: string; prompt?: string },
) => put<Ok>(`/hotbuttons/${id}`, "Couldn't save the hotbutton.", body);

export const deleteHotbutton = (id: number) =>
  del<Ok>(`/hotbuttons/${id}`, "Couldn't delete the hotbutton.");

// ─── Prescreen questions ─────────────────────────────────────────────────────

export interface PrescreenQuestion {
  id: number;
  txn_type_id: number;
  sort_order: number;
  question_text: string;
  txn_name: string;
}

export const fetchPrescreenQuestions = () =>
  get<PrescreenQuestion[]>("/prescreen-questions", "Couldn't load pre-screen questions.");

export const createPrescreenQuestion = (body: {
  txnTypeId: number;
  sortOrder?: number;
  questionText: string;
}) => post<OkId>("/prescreen-questions", "Couldn't create the question.", body);

export const updatePrescreenQuestion = (
  id: number,
  body: { sortOrder?: number; questionText?: string },
) => put<Ok>(`/prescreen-questions/${id}`, "Couldn't save the question.", body);

export const deletePrescreenQuestion = (id: number) =>
  del<Ok>(`/prescreen-questions/${id}`, "Couldn't delete the question.");

// ─── Document registry ───────────────────────────────────────────────────────

export interface DocumentRegistryEntry {
  doc_id: string;
  name: string;
  description: string | null;
  alternatives: string[];
}

export const fetchDocumentRegistry = () =>
  get<DocumentRegistryEntry[]>("/document-registry", "Couldn't load the document registry.");

export const createDocument = (body: {
  docId: string;
  name: string;
  description?: string;
  alternatives?: string[];
}) => post<Ok>("/document-registry", "Couldn't create the document.", body);

export const updateDocument = (
  docId: string,
  body: { name?: string; description?: string; alternatives?: string[] },
) => put<Ok>(`/document-registry/${docId}`, "Couldn't save the document.", body);

export const deleteDocument = (docId: string) =>
  del<Ok>(`/document-registry/${docId}`, "Couldn't delete the document.");

// ─── Performance ─────────────────────────────────────────────────────────────

export interface PerformanceMetrics {
  avgByTxn: {
    txn_name: string;
    txn_type_id: number;
    avg_minutes: string | null;
    sample_count: number;
  }[];
  dailyTimes: { day: string; avg_minutes: string | null; count: number }[];
  dailyVolume: { day: string; customers_served: number }[];
  waitTimes: { avg_wait_minutes: string | null; sample_count: number };
  officeMetrics: {
    office_name: string;
    office_id: number;
    avg_service_minutes: string | null;
    total_served: number;
    avg_wait_minutes: string | null;
  }[];
}

export const fetchPerformanceMetrics = (days: number) =>
  get<PerformanceMetrics>(
    `/performance-metrics?days=${days}`,
    "Couldn't load performance metrics.",
  );

export interface ClerkPerformance {
  summary: {
    clerk_id: number;
    first_name: string;
    last_name: string;
    total_served: number;
    avg_minutes: string | null;
    min_minutes: string | null;
    max_minutes: string | null;
  }[];
  byTransactionType: {
    clerk_id: number;
    first_name: string;
    last_name: string;
    txn_name: string;
    txn_type_id: number;
    count: number;
    avg_minutes: string | null;
  }[];
}

export const fetchClerkPerformance = (days: number) =>
  get<ClerkPerformance>(`/clerk-performance?days=${days}`, "Couldn't load clerk performance.");

// ─── Duration recommendations ────────────────────────────────────────────────

export interface DurationRecommendation {
  id: number;
  txn_type_id: number;
  txn_name: string;
  current_avg_min: number;
  recommended_avg_min: number;
  sample_size: number;
  status: string;
  created_at: string;
}

export const fetchDurationRecommendations = () =>
  get<DurationRecommendation[]>(
    "/duration-recommendations",
    "Couldn't load duration recommendations.",
  );

export const approveDurationRecommendation = (id: number) =>
  post<Ok>(`/duration-recommendations/${id}/approve`, "Couldn't approve that recommendation.");

export const rejectDurationRecommendation = (id: number) =>
  post<Ok>(`/duration-recommendations/${id}/reject`, "Couldn't reject that recommendation.");
