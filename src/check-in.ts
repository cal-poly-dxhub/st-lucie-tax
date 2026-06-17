import { type Queryable } from "./utils.js";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { camelRows } from "./utils.js";

export function generateQrCode(): string {
  return randomUUID();
}

export async function generateQrCodeDataUrl(content: string): Promise<string> {
  return QRCode.toDataURL(content, { errorCorrectionLevel: "M", width: 200 });
}

export interface QrLookupResult {
  appointmentId: number;
  officeId: number;
  status: string;
}

export async function lookupByQrCode(
  db: Queryable,
  qrCode: string,
): Promise<QrLookupResult | null> {
  const { rows } = await db.query(
    `SELECT id AS appointment_id, office_id, status
     FROM appointments
     WHERE qr_code = $1`,
    [qrCode],
  );
  if (rows.length === 0) return null;
  return camelRows<QrLookupResult>(rows)[0];
}

export interface CheckInResult {
  queueId: number;
  queueNumber: number;
}

export async function checkInToQueue(
  db: Queryable,
  officeId: number,
  appointmentId: number,
  notes?: string,
): Promise<CheckInResult> {
  const { rows } = await db.query<{ id: number }>(`SELECT check_in_to_queue($1, $2, $3) AS id`, [
    officeId,
    appointmentId,
    notes ?? null,
  ]);
  const queueId = rows[0].id;

  const qRow = await db.query<{ queue_number: number }>(
    `SELECT queue_number FROM queue WHERE id = $1`,
    [queueId],
  );
  return { queueId, queueNumber: qRow.rows[0].queue_number };
}

export interface WalkInInput {
  officeId: number;
  txnTypeIds: number[];
  firstName: string;
  lastName: string;
  contactEmail: string;
  contactPhone: string;
  isPriority?: boolean;
  nowTs?: string;
}

export interface WalkInResult {
  appointmentId: number;
}

export type WalkInError = "office_closed" | "txn_unavailable";

export type WalkInOutcome = { ok: true; appointmentId: number } | { ok: false; error: WalkInError };

const WALK_IN_ERROR_MAP: Record<string, WalkInError> = {
  P0002: "office_closed",
  P0003: "txn_unavailable",
};

export async function registerWalkIn(db: Queryable, input: WalkInInput): Promise<WalkInOutcome> {
  try {
    const res = await db.query<{ register_walk_in: number }>(
      `SELECT register_walk_in($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.officeId,
        input.txnTypeIds,
        input.firstName,
        input.lastName,
        input.contactEmail,
        input.contactPhone,
        input.isPriority ?? false,
        input.nowTs ?? null,
      ],
    );
    return { ok: true, appointmentId: res.rows[0].register_walk_in };
  } catch (err: unknown) {
    const code = err instanceof Error && "code" in err ? (err as { code: string }).code : null;
    const mapped = code ? WALK_IN_ERROR_MAP[code] : undefined;
    if (mapped) return { ok: false, error: mapped };
    throw err;
  }
}

export async function updateQueueNotes(
  db: Queryable,
  queueId: number,
  notes: string,
): Promise<void> {
  const { rowCount } = await db.query(`UPDATE queue SET notes = $2 WHERE id = $1`, [
    queueId,
    notes,
  ]);
  if (rowCount === 0) {
    throw new Error(`Queue entry ${queueId} not found`);
  }
}

export async function setAppointmentPriority(
  db: Queryable,
  appointmentId: number,
  isPriority: boolean,
): Promise<void> {
  const { rowCount } = await db.query(`UPDATE appointments SET is_priority = $2 WHERE id = $1`, [
    appointmentId,
    isPriority,
  ]);
  if (rowCount === 0) {
    throw new Error(`Appointment ${appointmentId} not found`);
  }
}

export interface AppointmentInfo {
  appointmentId: number;
  firstName: string;
  lastName: string;
  identityVerified: boolean;
  prescreenCompleted: boolean;
  requiredDocIds: string[];
}

export async function getAppointmentInfo(
  db: Queryable,
  appointmentId: number,
): Promise<AppointmentInfo> {
  const { rows } = await db.query<{
    id: number;
    first_name: string;
    last_name: string;
    identity_verified: boolean;
    prescreen_completed: boolean;
    required_doc_ids: string[];
  }>(
    `SELECT id, first_name, last_name, identity_verified, prescreen_completed, required_doc_ids
     FROM appointments
     WHERE id = $1`,
    [appointmentId],
  );
  if (rows.length === 0) throw new Error(`Appointment ${appointmentId} not found`);

  const r = rows[0];
  return {
    appointmentId: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    identityVerified: r.identity_verified,
    prescreenCompleted: r.prescreen_completed,
    requiredDocIds: r.required_doc_ids,
  };
}

export interface CheckInSummary {
  appointmentId: number;
  firstName: string;
  lastName: string;
  identityVerified: boolean;
  prescreenCompleted: boolean;
  docsReady: boolean;
  missingDocs: string[];
  pendingDocs: string[];
}

export async function getCheckInSummary(
  db: Queryable,
  appointmentId: number,
): Promise<CheckInSummary> {
  const apptRes = await db.query<{
    id: number;
    first_name: string;
    last_name: string;
    identity_verified: boolean;
    prescreen_completed: boolean;
    required_doc_ids: string[];
  }>(
    `SELECT id, first_name, last_name, identity_verified, prescreen_completed, required_doc_ids
     FROM appointments
     WHERE id = $1`,
    [appointmentId],
  );
  if (apptRes.rows.length === 0) throw new Error(`Appointment ${appointmentId} not found`);

  const appt = apptRes.rows[0];

  const missingDocs: string[] = [];
  const pendingDocs: string[] = [];

  if (appt.required_doc_ids.length > 0) {
    const docRes = await db.query<{
      doc_id: string;
      clerk_validated: boolean | null;
    }>(
      `SELECT req.doc_id,
              bool_or(d.clerk_validated) AS clerk_validated
       FROM unnest($2::text[]) AS req(doc_id)
       LEFT JOIN documents d
         ON d.appointment_id = $1
        AND d.doc_id = req.doc_id
       GROUP BY req.doc_id
       ORDER BY req.doc_id`,
      [appointmentId, appt.required_doc_ids],
    );

    for (const row of docRes.rows) {
      if (row.clerk_validated === null) {
        missingDocs.push(row.doc_id);
      } else if (!row.clerk_validated) {
        pendingDocs.push(row.doc_id);
      }
    }
  }

  const docsReady = missingDocs.length === 0 && pendingDocs.length === 0;

  return {
    appointmentId: appt.id,
    firstName: appt.first_name,
    lastName: appt.last_name,
    identityVerified: appt.identity_verified,
    prescreenCompleted: appt.prescreen_completed,
    docsReady,
    missingDocs,
    pendingDocs,
  };
}
