import type { Pool, PoolClient } from "pg";

export interface AssignResult {
  queueId: number;
  deskNumber: number;
  clerkId: number;
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
