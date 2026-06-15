import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";

export function generateQrCode(): string {
  return randomUUID();
}

export async function generateQrCodeDataUrl(content: string): Promise<string> {
  return QRCode.toDataURL(content, { errorCorrectionLevel: "M", width: 200 });
}

export async function lookupByQrCode(
  db: Pool | PoolClient,
  countyId: string,
  qrCode: string,
): Promise<{ appointmentId: number; officeId: number; status: string } | null> {
  const { rows } = await db.query<{
    id: number;
    office_id: number;
    status: string;
  }>(
    `SELECT id, office_id, status FROM appointments WHERE county_id = $1 AND qr_code = $2`,
    [countyId, qrCode],
  );
  if (rows.length === 0) return null;
  return {
    appointmentId: rows[0].id,
    officeId: rows[0].office_id,
    status: rows[0].status,
  };
}

export interface CheckInResult {
  queueId: number;
  queueNumber: number;
}

export interface AssignResult {
  queueId: number;
  deskNumber: number;
  clerkId: number;
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

export async function assignNextCustomer(
  db: Pool | PoolClient,
  countyId: string,
  officeId: number,
  clerkId: number,
): Promise<AssignResult | null> {
  const { rows } = await db.query<{ queue_id: number | null }>(
    `SELECT assign_next_customer($1, $2, $3) AS queue_id`,
    [countyId, officeId, clerkId],
  );
  const queueId = rows[0].queue_id;
  if (queueId === null) return null;

  const qRow = await db.query<{
    assigned_desk: number;
    assigned_clerk_id: number;
  }>(`SELECT assigned_desk, assigned_clerk_id FROM queue WHERE id = $1`, [
    queueId,
  ]);
  return {
    queueId,
    deskNumber: qRow.rows[0].assigned_desk,
    clerkId: qRow.rows[0].assigned_clerk_id,
  };
}
