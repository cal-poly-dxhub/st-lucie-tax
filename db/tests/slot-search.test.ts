import { describe, expect, test } from "vitest";
import { useDb } from "./helpers/fixture.js";
import { findAppointment, type FindApptInput } from "../../src/find-appt.js";
import {
  BOOK_SQL,
  bookParams,
  clearOfficeDay,
  fillSlotToCapacity,
  fillAllSlots,
  ROAD_TEST,
  ID_CARD,
  tryBook,
  PG_ERROR,
} from "./helpers/booking.js";
import { TEST_DATE as DATE, TEST_FROZEN_NOW as FROZEN_NOW } from "../../tests/config.js";

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

describe("findAppointment: basic capacity", () => {
  test("returns earliest available slot when capacity exists", async () => {
    await clearOfficeDay(db.client);

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    expect(result!.officeId).toBeTypeOf("number");
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
    // Packing model finds 09:15 (end of the 15-min id_card at 09:00) or 09:30 (end of road_test)
    expect(toMinutes(result!.slotTime)).toBeGreaterThan(9 * 60);
  });
});

describe("findAppointment: packing model", () => {
  test("finds slot at appointment-end boundary when earlier slots are full", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill 09:00 and 09:30 at both offices to desk cap.
    await fillSlotToCapacity(db.client, { time: "09:00" });
    await fillSlotToCapacity(db.client, { time: "09:30" });

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    // Earliest opening is 09:15 (id_card from 09:00 ends) or 10:00 (road_tests from 09:30 end)
    // Since road_test needs supply, and at 09:15 the two road_tests from 09:00 are still running,
    // road_test supply=2, demand=2 at 09:15 → full. Next: 09:30 is also full.
    // At 10:00: road_tests from 09:30 end → supply=2, demand=0 → available.
    expect(result!.slotTime).toBe("10:00:00");
  });

  test("finds slot at lunch-shift end when pre-lunch slots are full", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Reduce road_test supply to 1 per office (disable Angela and Nancy).
    await db.client.query(`UPDATE clerks SET status='inactive' WHERE id IN (3, 6)`);

    // Fill all pre-lunch slots (supply=1, so 1 road_test per slot).
    // road_test 09:00-15:00, 30 min. With supply=1: 09:00, 09:30, 10:00, 10:30, 11:00 = 5 slots.
    for (const office of [1, 2]) {
      for (let i = 0; i < 5; i++) {
        const hour = 9 + Math.floor(i / 2);
        const min = (i % 2) * 30;
        const time = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        await db.client.query(
          BOOK_SQL,
          bookParams({ office, time, email: `lunch${office}-${i}@x.com` }),
        );
      }
    }

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    // Maria (office 1) is on lunch 11:30-12:15. Jennifer (office 2) on lunch 11:30-12:15.
    // After last pre-lunch appt ends at 11:30, both clerks go to lunch.
    // First available: 12:15 (lunch ends).
    expect(result!.slotTime).toBe("12:15:00");
  });

  test("available_from is used as a candidate start time", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // road_test has available_from=09:00. Even though office opens at 08:00,
    // the packing model should include 09:00 as a candidate.
    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    expect(result!.slotTime).toBe("09:00:00");
  });
});

describe("findAppointment: skill filtering", () => {
  test("id_card appointments do not block road_test skill supply", async () => {
    await clearOfficeDay(db.client);

    // Book 2 id_card appointments at 09:00. Desk cap=3, so 1 desk remains.
    // road_test supply at 09:00 = 2 (Maria + Angela), demand for road_test = 0.
    // Desk avail = 3-2 = 1. Skill avail = 2-0 = 2. min(1, 2) = 1.
    await db.client.query(
      BOOK_SQL,
      bookParams({ time: "09:00", skills: [ID_CARD], email: "id1@x.com" }),
    );
    await db.client.query(
      BOOK_SQL,
      bookParams({ time: "09:00", skills: [ID_CARD], email: "id2@x.com" }),
    );

    const result = await findAppointment(
      db.client,
      baseInput({
        preferredOffice: 1,
        asap: false,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
    expect(result!.slotTime).toBe("09:00:00");
    expect(result!.available).toBe(1);
  });

  test("same-skill appointments count toward demand reducing available slots", async () => {
    await clearOfficeDay(db.client);

    // Book 1 road_test — skill supply=2, demand=1. Desk: 3-1=2. min(1, 2)=1.
    await db.client.query(BOOK_SQL, bookParams({ time: "09:00", email: "rt1@x.com" }));

    const result = await findAppointment(
      db.client,
      baseInput({
        preferredOffice: 1,
        asap: false,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
    expect(result!.slotTime).toBe("09:00:00");
    expect(result!.available).toBe(1);
  });
});

describe("findAppointment: absence handling", () => {
  test("absent clerk excluded from supply reduces available count", async () => {
    await clearOfficeDay(db.client);

    // Put Maria on vacation. Road test supply drops 2 → 1 (Angela only).
    await db.client.query(
      `INSERT INTO clerk_absences (clerk_id, start_date, end_date, reason)
       VALUES (1, $1, $1, 'vacation')`,
      [DATE],
    );

    const result = await findAppointment(
      db.client,
      baseInput({
        preferredOffice: 1,
        asap: false,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
    // Skill supply=1 (Angela). Desk cap=3, concurrent=0, deskAvail=3. min(1,3)=1.
    expect(result!.available).toBe(1);
  });

  test("returns null when all specialists are absent", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // All road_test clerks absent: Maria(1), Angela(3), Jennifer(4), Nancy(6).
    await db.client.query(
      `INSERT INTO clerk_absences (clerk_id, start_date, end_date, reason)
       VALUES (1, $1, $1, 'vacation'),
              (3, $1, $1, 'vacation'),
              (4, $1, $1, 'vacation'),
              (6, $1, $1, 'vacation')`,
      [DATE],
    );

    const result = await findAppointment(db.client, baseInput());
    expect(result).toBeNull();
  });
});

describe("findAppointment: preferences", () => {
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

  test("returns null when preferred office is full (hard preference)", async () => {
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
    expect(toMinutes(result!.slotTime)).toBeLessThan(12 * 60);
  });

  test("returns null when all morning slots are full (hard preference)", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill all morning road_test at both offices.
    // Supply=2 per slot (09:00-11:00), supply=1 at 11:30 (one clerk on lunch).
    for (const office of [1, 2]) {
      for (const time of ["09:00", "09:30", "10:00", "10:30", "11:00"]) {
        await db.client.query(
          BOOK_SQL,
          bookParams({ office, time, email: `morn-${office}-${time}-a@x.com` }),
        );
        await db.client.query(
          BOOK_SQL,
          bookParams({ office, time, email: `morn-${office}-${time}-b@x.com` }),
        );
      }
      // 11:30: one road_test clerk on lunch → supply=1.
      await db.client.query(
        BOOK_SQL,
        bookParams({
          office,
          time: "11:30",
          email: `morn-${office}-1130@x.com`,
        }),
      );
    }

    const result = await findAppointment(
      db.client,
      baseInput({
        asap: false,
        preferredTime: "morning",
      }),
    );

    // Morning is full — hard preference means null, not fallback to afternoon.
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
    expect(toMinutes(result!.slotTime)).toBeGreaterThanOrEqual(12 * 60);
  });
});

describe("findAppointment: preferredDow across multiple days", () => {
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
    for (const office of [1, 2]) {
      await db.client.query(
        `DELETE FROM documents
          WHERE appointment_id IN (
            SELECT id FROM appointments
            WHERE office_id=$1 AND appointment_date='2026-05-13'
          )`,
        [office],
      );
      await db.client.query(
        `DELETE FROM appointments
          WHERE office_id=$1 AND appointment_date='2026-05-13'`,
        [office],
      );
    }
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

  test("preferred DOW full with days>1 still returns null (hard preference)", async () => {
    // Prefer Wednesday (DOW=3). Search window: Tue(12)–Thu(14), days=3.
    // Fill Wednesday (May 13) completely. Hard preference → null.
    for (const office of [1, 2]) {
      await db.client.query(
        `DELETE FROM documents
          WHERE appointment_id IN (
            SELECT id FROM appointments
            WHERE office_id=$1 AND appointment_date='2026-05-13'
          )`,
        [office],
      );
      await db.client.query(
        `DELETE FROM appointments
          WHERE office_id=$1 AND appointment_date='2026-05-13'`,
        [office],
      );
    }
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

  test("preferred DOW is a closed day (weekend) — returns null with days=1", async () => {
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

  test("preferred DOW is a closed day with days>1 returns null (hard preference)", async () => {
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

  test("preferred DOW outside window returns null (hard preference)", async () => {
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

describe("findAppointment: multi-day search", () => {
  test("finds a slot on day 2 when first day is completely full", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill both offices on May 12 to desk cap at every slot.
    await fillAllSlots(db.client, {});

    // Clear May 13.
    await db.client.query(
      `DELETE FROM documents
        WHERE appointment_id IN (
          SELECT id FROM appointments
          WHERE appointment_date='2026-05-13'
        )`,
    );
    await db.client.query(
      `DELETE FROM appointments
        WHERE appointment_date='2026-05-13'`,
    );

    const result = await findAppointment(db.client, baseInput({ days: 2 }));
    expect(result).not.toBeNull();
    expect(result!.slotDate).toBe("2026-05-13");
  });
});

describe("findAppointment: CELL_QUERY correctness", () => {
  test("skips slot with available=0 during lunch period", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Book at 12:15 (skill 1). During shift 2 (12:15-13:00), clerks 2+3 on lunch.
    // Only clerk 1 on floor. After booking: concurrent=1, cap=min(3,1)=1, avail=0.
    await db.client.query(
      BOOK_SQL,
      bookParams({ time: "12:15", skills: [ID_CARD], email: "c25pre@x.com" }),
    );

    // findAppointment for skill 2 at preferred office 1 should NOT return 12:15
    // (it has available=0 there). It should find a different time.
    const result = await findAppointment(
      db.client,
      baseInput({
        targetTxns: [ID_CARD],
        preferredOffice: 1,
        asap: false,
      }),
    );
    expect(result).not.toBeNull();
    // Should find a slot that's NOT 12:15 at office 1 (since that's full)
    if (result!.officeId === 1) {
      expect(result!.slotTime).not.toBe("12:15:00");
    }
    expect(result!.available).toBeGreaterThan(0);
  });

  test("afternoon slots reachable after morning is fully packed", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Sequentially book id_card (15 min) appointments using the engine itself.
    // With 3 desks × 2 offices, the engine should pack morning → lunch → afternoon.
    let booked = 0;
    let lastTime = "";
    for (let i = 0; i < 80; i++) {
      const result = await findAppointment(
        db.client,
        baseInput({
          targetTxns: [ID_CARD],
          asap: true,
        }),
      );
      if (!result) break;

      await db.client.query("SAVEPOINT book_slot");
      try {
        await db.client.query(
          BOOK_SQL,
          bookParams({
            office: result.officeId,
            time: result.slotTime,
            skills: [ID_CARD],
            email: `c26-${i}@x.com`,
          }),
        );
        await db.client.query("RELEASE SAVEPOINT book_slot");
        booked++;
        lastTime = result.slotTime;
      } catch {
        await db.client.query("ROLLBACK TO SAVEPOINT book_slot");
        break;
      }
    }

    // Should book at least 30 appointments (fills past morning into lunch/afternoon).
    expect(booked).toBeGreaterThan(30);
    // Last booked time should be past morning (>= 11:00), proving the engine
    // doesn't get stuck in early morning slots.
    expect(toMinutes(lastTime)).toBeGreaterThanOrEqual(11 * 60);
  });
});

describe("findAppointment: combined preferences — full scenario", () => {
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
    expect(toMinutes(result!.slotTime)).toBeLessThan(12 * 60);
  });

  test("returns null when office 1 morning road-test slots are full on Tuesday", async () => {
    await clearOfficeDay(db.client);

    // Reduce to 1 desk and 1 road_test clerk at office 1.
    await db.client.query(`UPDATE offices SET total_desks = 1 WHERE id = 1`);
    await db.client.query(`UPDATE clerks SET status = 'inactive'`);
    await db.client.query(`UPDATE clerks SET status = 'active' WHERE id = 1`); // Maria only

    // Road test: 09:00-15:00, 30 min, 1 desk, 1 clerk.
    // Morning slots: 09:00, 09:30, 10:00, 10:30, 11:00, 11:30.
    // Maria is on lunch shift 1 (11:30-12:15) but 11:30 is still < noon so it's "morning".
    // With 1 desk, booking at 11:30 will fail (Maria on lunch → supply=0). Skip it.
    // Slots where Maria is available and slot is morning: 09:00-11:00 (5 slots).
    for (const time of ["09:00", "09:30", "10:00", "10:30", "11:00"]) {
      await db.client.query(
        BOOK_SQL,
        bookParams({
          office: 1,
          time,
          skills: [ROAD_TEST],
          email: `combo-full-${time}@x.com`,
        }),
      );
    }

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

  test("returns null with full desk cap (no capacity reduction)", async () => {
    await clearOfficeDay(db.client);

    // Default setup: office 1 has 3 desks, 2 road_test clerks (Maria + Angela).
    // road_test supply=2, desk cap=3.
    // Morning road_test slots (30 min, available_from=09:00, morning < 12:00):
    //   09:00, 09:30, 10:00, 10:30, 11:00 — supply=2 (both on floor)
    //   11:30 — Maria on lunch (shift 1: 11:30-12:15), supply=1 (Angela only)
    // Fill 2 per slot for 09:00-11:00, then 1 at 11:30 to exhaust all morning capacity.
    for (const time of ["09:00", "09:30", "10:00", "10:30", "11:00"]) {
      await db.client.query(
        BOOK_SQL,
        bookParams({
          office: 1,
          time,
          skills: [ROAD_TEST],
          email: `combo-a-${time}@x.com`,
        }),
      );
      await db.client.query(
        BOOK_SQL,
        bookParams({
          office: 1,
          time,
          skills: [ROAD_TEST],
          email: `combo-b-${time}@x.com`,
        }),
      );
    }
    // 11:30: Maria on lunch → road_test supply=1 (Angela). Fill that 1 slot.
    await db.client.query(
      BOOK_SQL,
      bookParams({
        office: 1,
        time: "11:30",
        skills: [ROAD_TEST],
        email: `combo-a-1130@x.com`,
      }),
    );

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

  test("returns null — does not bleed into afternoon or office 2", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill all morning road_test at office 1 (supply=2 for 09:00-11:00, supply=1 at 11:30).
    for (const time of ["09:00", "09:30", "10:00", "10:30", "11:00"]) {
      await db.client.query(
        BOOK_SQL,
        bookParams({
          office: 1,
          time,
          skills: [ROAD_TEST],
          email: `nobleed-a-${time}@x.com`,
        }),
      );
      await db.client.query(
        BOOK_SQL,
        bookParams({
          office: 1,
          time,
          skills: [ROAD_TEST],
          email: `nobleed-b-${time}@x.com`,
        }),
      );
    }
    await db.client.query(
      BOOK_SQL,
      bookParams({
        office: 1,
        time: "11:30",
        skills: [ROAD_TEST],
        email: `nobleed-a-1130@x.com`,
      }),
    );

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

describe("findAppointment: scheduling_block_padding", () => {
  test("next slot respects padding gap", async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);
    await db.client.query("UPDATE config SET scheduling_block_padding = 5");
    // Fill both road_test clerk slots at 09:00 (30-min → raw end 09:30)
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
    // Fill both road_test clerk slots at 09:00 (raw end 09:30, padded end 09:35)
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
    // Fill both road_test clerk slots at 09:00 (raw end 09:30, padded end 09:35)
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

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
