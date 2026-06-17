import { type Queryable } from "./utils.js";

export interface CompleteAppointmentInput {
  officeId: number;
  queueId: number;
  clerkId: number;
}

export interface CompleteAppointmentResult {
  durationMin: number;
}

export async function completeAppointment(
  db: Queryable,
  input: CompleteAppointmentInput,
): Promise<CompleteAppointmentResult> {
  const { officeId, queueId, clerkId } = input;

  const qRow = await db.query<{
    appointment_id: number;
    status: string;
    served_at: Date;
  }>(`SELECT appointment_id, status, served_at FROM queue WHERE id = $1`, [queueId]);
  if (qRow.rows.length === 0) throw new Error(`Queue entry ${queueId} not found`);
  if (qRow.rows[0].status !== "serving")
    throw new Error(`Queue entry ${queueId} is not in serving status`);

  const { appointment_id: appointmentId, served_at: servedAt } = qRow.rows[0];
  const durationMin = Math.round((Date.now() - new Date(servedAt).getTime()) / 60_000);

  await db.query(`UPDATE queue SET status = 'done' WHERE id = $1`, [queueId]);

  await db.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [appointmentId]);

  const shRes = await db.query<{ id: number }>(
    `INSERT INTO service_history (office_id, appointment_id, duration_min)
     VALUES ($1, $2, $3) RETURNING id`,
    [officeId, appointmentId, durationMin],
  );
  const serviceHistoryId = shRes.rows[0].id;

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

  return { durationMin };
}
