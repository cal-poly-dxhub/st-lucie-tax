// API client + response shapes — mirrors server/routes/check-in.ts.
// All requests go through the Vite proxy to the official server (port 3000).

export interface DocStatus {
  id: number | null;
  docId: string;
  name: string;
  uploaded: boolean;
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
}

export interface ConfigResponse {
  offices: Office[];
  txnTypes: TxnType[];
  demoDate: string;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
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

  checkIn: (appointmentId: number, officeId: number, notes: string, priority: boolean) =>
    post<{ ok: boolean; queueId: number; queueNumber: number }>("/api/check-in", {
      appointmentId,
      officeId,
      notes,
      priority,
    }),

  sendPrescreen: (appointmentId: number) =>
    post<{ ok: boolean; prescreenUrl: string; sentTo: string }>("/api/send-prescreen", {
      appointmentId,
    }),
};
