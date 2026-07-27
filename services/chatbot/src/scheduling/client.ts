/**
 * Scheduling integration — thin adapter over the canonical Office Operations
 * scheduling engine.
 *
 * Office Operations owns slot search and booking (`@st-lucie/office-ops/scheduling`).
 * This module only translates between the chatbot's hyphenated txn_type_id
 * strings and the integer transaction IDs that engine expects; it deliberately
 * carries no scheduling logic of its own, so the chatbot and the office UI can
 * never disagree about which times exist.
 */

import { getPool } from "@st-lucie/data-access";
import { findAppointment, bookAppointment } from "@st-lucie/office-ops/scheduling";

export function schedulingEnabled(): boolean {
  return true;
}

export interface OfferedSlot {
  officeId: number;
  officeName: string;
  date: string;
  time: string;
}

export interface SlotResult {
  slot: OfferedSlot | null;
  reason: string | null;
  unmapped: string[];
  schedulable: boolean;
}

/** Default search horizon when the caller doesn't specify one. */
const DEFAULT_LOOKAHEAD_DAYS = 30;

/**
 * Resolves chatbot txn_type_id strings to the global integer IDs the
 * scheduling engine takes. Only office-agnostic (`office_id IS NULL`) active
 * rows are bookable, so anything else counts as unmapped.
 */
async function resolveTxnIds(
  chatbotTxnIds: string[],
): Promise<{ txnTypeIds: number[]; unmapped: string[] }> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: number; txn_type_id: string }>(
    `SELECT id, txn_type_id FROM transaction_types
     WHERE txn_type_id = ANY($1) AND office_id IS NULL AND status = 'active'`,
    [chatbotTxnIds],
  );

  const mapped = new Set(rows.map((r) => r.txn_type_id));
  return {
    txnTypeIds: rows.map((r) => r.id),
    unmapped: chatbotTxnIds.filter((id) => !mapped.has(id)),
  };
}

export async function findSlot(opts: {
  chatbotTxnIds: string[];
  startDate?: string;
  maxDays?: number;
  /** Local "now" override for deterministic tests; matches book_appointment(p_now_ts). */
  nowTs?: string;
}): Promise<SlotResult> {
  const pool = getPool();
  const { txnTypeIds, unmapped } = await resolveTxnIds(opts.chatbotTxnIds);

  // A partial match means at least one requested transaction isn't bookable;
  // scheduling a subset would silently drop it from the appointment.
  if (txnTypeIds.length !== opts.chatbotTxnIds.length) {
    return { slot: null, reason: null, unmapped, schedulable: false };
  }

  const slot = await findAppointment(pool, {
    targetTxns: txnTypeIds,
    asap: true,
    preferredOffice: null,
    preferredDow: null,
    preferredTime: null,
    startDate: opts.startDate ? new Date(`${opts.startDate}T00:00:00Z`) : new Date(),
    days: opts.maxDays ?? DEFAULT_LOOKAHEAD_DAYS,
    nowTs: opts.nowTs,
  });

  if (slot === null) {
    return { slot: null, reason: "no-availability", unmapped, schedulable: true };
  }

  const { rows: officeRows } = await pool.query<{ name: string }>(
    `SELECT name FROM offices WHERE id = $1`,
    [slot.officeId],
  );

  return {
    slot: {
      officeId: slot.officeId,
      officeName: officeRows[0]?.name ?? "",
      date: slot.slotDate.slice(0, 10),
      time: slot.slotTime,
    },
    reason: null,
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
  nowTs?: string;
}): Promise<BookResult> {
  const pool = getPool();
  const { txnTypeIds } = await resolveTxnIds(opts.chatbotTxnIds);

  if (txnTypeIds.length !== opts.chatbotTxnIds.length) {
    throw Object.assign(new Error("Transaction not bookable"), { code: "TXN_UNAVAILABLE" });
  }

  const result = await bookAppointment(pool, {
    officeId: opts.officeId,
    date: opts.date,
    time: opts.time,
    txnTypeIds,
    requiredDocIds: [],
    firstName: opts.firstName,
    lastName: opts.lastName,
    contactEmail: opts.email,
    contactPhone: opts.phone,
    nowTs: opts.nowTs,
  });

  if (!result.ok) {
    throw bookErrorToThrowable(result.error);
  }

  const { rows: officeRows } = await pool.query<{ name: string }>(
    `SELECT name FROM offices WHERE id = $1`,
    [opts.officeId],
  );

  return {
    appointmentId: result.appointmentId,
    qrCode: result.confirmationCode,
    slot: {
      officeId: opts.officeId,
      officeName: officeRows[0]?.name ?? "",
      date: opts.date,
      time: opts.time,
    },
  };
}

/**
 * Turns bookAppointment()'s typed rejections into thrown errors carrying the
 * codes the route layer maps to HTTP statuses. capacity_exceeded and
 * slot_in_past are retryable with a fresh slot; the others are terminal.
 */
function bookErrorToThrowable(
  error: "slot_in_past" | "capacity_exceeded" | "office_closed" | "txn_unavailable",
): Error {
  switch (error) {
    case "capacity_exceeded":
    case "slot_in_past":
      return Object.assign(new Error("Slot just taken"), { code: "SLOT_TAKEN" });
    case "office_closed":
      return Object.assign(new Error("Office closed at that time"), { code: "OFFICE_CLOSED" });
    case "txn_unavailable":
      return Object.assign(new Error("Transaction not bookable at that time"), {
        code: "TXN_UNAVAILABLE",
      });
  }
}
