import type { Pool, PoolClient } from "pg";

export async function setIdentityVerified(
  db: Pool | PoolClient,
  countyId: string,
  appointmentId: number,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE appointments SET identity_verified = TRUE WHERE county_id = $1 AND id = $2`,
    [countyId, appointmentId],
  );
  if (rowCount === 0) {
    throw new Error(`Appointment ${appointmentId} not found`);
  }
}
