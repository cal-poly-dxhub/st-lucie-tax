import { describe, expect, test } from "vitest";
import { useDb } from "./helpers/fixture.ts";
import { BOOK_SQL, bookParams, clearOfficeDay, DATE, FROZEN_NOW } from "./helpers/booking.ts";

const db = useDb();

const WALK_IN_SQL = `
  SELECT register_walk_in(
    p_county_id    := $1,
    p_office_id    := $2,
    p_txn_type_ids := $3,
    p_first_name   := $4,
    p_last_name    := $5,
    p_contact_email := $6,
    p_contact_phone := $7,
    p_is_priority  := $8,
    p_now_ts       := $9::timestamp
  ) AS id
`;

function walkInParams(
  overrides: Partial<{
    office: number;
    skills: number[];
    first: string;
    last: string;
    email: string;
    phone: string;
    priority: boolean;
    now: string;
  }> = {},
) {
  return [
    "stlucie",
    overrides.office ?? 1,
    overrides.skills ?? [2], // id_card
    overrides.first ?? "Walk",
    overrides.last ?? "In",
    overrides.email ?? "walkin@example.com",
    overrides.phone ?? "555-1111",
    overrides.priority ?? false,
    overrides.now ?? `${DATE} 10:00`,
  ];
}

describe("register_walk_in", () => {
  test("happy path: creates appointment with is_walk_in=true", async () => {
    const { rows } = await db.client.query(WALK_IN_SQL, walkInParams());
    expect(rows[0].id).toBeTypeOf("number");

    const check = await db.client.query(
      `SELECT first_name, last_name, status, is_walk_in, is_priority, appointment_date, prescreen_completed
         FROM appointments WHERE id = $1`,
      [rows[0].id],
    );
    expect(check.rows[0]).toMatchObject({
      first_name: "Walk",
      last_name: "In",
      status: "scheduled",
      is_walk_in: true,
      is_priority: false,
      prescreen_completed: false,
    });
  });

  test("priority walk-in sets is_priority=true", async () => {
    const { rows } = await db.client.query(
      WALK_IN_SQL,
      walkInParams({ priority: true, email: "vip@x.com" }),
    );

    const check = await db.client.query(
      `SELECT is_priority FROM appointments WHERE id = $1`,
      [rows[0].id],
    );
    expect(check.rows[0].is_priority).toBe(true);
  });

  test("office_closed when office is not open on that day", async () => {
    // DATE is 2026-05-12 (Monday). Office 1 has hours Mon-Fri.
    // Use a Sunday timestamp.
    await expect(
      db.client.query(WALK_IN_SQL, walkInParams({ now: "2026-05-10 10:00" })),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  test("office_closed when current time is before open", async () => {
    await expect(
      db.client.query(WALK_IN_SQL, walkInParams({ now: `${DATE} 07:00` })),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  test("office_closed when current time is at or after close", async () => {
    await expect(
      db.client.query(WALK_IN_SQL, walkInParams({ now: `${DATE} 17:00` })),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  test("txn_unavailable when transaction type is hidden at office", async () => {
    await db.client.query(
      `INSERT INTO transaction_types
         (county_id, txn_type_id, office_id, name, avg_duration_min, status)
       VALUES ('stlucie', 'id_card', 1, 'ID Card', 15, 'hidden')`,
    );

    await expect(
      db.client.query(WALK_IN_SQL, walkInParams()),
    ).rejects.toMatchObject({ code: "P0003" });
  });

  test("bypasses capacity validation — succeeds even when slot is full", async () => {
    await clearOfficeDay(db.client);

    // Fill all capacity for road_test at 09:00 via scheduled bookings (supply=2).
    await db.client.query(BOOK_SQL, bookParams({ email: "a@x.com" }));
    await db.client.query(BOOK_SQL, bookParams({ email: "b@x.com" }));

    // A third scheduled booking would fail with P0001.
    // But a walk-in at the same time should succeed.
    const { rows } = await db.client.query(
      WALK_IN_SQL,
      walkInParams({ skills: [1], now: `${DATE} 09:00` }),
    );
    expect(rows[0].id).toBeTypeOf("number");
  });

  test("does not auto-enqueue — no queue entry created", async () => {
    const { rows } = await db.client.query(
      WALK_IN_SQL,
      walkInParams({ email: "noqueue@x.com" }),
    );

    const queueCheck = await db.client.query(
      `SELECT id FROM queue WHERE appointment_id = $1`,
      [rows[0].id],
    );
    expect(queueCheck.rows).toHaveLength(0);
  });
});
