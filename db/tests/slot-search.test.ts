import { describe, expect, test } from 'vitest';
import { useDb } from './helpers/fixture.ts';
import { findAppointment, type FindApptInput } from '../../src/find-appt.ts';
import { BOOK_SQL, bookParams, clearOfficeDay, DATE, FROZEN_NOW, ROAD_TEST, ID_CARD } from './helpers/booking.ts';

const db = useDb();

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

  test('returns null when all capacity is exhausted', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Desk cap = 3 per office. Road test: 09:00-15:00, 30 min.
    // Fill all 3 desks at every slot across both offices.
    // road_test supply is 2, but desk cap is 3 — so we need to fill
    // 2 road_tests + 1 id_card per slot to hit desk cap.
    // Slots: 09:00-14:30 = 12 slots per office.
    // During lunch (11:30-13:00) clerks_on_floor drops, reducing cap.
    for (const office of [1, 2]) {
      // Fill with 3 per slot pre-lunch, fewer during lunch
      for (let i = 0; i < 12; i++) {
        const hour = 9 + Math.floor(i / 2);
        const min = (i % 2) * 30;
        const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        const slotMin = hour * 60 + min;

        // During lunch shifts, fewer clerks on floor.
        // Shift 1 (11:30-12:15): 1 clerk out at office 1, 2 out at office 2
        // Shift 2 (12:15-13:00): 2 clerks out at office 1, 1 out at office 2
        const inShift1 = slotMin >= 690 && slotMin < 735;
        const inShift2 = slotMin >= 735 && slotMin < 780;
        let cap: number;
        if (office === 1) {
          cap = inShift1 ? 2 : inShift2 ? 1 : 3;
        } else {
          cap = inShift1 ? 1 : inShift2 ? 2 : 3;
        }

        for (let j = 0; j < cap; j++) {
          const skills = j < 2 ? [ROAD_TEST] : [ID_CARD];
          await db.client.query('SAVEPOINT fill_slot');
          try {
            await db.client.query(BOOK_SQL, bookParams({
              office, time, skills,
              email: `fill-${office}-${i}-${j}@x.com`,
            }));
            await db.client.query('RELEASE SAVEPOINT fill_slot');
          } catch {
            await db.client.query('ROLLBACK TO SAVEPOINT fill_slot');
          }
        }
      }
    }

    const result = await findAppointment(db.client, baseInput());
    expect(result).toBeNull();
  });

  test('skips a full slot and finds the next available one', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill 09:00 at both offices to desk cap (3 each).
    for (const office of [1, 2]) {
      await db.client.query(BOOK_SQL, bookParams({ office, time: '09:00', skills: [ROAD_TEST], email: `a${office}@x.com` }));
      await db.client.query(BOOK_SQL, bookParams({ office, time: '09:00', skills: [ROAD_TEST], email: `b${office}@x.com` }));
      await db.client.query(BOOK_SQL, bookParams({ office, time: '09:00', skills: [ID_CARD], email: `c${office}@x.com` }));
    }

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    // Packing model finds 09:15 (end of the 15-min id_card at 09:00) or 09:30 (end of road_test)
    expect(toMinutes(result!.slotTime)).toBeGreaterThan(9 * 60);
  });
});

describe('findAppointment: packing model', () => {
  test('finds a tight-packed slot at an appointment end boundary', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Fill 09:00 and 09:30 at both offices to desk cap.
    for (const office of [1, 2]) {
      for (const time of ['09:00', '09:30']) {
        await db.client.query(BOOK_SQL, bookParams({ office, time, skills: [ROAD_TEST], email: `${office}-${time}-a@x.com` }));
        await db.client.query(BOOK_SQL, bookParams({ office, time, skills: [ROAD_TEST], email: `${office}-${time}-b@x.com` }));
        await db.client.query(BOOK_SQL, bookParams({ office, time, skills: [ID_CARD], email: `${office}-${time}-c@x.com` }));
      }
    }

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    // Earliest opening is 09:15 (id_card from 09:00 ends) or 10:00 (road_tests from 09:30 end)
    // Since road_test needs supply, and at 09:15 the two road_tests from 09:00 are still running,
    // road_test supply=2, demand=2 at 09:15 → full. Next: 09:30 is also full.
    // At 10:00: road_tests from 09:30 end → supply=2, demand=0 → available.
    expect(result!.slotTime).toBe('10:00:00');
  });

  test('finds a slot at lunch shift end', async () => {
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
        const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        await db.client.query(BOOK_SQL, bookParams({ office, time, email: `lunch${office}-${i}@x.com` }));
      }
    }

    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    // Maria (office 1) is on lunch 11:30-12:15. Jennifer (office 2) on lunch 11:30-12:15.
    // After last pre-lunch appt ends at 11:30, both clerks go to lunch.
    // First available: 12:15 (lunch ends).
    expect(result!.slotTime).toBe('12:15:00');
  });

  test('available_from is used as a candidate start time', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // road_test has available_from=09:00. Even though office opens at 08:00,
    // the packing model should include 09:00 as a candidate.
    const result = await findAppointment(db.client, baseInput());
    expect(result).not.toBeNull();
    expect(result!.slotTime).toBe('09:00:00');
  });
});

describe('findAppointment: skill filtering', () => {
  test('id_card appointments do not block road_test skill supply (Case 1)', async () => {
    await clearOfficeDay(db.client);

    // Book 2 id_card appointments at 09:00. Desk cap=3, so 1 desk remains.
    // road_test supply at 09:00 = 2 (Maria + Angela), demand for road_test = 0.
    // Desk avail = 3-2 = 1. Skill avail = 2-0 = 2. min(1, 2) = 1.
    await db.client.query(BOOK_SQL, bookParams({ time: '09:00', skills: [ID_CARD], email: 'id1@x.com' }));
    await db.client.query(BOOK_SQL, bookParams({ time: '09:00', skills: [ID_CARD], email: 'id2@x.com' }));

    const result = await findAppointment(db.client, baseInput({
      preferredOffice: 1,
      asap: false,
    }));
    expect(result).not.toBeNull();
    expect(result!.officeId).toBe(1);
    expect(result!.slotTime).toBe('09:00:00');
    expect(result!.available).toBe(1);
  });

  test('same-skill appointments DO count as demand (Case 2)', async () => {
    await clearOfficeDay(db.client);

    // Book 1 road_test — skill supply=2, demand=1. Desk: 3-1=2. min(1, 2)=1.
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
    // Skill supply=1 (Angela). Desk cap=3, concurrent=0, deskAvail=3. min(1,3)=1.
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

    // Fill all road_test capacity at office 2 to desk cap.
    // road_test 09:00-15:00, 30 min. Desk cap=3 per slot. Supply=2 road_test.
    // Fill 2 road_test + 1 id_card per slot to hit desk cap.
    for (let i = 0; i < 12; i++) {
      const hour = 9 + Math.floor(i / 2);
      const min = (i % 2) * 30;
      const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      const slotMin = hour * 60 + min;
      // During lunch at office 2: shift 1 (11:30-12:15) has 2 clerks out, shift 2 (12:15-13:00) has 1 out
      const inShift1 = slotMin >= 690 && slotMin < 735;
      const inShift2 = slotMin >= 735 && slotMin < 780;
      const cap = inShift1 ? 1 : inShift2 ? 2 : 3;
      for (let j = 0; j < cap; j++) {
        const skills = j < 2 ? [ROAD_TEST] : [ID_CARD];
        await db.client.query('SAVEPOINT fill_slot');
        try {
          await db.client.query(BOOK_SQL, bookParams({
            office: 2, time, skills,
            email: `o2-${i}-${j}@x.com`,
          }));
          await db.client.query('RELEASE SAVEPOINT fill_slot');
        } catch {
          await db.client.query('ROLLBACK TO SAVEPOINT fill_slot');
        }
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

    // Fill both offices on May 12 to desk cap at every slot.
    for (const office of [1, 2]) {
      for (let i = 0; i < 12; i++) {
        const hour = 9 + Math.floor(i / 2);
        const min = (i % 2) * 30;
        const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        const slotMin = hour * 60 + min;
        const inShift1 = slotMin >= 690 && slotMin < 735;
        const inShift2 = slotMin >= 735 && slotMin < 780;
        let cap: number;
        if (office === 1) {
          cap = inShift1 ? 2 : inShift2 ? 1 : 3;
        } else {
          cap = inShift1 ? 1 : inShift2 ? 2 : 3;
        }
        for (let j = 0; j < cap; j++) {
          const skills = j < 2 ? [ROAD_TEST] : [ID_CARD];
          await db.client.query('SAVEPOINT fill_slot');
          try {
            await db.client.query(BOOK_SQL, bookParams({
              office, time, skills,
              email: `day1-${office}-${i}-${j}@x.com`,
            }));
            await db.client.query('RELEASE SAVEPOINT fill_slot');
          } catch {
            await db.client.query('ROLLBACK TO SAVEPOINT fill_slot');
          }
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

describe('findAppointment: CELL_QUERY correctness (Cases 25-26)', () => {
  test('Case 25: checkCell rejects slot with available=0 during lunch', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Book at 12:15 (skill 1). During shift 2 (12:15-13:00), clerks 2+3 on lunch.
    // Only clerk 1 on floor. After booking: concurrent=1, cap=min(3,1)=1, avail=0.
    await db.client.query(BOOK_SQL, bookParams({ time: '12:15', skills: [ID_CARD], email: 'c25pre@x.com' }));

    // findAppointment for skill 2 at preferred office 1 should NOT return 12:15
    // (it has available=0 there). It should find a different time.
    const result = await findAppointment(db.client, baseInput({
      targetSkills: [ID_CARD],
      preferredOffice: 1,
      asap: false,
    }));
    expect(result).not.toBeNull();
    // Should find a slot that's NOT 12:15 at office 1 (since that's full)
    if (result!.officeId === 1) {
      expect(result!.slotTime).not.toBe('12:15:00');
    }
    expect(result!.available).toBeGreaterThan(0);
  });

  test('Case 26: afternoon slots reachable after morning packs up', async () => {
    await clearOfficeDay(db.client);
    await clearOfficeDay(db.client, 2);

    // Sequentially book id_card (15 min) appointments using the engine itself.
    // With 3 desks × 2 offices, the engine should pack morning → lunch → afternoon.
    let booked = 0;
    let lastTime = '';
    for (let i = 0; i < 80; i++) {
      const result = await findAppointment(db.client, baseInput({
        targetSkills: [ID_CARD],
        asap: true,
      }));
      if (!result) break;

      await db.client.query('SAVEPOINT book_slot');
      try {
        await db.client.query(BOOK_SQL, bookParams({
          office: result.officeId,
          time: result.slotTime,
          skills: [ID_CARD],
          email: `c26-${i}@x.com`,
        }));
        await db.client.query('RELEASE SAVEPOINT book_slot');
        booked++;
        lastTime = result.slotTime;
      } catch {
        await db.client.query('ROLLBACK TO SAVEPOINT book_slot');
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

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
