/**
 * The ONLY chatbot code that knows the scheduling service's HTTP shape.
 * If the devs change their API, this file (and txn-map.ts) is where it's fixed.
 *
 * Reads SCHEDULING_API_URL (empty = scheduling unavailable) and
 * SCHEDULING_COUNTY_ID. All calls send the x-county-id header their service
 * requires.
 */
import { mapTransactions, type SchedulingTxnType } from "./txn-map.js";

const BASE_URL = process.env.SCHEDULING_API_URL ?? "";
const COUNTY_ID = process.env.SCHEDULING_COUNTY_ID ?? "stlucie";

export function schedulingEnabled(): boolean {
  return BASE_URL.length > 0;
}

function headers(): Record<string, string> {
  return { "x-county-id": COUNTY_ID, "Content-Type": "application/json" };
}

export interface OfferedSlot {
  officeId: number;
  officeName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
}

export interface SlotResult {
  slot: OfferedSlot | null;
  reason: string | null;
  unmapped: string[];
  schedulable: boolean;
}

async function listTypes(): Promise<SchedulingTxnType[]> {
  const res = await fetch(`${BASE_URL}/api/transaction-types`, { headers: headers() });
  if (!res.ok) throw new Error(`scheduling transaction-types failed: ${res.status}`);
  return res.json() as Promise<SchedulingTxnType[]>;
}

export async function findSlot(opts: {
  chatbotTxnIds: string[];
  startDate?: string;
  maxDays?: number;
}): Promise<SlotResult> {
  const types = await listTypes();
  const { ids, unmapped } = mapTransactions(opts.chatbotTxnIds, types);
  if (ids.length === 0) {
    return { slot: null, reason: null, unmapped, schedulable: false };
  }
  const qs = new URLSearchParams({ txn_type_ids: ids.join(",") });
  if (opts.startDate) qs.set("start_date", opts.startDate);
  if (opts.maxDays) qs.set("max_days", String(opts.maxDays));
  const res = await fetch(`${BASE_URL}/api/scheduling/slots?${qs.toString()}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`scheduling slots failed: ${res.status}`);
  const body = (await res.json()) as {
    slot: { office_id: number; office_name: string; date: string; time: string } | null;
    reason: string | null;
  };
  return {
    slot: body.slot
      ? {
          officeId: body.slot.office_id,
          officeName: body.slot.office_name,
          date: body.slot.date,
          time: body.slot.time,
        }
      : null,
    reason: body.reason,
    unmapped,
    schedulable: true,
  };
}

export interface BookResult {
  appointmentId: number;
  qrCode: string;
  slot: OfferedSlot;
}

export async function book(opts: {
  chatbotTxnIds: string[];
  officeId: number;
  date: string;
  time: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}): Promise<BookResult> {
  const types = await listTypes();
  const { ids } = mapTransactions(opts.chatbotTxnIds, types);
  const res = await fetch(`${BASE_URL}/api/appointments`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      office_id: opts.officeId,
      first_name: opts.firstName,
      last_name: opts.lastName,
      contact_email: opts.email,
      contact_phone: opts.phone,
      txn_type_ids: ids,
      appointment_date: opts.date,
      appointment_time: opts.time,
    }),
  });
  if (res.status === 409) {
    throw Object.assign(new Error("Slot just taken"), { code: "SLOT_TAKEN" });
  }
  if (!res.ok) throw new Error(`scheduling book failed: ${res.status}`);
  const row = (await res.json()) as {
    id: number;
    qr_code: string;
    office_id: number;
    appointment_date: string;
    appointment_time: string;
  };
  return {
    appointmentId: row.id,
    qrCode: row.qr_code,
    // pg serializes the `date` column to a full ISO timestamp (e.g.
    // 2026-05-13T07:00:00.000Z); slice to the bare YYYY-MM-DD the UI expects.
    slot: {
      officeId: row.office_id,
      officeName: "",
      date: row.appointment_date.slice(0, 10),
      time: row.appointment_time,
    },
  };
}
