import { type Queryable } from "./utils.js";
import { camelRows } from "./utils.js";

export interface PrescreenQuestion {
  id: number;
  txnTypeId: number;
  sortOrder: number;
  questionText: string;
}

export async function getPrescreenQuestions(
  db: Queryable,
  txnTypeIds: number[],
): Promise<PrescreenQuestion[]> {
  const { rows } = await db.query(
    `SELECT pq.id, pq.txn_type_id, pq.sort_order, pq.question_text
     FROM prescreen_questions pq
     WHERE pq.txn_type_id = ANY($1::int[])
     ORDER BY pq.txn_type_id, pq.sort_order`,
    [txnTypeIds],
  );
  return camelRows<PrescreenQuestion>(rows);
}

export async function savePrescreenResponses(
  db: Queryable,
  appointmentId: number,
  responses: Record<string, boolean>,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE appointments
     SET prescreen_completed = TRUE,
         prescreen_responses = $2
     WHERE id = $1`,
    [appointmentId, JSON.stringify(responses)],
  );
  if (rowCount === 0) {
    throw new Error(`Appointment ${appointmentId} not found`);
  }
}
