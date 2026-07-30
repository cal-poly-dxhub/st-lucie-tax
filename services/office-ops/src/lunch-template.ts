import type { Queryable } from "./utils.js";

export interface LunchTemplateAssignment {
  clerkId: number;
  officeId: number;
  scheduleDate: string;
  lunchShiftId: number | null;
}

/**
 * Apply each current-week assignment to the matching weekday on every existing
 * future schedule row. Date rows before today are deliberately preserved as
 * historical records.
 */
export async function propagateLunchTemplate(
  db: Queryable,
  assignments: LunchTemplateAssignment[],
): Promise<void> {
  for (const assignment of assignments) {
    await db.query(
      `UPDATE clerk_schedules
       SET lunch_shift_id = $4
       WHERE clerk_id = $1
         AND office_id = $2
         AND schedule_date >= CURRENT_DATE
         AND EXTRACT(ISODOW FROM schedule_date) = EXTRACT(ISODOW FROM $3::date)`,
      [assignment.clerkId, assignment.officeId, assignment.scheduleDate, assignment.lunchShiftId],
    );
  }
}
