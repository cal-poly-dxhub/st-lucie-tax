import { type Queryable } from "./utils.js";

export interface CompleteAppointmentInput {
  officeId: number;
  queueId: number;
  clerkId: number;
}

export interface CompleteAppointmentResult {
  durationSec: number;
}

export async function completeAppointment(
  db: Queryable,
  input: CompleteAppointmentInput,
): Promise<CompleteAppointmentResult> {
  const { officeId, queueId, clerkId } = input;

  const qRow = await db.query<{
    appointment_id: number;
    status: string;
  }>(`SELECT appointment_id, status FROM queue WHERE id = $1`, [queueId]);
  if (qRow.rows.length === 0) throw new Error(`Queue entry ${queueId} not found`);
  if (qRow.rows[0].status !== "serving")
    throw new Error(`Queue entry ${queueId} is not in serving status`);

  const { appointment_id: appointmentId } = qRow.rows[0];

  await db.query(`UPDATE queue SET status = 'done' WHERE id = $1`, [queueId]);

  await db.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [appointmentId]);

  const shRes = await db.query<{ id: number; duration_sec: number }>(
    `INSERT INTO service_history (office_id, appointment_id, clerk_id, duration_sec)
     SELECT $1, $2, $4, EXTRACT(EPOCH FROM (NOW() - served_at))::int
     FROM queue WHERE id = $3
     RETURNING id, duration_sec`,
    [officeId, appointmentId, queueId, clerkId],
  );
  const { id: serviceHistoryId, duration_sec: durationSec } = shRes.rows[0];

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

  return { durationSec };
}
