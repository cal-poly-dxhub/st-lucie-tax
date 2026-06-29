import { describe, expect, test } from "vitest";
import { useDb } from "./helpers/fixture.js";
import { findAppointment, type FindApptInput } from "../../src/find-appt.js";
import {
  BOOK_SQL,
  bookParams,
  clearOfficeDay,
  fillSlotToCapacity,
  fillAllSlots,
  fillMorningSlots,
  tryBook,
  PG_ERROR,
} from "./helpers/booking.js";
import { ROAD_TEST } from "./helpers/seed-ids.js";
import { TEST_FROZEN_NOW as FROZEN_NOW } from "../../tests/config.js";

const db = useDb();

function baseInput(overrides: Partial<FindApptInput> = {}): FindApptInput {
  return {
    targetTxns: [ROAD_TEST],
    asap: true,
    preferredOffice: null,
    preferredDow: null,
    preferredTime: null,
    startDate: new Date("2026-05-12"),
    days: 1,
    nowTs: FROZEN_NOW,
    ...overrides,
  };
}

describe("findAppointment capacity checks", () => {
  test("returns earliest available slot when capacity exists", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    expect(result!.slotDate).toBe("2026-05-12");
    expect(result!.slotTime).toBe("09:00:00");
    expect(result!.available).toBeGreaterThan(0);
  });

  test("returns null when all slots at all offices are exhausted", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    await fillAllSlots(db.client, {});

    const result = await findAppointment(db.client, baseInput());
    expect(result).toBeNull();
  });

  test("skips a full slot and returns the next available one", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill 09:00 at both offices to desk cap (3 each).
    await fillSlotToCapacity(db.client, { time: "09:00" });

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    expect(result!.slotTime > "09:00:00").toBe(true);
  });
});

describe("findAppointment packing model checks", () => {
  test("finds slot at appointment-end boundary when earlier slots are full", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill 09:00 and 09:30 at both offices to desk cap.
    await fillSlotToCapacity(db.client, { time: "09:00" });
    await fillSlotToCapacity(db.client, { time: "09:30" });

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    // Earliest opening is 09:15 (id-card from 09:00 ends) or 10:00 (road-tests from 09:30 end)
    // Since road-test needs supply, and at 09:15 the two road-tests from 09:00 are still running,
    // road-test supply=2, demand=2 at 09:15 → full. Next: 09:30 is also full.
    // At 10:00: road-tests from 09:30 end → supply=2, demand=0 → available.
    expect(result!.slotTime).toBe("10:00:00");
  });

  test("available_from is used as a candidate start time", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // road-test has available_from=09:00. Even though office opens at 08:00,
    // the packing model should include 09:00 as a candidate.
    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    expect(result!.slotTime).toBe("09:00:00");
  });
});

describe("findAppointment preferences", () => {
  test("preferred office is tried first", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredOffice: 2,
        days: 1,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(2);
  });

  test("returns null when preferred office is full", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    await fillAllSlots(db.client, { offices: [2] });

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredOffice: 2,
        days: 1,
      }),
    );
    expect(result).toBeNull();
  });

  test("preferred morning returns a morning slot", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredTime: "morning",
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.slotTime < "12:00:00").toBe(true);
  });

  test("returns null when all morning slots are full", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill all morning road-test at both offices to skill supply.
    await fillMorningSlots(db.client, { office: 1 });
    await fillMorningSlots(db.client, { office: 2 });

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredTime: "morning",
      }),
    );

    expect(result).toBeNull();
  });

  test("preferred afternoon returns an afternoon slot", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredTime: "afternoon",
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.slotTime >= "12:00:00").toBe(true);
  });
});

describe("findAppointment preferredDow across multiple days", () => {
  // startDate = 2026-05-12 (Tuesday, DOW=2). Office hours Mon(1)–Fri(5).

  test("returns preferred DOW when capacity is available", async () => {
    // Search 3 days: Tue(12), Wed(13), Thu(14). Prefer Wednesday (DOW=3).
    // All days are open — should return Wednesday since it's preferred.
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredDow: 3,
        days: 3,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.slotDate).toBe("2026-05-13");
  });

  test("returns null when preferred DOW is full (days=1 on that DOW)", async () => {
    // startDate = Wednesday (May 13), days=1, preferDow=3.
    // Fill Wednesday completely. Engine should return null, not bleed.
    await clearOfficeDay(db.client, 1, "2026-05-13");
    await clearOfficeDay(db.client, 2, "2026-05-13");
    await fillAllSlots(db.client, { date: "2026-05-13" });

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredDow: 3,
        startDate: new Date("2026-05-13"),
        days: 1,
      }),
    );
    expect(result).toBeNull();
  });

  test("preferred DOW full with days>1 still returns null", async () => {
    // Prefer Wednesday (DOW=3). Search window: Tue(12)–Thu(14), days=3.
    // Fill Wednesday (May 13) completely. Hard preference → null.
    await clearOfficeDay(db.client, 1, "2026-05-13");
    await clearOfficeDay(db.client, 2, "2026-05-13");
    await fillAllSlots(db.client, { date: "2026-05-13" });

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredDow: 3,
        days: 3,
      }),
    );
    expect(result).toBeNull();
  });

  test("preferred DOW is a closed day (weekend) returns null with days=1", async () => {
    // Sunday (DOW=0). Start on Sunday May 17, days=1. Office is closed.
    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredDow: 0,
        startDate: new Date("2026-05-17"),
        days: 1,
      }),
    );
    expect(result).toBeNull();
  });

  test("preferred DOW is a closed day with days>1 returns null", async () => {
    // Prefer Sunday (DOW=0). Start Saturday May 16, days=3 → Sat(closed), Sun(closed), Mon(open).
    // Hard preference for Sunday → only Sunday is considered → office closed → null.
    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredDow: 0,
        startDate: new Date("2026-05-16"),
        days: 3,
      }),
    );
    expect(result).toBeNull();
  });

  test("preferred DOW outside window returns null", async () => {
    // Prefer Friday (DOW=5). Window: Tue(12)–Thu(14). Friday isn't in range.
    // Hard preference → only Friday is considered → not in window → null.
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredDow: 5,
        days: 3,
      }),
    );
    expect(result).toBeNull();
  });
});

describe("findAppointment multi-day search", () => {
  test("finds a slot on day 2 when first day is completely full", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill both offices on May 12 to desk cap at every slot.
    await fillAllSlots(db.client, {});

    // Clear May 13.
    await clearOfficeDay(db.client, 1, "2026-05-13");
    await clearOfficeDay(db.client, 2, "2026-05-13");

    const result = await findAppointment(db.client, baseInput({ days: 2 }));
    expect(result).not.toBeNull();
    expect(result!.slotDate).toBe("2026-05-13");
  });
});

describe("findAppointment with combined preferences", () => {
  // Scenario: St Lucie office 1, morning, road test, on a Tuesday.
  // When morning road-test capacity at office 1 is exhausted, should return null.

  test("returns a slot when combined preferences have capacity", async () => {
    await clearOfficeDay(db.client);

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredOffice: 1,
        preferredTime: "morning",
        preferredDow: 2, // Tuesday (May 12 is a Tuesday)
        targetTxns: [ROAD_TEST],
        days: 1,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
    expect(result!.slotTime < "12:00:00").toBe(true);
  });

  test("returns null when office 1 morning road-test slots are full on Tuesday", async () => {
    await clearOfficeDay(db.client);

    // Reduce to 1 desk and 1 road-test clerk at office 1.
    await db.client.query(`UPDATE offices SET total_desks = 1 WHERE id = 1`);
    await db.client.query(`UPDATE clerks SET status = 'inactive'`);
    await db.client.query(`UPDATE clerks SET status = 'active' WHERE id = 1`); // Maria only

    // Road test: 09:00-15:00, 30 min, 1 desk, 1 clerk.
    // Maria is on lunch shift 1 (11:30-12:15), so skip 11:30 (supply=0).
    // Slots where Maria is available and slot is morning: 09:00-11:00 (5 slots).
    await fillMorningSlots(db.client, { office: 1, supply: 1, lunchSupply: 0 });

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredOffice: 1,
        preferredTime: "morning",
        preferredDow: 2, // Tuesday
        targetTxns: [ROAD_TEST],
        days: 1,
      }),
    );
    expect(result).toBeNull();
  });

  test("returns null with full desk cap", async () => {
    await clearOfficeDay(db.client);

    // Default setup: office 1 has 3 desks, 2 road-test clerks (Maria + Angela).
    // Morning road-test supply=2 (09:00-11:00), supply=1 at 11:30 (Maria on lunch).
    await fillMorningSlots(db.client, { office: 1 });

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredOffice: 1,
        preferredTime: "morning",
        preferredDow: 2, // Tuesday
        targetTxns: [ROAD_TEST],
        days: 1,
      }),
    );
    expect(result).toBeNull();
  });

  test("returns null for morning and does not bleed into afternoon or office 2", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill all morning road-test at office 1 (supply=2 for 09:00-11:00, supply=1 at 11:30).
    await fillMorningSlots(db.client, { office: 1 });

    // Office 2 has wide-open capacity, and office 1 afternoon is open.
    // But with all preferences hard-filtered (office=1, morning, dow=2, days=1),
    // the engine must NOT fall back — it should return null.
    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredOffice: 1,
        preferredTime: "morning",
        preferredDow: 2,
        targetTxns: [ROAD_TEST],
        days: 1,
      }),
    );
    expect(result).toBeNull();
  });
});

describe("findAppointment scheduling_block_padding", () => {
  test("next slot respects padding gap", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);
    await db.client.query("UPDATE config SET scheduling_block_padding = 5");
    // Fill both road-test clerk slots at 09:00 (30-min → raw end 09:30)
    await db.client.query(BOOK_SQL, bookParams({ time: "09:00" }));
    await db.client.query(BOOK_SQL, bookParams({ time: "09:00", email: "pad2@x.com" }));

    // Find next slot — should be 09:35 (09:30 + 5 padding), not 09:30
    const result = await findAppointment(db.client, baseInput({ preferredOffice: 1 }));
    expect(result).not.toBeNull();
    expect(result!.slotTime).toBe("09:35:00");
  });

  test("booking inside padding zone is rejected", async () => {
    await clearOfficeDay(db.client);
    await db.client.query("UPDATE config SET scheduling_block_padding = 5");
    // Fill both road-test clerk slots at 09:00 (raw end 09:30, padded end 09:35)
    await db.client.query(BOOK_SQL, bookParams({ time: "09:00" }));
    await db.client.query(BOOK_SQL, bookParams({ time: "09:00", email: "pad2@x.com" }));

    // Try to book at 09:31 — inside the padded zone
    const result = await tryBook(db.client, bookParams({ time: "09:31", email: "pad-test@x.com" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PG_ERROR.CAPACITY_EXCEEDED);
  });

  test("booking after padding zone succeeds", async () => {
    await clearOfficeDay(db.client);
    await db.client.query("UPDATE config SET scheduling_block_padding = 5");
    // Fill both road-test clerk slots at 09:00 (raw end 09:30, padded end 09:35)
    await db.client.query(BOOK_SQL, bookParams({ time: "09:00" }));
    await db.client.query(BOOK_SQL, bookParams({ time: "09:00", email: "pad2@x.com" }));

    // Book at 09:35 — after the padded zone — should succeed
    const result = await tryBook(db.client, bookParams({ time: "09:35", email: "pad-ok@x.com" }));
    expect(result.ok).toBe(true);
  });

  test("zero padding allows back-to-back booking", async () => {
    await clearOfficeDay(db.client);
    await db.client.query("UPDATE config SET scheduling_block_padding = 0");
    await db.client.query(BOOK_SQL, bookParams({ time: "09:00" }));
    await db.client.query(BOOK_SQL, bookParams({ time: "09:00", email: "pad2@x.com" }));

    // Book at 09:30 — immediately after 30-min appt ends — should work
    const result = await tryBook(db.client, bookParams({ time: "09:30", email: "nopad@x.com" }));
    expect(result.ok).toBe(true);
  });
});
