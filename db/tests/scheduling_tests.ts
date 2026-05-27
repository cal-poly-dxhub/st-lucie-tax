import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { connect } from './helpers/client.ts';
import { useDb } from './helpers/fixture.ts';

const db = useDb();

// Booking tests target office 1 on 2026-05-12 (Tuesday).
// Office 1 supply for road_test (skill 1) at 09:00:
//   scheduled clerks with skill 1 = Maria (id=1), Angela (id=3) → 2.
//   Neither has lunch at 09:00. run_rate_pct = 100 → supply = 2.
const ROAD_TEST = 1;
const DATE = '2026-05-12';
// Frozen "now" for the tests — 06:00 on the seed date, comfortably before
// every booking time the suite tries (earliest is 07:30). Lets the past-slot
// gate in book_appointment stay deterministic without freezing the wall clock.
const FROZEN_NOW = '2026-05-12 06:00';

// Use named args so we can pass p_now_ts without expanding every positional
// parameter (qr_code / is_walk_in / is_priority stay defaulted).
const BOOK_SQL = `
  SELECT book_appointment(
    p_county_id     := $1,
    p_office_id     := $2,
    p_date          := $3,
    p_time          := $4,
    p_txn_type_ids  := $5,
    p_first_name    := $6,
    p_last_name     := $7,
    p_contact_email := $8,
    p_contact_phone := $9,
    p_now_ts        := $10::timestamp
  ) AS id
`;
const bookParams = (overrides: Partial<{
  office: number; date: string; time: string; skills: number[];
  first: string; last: string; email: string; phone: string;
  now: string;
}> = {}) => [
  'stlucie',
  overrides.office ?? 1,
  overrides.date   ?? DATE,
  overrides.time   ?? '09:00',
  overrides.skills ?? [ROAD_TEST],
  overrides.first  ?? 'Test',
  overrides.last   ?? 'Booker',
  overrides.email  ?? 'test@example.com',
  overrides.phone  ?? '555-0000',
  overrides.now    ?? FROZEN_NOW,
];

// Wipe seeded appts at the test office/date so capacity math is predictable.
async function clearOfficeDay(client: Client) {
  await client.query(
    `DELETE FROM appointments
      WHERE county_id='stlucie' AND office_id=1 AND appointment_date=$1`,
    [DATE],
  );
}

// Run a query inside a SAVEPOINT. Lets us assert .rejects without aborting
// the outer per-test transaction, so subsequent queries in the same test
// still work.
async function tryBook(client: Client, params: unknown[]): Promise<{
  ok: true;  id: number;
} | {
  ok: false; code: string;
}> {
  await client.query('SAVEPOINT s');
  try {
    const { rows } = await client.query(BOOK_SQL, params);
    await client.query('RELEASE SAVEPOINT s');
    return { ok: true, id: rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT s');
    return { ok: false, code: (err as { code: string }).code };
  }
}

describe('query 1: get office config', () => {
  test('returns Fort Pierce config for office_id=1', async () => {
    const { rows } = await db.client.query(
      `SELECT id, office_name, name, total_desks, run_rate_pct
         FROM offices
        WHERE county_id = 'stlucie' AND id = 1`,
    );
    expect(rows).toEqual([
      {
        id: 1,
        office_name: 'ftpierce',
        name: 'Fort Pierce Office',
        total_desks: 3,
        run_rate_pct: 100,
      },
    ]);
  });
});

describe('query 2: get office hours', () => {
  test('returns Mon-Fri 08:00-17:00 for office 1', async () => {
    const { rows } = await db.client.query(
      `SELECT day_of_week, open_time::text AS open, close_time::text AS close
         FROM office_hours
        WHERE county_id = 'stlucie' AND office_id = 1
        ORDER BY day_of_week`,
    );
    expect(rows).toEqual([
      { day_of_week: 1, open: '08:00:00', close: '17:00:00' },
      { day_of_week: 2, open: '08:00:00', close: '17:00:00' },
      { day_of_week: 3, open: '08:00:00', close: '17:00:00' },
      { day_of_week: 4, open: '08:00:00', close: '17:00:00' },
      { day_of_week: 5, open: '08:00:00', close: '17:00:00' },
    ]);
  });
});

describe('query 3: get lunch shifts', () => {
  test('returns the two 45-min shifts for office 1', async () => {
    const { rows } = await db.client.query(
      `SELECT shift_num, start_time::text AS start, end_time::text AS finish
         FROM office_lunch_shifts
        WHERE county_id = 'stlucie' AND office_id = 1
        ORDER BY start_time`,
    );
    expect(rows).toEqual([
      { shift_num: 1, start: '11:30:00', finish: '12:15:00' },
      { shift_num: 2, start: '12:15:00', finish: '13:00:00' },
    ]);
  });
});

describe('query 4: effective transaction types', () => {
  test('baseline: all 3 global txns active at office 1', async () => {
    const { rows } = await db.client.query(
      `SELECT txn_type_id
         FROM effective_transaction_types
        WHERE county_id = 'stlucie' AND office_id = 1 AND status = 'active'
        ORDER BY global_id`,
    );
    expect(rows.map(r => r.txn_type_id)).toEqual([
      'road_test',
      'id_card',
      'license_original',
    ]);
  });

  test('hidden override at office 1 drops road_test there but not at office 2', async () => {
    await db.client.query(
      `INSERT INTO transaction_types
         (county_id, txn_type_id, office_id, name, avg_duration_min, status)
       VALUES ('stlucie', 'road_test', 1, 'Road Test', 30, 'hidden')`,
    );

    const office1 = await db.client.query(
      `SELECT txn_type_id
         FROM effective_transaction_types
        WHERE county_id = 'stlucie' AND office_id = 1 AND status = 'active'
        ORDER BY global_id`,
    );
    expect(office1.rows.map(r => r.txn_type_id)).toEqual([
      'id_card',
      'license_original',
    ]);

    const office2 = await db.client.query(
      `SELECT txn_type_id
         FROM effective_transaction_types
        WHERE county_id = 'stlucie' AND office_id = 2 AND status = 'active'
        ORDER BY global_id`,
    );
    expect(office2.rows.map(r => r.txn_type_id)).toEqual([
      'road_test',
      'id_card',
      'license_original',
    ]);
  });
});

// office_txn_window CTE in booking-query.sql intersects per-skill availability
// windows into one window per office. With concurrent-skill semantics, the
// earliest the appt can start is the LATEST of the skills' available_from
// values, and the latest it can end is the EARLIEST of available_until.
// road_test currently starts at 09:00 in seed; this suite overrides it to
// 09:30 so license_original (NULL = office-open) and road_test produce
// distinct lower bounds.
const OFFICE_TXN_WINDOW_SQL = `
  SELECT ett.office_id,
         MAX(ett.available_from)  AS earliest_start,
         MIN(ett.available_until) AS latest_end
    FROM effective_transaction_types ett
   WHERE ett.county_id = 'stlucie'
     AND ett.global_id = ANY($1::int[])
     AND ett.status    = 'active'
   GROUP BY ett.office_id
  HAVING COUNT(*) = cardinality($1::int[])
   ORDER BY ett.office_id
`;

describe('office_txn_window: per-office intersected availability', () => {
  test('multi-skill takes the LATEST available_from across skills', async () => {
    // Push road_test from 09:00 → 09:30 globally. license_original stays NULL.
    // Intersection: earliest_start = MAX(09:30, NULL) = 09:30, even though
    // license_original alone would allow earlier slots.
    await db.client.query(
      `UPDATE transaction_types
          SET available_from = '09:30'
        WHERE county_id = 'stlucie'
          AND txn_type_id = 'road_test'
          AND office_id IS NULL`,
    );

    const { rows } = await db.client.query(OFFICE_TXN_WINDOW_SQL, [[1, 3]]);
    expect(rows).toEqual([
      { office_id: 1, earliest_start: '09:30:00', latest_end: '15:00:00' },
      { office_id: 2, earliest_start: '09:30:00', latest_end: '15:00:00' },
    ]);
  });

  test('multi-skill takes the EARLIEST available_until across skills', async () => {
    // road_test until 15:00, license_original until 13:00 → MIN = 13:00.
    await db.client.query(
      `UPDATE transaction_types
          SET available_until = '13:00'
        WHERE county_id = 'stlucie'
          AND txn_type_id = 'license_original'
          AND office_id IS NULL`,
    );

    const { rows } = await db.client.query(OFFICE_TXN_WINDOW_SQL, [[1, 3]]);
    expect(rows.map(r => ({ office: r.office_id, end: r.latest_end }))).toEqual([
      { office: 1, end: '13:00:00' },
      { office: 2, end: '13:00:00' },
    ]);
  });

  test('NULL available_from on a skill does not pull the intersection earlier', async () => {
    // Single skill with no time window (id_card, NULL/NULL) returns NULLs —
    // i.e. no extra constraint beyond office hours.
    const { rows } = await db.client.query(OFFICE_TXN_WINDOW_SQL, [[2]]);
    expect(rows).toEqual([
      { office_id: 1, earliest_start: null, latest_end: null },
      { office_id: 2, earliest_start: null, latest_end: null },
    ]);
  });

  test('office is dropped when one of the requested skills is hidden there', async () => {
    // Hide road_test at office 1 only. Office 1 disappears from the result
    // because COUNT(*) for [1,3] = 1 ≠ 2 = cardinality.
    await db.client.query(
      `INSERT INTO transaction_types
         (county_id, txn_type_id, office_id, name, avg_duration_min, status)
       VALUES ('stlucie', 'road_test', 1, 'Road Test', 30, 'hidden')`,
    );

    const { rows } = await db.client.query(OFFICE_TXN_WINDOW_SQL, [[1, 3]]);
    expect(rows.map(r => r.office_id)).toEqual([2]);
  });
});

describe('book_appointment: lock + recheck + insert', () => {
  test('happy path inserts and returns the new appointment id', async () => {
    await clearOfficeDay(db.client);

    const { rows } = await db.client.query(BOOK_SQL, bookParams());
    expect(rows[0].id).toBeTypeOf('number');

    const check = await db.client.query(
      `SELECT first_name, last_name, status, txn_type_ids
         FROM appointments WHERE id = $1`,
      [rows[0].id],
    );
    expect(check.rows[0]).toMatchObject({
      first_name: 'Test',
      last_name:  'Booker',
      status:     'scheduled',
      txn_type_ids: [ROAD_TEST],
    });
  });

  test('capacity_exceeded once the slot is full', async () => {
    await clearOfficeDay(db.client);

    // Supply at 09:00 for road_test = 2. Book twice → ok. Third → reject.
    await db.client.query(BOOK_SQL, bookParams({ email: 'a@x.com' }));
    await db.client.query(BOOK_SQL, bookParams({ email: 'b@x.com' }));

    await expect(
      db.client.query(BOOK_SQL, bookParams({ email: 'c@x.com' })),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  test('office_closed when slot is outside open/close window', async () => {
    await clearOfficeDay(db.client);

    // Office hours are 08:00-17:00. 07:30 is before open.
    await expect(
      db.client.query(BOOK_SQL, bookParams({ time: '07:30' })),
    ).rejects.toMatchObject({ code: 'P0002' });
  });

  test('slot_in_past when slot start is before now_ts', async () => {
    await clearOfficeDay(db.client);

    // Frozen now = 09:30 on the seed date. A 09:00 slot is already in the
    // past — must be rejected before any capacity work.
    await expect(
      db.client.query(BOOK_SQL, bookParams({
        time: '09:00', now: '2026-05-12 09:30',
      })),
    ).rejects.toMatchObject({ code: 'P0004' });
  });

  test('slot_in_past when slot start equals now_ts (strict <=)', async () => {
    await clearOfficeDay(db.client);

    // Equality fails the gate: book_appointment uses `slot_start <= now_ts`
    // so callers can't bypass any lead-time policy by booking "right now".
    await expect(
      db.client.query(BOOK_SQL, bookParams({
        time: '09:00', now: '2026-05-12 09:00',
      })),
    ).rejects.toMatchObject({ code: 'P0004' });
  });

  test('slot_in_past does not fire when slot is in the future', async () => {
    await clearOfficeDay(db.client);

    // Frozen now = 08:00, slot at 09:00 — comfortably in the future. The
    // booking should succeed (sanity check that the gate doesn't over-fire).
    const ok = await db.client.query(
      BOOK_SQL,
      bookParams({ time: '09:00', now: '2026-05-12 08:00', email: 'future@x.com' }),
    );
    expect(ok.rows[0].id).toBeTypeOf('number');
  });

  test('txn_unavailable when slot is outside available_from/until', async () => {
    await clearOfficeDay(db.client);

    // road_test seed window is 09:00-15:00. 08:30 is before available_from.
    await expect(
      db.client.query(BOOK_SQL, bookParams({ time: '08:30' })),
    ).rejects.toMatchObject({ code: 'P0003' });
  });

  test('txn_unavailable when an office override hides the txn', async () => {
    await clearOfficeDay(db.client);

    await db.client.query(
      `INSERT INTO transaction_types
         (county_id, txn_type_id, office_id, name, avg_duration_min, status)
       VALUES ('stlucie', 'road_test', 1, 'Road Test', 30, 'hidden')`,
    );

    await expect(
      db.client.query(BOOK_SQL, bookParams()),
    ).rejects.toMatchObject({ code: 'P0003' });
  });

  // ---------------------------------------------------------------------------
  // Capacity correctness across overlapping appointments and multi-skill calls
  // ---------------------------------------------------------------------------

  test('appt overlap: a 30-min appt at 09:00 occupies 09:15 too', async () => {
    await clearOfficeDay(db.client);

    // Book 2 road_test appts at 09:00 (supply=2, fills slot at 09:00).
    await db.client.query(BOOK_SQL, bookParams({ email: 'a@x.com' }));
    await db.client.query(BOOK_SQL, bookParams({ email: 'b@x.com' }));

    // Both 09:00 appts run until 09:30 (avg_duration=30). At 09:15 they are
    // still in progress, so demand at 09:15 = 2 = supply. Booking must fail.
    const blocked = await tryBook(
      db.client,
      bookParams({ time: '09:15', email: 'c@x.com' }),
    );
    expect(blocked).toEqual({ ok: false, code: 'P0001' });

    // At 09:30 the earlier appts have ended (end_at > slot uses strict >),
    // so the slot is open again.
    const ok = await tryBook(
      db.client,
      bookParams({ time: '09:30', email: 'd@x.com' }),
    );
    expect(ok.ok).toBe(true);
  });

  test('multi-skill: appt blocked when one of the two skills is at capacity', async () => {
    await clearOfficeDay(db.client);

    // Skill 3 (license_original) supply at office 1 = 2 (Maria, James).
    // Fill skill 3 with two appts that need ONLY skill 3.
    await db.client.query(BOOK_SQL, bookParams({
      time: '09:00', skills: [3], email: 'lo-a@x.com',
    }));
    await db.client.query(BOOK_SQL, bookParams({
      time: '09:00', skills: [3], email: 'lo-b@x.com',
    }));

    // A multi-skill booking [1,3] now should fail on skill 3 even though
    // skill 1 still has spare supply.
    await expect(
      db.client.query(BOOK_SQL, bookParams({
        time: '09:00', skills: [1, 3], email: 'multi@x.com',
      })),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  test('cancelled appts do not count toward demand', async () => {
    await clearOfficeDay(db.client);

    const a = await db.client.query(BOOK_SQL, bookParams({ email: 'a@x.com' }));
    const b = await db.client.query(BOOK_SQL, bookParams({ email: 'b@x.com' }));

    // Slot is now full (supply=2, demand=2). Cancel one and re-book.
    await db.client.query(
      `UPDATE appointments SET status='cancelled' WHERE id = $1`,
      [a.rows[0].id],
    );
    void b;

    const replay = await db.client.query(
      BOOK_SQL,
      bookParams({ email: 'replay@x.com' }),
    );
    expect(replay.rows[0].id).toBeTypeOf('number');
  });

  test('inactive clerks do not count toward supply', async () => {
    await clearOfficeDay(db.client);

    // Mark one of the two road_test clerks inactive — supply drops 2 → 1.
    await db.client.query(
      `UPDATE clerks SET status='inactive' WHERE id = 1`,
    );

    await db.client.query(BOOK_SQL, bookParams({ email: 'a@x.com' }));
    await expect(
      db.client.query(BOOK_SQL, bookParams({ email: 'b@x.com' })),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  test('appt straddling a lunch window is rejected (multi-block recheck)', async () => {
    await clearOfficeDay(db.client);

    // Knock out Angela: leaves Maria as the only road_test clerk.
    await db.client.query(
      `UPDATE clerks SET status='inactive' WHERE id = 3`,
    );

    // Maria's lunch is shift 1 (11:30-12:15). A 30-min road_test at 11:15
    // runs 11:15-11:45, crossing the 11:30 lunch boundary. At 11:30 Maria
    // is on lunch → supply = 0 — multi-block recheck rejects the booking.
    const result = await tryBook(
      db.client,
      bookParams({ time: '11:15', email: 'straddle@x.com' }),
    );
    expect(result).toEqual({ ok: false, code: 'P0001' });
  });

  // ---------------------------------------------------------------------------
  // Time boundary edge cases
  // ---------------------------------------------------------------------------

  test('boundary: appt ending exactly at available_until succeeds', async () => {
    await clearOfficeDay(db.client);

    // road_test available_until = 15:00, duration = 30. Start at 14:30 ends
    // at 15:00 exactly. The gate is `slot_end > available_until` (strict >),
    // so equality must be allowed.
    const ok = await db.client.query(
      BOOK_SQL,
      bookParams({ time: '14:30', email: 'edge@x.com' }),
    );
    expect(ok.rows[0].id).toBeTypeOf('number');
  });

  test('boundary: appt running one minute past available_until rejected', async () => {
    await clearOfficeDay(db.client);

    // 14:31 + 30 = 15:01 > available_until 15:00 → reject.
    await expect(
      db.client.query(BOOK_SQL, bookParams({ time: '14:31', email: 'over@x.com' })),
    ).rejects.toMatchObject({ code: 'P0003' });
  });

  test('boundary: appt starting exactly at available_from succeeds', async () => {
    await clearOfficeDay(db.client);

    // 09:00 == available_from. The gate is `time < available_from` (strict <).
    const ok = await db.client.query(
      BOOK_SQL,
      bookParams({ time: '09:00', email: 'open@x.com' }),
    );
    expect(ok.rows[0].id).toBeTypeOf('number');
  });

  test('boundary: appt ending exactly at office close succeeds (id_card)', async () => {
    await clearOfficeDay(db.client);

    // id_card has no available_from/until (NULL). Its gate is the office's
    // 17:00 close. avg_duration=15 → start at 16:45 ends at 17:00 exactly.
    const ok = await db.client.query(BOOK_SQL, bookParams({
      time: '16:45', skills: [2], email: 'late@x.com',
    }));
    expect(ok.rows[0].id).toBeTypeOf('number');
  });

  test('boundary: appt ending one minute past close rejected', async () => {
    await clearOfficeDay(db.client);

    // license_original is 25 min and has no override. Start 16:36 ends 17:01.
    await expect(
      db.client.query(BOOK_SQL, bookParams({
        time: '16:36', skills: [3], email: 'past-close@x.com',
      })),
    ).rejects.toMatchObject({ code: 'P0002' });
  });

  test('boundary: clerk on lunch is excluded from supply during lunch window', async () => {
    await clearOfficeDay(db.client);

    // At 11:45 (inside Maria's 11:30-12:15 lunch shift), Maria is excluded.
    // Supply for road_test drops 2 → 1. Second booking at 11:45 must fail.
    const first = await tryBook(db.client, bookParams({
      time: '11:45', email: 'l1@x.com',
    }));
    expect(first.ok).toBe(true);

    const second = await tryBook(db.client, bookParams({
      time: '11:45', email: 'l2@x.com',
    }));
    expect(second).toEqual({ ok: false, code: 'P0001' });

    // At 12:15: Maria's shift-1 lunch ended (end_time strict >, so 12:15 is
    // free for her). Angela is on shift-2 lunch (12:15-13:00) so she IS on
    // lunch at 12:15. Net road_test supply at 12:15 = 1 (Maria only).
    // The 11:45 appt's end_at = 12:15 — equality fails the strict > demand
    // check, so it doesn't overlap 12:15.
    const okOne = await tryBook(db.client, bookParams({
      time: '12:15', email: 'l3@x.com',
    }));
    expect(okOne.ok).toBe(true);

    const overflow = await tryBook(db.client, bookParams({
      time: '12:15', email: 'l4@x.com',
    }));
    expect(overflow).toEqual({ ok: false, code: 'P0001' });
  });

  // ---------------------------------------------------------------------------
  // Race conditions
  // ---------------------------------------------------------------------------

  test('race: two concurrent bookings — first wins, second gets capacity_exceeded', async () => {
    // Run outside the fixture's transaction: two independent connections
    // with their own transactions. Pre-book one seat so the race is for
    // the last one.
    const setup = await connect();
    const a = await connect();
    const b = await connect();
    try {
      await setup.query(`SET app.current_tenant = 'stlucie'`);
      await a.query(`SET app.current_tenant = 'stlucie'`);
      await b.query(`SET app.current_tenant = 'stlucie'`);

      await setup.query(
        `DELETE FROM appointments
          WHERE county_id='stlucie' AND office_id=1
            AND appointment_date=$1`,
        [DATE],
      );
      await setup.query(BOOK_SQL, bookParams({ email: 'pre@x.com' }));

      await a.query('BEGIN');
      await b.query('BEGIN');

      // Issue A first; small await to let it acquire FOR UPDATE locks.
      const racerA = a.query(BOOK_SQL, bookParams({ email: 'race-a@x.com' }));
      await new Promise(r => setTimeout(r, 50));
      const racerB = b.query(BOOK_SQL, bookParams({ email: 'race-b@x.com' }));

      const winnerRow = await racerA;
      expect(winnerRow.rows[0].id).toBeTypeOf('number');

      // Releasing A's locks lets B's recheck proceed against the updated
      // state — B should see demand has gone up and raise capacity_exceeded.
      await a.query('COMMIT');

      await expect(racerB).rejects.toMatchObject({ code: 'P0001' });
      await b.query('ROLLBACK');

      // Cleanup the winner so seed isn't permanently mutated.
      await setup.query(
        `DELETE FROM appointments
          WHERE county_id='stlucie' AND office_id=1
            AND appointment_date=$1`,
        [DATE],
      );
    } finally {
      await setup.end();
      await a.end();
      await b.end();
    }
  });

  test('race: multi-skill bookings serialize on the same office/day lock', async () => {
    // Both bookings need skills [1,3]. Skill 3 supply at 09:00 = 2 (Maria,
    // James). Pre-book one [3]-only appt so skill 3 has 1 seat left.
    // Two parallel multi-skill bookings race for that last seat.
    const setup = await connect();
    const a = await connect();
    const b = await connect();
    try {
      await setup.query(`SET app.current_tenant = 'stlucie'`);
      await a.query(`SET app.current_tenant = 'stlucie'`);
      await b.query(`SET app.current_tenant = 'stlucie'`);

      await setup.query(
        `DELETE FROM appointments
          WHERE county_id='stlucie' AND office_id=1
            AND appointment_date=$1`,
        [DATE],
      );
      await setup.query(BOOK_SQL, bookParams({
        skills: [3], email: 'pre@x.com',
      }));

      await a.query('BEGIN');
      await b.query('BEGIN');

      const racerA = a.query(BOOK_SQL, bookParams({
        skills: [1, 3], email: 'multi-a@x.com',
      }));
      await new Promise(r => setTimeout(r, 50));
      const racerB = b.query(BOOK_SQL, bookParams({
        skills: [1, 3], email: 'multi-b@x.com',
      }));

      const winnerRow = await racerA;
      expect(winnerRow.rows[0].id).toBeTypeOf('number');
      await a.query('COMMIT');

      await expect(racerB).rejects.toMatchObject({ code: 'P0001' });
      await b.query('ROLLBACK');

      await setup.query(
        `DELETE FROM appointments
          WHERE county_id='stlucie' AND office_id=1
            AND appointment_date=$1`,
        [DATE],
      );
    } finally {
      await setup.end();
      await a.end();
      await b.end();
    }
  });
});

// Smoke test for the booking validation query in db/booking-query.sql.
// The file uses a hardcoded params CTE for psql exploration; this test runs it
// as-is against the seed and asserts the single-slot validation shape.
describe('booking-query.sql: single-slot validation', () => {
  const VALIDATION_SQL = readFileSync(
    resolve(import.meta.dirname, '../booking-query.sql'),
    'utf8',
  );

  test('returns at most one row with expected columns when slot is bookable', async () => {
    const { rows } = await db.client.query(VALIDATION_SQL);

    // The query returns exactly one row if the slot is bookable, zero if not.
    expect(rows.length).toBeLessThanOrEqual(1);

    if (rows.length === 1) {
      const row = rows[0];
      expect(row).toMatchObject({
        office_id: expect.any(Number),
        slot_date: expect.any(Date),
        slot_time: expect.any(String),
      });
      expect(Number(row.available)).toBeGreaterThan(0);
    }
  });
});
