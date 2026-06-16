import { type Queryable } from "./utils.js";
import { camelRows } from "./utils.js";

export interface AssignResult {
  queueId: number;
  deskNumber: number;
  clerkId: number;
}

export async function assignNextCustomer(
  db: Queryable,
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

  const qRow = await db.query(
    `SELECT id AS queue_id, assigned_desk AS desk_number, assigned_clerk_id AS clerk_id FROM queue WHERE id = $1`,
    [queueId],
  );
  return camelRows<AssignResult>(qRow.rows)[0];
}
