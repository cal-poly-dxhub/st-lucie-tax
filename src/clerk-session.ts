import { type Queryable } from "./utils.js";

export interface ClerkSession {
  sessionId: number;
  clerkId: number;
  officeId: number;
  deskNumber: number;
  isAvailable: boolean;
}

export type ClerkLoginError = "already_logged_in" | "clerk_not_found";
export type ClerkLoginOutcome =
  | { ok: true; session: ClerkSession }
  | { ok: false; error: ClerkLoginError };

export async function clerkLogin(
  db: Queryable,
  clerkId: number,
  officeId: number,
  deskNumber: number,
): Promise<ClerkLoginOutcome> {
  const clerkRes = await db.query<{ id: number }>(
    `SELECT id FROM clerks WHERE id = $1 AND status = 'active'`,
    [clerkId],
  );
  if (clerkRes.rows.length === 0) {
    return { ok: false, error: "clerk_not_found" };
  }

  const existingRes = await db.query<{ id: number }>(
    `SELECT id FROM clerk_sessions
     WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
    [clerkId, officeId],
  );
  if (existingRes.rows.length > 0) {
    return { ok: false, error: "already_logged_in" };
  }

  const { rows } = await db.query<{
    id: number;
    clerk_id: number;
    office_id: number;
    desk_number: number;
    is_available: boolean;
  }>(
    `INSERT INTO clerk_sessions (clerk_id, office_id, desk_number, is_available)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id, clerk_id, office_id, desk_number, is_available`,
    [clerkId, officeId, deskNumber],
  );

  const row = rows[0];
  return {
    ok: true,
    session: {
      sessionId: row.id,
      clerkId: row.clerk_id,
      officeId: row.office_id,
      deskNumber: row.desk_number,
      isAvailable: row.is_available,
    },
  };
}

export async function setClerkAvailability(
  db: Queryable,
  clerkId: number,
  officeId: number,
  isAvailable: boolean,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE clerk_sessions
     SET is_available = $3
     WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
    [clerkId, officeId, isAvailable],
  );
  if (rowCount === 0) {
    throw new Error(`No active session found for clerk ${clerkId} at office ${officeId}`);
  }
}

export async function clerkLogout(db: Queryable, clerkId: number, officeId: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE clerk_sessions
     SET logged_out_at = NOW(), is_available = FALSE
     WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
    [clerkId, officeId],
  );
  if (rowCount === 0) {
    throw new Error(`No active session found for clerk ${clerkId} at office ${officeId}`);
  }
}
