import { type Queryable } from "./utils.js";

export async function setIdentityVerified(db: Queryable, appointmentId: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE appointments SET identity_verified = TRUE WHERE id = $1`,
    [appointmentId],
  );
  if (rowCount === 0) {
    throw new Error(`Appointment ${appointmentId} not found`);
  }
}
