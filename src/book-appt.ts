import { type Queryable } from "./utils.js";

export interface BookApptInput {
  officeId: number;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:MM:SS'
  txnTypeIds: number[];
  requiredDocIds: string[];
  prescreenCompleted?: boolean;
  prescreenResponses?: Record<string, boolean>;
  firstName: string;
  lastName: string;
  contactEmail: string;
  contactPhone: string;
  qrCode?: string | null;
  isWalkIn?: boolean;
  isPriority?: boolean;
  nowTs?: string; // 'YYYY-MM-DD HH:MM' local time — defaults to now in config.timezone. Used only in testing.
}

export type BookApptError =
  | "slot_in_past"
  | "capacity_exceeded"
  | "office_closed"
  | "txn_unavailable";

export type BookApptResult =
  | { ok: true; appointmentId: number }
  | { ok: false; error: BookApptError };

export const PG_ERROR_MAP: Record<string, BookApptError> = {
  P0001: "capacity_exceeded",
  P0002: "office_closed",
  P0003: "txn_unavailable",
  P0004: "slot_in_past",
};

export async function bookAppointment(
  db: Queryable,
  input: BookApptInput,
): Promise<BookApptResult> {
  try {
    const result = await db.query<{ book_appointment: number }>(
      `SELECT book_appointment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        input.officeId,
        input.date,
        input.time,
        input.txnTypeIds,
        input.requiredDocIds,
        input.firstName,
        input.lastName,
        input.contactEmail,
        input.contactPhone,
        input.qrCode ?? null,
        input.isWalkIn ?? false,
        input.isPriority ?? false,
        input.prescreenCompleted ?? false,
        JSON.stringify(input.prescreenResponses ?? {}),
        input.nowTs ?? null,
      ],
    );
    return { ok: true, appointmentId: result.rows[0].book_appointment };
  } catch (err: unknown) {
    const code = err instanceof Error && "code" in err ? (err as { code: string }).code : null;
    const mapped = code ? PG_ERROR_MAP[code] : undefined;
    if (mapped) return { ok: false, error: mapped };
    throw err;
  }
}
