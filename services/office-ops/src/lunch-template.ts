import type { Queryable } from "./utils.js";

export interface LunchTemplateAssignment {
  clerkId: number;
  officeId: number;
  scheduleDate: string;
  lunchShiftId: number | null;
}

/**
 * Apply each current-week assignment to the matching weekday on every future
 * schedule week. Uses UPSERT so rows are created when they don't already exist
 * (e.g. the seed was run mid-week and earlier weekdays were missed). Past dates
 * are deliberately preserved as historical records.
 */
export async function propagateLunchTemplate(
  db: Queryable,
  assignments: LunchTemplateAssignment[],
): Promise<void> {
  for (const assignment of assignments) {
    await db.query(
      `INSERT INTO clerk_schedules (clerk_id, office_id, schedule_date, lunch_shift_id)
       SELECT $1, $2, d::date, $4
       FROM generate_series($3::date, $3::date + interval '1 year', '7 days') d
       WHERE d >= CURRENT_DATE
       ON CONFLICT (clerk_id, schedule_date)
       DO UPDATE SET lunch_shift_id = EXCLUDED.lunch_shift_id,
                     office_id = EXCLUDED.office_id`,
      [assignment.clerkId, assignment.officeId, assignment.scheduleDate, assignment.lunchShiftId],
    );
  }
}
