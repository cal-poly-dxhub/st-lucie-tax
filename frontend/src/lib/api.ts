import { getIdToken } from "./auth";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export interface DocStatus {
  id: number | null;
  docId: string;
  name: string;
  uploaded: boolean;
  s3Key: string | null;
  aiReviewStatus: "accept" | "reject" | null;
  aiReviewNotes: string | null;
  clerkValidated: boolean;
}

export interface CustomerRecord {
  found: true;
  appointmentId: number;
  confirmationCode: string;
  officeId: number;
  status: string;
  firstName: string;
  lastName: string;
  identityVerified: boolean;
  prescreenCompleted: boolean;
  requiredDocIds: string[];
  docs: DocStatus[];
}

export type LookupResult = CustomerRecord | { found: false };

export interface NameMatch {
  appointmentId: number;
  officeId: number;
  firstName: string;
  lastName: string;
  appointmentTime: string | null;
}

export interface Office {
  id: number;
  name: string;
  total_desks: number;
  run_rate_pct: number;
}

export interface TxnType {
  id: number;
  slug: string;
  name: string;
  duration: number;
  status: string;
  requiredDocs?: { docId: string; name: string }[];
}

export interface LunchShift {
  id: number;
  office_id: number;
  shift_num: number;
  start_time: string;
  end_time: string;
}

export interface OfficeHours {
  office_id: number;
  day_of_week: number;
  open_time: string;
  close_time: string;
}

export interface ConfigResponse {
  offices: Office[];
  txnTypes: TxnType[];
  lunchShifts: LunchShift[];
  officeHours: OfficeHours[];
  demoDate: string;
}

export interface Clerk {
  id: number;
  first_name: string;
  last_name: string;
  skill_ids: number[];
  skill_names: string[];
}

export interface QueueEntry {
  id: number;
  queue_number: number;
  status: string;
  assigned_desk: number | null;
  confirmation_code: string;
  is_priority?: boolean;
  first_name?: string;
  last_name?: string;
  txn_type_ids?: number[];
  checked_in_at?: string;
}

export interface ClerkSession {
  desk_number: number;
  is_available: boolean;
  name?: string;
}

export interface LiveQueueResponse {
  queue: QueueEntry[];
  clerks: ClerkSession[];
  txnTypes?: TxnType[];
}

export interface ServiceRecord {
  queueId: number;
  queueNumber: number;
  firstName: string;
  lastName: string;
  isPriority: boolean;
  identityVerified: boolean;
  prescreenCompleted: boolean;
  txnTypes: { id: number; name: string }[];
  docs: DocStatus[];
  notes: string | null;
  prescreenResponses: Record<string, boolean>;
  prescreenWithText?: { questionId: string; questionText: string; answer: boolean }[];
  steps: Record<string, boolean>;
}

export interface PrescreenQuestion {
  id: number;
  questionText: string;
}

export interface PrescreenData {
  appointmentId: number;
  firstName: string;
  lastName: string;
  prescreenCompleted: boolean;
  questions: PrescreenQuestion[];
}

export interface ScheduleAppointment {
  id: number;
  office_id: number;
  appointment_date: string;
  start_time: string;
  txn_type_ids: number[];
  first_name: string;
  last_name: string;
  status: string;
  duration_min: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
  const res = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

async function get<T>(url: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${url}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  config: () => get<ConfigResponse>("/api/config"),

  lookup: (confirmationCode: string) => post<LookupResult>("/api/lookup", { confirmationCode }),

  lookupById: (appointmentId: number) => post<LookupResult>("/api/lookup-by-id", { appointmentId }),

  searchName: (query: string, officeId: number, date: string) =>
    post<NameMatch[]>("/api/search-name", { query, officeId, date }),

  verifyIdentity: (appointmentId: number) =>
    post<{ ok: boolean }>("/api/verify-identity", { appointmentId }),

  validateDocument: (documentId: number) =>
    post<{ ok: boolean }>("/api/validate-document", { documentId }),

  getDocumentUrl: (documentId: number) =>
    get<{ url: string; name: string }>(`/api/clerk/document-url/${documentId}`),

  uploadDocument: async (input: { appointmentId: number; docId: string; file: File }) => {
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return post<{ ok: boolean; documentId: number; s3Key: string }>("/api/upload-document", {
      appointmentId: input.appointmentId,
      docId: input.docId,
      name: input.file.name,
      contentType: input.file.type || "application/octet-stream",
      dataBase64: btoa(binary),
    });
  },

  checkIn: (appointmentId: number, officeId: number, notes: string, priority: boolean) =>
    post<{ ok: boolean; queueId: number; queueNumber: number }>("/api/check-in", {
      appointmentId,
      officeId,
      notes,
      priority,
    }),

  sendPrescreen: (appointmentId: number, autoCheckIn?: boolean, priority?: boolean) =>
    post<{ ok: boolean; prescreenUrl: string; sentTo: string }>("/api/send-prescreen", {
      appointmentId,
      autoCheckIn,
      priority,
    }),

  sendConfirmation: (cfg: { prescreen: boolean; identity: boolean; docs: string }) =>
    post<{ ok: boolean; confirmationCode?: string; error?: string }>("/api/send-confirmation", cfg),

  demoBook: (data: {
    firstName: string;
    lastName: string;
    email: string;
    txnTypeIds: number[];
    officeId?: number;
    preferredTime?: "morning" | "afternoon" | null;
    preferredDow?: number | null;
  }) =>
    post<{
      ok: boolean;
      appointmentId: number;
      confirmationCode: string;
      officeId: number;
      officeName: string;
      date: string;
      time: string;
      dateFormatted: string;
      timeFormatted: string;
    }>("/api/demo-book", data),

  setDemoEmail: (email: string) =>
    post<{ ok: boolean; email: string; note: string }>("/api/set-demo-email", { email }),

  verifyEmail: (email: string) =>
    post<{ ok: boolean; status: string }>("/api/verify-email", { email }),

  verifyEmailStatus: (email: string) =>
    get<{ email: string; verified: boolean }>(
      `/api/verify-email-status?email=${encodeURIComponent(email)}`,
    ),

  // Queue / Clerk
  clerks: (officeId: number) => get<{ clerks: Clerk[] }>(`/api/clerks?officeId=${officeId}`),

  clerkLogin: (clerkId: number, officeId: number, deskNumber: number) =>
    post<{ ok: boolean; error?: string }>("/api/clerk/login", { clerkId, officeId, deskNumber }),

  clerkAvailability: (clerkId: number, officeId: number, available: boolean) =>
    post<{ ok: boolean }>("/api/clerk/availability", { clerkId, officeId, available }),

  clerkSummonNext: (clerkId: number, officeId: number) =>
    post<{ ok: boolean; assigned: boolean; queueId?: number; deskNumber?: number }>(
      "/api/clerk/summon-next",
      { clerkId, officeId },
    ),

  clerkServing: (clerkId: number, officeId: number) =>
    get<{ serving: boolean; record?: ServiceRecord }>(
      `/api/clerk/serving?clerkId=${clerkId}&officeId=${officeId}`,
    ),

  clerkComplete: (queueId: number, clerkId: number, officeId: number) =>
    post<{ ok: boolean; durationSec: number }>("/api/clerk/complete", {
      queueId,
      clerkId,
      officeId,
    }),

  clerkCompleteAndNext: (queueId: number, clerkId: number, officeId: number) =>
    post<{ ok: boolean; durationSec: number; next: ServiceRecord | null }>(
      "/api/clerk/complete-and-next",
      { queueId, clerkId, officeId },
    ),

  clerkRecordStep: (queueId: number, step: string) =>
    post<{ ok: boolean; steps: Record<string, boolean> }>("/api/clerk/record-step", {
      queueId,
      step,
    }),

  liveQueue: () => get<LiveQueueResponse>("/api/live-queue"),

  seedQueue: () => post<{ ok: boolean; seeded: unknown[] }>("/api/seed-queue", {}),

  walkIn: (data: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    txns: string[];
    officeId: number;
    priority: boolean;
    identityVerified: boolean;
    notes: string;
  }) =>
    post<{
      ok: boolean;
      appointmentId?: number;
      confirmationCode?: string;
      pendingPrescreen?: boolean;
      queueNumber?: number;
    }>("/api/walk-in", data),

  // Schedule
  scheduleAppointments: (officeId: number, startDate: string, endDate: string) =>
    get<ScheduleAppointment[]>(
      `/api/schedule/appointments?officeId=${officeId}&startDate=${startDate}&endDate=${endDate}`,
    ),

  reschedule: (appointmentId: number, newDate: string, newTime: string, force: boolean) =>
    post<{ success: boolean; error?: string }>("/api/schedule/reschedule", {
      appointmentId,
      newDate,
      newTime,
      force,
    }),

  // Prescreen (customer-facing)
  prescreenLoad: (confirmationCode: string) =>
    get<PrescreenData>(`/api/prescreen/${confirmationCode}`),

  prescreenSubmit: (
    confirmationCode: string,
    responses: Record<string, boolean>,
    autoCheckIn: boolean,
    priority: boolean,
  ) =>
    post<{ ok: boolean; checkedIn?: boolean; queueNumber?: number }>(
      `/api/prescreen/${confirmationCode}/submit`,
      { responses, autoCheckIn, priority },
    ),

  submitFeedback: (data: { name?: string; message: string }) =>
    post<{ ok: boolean }>("/api/feedback", data),
};
