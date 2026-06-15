import type { Pool, PoolClient } from "pg";
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
  db: Pool | PoolClient,
  countyId: string,
  qrCode: string,
): Promise<QrLookupResult | null> {
  const { rows } = await db.query(
    `SELECT id, office_id, status
     FROM appointments
     WHERE county_id = $1 AND qr_code = $2`,
    [countyId, qrCode],
  );
  if (rows.length === 0) return null;
  return camelRows<QrLookupResult>(rows)[0];
}

export interface CheckInResult {
  queueId: number;
  queueNumber: number;
}

export async function checkInToQueue(
  db: Pool | PoolClient,
  countyId: string,
  officeId: number,
  appointmentId: number,
  notes?: string,
): Promise<CheckInResult> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT check_in_to_queue($1, $2, $3, $4) AS id`,
    [countyId, officeId, appointmentId, notes ?? null],
  );
  const queueId = rows[0].id;

  const qRow = await db.query<{ queue_number: number }>(
    `SELECT queue_number FROM queue WHERE id = $1`,
    [queueId],
  );
  return { queueId, queueNumber: qRow.rows[0].queue_number };
}

export interface AppointmentDocument {
  id: number;
  docId: string | null;
  name: string;
  s3Key: string | null;
  aiReviewStatus: "accept" | "reject" | null;
  aiReviewNotes: string | null;
  createdAt: string;
}

export async function getAppointmentDocuments(
  db: Pool | PoolClient,
  countyId: string,
  appointmentId: number,
): Promise<AppointmentDocument[]> {
  const { rows } = await db.query(
    `SELECT id, doc_id, name, s3_key, ai_review_status, ai_review_notes, created_at
     FROM documents
     WHERE county_id = $1 AND appointment_id = $2
     ORDER BY created_at`,
    [countyId, appointmentId],
  );
  return camelRows<AppointmentDocument>(rows);
}

export interface DocStatus {
  docId: string;
  name: string;
  uploaded: boolean;
  aiReviewStatus: "accept" | "reject" | null;
}

export async function getRequiredDocsStatus(
  db: Pool | PoolClient,
  countyId: string,
  appointmentId: number,
): Promise<DocStatus[]> {
  const { rows } = await db.query(
    `SELECT dr.doc_id, dr.name,
            (d.id IS NOT NULL) AS uploaded,
            d.ai_review_status
     FROM appointments a
     CROSS JOIN LATERAL unnest(a.required_doc_ids) AS req(doc_id)
     JOIN document_registry dr
       ON dr.county_id = a.county_id AND dr.doc_id = req.doc_id
     LEFT JOIN documents d
       ON d.county_id = a.county_id
      AND d.appointment_id = a.id
      AND d.doc_id = req.doc_id
     WHERE a.county_id = $1 AND a.id = $2
     ORDER BY dr.doc_id`,
    [countyId, appointmentId],
  );
  return camelRows<DocStatus>(rows);
}

export interface WalkInInput {
  countyId: string;
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

export type WalkInOutcome =
  | { ok: true; appointmentId: number }
  | { ok: false; error: WalkInError };

const WALK_IN_ERROR_MAP: Record<string, WalkInError> = {
  P0002: "office_closed",
  P0003: "txn_unavailable",
};

export async function registerWalkIn(
  db: Pool | PoolClient,
  input: WalkInInput,
): Promise<WalkInOutcome> {
  try {
    const res = await db.query<{ register_walk_in: number }>(
      `SELECT register_walk_in($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.countyId,
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
    const code =
      err instanceof Error && "code" in err
        ? (err as { code: string }).code
        : null;
    const mapped = code ? WALK_IN_ERROR_MAP[code] : undefined;
    if (mapped) return { ok: false, error: mapped };
    throw err;
  }
}

export async function updateQueueNotes(
  db: Pool | PoolClient,
  countyId: string,
  queueId: number,
  notes: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE queue SET notes = $3 WHERE county_id = $1 AND id = $2`,
    [countyId, queueId, notes],
  );
  if (rowCount === 0) {
    throw new Error(`Queue entry ${queueId} not found`);
  }
}

export async function setAppointmentPriority(
  db: Pool | PoolClient,
  countyId: string,
  appointmentId: number,
  isPriority: boolean,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE appointments SET is_priority = $3 WHERE county_id = $1 AND id = $2`,
    [countyId, appointmentId, isPriority],
  );
  if (rowCount === 0) {
    throw new Error(`Appointment ${appointmentId} not found`);
  }
}
