import { describe, expect, test } from "vitest";
import { useDb } from "./helpers/fixture.js";
import {
  BOOK_SQL,
  bookParams,
  clearOfficeDay,
  tryBook,
  raceTest,
  CONFIRMATION_CODE_FORMAT,
  PG_ERROR,
} from "./helpers/booking.js";
import { ROAD_TEST, ID_CARD, LICENSE_ORIGINAL } from "./helpers/seed-ids.js";

const db = useDb();

describe("effective transaction types", () => {
  test("hidden override at office 1 drops road-test only at office 1", async () => {
    await db.client.query(
      `INSERT INTO transaction_types
         (txn_type_id, office_id, name, avg_duration_min, status)
       VALUES ('road-test', 1, 'Road Test', 30, 'hidden')`,
    );

    const office1 = await db.client.query(
      `SELECT txn_type_id
         FROM effective_transaction_types
        WHERE office_id = 1 AND status = 'active'
        ORDER BY global_id`,
    );
    const office1Ids = office1.rows.map((r: { txn_type_id: string }) => r.txn_type_id);
    expect(office1Ids).not.toContain("road-test");
    expect(office1Ids).toContain("id-card");
    expect(office1Ids).toContain("license-original");

    const office2 = await db.client.query(
      `SELECT txn_type_id
         FROM effective_transaction_types
        WHERE office_id = 2 AND status = 'active'
        ORDER BY global_id`,
    );
    const office2Ids = office2.rows.map((r: { txn_type_id: string }) => r.txn_type_id);
    expect(office2Ids).toContain("road-test");
    expect(office2Ids).toContain("id-card");
    expect(office2Ids).toContain("license-original");
  });
});

describe("book_appt: lock + recheck + insert", () => {
  test("inserts appt with default scheduled status and confirmation code when slot has capacity", async () => {
    await clearOfficeDay(db.client);

    const { rows } = await db.client.query(BOOK_SQL, bookParams());
    expect(rows[0].id).toBeTypeOf("number");

    const check = await db.client.query(
      `SELECT first_name, last_name, status, txn_type_ids, confirmation_code
         FROM appointments WHERE id = $1`,
      [rows[0].id],
    );
    expect(check.rows[0]).toMatchObject({
      first_name: "Test",
      last_name: "Booker",
      status: "scheduled",
      txn_type_ids: [ROAD_TEST],
    });
    expect(check.rows[0].confirmation_code).toMatch(CONFIRMATION_CODE_FORMAT);
  });

  test("capacity_exceeded once the slot is full", async () => {
    await clearOfficeDay(db.client);

    // Supply at 09:00 for road-test = 2. Book first two and reject third.
    await db.client.query(BOOK_SQL, bookParams({ email: "a@x.com" }));
    await db.client.query(BOOK_SQL, bookParams({ email: "b@x.com" }));

    await expect(db.client.query(BOOK_SQL, bookParams({ email: "c@x.com" }))).rejects.toMatchObject(
      { code: PG_ERROR.CAPACITY_EXCEEDED },
    );
  });

  test("office_closed when slot is outside open/close window", async () => {
    await clearOfficeDay(db.client);

    // Office hours are 08:00-17:00. 07:30 is before open.
    await expect(db.client.query(BOOK_SQL, bookParams({ time: "07:30" }))).rejects.toMatchObject({
      code: PG_ERROR.OFFICE_CLOSED,
    });
  });

  test("rejected when booking for today (can only book day before or earlier)", async () => {
    await clearOfficeDay(db.client);

    await expect(
      db.client.query(
        BOOK_SQL,
        bookParams({
          date: "2026-05-12",
          now: "2026-05-12 08:00",
        }),
      ),
    ).rejects.toMatchObject({ code: PG_ERROR.SLOT_IN_PAST });
  });

  test("succeeds when booking for the next day", async () => {
    await clearOfficeDay(db.client, 1, "2026-05-13");

    const ok = await db.client.query(
      BOOK_SQL,
      bookParams({
        date: "2026-05-13",
        now: "2026-05-12 23:59",
        email: "tomorrow@x.com",
      }),
    );
    expect(ok.rows[0].id).toBeTypeOf("number");
  });

  test("txn_unavailable when slot is outside available_from/until", async () => {
    await clearOfficeDay(db.client);

    // road-test seed window is 09:00-15:00. 08:30 is before available_from.
    await expect(db.client.query(BOOK_SQL, bookParams({ time: "08:30" }))).rejects.toMatchObject({
      code: PG_ERROR.TXN_UNAVAILABLE,
    });
  });

  test("txn_unavailable when an office override hides the txn", async () => {
    await clearOfficeDay(db.client);

    await db.client.query(
      `INSERT INTO transaction_types
         (txn_type_id, office_id, name, avg_duration_min, status)
       VALUES ('road-test', 1, 'Road Test', 30, 'hidden')`,
    );

    await expect(db.client.query(BOOK_SQL, bookParams())).rejects.toMatchObject({
      code: PG_ERROR.TXN_UNAVAILABLE,
    });
  });

  test("multi-skill booking uses the LATEST available_from across skills", async () => {
    await clearOfficeDay(db.client);

    // road-test available_from to 09:30. license-original has no window (NULL).
    // A multi-skill [1,3] booking at 09:00 must be rejected as road-test doesn't
    // start until 09:30, so the intersection window starts at 09:30.
    await db.client.query(
      `UPDATE transaction_types
          SET available_from = '09:30'
        WHERE txn_type_id = 'road-test'
          AND office_id IS NULL`,
    );

    const rejected = await tryBook(
      db.client,
      bookParams({ time: "09:00", skills: [ROAD_TEST, LICENSE_ORIGINAL] }),
    );
    expect(rejected).toEqual({ ok: false, code: PG_ERROR.TXN_UNAVAILABLE });

    // At 09:30 intersection boundary booking should succeed.
    const ok = await tryBook(
      db.client,
      bookParams({ time: "09:30", skills: [ROAD_TEST, LICENSE_ORIGINAL], email: "multi@x.com" }),
    );
    expect(ok.ok).toBe(true);
  });

  test("multi-skill booking uses the EARLIEST available_until across skills", async () => {
    await clearOfficeDay(db.client);

    // Set license-original available_until to 14:00. road-test stays at 15:00.
    // A multi-skill [1,3] total duration = 30 + 20 = 50 min.
    // Book at 13:11 which ends 14:01 which is past license-original's 14:00 cutoff.
    await db.client.query(
      `UPDATE transaction_types
          SET available_until = '14:00'
        WHERE txn_type_id = 'license-original'
          AND office_id IS NULL`,
    );

    const rejected = await tryBook(
      db.client,
      bookParams({ time: "13:11", skills: [ROAD_TEST, LICENSE_ORIGINAL] }),
    );
    expect(rejected).toEqual({ ok: false, code: PG_ERROR.TXN_UNAVAILABLE });

    // Book at 13:10 which ends exactly at 14:00 is okay.
    const ok = await tryBook(
      db.client,
      bookParams({ time: "13:10", skills: [ROAD_TEST, LICENSE_ORIGINAL], email: "until@x.com" }),
    );
    expect(ok.ok).toBe(true);
  });

  test("txn_unavailable when one of the multi-skill txns is hidden at the office", async () => {
    await clearOfficeDay(db.client);

    // Hide road-test at office 1. A multi-skill [1,3] booking should fail
    // because the office no longer offers one of the required skills.
    await db.client.query(
      `INSERT INTO transaction_types
         (txn_type_id, office_id, name, avg_duration_min, status)
       VALUES ('road-test', 1, 'Road Test', 30, 'hidden')`,
    );

    await expect(
      db.client.query(BOOK_SQL, bookParams({ skills: [ROAD_TEST, LICENSE_ORIGINAL] })),
    ).rejects.toMatchObject({
      code: PG_ERROR.TXN_UNAVAILABLE,
    });
  });

  // ---------------------------------------------------------------------------
  // Capacity correctness across overlapping appts and multi-skill calls
  // ---------------------------------------------------------------------------

  test("30-min appt at 09:00 occupies 09:15 too", async () => {
    await clearOfficeDay(db.client);

    // Book 2 road-test appts at 09:00 (supply=2, fills slots at 09:00).
    await db.client.query(BOOK_SQL, bookParams({ email: "a@x.com" }));
    await db.client.query(BOOK_SQL, bookParams({ email: "b@x.com" }));

    // Both 09:00 appts run until 09:30 (avg_duration=30). At 09:15 they are
    // still in progress, so demand at 09:15 = 2 = supply. Booking must fail.
    const blocked = await tryBook(db.client, bookParams({ time: "09:15", email: "c@x.com" }));
    expect(blocked).toEqual({ ok: false, code: PG_ERROR.CAPACITY_EXCEEDED });

    // At 09:30 the earlier appts have ended so the slot is open again.
    const ok = await tryBook(db.client, bookParams({ time: "09:30", email: "d@x.com" }));
    expect(ok.ok).toBe(true);
  });

  test("multi-skill appt blocked when one of the two skills is at capacity", async () => {
    await clearOfficeDay(db.client);

    // Skill 3 (license-original) supply at office 1 = 2 (Maria, James).
    // Fill skill 3 with two appts that need ONLY skill 3.
    await db.client.query(
      BOOK_SQL,
      bookParams({
        time: "09:00",
        skills: [LICENSE_ORIGINAL],
        email: "lo-a@x.com",
      }),
    );
    await db.client.query(
      BOOK_SQL,
      bookParams({
        time: "09:00",
        skills: [LICENSE_ORIGINAL],
        email: "lo-b@x.com",
      }),
    );

    // A multi-skill booking [1,3] now should fail on skill 3 even though
    // skill 1 still has spare supply as no clerk can servce skill 3.
    await expect(
      db.client.query(
        BOOK_SQL,
        bookParams({
          time: "09:00",
          skills: [ROAD_TEST, LICENSE_ORIGINAL],
          email: "multi@x.com",
        }),
      ),
    ).rejects.toMatchObject({ code: PG_ERROR.CAPACITY_EXCEEDED });
  });

  test("cancelled appts do not count toward demand", async () => {
    await clearOfficeDay(db.client);

    const a = await db.client.query(BOOK_SQL, bookParams({ email: "a@x.com" }));
    const b = await db.client.query(BOOK_SQL, bookParams({ email: "b@x.com" }));

    // Slot is now full (supply=2, demand=2). Cancel one and re-book.
    await db.client.query(`UPDATE appointments SET status='cancelled' WHERE id = $1`, [
      a.rows[0].id,
    ]);
    void b;

    const replay = await db.client.query(BOOK_SQL, bookParams({ email: "replay@x.com" }));
    expect(replay.rows[0].id).toBeTypeOf("number");
  });

  test("inactive clerks do not count toward supply", async () => {
    await clearOfficeDay(db.client);

    // Mark one of the two road-test clerks inactive — supply drops 2 → 1.
    await db.client.query(`UPDATE clerks SET status='inactive' WHERE id = 1`);

    await db.client.query(BOOK_SQL, bookParams({ email: "a@x.com" }));
    await expect(db.client.query(BOOK_SQL, bookParams({ email: "b@x.com" }))).rejects.toMatchObject(
      { code: PG_ERROR.CAPACITY_EXCEEDED },
    );
  });

  test("appt straddling a lunch window is rejected (multi-block recheck)", async () => {
    await clearOfficeDay(db.client);

    // Remove Angela leaving Maria as the only road-test clerk.
    await db.client.query(`UPDATE clerks SET status='inactive' WHERE id = 3`);

    // Maria's lunch is shift 1 (11:30-12:15). A 30-min road-test at 11:15
    // runs 11:15-11:45, crossing the 11:30 lunch boundary. At 11:30 Maria
    // is on lunch so there is no road test supply
    const result = await tryBook(db.client, bookParams({ time: "11:15", email: "straddle@x.com" }));
    expect(result).toEqual({ ok: false, code: PG_ERROR.CAPACITY_EXCEEDED });
  });

  // ---------------------------------------------------------------------------
  // Time boundary edge cases
  // ---------------------------------------------------------------------------

  test("boundary: appt ending exactly at available_until succeeds", async () => {
    await clearOfficeDay(db.client);

    // road-test available_until = 15:00, duration = 30. Start at 14:30 ends
    // at 15:00 exactly. The gate is `slot_end > available_until` (strict >),
    // so equality must be allowed.
    const ok = await db.client.query(BOOK_SQL, bookParams({ time: "14:30", email: "edge@x.com" }));
    expect(ok.rows[0].id).toBeTypeOf("number");
  });

  test("boundary: appt running one minute past available_until rejected", async () => {
    await clearOfficeDay(db.client);

    // 14:31 + 30 = 15:01 > available_until 15:00 → reject.
    await expect(
      db.client.query(BOOK_SQL, bookParams({ time: "14:31", email: "over@x.com" })),
    ).rejects.toMatchObject({ code: PG_ERROR.TXN_UNAVAILABLE });
  });

  test("boundary: appt starting exactly at available_from succeeds", async () => {
    await clearOfficeDay(db.client);

    // 09:00 == available_from. The gate is `time < available_from` (strict <).
    const ok = await db.client.query(BOOK_SQL, bookParams({ time: "09:00", email: "open@x.com" }));
    expect(ok.rows[0].id).toBeTypeOf("number");
  });

  test("boundary: appt ending exactly at office close succeeds (id-card)", async () => {
    await clearOfficeDay(db.client);

    // id-card has no available_from/until (NULL). Its gate is the office's
    // 17:00 close. avg_duration=15 → start at 16:45 ends at 17:00 exactly.
    const ok = await db.client.query(
      BOOK_SQL,
      bookParams({
        time: "16:45",
        skills: [ID_CARD],
        email: "late@x.com",
      }),
    );
    expect(ok.rows[0].id).toBeTypeOf("number");
  });

  test("boundary: appt ending one minute past close rejected", async () => {
    await clearOfficeDay(db.client);

    // license-original is 20 min and has no override. Start 16:41 ends 17:01.
    await expect(
      db.client.query(
        BOOK_SQL,
        bookParams({
          time: "16:41",
          skills: [LICENSE_ORIGINAL],
          email: "past-close@x.com",
        }),
      ),
    ).rejects.toMatchObject({ code: PG_ERROR.OFFICE_CLOSED });
  });

  test("boundary: clerk on lunch is excluded from supply during lunch window", async () => {
    await clearOfficeDay(db.client);

    // At 11:45 (inside Maria's 11:30-12:15 lunch shift), Maria is excluded.
    // Supply for road-test drops 2 → 1. Second booking at 11:45 must fail.
    const first = await tryBook(
      db.client,
      bookParams({
        time: "11:45",
        email: "l1@x.com",
      }),
    );
    expect(first.ok).toBe(true);

    const second = await tryBook(
      db.client,
      bookParams({
        time: "11:45",
        email: "l2@x.com",
      }),
    );
    expect(second).toEqual({ ok: false, code: PG_ERROR.CAPACITY_EXCEEDED });

    // At 12:15: Maria's shift-1 lunch ended (end_time strict >, so 12:15 is
    // free for her). Angela is on shift-2 lunch (12:15-13:00) so she IS on
    // lunch at 12:15. Net road-test supply at 12:15 = 1 (Maria only).
    // The 11:45 appt's end_at = 12:15 — equality fails the strict > demand
    // check, so it doesn't overlap 12:15.
    const okOne = await tryBook(
      db.client,
      bookParams({
        time: "12:15",
        email: "l3@x.com",
      }),
    );
    expect(okOne.ok).toBe(true);

    const overflow = await tryBook(
      db.client,
      bookParams({
        time: "12:15",
        email: "l4@x.com",
      }),
    );
    expect(overflow).toEqual({ ok: false, code: PG_ERROR.CAPACITY_EXCEEDED });
  });

  // ---------------------------------------------------------------------------
  // Race conditions
  // ---------------------------------------------------------------------------

  test("race: exactly one of two concurrent bookings wins, the other gets capacity_exceeded", async () => {
    const { winnerId, loserCode } = await raceTest({
      preBookParams: bookParams({ email: "pre@x.com" }),
      racerAParams: bookParams({ email: "race-a@x.com" }),
      racerBParams: bookParams({ email: "race-b@x.com" }),
    });
    expect(winnerId).toBeTypeOf("number");
    expect(loserCode).toBe(PG_ERROR.CAPACITY_EXCEEDED);
  });
});

describe("total concurrent cap (run_rate_pct + lunch)", () => {
  test("run_rate_pct caps total concurrent even with diverse skills", async () => {
    await clearOfficeDay(db.client);

    // Set run_rate_pct=50 → effective_desks = floor(3*50/100) = 1.
    await db.client.query(`UPDATE offices SET run_rate_pct = 50 WHERE id=1`);

    // Book 1 appt (any skill) — fills the effective desk cap.
    await db.client.query(BOOK_SQL, bookParams({ skills: [ID_CARD], email: "cap1@x.com" }));

    // Second booking with a DIFFERENT skill should be rejected (desk cap hit).
    const result = await tryBook(
      db.client,
      bookParams({ skills: [ROAD_TEST], email: "cap2@x.com" }),
    );
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe(PG_ERROR.CAPACITY_EXCEEDED);

    // Restore run_rate_pct.
    await db.client.query(`UPDATE offices SET run_rate_pct = 100 WHERE id=1`);
  });

  test("lunch reduces effective cap below effective_desks", async () => {
    await clearOfficeDay(db.client);

    // At 12:20: clerks B(2) and C(3) are on lunch shift 2 (12:15-13:00).
    // Only clerk A(1) on floor. Cap = min(3, 1) = 1.
    // Book one appt at 12:20 → fills cap.
    await db.client.query(
      BOOK_SQL,
      bookParams({ time: "12:20", skills: [ID_CARD], email: "lunch1@x.com" }),
    );

    // Second booking at same time with different skill → rejected (only 1 clerk on floor).
    const result = await tryBook(
      db.client,
      bookParams({ time: "12:20", skills: [LICENSE_ORIGINAL], email: "lunch2@x.com" }),
    );
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe(PG_ERROR.CAPACITY_EXCEEDED);
  });

  test("appt spanning into lunch rejected when exceeding on-floor count", async () => {
    await clearOfficeDay(db.client);

    // Office 1 shift 2 (12:15-13:00): James(2) + Angela(3) on lunch. Only Maria on floor.
    // Book at 12:00 (30-min road-test, ends 12:30). At 12:00: 3 on floor, OK.
    await db.client.query(
      BOOK_SQL,
      bookParams({ time: "12:00", skills: [ROAD_TEST], email: "pre18@x.com" }),
    );

    // Try booking at 12:10 (15-min id-card, ends 12:25). Spans into shift 2.
    // At 12:15 change-point: 1 on floor (Maria), 1 existing still running → concurrent=1, cap=1, deskAvail=0.
    const result = await tryBook(
      db.client,
      bookParams({ time: "12:10", skills: [ID_CARD], email: "span18@x.com" }),
    );
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe(PG_ERROR.CAPACITY_EXCEEDED);
  });

  test("full capacity restored when appt starts after lunch ends", async () => {
    await clearOfficeDay(db.client);

    // At 12:15: lunch shift 1 ends, all 3 clerks back. Should book fine.
    const result = await tryBook(
      db.client,
      bookParams({ time: "12:15", skills: [ID_CARD], email: "postlunch@x.com" }),
    );
    expect(result.ok).toBe(true);
  });

  test("diverse-skill appts cannot exceed clerks on floor during lunch", async () => {
    await clearOfficeDay(db.client);

    // Book at 12:00 (skill 1, 30 min → ends 12:30). At 12:00 all 3 on floor, OK.
    await db.client.query(
      BOOK_SQL,
      bookParams({ time: "12:00", skills: [ROAD_TEST], email: "pre22@x.com" }),
    );

    // Try booking skill 2 at 12:15. At 12:15: shift 2 starts (clerks 2,3 on lunch).
    // Only clerk 1 on floor. Existing appt from 12:00 still running → concurrent=1, cap=1, rejected.
    const result = await tryBook(
      db.client,
      bookParams({ time: "12:15", skills: [ID_CARD], email: "div22@x.com" }),
    );
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe(PG_ERROR.CAPACITY_EXCEEDED);
  });

  test("run_rate_pct and lunch at the same time check walk-in headroom maintained", async () => {
    await clearOfficeDay(db.client);

    // Set run_rate_pct=50 → effective_desks = floor(3*50/100) = 1.
    await db.client.query(`UPDATE offices SET run_rate_pct = 50 WHERE id=1`);

    // At 12:20 during shift 2: James+Angela on lunch, only Maria on floor.
    // Cap = min(effective_desks=1, clerks_on_floor=1) = 1.
    // First booking should succeed (fills the single slot).
    const first = await tryBook(
      db.client,
      bookParams({ time: "12:20", skills: [ID_CARD], email: "c20a@x.com" }),
    );
    expect(first.ok).toBe(true);

    // Second booking same time rejected (cap=1, concurrent=1).
    const second = await tryBook(
      db.client,
      bookParams({ time: "12:20", skills: [LICENSE_ORIGINAL], email: "c20b@x.com" }),
    );
    expect(second.ok).toBe(false);
    expect((second as { code: string }).code).toBe(PG_ERROR.CAPACITY_EXCEEDED);

    // At 09:00 (all 3 on floor): cap = min(1, 3) = 1. Still only 1 allowed.
    const third = await tryBook(
      db.client,
      bookParams({ time: "09:00", skills: [ROAD_TEST], email: "c20c@x.com" }),
    );
    expect(third.ok).toBe(true);
    const fourth = await tryBook(
      db.client,
      bookParams({ time: "09:00", skills: [ID_CARD], email: "c20d@x.com" }),
    );
    expect(fourth.ok).toBe(false);
    expect((fourth as { code: string }).code).toBe(PG_ERROR.CAPACITY_EXCEEDED);

    await db.client.query(`UPDATE offices SET run_rate_pct = 100 WHERE id=1`);
  });

  test("multi-skill appt spanning lunch rejected when specialist is on break", async () => {
    await clearOfficeDay(db.client);

    // Multi-skill [1,3] = road-test(30) + license-original(25) = 55 min.
    // Book at 11:00 → spans 11:00-11:55. Lunch shift 1 starts at 11:30 (inside window).
    // At 11:30: Maria on lunch, James+Angela on floor (2 clerks).
    // Skill [1,3] supply: only Maria has both 1 and 3 → supply=0 at 11:30 (she's on lunch).
    const result = await tryBook(
      db.client,
      bookParams({ time: "11:00", skills: [ROAD_TEST, LICENSE_ORIGINAL], email: "c21@x.com" }),
    );
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe(PG_ERROR.CAPACITY_EXCEEDED);
  });
});
