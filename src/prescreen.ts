import type { Pool, PoolClient } from "pg";
import { camelRows } from "./utils.js";

export interface PrescreenQuestion {
  id: number;
  txnTypeId: number;
  sortOrder: number;
  questionText: string;
}

export async function getPrescreenQuestions(
  db: Pool | PoolClient,
  countyId: string,
  txnTypeIds: number[],
): Promise<PrescreenQuestion[]> {
  const { rows } = await db.query(
    `SELECT pq.id, pq.txn_type_id, pq.sort_order, pq.question_text
     FROM prescreen_questions pq
     WHERE pq.county_id = $1 AND pq.txn_type_id = ANY($2::int[])
     ORDER BY pq.txn_type_id, pq.sort_order`,
    [countyId, txnTypeIds],
  );
  return camelRows<PrescreenQuestion>(rows);
}

export async function savePrescreenResponses(
  db: Pool | PoolClient,
  countyId: string,
  appointmentId: number,
  responses: Record<string, boolean>,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE appointments
     SET prescreen_completed = TRUE,
         prescreen_responses = $3
     WHERE county_id = $1 AND id = $2`,
    [countyId, appointmentId, JSON.stringify(responses)],
  );
  if (rowCount === 0) {
    throw new Error(`Appointment ${appointmentId} not found`);
  }
}
