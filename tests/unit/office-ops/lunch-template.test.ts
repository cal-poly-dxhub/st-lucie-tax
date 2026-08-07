import { describe, expect, test } from "vitest";
import { propagateLunchTemplate } from "../../../services/office-ops/src/lunch-template.js";
import { mockDb } from "./helpers/mock-db.js";

describe("propagateLunchTemplate", () => {
  test("upserts every future schedule row matching each configured weekday", async () => {
    const db = mockDb([{}, {}]);

    await propagateLunchTemplate(db, [
      { clerkId: 1, officeId: 2, scheduleDate: "2026-07-27", lunchShiftId: 3 },
      { clerkId: 1, officeId: 2, scheduleDate: "2026-07-28", lunchShiftId: null },
    ]);

    expect(db.calls).toHaveLength(2);
    // Verify UPSERT pattern: INSERT ... ON CONFLICT ... DO UPDATE
    expect(db.calls[0].sql).toContain("INSERT INTO clerk_schedules");
    expect(db.calls[0].sql).toContain("generate_series");
    expect(db.calls[0].sql).toContain("ON CONFLICT (clerk_id, schedule_date)");
    expect(db.calls[0].sql).toContain("DO UPDATE SET lunch_shift_id");
    expect(db.calls[0].sql).toContain("d >= CURRENT_DATE");
    expect(db.calls[0].values).toEqual([1, 2, "2026-07-27", 3]);
    expect(db.calls[1].values).toEqual([1, 2, "2026-07-28", null]);
  });
});
