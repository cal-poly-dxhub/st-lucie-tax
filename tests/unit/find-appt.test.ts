import { describe, expect, test } from "vitest";
import { findAppointment, type FindApptInput } from "../../src/find-appt.js";
import type { Queryable } from "../../src/utils.js";
import { TEST_START_DATE, TEST_FROZEN_NOW } from "../config.js";

type Row = Record<string, unknown>;

/* Creates a mock db response in sequence in an array */
function makeDb(responses: Array<{ rows: Row[] }>): Queryable {
  let idx = 0;
  return {
    async query() {
      if (idx >= responses.length) {
        throw new Error(`Unexpected query #${idx + 1} (only ${responses.length} mocked)`);
      }
      const r = responses[idx++];
      return { rows: r.rows, rowCount: r.rows.length };
    },
  };
}

function happyPathResponses(
  overrides: {
    officeId?: number;
    slotTime?: string;
    available?: number;
  } = {},
): Array<{ rows: Row[] }> {
  const officeId = overrides.officeId ?? 1;
  const slotTime = overrides.slotTime ?? "09:00:00";
  const available = overrides.available ?? 2;

  return [
    // 1. getAppointmentConfig
    { rows: [{ total_duration_min: 30, n: 1, padding: 0 }] },
    // 2. getEligibleOfficeHours – offices
    { rows: [{ id: officeId, run_rate_pct: 100, total_desks: 3 }] },
    // 3. getEligibleOfficeHours – office_hours (Tuesday = DOW 2)
    { rows: [{ office_id: officeId, day_of_week: 2, open_time: "09:00", close_time: "17:00" }] },
    // 4. buildPossibleStartTimes – txn_window (no restriction)
    { rows: [{ office_id: officeId, earliest_start: null }] },
    // 5. buildPossibleStartTimes – lunch (no lunch breaks)
    { rows: [] },
    // 6. buildPossibleStartTimes – appointments (empty day)
    { rows: [] },
    // 7. validateAppointmentTime
    { rows: [{ office_id: officeId, slot_date: "2026-05-12", slot_time: slotTime, available }] },
  ];
}

function baseInput(overrides: Partial<FindApptInput> = {}): FindApptInput {
  return {
    targetTxns: [1],
    asap: true,
    preferredOffice: null,
    preferredDow: null,
    preferredTime: null,
    startDate: TEST_START_DATE,
    days: 1,
    nowTs: TEST_FROZEN_NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findAppointment: early-exit paths", () => {
  test("returns null when transaction type is not found in config", async () => {
    const db = makeDb([{ rows: [{ total_duration_min: 0, n: 0, padding: 0 }] }]);
    const result = await findAppointment(db, baseInput({ targetTxns: [999] }));
    expect(result).toBeNull();
  });

  test("returns null when only some transaction types are found", async () => {
    const db = makeDb([{ rows: [{ total_duration_min: 30, n: 1, padding: 0 }] }]);
    const result = await findAppointment(db, baseInput({ targetTxns: [1, 2] }));
    expect(result).toBeNull();
  });

  test("returns null when no offices support the requested transactions", async () => {
    const db = makeDb([
      // 1. getAppointmentConfig – valid
      { rows: [{ total_duration_min: 30, n: 1, padding: 0 }] },
      // 2. getEligibleOfficeHours – no offices
      { rows: [] },
    ]);
    const result = await findAppointment(db, baseInput());
    expect(result).toBeNull();
  });

  test("returns null when validation returns available=0", async () => {
    const db = makeDb([
      ...happyPathResponses().slice(0, 6),
      { rows: [{ office_id: 1, slot_date: "2026-05-12", slot_time: "09:00:00", available: 0 }] },
    ]);
    const result = await findAppointment(db, baseInput());
    expect(result).toBeNull();
  });
});

describe("findAppointment: happy path", () => {
  test("returns slot when capacity is available", async () => {
    const db = makeDb(happyPathResponses());
    const result = await findAppointment(db, baseInput());
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
    expect(result!.slotDate).toBe("2026-05-12");
    expect(result!.slotTime).toBe("09:00:00");
    expect(result!.available).toBe(2);
  });

  test("returns the first valid candidate when the first fails and second succeeds", async () => {
    // Provide two appointment end times so buildPossibleStartTimes generates two candidates
    const db: Queryable = (() => {
      const responses = [
        { rows: [{ total_duration_min: 30, n: 1, padding: 0 }] },
        { rows: [{ id: 1, run_rate_pct: 100, total_desks: 3 }] },
        { rows: [{ office_id: 1, day_of_week: 2, open_time: "09:00", close_time: "17:00" }] },
        { rows: [{ office_id: 1, earliest_start: null }] },
        { rows: [] },
        {
          rows: [
            // Two existing appointments ending at 09:30 and 10:00 → two extra candidates
            {
              office_id: 1,
              appointment_date: "2026-05-12",
              start_time: "09:00",
              end_time: "09:30",
              skill_overlap: false,
            },
            {
              office_id: 1,
              appointment_date: "2026-05-12",
              start_time: "09:30",
              end_time: "10:00",
              skill_overlap: false,
            },
          ],
        },
        // validate 09:00 → fail
        { rows: [] },
        // validate 09:30 → succeed
        { rows: [{ office_id: 1, slot_date: "2026-05-12", slot_time: "09:30:00", available: 1 }] },
      ];
      let i = 0;
      return {
        async query() {
          return { rows: responses[i++].rows, rowCount: responses[i - 1].rows.length };
        },
      };
    })();

    const result = await findAppointment(db, baseInput());
    expect(result).not.toBeNull();
    expect(result!.slotTime).toBe("09:30:00");
  });
});

describe("findAppointment: preference filtering (JS-layer)", () => {
  test("preferredDow skips days that do not match", async () => {
    // first available day is Tuesday (DOW=2). Prefer Wednesday (DOW=3).
    // With days=1 there is no Wednesday in the window → no candidates → null.
    const db = makeDb([
      { rows: [{ total_duration_min: 30, n: 1, padding: 0 }] },
      { rows: [{ id: 1, run_rate_pct: 100, total_desks: 3 }] },
      { rows: [{ office_id: 1, day_of_week: 2, open_time: "09:00", close_time: "17:00" }] },
      { rows: [{ office_id: 1, earliest_start: null }] },
      { rows: [] },
      { rows: [] },
    ]);

    const result = await findAppointment(db, baseInput({ asap: false, preferredDow: 3, days: 1 }));
    expect(result).toBeNull();
  });

  test("preferredDow matches the start date and returns a slot", async () => {
    // startDate is Tuesday (DOW=2). Prefer Tuesday (DOW=2).
    const db = makeDb(happyPathResponses());

    const result = await findAppointment(db, baseInput({ asap: false, preferredDow: 2, days: 1 }));
    expect(result).not.toBeNull();
    expect(result!.slotDate).toBe("2026-05-12");
  });

  test("preferredOffice skips offices that do not match", async () => {
    // Office ID 1 is returned, but we request office 2 → no candidates → null
    const db = makeDb([
      { rows: [{ total_duration_min: 30, n: 1, padding: 0 }] },
      { rows: [{ id: 1, run_rate_pct: 100, total_desks: 3 }] },
      { rows: [{ office_id: 1, day_of_week: 2, open_time: "09:00", close_time: "17:00" }] },
      { rows: [{ office_id: 1, earliest_start: null }] },
      { rows: [] },
      { rows: [] },
    ]);

    const result = await findAppointment(
      db,
      baseInput({ asap: false, preferredOffice: 2, days: 1 }),
    );
    expect(result).toBeNull();
  });

  test("preferredTime: morning skips slots at or after noon", async () => {
    // Office only has afternoon hours (13:00-17:00) → open time 13:00 ≥ noon → no morning candidates
    const db = makeDb([
      { rows: [{ total_duration_min: 30, n: 1, padding: 0 }] },
      { rows: [{ id: 1, run_rate_pct: 100, total_desks: 3 }] },
      { rows: [{ office_id: 1, day_of_week: 2, open_time: "13:00", close_time: "17:00" }] },
      { rows: [{ office_id: 1, earliest_start: null }] },
      { rows: [] },
      { rows: [] },
    ]);

    const result = await findAppointment(db, baseInput({ asap: false, preferredTime: "morning" }));
    expect(result).toBeNull();
  });

  test("preferredTime: afternoon skips slots before noon", async () => {
    // Office only has morning hours (09:00-11:30) → open time < noon → no afternoon candidates
    const db = makeDb([
      { rows: [{ total_duration_min: 30, n: 1, padding: 0 }] },
      { rows: [{ id: 1, run_rate_pct: 100, total_desks: 3 }] },
      { rows: [{ office_id: 1, day_of_week: 2, open_time: "09:00", close_time: "11:30" }] },
      { rows: [{ office_id: 1, earliest_start: null }] },
      { rows: [] },
      { rows: [] },
    ]);

    const result = await findAppointment(
      db,
      baseInput({ asap: false, preferredTime: "afternoon" }),
    );
    expect(result).toBeNull();
  });

  test("preferredTime: morning allows a slot before noon", async () => {
    const db = makeDb(happyPathResponses({ slotTime: "09:00:00" }));

    const result = await findAppointment(db, baseInput({ asap: false, preferredTime: "morning" }));
    expect(result).not.toBeNull();
    const [h] = result!.slotTime.split(":").map(Number);
    expect(h).toBeLessThan(12);
  });

  test("slot is dropped when start + duration exceeds close time", async () => {
    // Office closes at 09:15; appointment needs 30 min → 09:00 start overruns → no candidates
    const db = makeDb([
      { rows: [{ total_duration_min: 30, n: 1, padding: 0 }] },
      { rows: [{ id: 1, run_rate_pct: 100, total_desks: 3 }] },
      { rows: [{ office_id: 1, day_of_week: 2, open_time: "09:00", close_time: "09:15" }] },
      { rows: [{ office_id: 1, earliest_start: null }] },
      { rows: [] },
      { rows: [] },
    ]);

    const result = await findAppointment(db, baseInput());
    expect(result).toBeNull();
  });
});

describe("findAppointment: multi-day search", () => {
  test("searches day 2 when day 1 produces no valid candidates", async () => {
    // days=2. Day 1 (Tue May 12, DOW=2) has no office_hours row → skipped.
    // Day 2 (Wed May 13, DOW=3) has hours → returns a slot.
    const db = makeDb([
      { rows: [{ total_duration_min: 30, n: 1, padding: 0 }] },
      { rows: [{ id: 1, run_rate_pct: 100, total_desks: 3 }] },
      // office_hours only has Wednesday (DOW=3)
      { rows: [{ office_id: 1, day_of_week: 3, open_time: "09:00", close_time: "17:00" }] },
      { rows: [{ office_id: 1, earliest_start: null }] },
      { rows: [] },
      { rows: [] },
      // validate the Wednesday candidate
      { rows: [{ office_id: 1, slot_date: "2026-05-13", slot_time: "09:00:00", available: 1 }] },
    ]);

    const result = await findAppointment(db, baseInput({ days: 2 }));
    expect(result).not.toBeNull();
    expect(result!.slotDate).toBe("2026-05-13");
  });
});

describe("findAppointment: ranking (ASAP vs preference)", () => {
  test("ASAP mode returns the result structure from the DB unchanged", async () => {
    const db = makeDb(happyPathResponses({ officeId: 1, slotTime: "09:00:00", available: 3 }));
    const result = await findAppointment(db, baseInput({ asap: true }));
    expect(result).toMatchObject({
      officeId: 1,
      slotDate: "2026-05-12",
      slotTime: "09:00:00",
      available: 3,
    });
  });
});

describe("findAppointment: result shape", () => {
  test("result contains all required fields with correct types", async () => {
    const db = makeDb(happyPathResponses());
    const result = await findAppointment(db, baseInput());
    expect(result).not.toBeNull();
    expect(typeof result!.officeId).toBe("number");
    expect(result!.slotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result!.slotTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(typeof result!.available).toBe("number");
    expect(result!.available).toBeGreaterThan(0);
  });
});
