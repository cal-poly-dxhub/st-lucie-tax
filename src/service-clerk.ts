import { type Queryable } from "./utils.js";
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
  steps: Record<string, boolean>;
}

export async function getClerkServiceRecord(
  db: Queryable,
  queueId: number,
): Promise<ClerkServiceRecord> {
  const qRow = await db.query<{
    queue_id: number;
    queue_number: number;
    notes: string | null;
    steps: Record<string, boolean>;
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
            q.steps,
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
     WHERE q.id = $1`,
    [queueId],
  );

  if (qRow.rows.length === 0) throw new Error(`Queue entry ${queueId} not found`);
  const r = qRow.rows[0];

  const txnRes = await db.query<{ id: number; name: string }>(
    `SELECT id, name
     FROM transaction_types
     WHERE id = ANY($1::int[]) AND office_id IS NULL
     ORDER BY id`,
    [r.txn_type_ids],
  );

  let docs: DocStatus[] = [];
  if (r.required_doc_ids.length > 0) {
    const docRes = await db.query(
      `SELECT dr.doc_id, dr.name,
              (d.id IS NOT NULL) AS uploaded,
              d.s3_key,
              d.ai_review_status,
              d.ai_review_notes,
              COALESCE(d.clerk_validated, FALSE) AS clerk_validated
       FROM unnest($2::text[]) AS req(doc_id)
       JOIN document_registry dr ON dr.doc_id = req.doc_id
       LEFT JOIN documents d
         ON d.appointment_id = $1
        AND d.doc_id = req.doc_id
       ORDER BY dr.doc_id`,
      [r.appointment_id, r.required_doc_ids],
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
    steps: r.steps ?? {},
  };
}

export interface SendToWrittenTestInput {
  queueId: number;
  testStationId: number;
  clerkId: number;
  officeId: number;
}

export async function sendToWrittenTest(
  db: Queryable,
  input: SendToWrittenTestInput,
): Promise<void> {
  const { queueId, testStationId, clerkId, officeId } = input;

  const qRow = await db.query<{ appointment_id: number; status: string }>(
    `SELECT appointment_id, status FROM queue WHERE id = $1`,
    [queueId],
  );
  if (qRow.rows.length === 0) throw new Error(`Queue entry ${queueId} not found`);
  if (qRow.rows[0].status !== "serving")
    throw new Error(`Queue entry ${queueId} not in serving status`);

  const { appointment_id: appointmentId } = qRow.rows[0];

  await db.query(
    `UPDATE queue
     SET status = 'testing', assigned_desk = $2, assigned_clerk_id = NULL
     WHERE id = $1`,
    [queueId, testStationId],
  );

  const shRes = await db.query<{ id: number }>(
    `INSERT INTO service_history (office_id, appointment_id, clerk_id, duration_sec)
     SELECT $1, $2, $4, EXTRACT(EPOCH FROM (NOW() - served_at))::int
     FROM queue WHERE id = $3
     RETURNING id`,
    [officeId, appointmentId, queueId, clerkId],
  );
  const { id: serviceHistoryId } = shRes.rows[0];

  const txnRow = await db.query<{ txn_type_ids: number[] }>(
    `SELECT txn_type_ids FROM appointments WHERE id = $1`,
    [appointmentId],
  );
  const txnTypeIds = txnRow.rows[0].txn_type_ids;
  if (txnTypeIds.length > 0) {
    const values = txnTypeIds.map((tid, i) => `($1, $${i + 2})`).join(", ");
    await db.query(
      `INSERT INTO service_history_txn_types (service_history_id, txn_type_id) VALUES ${values}`,
      [serviceHistoryId, ...txnTypeIds],
    );
  }

  await db.query(
    `UPDATE clerk_sessions SET is_available = TRUE
     WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
    [clerkId, officeId],
  );
}

export async function completeWrittenTest(db: Queryable, queueId: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE queue
     SET status = 'waiting', is_returning = TRUE, assigned_desk = NULL, served_at = NULL
     WHERE id = $1 AND status = 'testing'`,
    [queueId],
  );
  if (rowCount === 0) {
    throw new Error(`Queue entry ${queueId} not found or not in testing status`);
  }
  // TODO: expose via public API so customer can self-submit in the future
}
