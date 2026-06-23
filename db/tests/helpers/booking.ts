import type { Client } from "pg";
import { connect } from "./client.js";
import { TEST_DATE, TEST_FROZEN_NOW } from "../../../tests/config.js";
import { ROAD_TEST, ID_CARD } from "./seed-ids.js";

export const CONFIRMATION_CODE_FORMAT = /^[0-9A-Z]{8}$/;

export const PG_ERROR = {
  UNIQUE_VIOLATION: "23505",
  CAPACITY_EXCEEDED: "P0001",
  OFFICE_CLOSED: "P0002",
  TXN_UNAVAILABLE: "P0003",
  SLOT_IN_PAST: "P0004",
} as const;

export const BOOK_SQL = `
  SELECT id FROM book_appointment(
    p_office_id        := $1,
    p_date             := $2,
    p_time             := $3,
    p_txn_type_ids     := $4,
    p_required_doc_ids := $5,
    p_first_name       := $6,
    p_last_name        := $7,
    p_contact_email    := $8,
    p_contact_phone    := $9,
    p_now_ts           := $10::timestamp
  )
`;

// Returns booking param object with default values if none specified
export function bookParams(
  overrides: Partial<{
    office: number;
    date: string;
    time: string;
    skills: number[];
    requiredDocIds: string[];
    first: string;
    last: string;
    email: string;
    phone: string;
    now: string;
  }> = {},
) {
  return [
    overrides.office ?? 1,
    overrides.date ?? TEST_DATE,
    overrides.time ?? "09:00",
    overrides.skills ?? [ROAD_TEST],
    overrides.requiredDocIds ?? [],
    overrides.first ?? "Test",
    overrides.last ?? "Booker",
    overrides.email ?? "test@example.com",
    overrides.phone ?? "555-0000",
    overrides.now ?? TEST_FROZEN_NOW,
  ];
}

// Deletes all appointments from an office on a given date
export async function clearOfficeDay(client: Client, office = 1) {
  await client.query(
    `DELETE FROM documents
      WHERE appointment_id IN (
        SELECT id FROM appointments
        WHERE office_id=$1 AND appointment_date=$2
      )`,
    [office, TEST_DATE],
  );
  await client.query(
    `DELETE FROM appointments
      WHERE office_id=$1 AND appointment_date=$2`,
    [office, TEST_DATE],
  );
}

// Attempt to book a given appointment and rollback if fails so that test can continue
export async function tryBook(
  client: Client,
  params: unknown[],
): Promise<
  | {
      ok: true;
      id: number;
    }
  | {
      ok: false;
      code: string;
    }
> {
  await client.query("SAVEPOINT s");
  try {
    const { rows } = await client.query(BOOK_SQL, params);
    await client.query("RELEASE SAVEPOINT s");
    return { ok: true, id: rows[0].id };
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT s");
    return { ok: false, code: (err as { code: string }).code };
  }
}

// Tries to book the same appt from two clients to ensure locks work
export async function raceTest(opts: {
  preBookParams: unknown[];
  racerAParams: unknown[];
  racerBParams: unknown[];
}) {
  const setup = await connect();
  const a = await connect();
  const b = await connect();
  try {
    await clearOfficeDay(setup);
    await setup.query(BOOK_SQL, opts.preBookParams);

    await a.query("BEGIN");
    await b.query("BEGIN");

    // Fire both concurrently — each commits/rolls back immediately on
    // completion so the lock is released for the other.
    const racerA = a.query(BOOK_SQL, opts.racerAParams).then(
      async (res) => {
        await a.query("COMMIT");
        return { ok: true as const, id: res.rows[0].id };
      },
      async (err) => {
        await a.query("ROLLBACK");
        return { ok: false as const, code: (err as { code: string }).code };
      },
    );
    const racerB = b.query(BOOK_SQL, opts.racerBParams).then(
      async (res) => {
        await b.query("COMMIT");
        return { ok: true as const, id: res.rows[0].id };
      },
      async (err) => {
        await b.query("ROLLBACK");
        return { ok: false as const, code: (err as { code: string }).code };
      },
    );

    const [resultA, resultB] = await Promise.all([racerA, racerB]);

    await clearOfficeDay(setup);

    const winner = resultA.ok ? resultA : resultB.ok ? resultB : null;
    const loser = !resultA.ok ? resultA : !resultB.ok ? resultB : null;

    return { winnerId: winner?.id ?? null, loserCode: loser?.code ?? null };
  } finally {
    await setup.end();
    await a.end();
    await b.end();
  }
}

// Fills a slot to desk capacity at the given offices
export async function fillSlotToCapacity(
  client: Client,
  opts: {
    offices?: number[];
    time: string;
    date?: string;
    deskCap?: (office: number, slotMin: number) => number;
  },
) {
  const offices = opts.offices ?? [1, 2];
  const [h, m] = opts.time.split(":").map(Number);
  const slotMin = h * 60 + m;

  for (const office of offices) {
    const cap = opts.deskCap ? opts.deskCap(office, slotMin) : 3;
    for (let j = 0; j < cap; j++) {
      const skills = j < 2 ? [ROAD_TEST] : [ID_CARD];
      await client.query("SAVEPOINT fill_slot");
      try {
        await client.query(
          BOOK_SQL,
          bookParams({
            office,
            date: opts.date,
            time: opts.time,
            skills,
            email: `fill-${office}-${opts.time}-${j}@x.com`,
          }),
        );
        await client.query("RELEASE SAVEPOINT fill_slot");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT fill_slot");
      }
    }
  }
}

// Default desk cap accounting for lunch shifts
export function lunchAwareCap(office: number, slotMin: number): number {
  const inShift1 = slotMin >= 690 && slotMin < 735;
  const inShift2 = slotMin >= 735 && slotMin < 780;
  if (office === 1) return inShift1 ? 2 : inShift2 ? 1 : 3;
  return inShift1 ? 1 : inShift2 ? 2 : 3;
}

// Fills all road_test slots (09:00-14:30) at the given offices to desk cap
export async function fillAllSlots(
  client: Client,
  opts: {
    offices?: number[];
    date?: string;
    deskCap?: (office: number, slotMin: number) => number;
  },
) {
  const offices = opts.offices ?? [1, 2];
  for (let i = 0; i < 12; i++) {
    const hour = 9 + Math.floor(i / 2);
    const min = (i % 2) * 30;
    const time = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    await fillSlotToCapacity(client, {
      offices,
      time,
      date: opts.date,
      deskCap: opts.deskCap ?? lunchAwareCap,
    });
  }
}
