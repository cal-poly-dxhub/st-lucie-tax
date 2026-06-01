import { describe, expect, test } from 'vitest';
import { useDb } from './helpers/fixture.ts';
import { findAppointment, type FindApptInput } from '../../src/find-appt.ts';

const db = useDb();

const DATE = '2026-05-12';
const FROZEN_NOW = '2026-05-12 06:00';
const ROAD_TEST = 1;
const ID_CARD = 2;

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

function bookParams(overrides: Partial<{
  office: number; date: string; time: string; skills: number[];
  email: string; now: string;
}> = {}) {
  return [
    'stlucie',
    overrides.office ?? 1,
    overrides.date   ?? DATE,
    overrides.time   ?? '09:00',
    overrides.skills ?? [ROAD_TEST],
    'Test',
    'Booker',
    overrides.email ?? 'test@example.com',
    '555-0000',
    overrides.now   ?? '2026-05-12 06:00',
  ];
}

async function clearOfficeDay(client: typeof db.client, office = 1) {
  await client.query(
    `DELETE FROM appointments
      WHERE county_id='stlucie' AND office_id=$1 AND appointment_date=$2`,
    [office, DATE],
  );
}

function baseInput(overrides: Partial<FindApptInput> = {}): FindApptInput {
  return {
    countyId: 'stlucie',
    targetSkills: [ROAD_TEST],
    asap: true,
    preferredOffice: null,
    preferredDow: null,
    preferredTime: null,
    startDate: new Date('2026-05-12'),
    days: 1,
    nowTs: FROZEN_NOW,
    ...overrides,
  };
}

describe('findAppointment: basic capacity', () => {
  test('returns a slot when capacity is available', async () => {
    await clearOfficeDay(db.client);

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    expect(result!.officeId).toBeTypeOf('number');
    expect(result!.available).toBeGreaterThan(0);
  });

  test('returns null when all road_test capacity is exhausted', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Road test supply = 2 per office, available 09:00-15:00, duration 30 min.
    // During lunch windows supply drops to 1 for some slots, so we can only
    // book 1 at those times. Fill to actual capacity per slot.
    for (const office of [1, 2]) {
      for (let i = 0; i < 12; i++) {
        const hour = 9 + Math.floor(i / 2);
        const min = (i % 2) * 30;
        const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        const slotMin = hour * 60 + min;
        // Office 1: shift 1 lunch 11:30-12:15, shift 2 lunch 12:15-13:00.
        // At a given slot, a clerk is on lunch if slot_time falls in their lunch window.
        // Maria (shift 1): lunch 11:30-12:15 → at 11:30 and 12:00 she's gone.
        // Angela (shift 2): lunch 12:15-13:00 → at 12:30 she's gone.
        // So supply=1 at: 11:30, 12:00, 12:30.
        const duringLunch = slotMin >= 11 * 60 + 30 && slotMin < 13 * 60;
        await db.client.query(BOOK_SQL, bookParams({ office, time, email: `o${office}a${i}@x.com` }));
        if (!duringLunch) {
          await db.client.query(BOOK_SQL, bookParams({ office, time, email: `o${office}b${i}@x.com` }));
        }
      }
    }

    const result = await findAppointment(db.client, baseInput());
    expect(result).toBeNull();
  });

  test('skips a full slot and finds the next available one', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill 09:00 at both offices (supply=2 each, book 2 each).
    await db.client.query(BOOK_SQL, bookParams({ office: 1, time: '09:00', email: 'a@x.com' }));
    await db.client.query(BOOK_SQL, bookParams({ office: 1, time: '09:00', email: 'b@x.com' }));
    await db.client.query(BOOK_SQL, bookParams({ office: 2, time: '09:00', email: 'c@x.com' }));
    await db.client.query(BOOK_SQL, bookParams({ office: 2, time: '09:00', email: 'd@x.com' }));

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    // The packing model should find 09:30 (end of the 09:00 appointments).
    expect(result!.slotTime).toBe('09:30:00');
  });
});

describe('findAppointment: packing model', () => {
  test('finds a tight-packed slot at an appointment end boundary', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill 09:00 and 09:30 at both offices.
    for (const office of [1, 2]) {
      await db.client.query(BOOK_SQL, bookParams({ office, time: '09:00', email: `${office}a@x.com` }));
      await db.client.query(BOOK_SQL, bookParams({ office, time: '09:00', email: `${office}b@x.com` }));
      await db.client.query(BOOK_SQL, bookParams({ office, time: '09:30', email: `${office}c@x.com` }));
      await db.client.query(BOOK_SQL, bookParams({ office, time: '09:30', email: `${office}d@x.com` }));
    }

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    expect(result!.slotTime).toBe('10:00:00');
  });

  test('finds a slot at lunch shift end', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Knock out Angela (id=3) and Nancy (id=6) so only Maria and Jennifer
    // have road_test at their respective offices (supply=1 each).
    await db.client.query(`UPDATE clerks SET status='inactive' WHERE id IN (3, 6)`);

    // Maria is on lunch shift 1 (11:30-12:15). Jennifer on shift 1 (11:30-12:15).
    // Fill all slots before lunch for both offices.
    // road_test available 09:00-15:00, 30 min each. With supply=1:
    // 09:00, 09:30, 10:00, 10:30, 11:00 = 5 slots before 11:30. Fill them.
    for (const office of [1, 2]) {
      for (let i = 0; i < 5; i++) {
        const hour = 9 + Math.floor(i / 2);
        const min = (i % 2) * 30;
        const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        await db.client.query(BOOK_SQL, bookParams({ office, time, email: `lunch${office}-${i}@x.com` }));
      }
    }

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    // Should find 12:15 (lunch shift end) as earliest available.
    expect(result!.slotTime).toBe('12:15:00');
  });

  test('available_from is used as a candidate start time', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // road_test has available_from=09:00. The packing model should include
    // 09:00 as a candidate even though office opens at 08:00.
    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    expect(result!.slotTime).toBe('09:00:00');
  });
});

describe('findAppointment: skill filtering', () => {
  test('id_card appointments do not block road_test slots (Case 1)', async () => {
    await clearOfficeDay(db.client);

    // Book 3 id_card appointments at 09:00 (supply for id_card = 3, all clerks).
    // These should NOT compete with road_test supply.
    await db.client.query(BOOK_SQL, bookParams({ time: '09:00', skills: [ID_CARD], email: 'id1@x.com' }));
    await db.client.query(BOOK_SQL, bookParams({ time: '09:00', skills: [ID_CARD], email: 'id2@x.com' }));
    await db.client.query(BOOK_SQL, bookParams({ time: '09:00', skills: [ID_CARD], email: 'id3@x.com' }));

    const result = await findAppointment(db.client, baseInput({
      preferredOffice: 1,
      asap: false,
    }));
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
    expect(result!.slotTime).toBe('09:00:00');
    expect(result!.available).toBe(2);
  });

  test('same-skill appointments DO count as demand (Case 2)', async () => {
    await clearOfficeDay(db.client);

    // Book 1 road_test — supply is 2, so available should be 1.
    await db.client.query(BOOK_SQL, bookParams({ time: '09:00', email: 'rt1@x.com' }));

    const result = await findAppointment(db.client, baseInput({
      preferredOffice: 1,
      asap: false,
    }));
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
    expect(result!.slotTime).toBe('09:00:00');
    expect(result!.available).toBe(1);
  });
});

describe('findAppointment: absence handling', () => {
  test('absent clerk excluded from supply (Case 10)', async () => {
    await clearOfficeDay(db.client);

    // Put Maria on vacation. Road test supply drops 2 → 1 (Angela only).
    await db.client.query(
      `INSERT INTO clerk_absences (county_id, clerk_id, start_date, end_date, reason)
       VALUES ('stlucie', 1, $1, $1, 'vacation')`,
      [DATE],
    );

    const result = await findAppointment(db.client, baseInput({
      preferredOffice: 1,
      asap: false,
    }));
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
    expect(result!.available).toBe(1);
  });

  test('all specialists absent returns null (Case 11)', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // All road_test clerks absent: Maria(1), Angela(3), Jennifer(4), Nancy(6).
    await db.client.query(
      `INSERT INTO clerk_absences (county_id, clerk_id, start_date, end_date, reason)
       VALUES ('stlucie', 1, $1, $1, 'vacation'),
              ('stlucie', 3, $1, $1, 'vacation'),
              ('stlucie', 4, $1, $1, 'vacation'),
              ('stlucie', 6, $1, $1, 'vacation')`,
      [DATE],
    );

    const result = await findAppointment(db.client, baseInput());
    expect(result).toBeNull();
  });
});

describe('findAppointment: preferences', () => {
  test('preferred office is tried first', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    const result = await findAppointment(db.client, baseInput({
      asap: false,
      preferredOffice: 2,
      days: 1,
    }));
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(2);
  });

  test('falls back to non-preferred office when preferred is full', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill all road_test capacity at office 2 for the full day.
    // During lunch supply drops to 1, so book accordingly.
    for (let i = 0; i < 12; i++) {
      const hour = 9 + Math.floor(i / 2);
      const min = (i % 2) * 30;
      const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      const slotMin = hour * 60 + min;
      const duringLunch = slotMin >= 11 * 60 + 30 && slotMin < 13 * 60;
      await db.client.query(BOOK_SQL, bookParams({ office: 2, time, email: `o2a${i}@x.com` }));
      if (!duringLunch) {
        await db.client.query(BOOK_SQL, bookParams({ office: 2, time, email: `o2b${i}@x.com` }));
      }
    }

    const result = await findAppointment(db.client, baseInput({
      asap: false,
      preferredOffice: 2,
      days: 1,
    }));
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
  });

  test('preferred morning returns a morning slot', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    const result = await findAppointment(db.client, baseInput({
      asap: false,
      preferredTime: 'morning',
    }));
    expect(result).not.toBeNull();
    expect(toMinutes(result!.slotTime)).toBeLessThan(12 * 60);
  });

  test('preferred afternoon returns an afternoon slot', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    const result = await findAppointment(db.client, baseInput({
      asap: false,
      preferredTime: 'afternoon',
    }));
    expect(result).not.toBeNull();
    expect(toMinutes(result!.slotTime)).toBeGreaterThanOrEqual(12 * 60);
  });
});

describe('findAppointment: multi-day search', () => {
  test('searches into next day when first day is full', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill both offices on May 12 (account for lunch supply reduction).
    for (const office of [1, 2]) {
      for (let i = 0; i < 12; i++) {
        const hour = 9 + Math.floor(i / 2);
        const min = (i % 2) * 30;
        const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        const slotMin = hour * 60 + min;
        const duringLunch = slotMin >= 11 * 60 + 30 && slotMin < 13 * 60;
        await db.client.query(BOOK_SQL, bookParams({ office, time, email: `day1-${office}-a${i}@x.com` }));
        if (!duringLunch) {
          await db.client.query(BOOK_SQL, bookParams({ office, time, email: `day1-${office}-b${i}@x.com` }));
        }
      }
    }

    // Clear May 13.
    await db.client.query(
      `DELETE FROM appointments
        WHERE county_id='stlucie' AND appointment_date='2026-05-13'`,
    );

    const result = await findAppointment(db.client, baseInput({ days: 2 }));
    expect(result).not.toBeNull();
    expect(result!.slotDate).toBe('2026-05-13');
  });
});

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
