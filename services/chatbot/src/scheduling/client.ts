/**
 * Scheduling integration — queries the shared PostgreSQL directly.
 *
 * Now that chatbot and office share a database with unified hyphenated
 * txn_type_id values, we resolve integer IDs and call book_appointment()
 * directly rather than going through an HTTP intermediary.
 */

import { getPool } from "@st-lucie/data-access";

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

export async function findSlot(opts: {
  chatbotTxnIds: string[];
  startDate?: string;
  maxDays?: number;
}): Promise<SlotResult> {
  const pool = getPool();

  const { rows: txnRows } = await pool.query<{ id: number; txn_type_id: string }>(
    `SELECT id, txn_type_id FROM transaction_types
     WHERE txn_type_id = ANY($1) AND office_id IS NULL`,
    [opts.chatbotTxnIds],
  );

  const mapped = new Set(txnRows.map((r) => r.txn_type_id));
  const unmapped = opts.chatbotTxnIds.filter((id) => !mapped.has(id));
  const txnTypeIds = txnRows.map((r) => r.id);

  if (txnTypeIds.length === 0) {
    return { slot: null, reason: null, unmapped, schedulable: false };
  }

  const startDate = opts.startDate ?? tomorrow();
  const maxDays = opts.maxDays ?? 30;

  const { rows: slotRows } = await pool.query<{
    office_id: number;
    office_name: string;
    slot_date: string;
    slot_time: string;
  }>(
    `WITH candidate_dates AS (
       SELECT generate_series($1::date, $1::date + ($2 - 1), '1 day')::date AS d
     ),
     candidate_slots AS (
       SELECT o.id AS office_id, o.name AS office_name, cd.d AS slot_date,
              generate_series(oh.open_time, oh.close_time - interval '1 minute', interval '15 minutes')::time AS slot_time
       FROM offices o
       JOIN candidate_dates cd ON true
       JOIN office_hours oh ON oh.office_id = o.id AND oh.day_of_week = EXTRACT(DOW FROM cd.d)::int
     )
     SELECT cs.office_id, cs.office_name, cs.slot_date::text, cs.slot_time::text
     FROM candidate_slots cs
     WHERE validate_slot(cs.office_id, cs.slot_date, cs.slot_time, $3, (
       SELECT COALESCE(SUM(avg_duration_min), 0)::int
       FROM transaction_types WHERE id = ANY($3) AND office_id IS NULL
     )) > 0
     ORDER BY cs.slot_date, cs.slot_time, cs.office_id
     LIMIT 1`,
    [startDate, maxDays, txnTypeIds],
  );

  if (slotRows.length === 0) {
    return { slot: null, reason: "no-availability", unmapped, schedulable: true };
  }

  const row = slotRows[0];
  return {
    slot: {
      officeId: row.office_id,
      officeName: row.office_name,
      date: row.slot_date.slice(0, 10),
      time: row.slot_time,
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
}): Promise<BookResult> {
  const pool = getPool();

  const { rows: txnRows } = await pool.query<{ id: number }>(
    `SELECT id FROM transaction_types
     WHERE txn_type_id = ANY($1) AND office_id IS NULL`,
    [opts.chatbotTxnIds],
  );
  const txnTypeIds = txnRows.map((r) => r.id);

  const { rows } = await pool.query<{ id: number; confirmation_code: string }>(
    `SELECT * FROM book_appointment($1, $2::date, $3::time, $4, '{}',
       $5, $6, $7, $8)`,
    [
      opts.officeId,
      opts.date,
      opts.time,
      txnTypeIds,
      opts.firstName,
      opts.lastName,
      opts.email,
      opts.phone,
    ],
  );

  if (rows.length === 0) {
    throw Object.assign(new Error("Slot just taken"), { code: "SLOT_TAKEN" });
  }

  const { rows: officeRows } = await pool.query<{ name: string }>(
    `SELECT name FROM offices WHERE id = $1`,
    [opts.officeId],
  );

  return {
    appointmentId: rows[0].id,
    qrCode: rows[0].confirmation_code,
    slot: {
      officeId: opts.officeId,
      officeName: officeRows[0]?.name ?? "",
      date: opts.date,
      time: opts.time,
    },
  };
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
