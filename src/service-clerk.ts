import type { Pool, PoolClient } from "pg";
import { camelRows } from "./utils.js";
import type { DocStatus } from "./documents.js";

export interface ClerkServiceRecord {
  appointmentId: number;
  queueId: number;
  queueNumber: number;
  firstName: string;
  lastName: string;
  contactEmail: string;
  contactPhone: string;
  txnTypes: { id: number; name: string }[];
  identityVerified: boolean;
  prescreenCompleted: boolean;
  prescreenResponses: Record<string, boolean>;
  docs: DocStatus[];
  notes: string | null;
  isPriority: boolean;
}

export async function getClerkServiceRecord(
  db: Pool | PoolClient,
  countyId: string,
  queueId: number,
): Promise<ClerkServiceRecord> {
  const qRow = await db.query<{
    queue_id: number;
    queue_number: number;
    notes: string | null;
    appointment_id: number;
    first_name: string;
    last_name: string;
    contact_email: string;
    contact_phone: string;
    txn_type_ids: number[];
    required_doc_ids: string[];
    identity_verified: boolean;
    prescreen_completed: boolean;
    prescreen_responses: Record<string, boolean>;
    is_priority: boolean;
  }>(
    `SELECT q.id AS queue_id,
            q.queue_number,
            q.notes,
            a.id AS appointment_id,
            a.first_name,
            a.last_name,
            a.contact_email,
            a.contact_phone,
            a.txn_type_ids,
            a.required_doc_ids,
            a.identity_verified,
            a.prescreen_completed,
            a.prescreen_responses,
            a.is_priority
     FROM queue q
     JOIN appointments a ON a.id = q.appointment_id
     WHERE q.county_id = $1 AND q.id = $2`,
    [countyId, queueId],
  );

  if (qRow.rows.length === 0) throw new Error(`Queue entry ${queueId} not found`);
  const r = qRow.rows[0];

  const txnRes = await db.query<{ id: number; name: string }>(
    `SELECT id, name
     FROM transaction_types
     WHERE county_id = $1 AND id = ANY($2::int[]) AND office_id IS NULL
     ORDER BY id`,
    [countyId, r.txn_type_ids],
  );

  let docs: DocStatus[] = [];
  if (r.required_doc_ids.length > 0) {
    const docRes = await db.query(
      `SELECT dr.doc_id, dr.name,
              (d.id IS NOT NULL) AS uploaded,
              d.ai_review_status
       FROM unnest($3::text[]) AS req(doc_id)
       JOIN document_registry dr ON dr.county_id = $1 AND dr.doc_id = req.doc_id
       LEFT JOIN documents d
         ON d.county_id = $1
        AND d.appointment_id = $2
        AND d.doc_id = req.doc_id
       ORDER BY dr.doc_id`,
      [countyId, r.appointment_id, r.required_doc_ids],
    );
    docs = camelRows<DocStatus>(docRes.rows);
  }

  return {
    appointmentId: r.appointment_id,
    queueId: r.queue_id,
    queueNumber: r.queue_number,
    firstName: r.first_name,
    lastName: r.last_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    txnTypes: txnRes.rows,
    identityVerified: r.identity_verified,
    prescreenCompleted: r.prescreen_completed,
    prescreenResponses: r.prescreen_responses ?? {},
    docs,
    notes: r.notes,
    isPriority: r.is_priority,
  };
}

export async function sendToWrittenTest(
  db: Pool | PoolClient,
  countyId: string,
  queueId: number,
  testStationId: number,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE queue
     SET status = 'testing', assigned_desk = $3
     WHERE county_id = $1 AND id = $2 AND status = 'serving'`,
    [countyId, queueId, testStationId],
  );
  if (rowCount === 0) {
    throw new Error(`Queue entry ${queueId} not found or not in serving status`);
  }
}
