import { describe, expect, test } from "vitest";
import { useDb } from "./helpers/fixture.js";
import { CONFIRMATION_CODE_FORMAT, PG_ERROR } from "./helpers/booking.js";
import { TEST_DATE as DATE } from "../../tests/config.js";
import { ID_CARD } from "./helpers/seed-ids.js";

const db = useDb();

const WALK_IN_SQL = `
  SELECT register_walk_in(
    p_office_id    := $1,
    p_txn_type_ids := $2,
    p_first_name   := $3,
    p_last_name    := $4,
    p_contact_email := $5,
    p_contact_phone := $6,
    p_is_priority  := $7,
    p_now_ts       := $8::timestamp
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
    overrides.office ?? 1,
    overrides.skills ?? [ID_CARD],
    overrides.first ?? "Walk",
    overrides.last ?? "In",
    overrides.email ?? "walkin@example.com",
    overrides.phone ?? "555-1111",
    overrides.priority ?? false,
    overrides.now ?? `${DATE} 10:00`,
  ];
}

describe("register_walk_in", () => {
  test("creates walk-in with scheduled status, today's date, and no time slot", async () => {
    const { rows } = await db.client.query(WALK_IN_SQL, walkInParams());
    expect(rows[0].id).toBeTypeOf("number");

    const check = await db.client.query(
      `SELECT first_name, last_name, status, is_walk_in, is_priority,
              appointment_date::text AS appointment_date, appointment_time,
              prescreen_completed, confirmation_code
         FROM appointments WHERE id = $1`,
      [rows[0].id],
    );
    expect(check.rows[0]).toMatchObject({
      first_name: "Walk",
      last_name: "In",
      status: "scheduled",
      is_walk_in: true,
      is_priority: false,
      appointment_time: null,
      prescreen_completed: false,
      appointment_date: DATE,
    });
    expect(check.rows[0].confirmation_code).toMatch(CONFIRMATION_CODE_FORMAT);
  });

  test("office_closed when office is not open on that day", async () => {
    // DATE is 2026-05-12 (Monday). Office 1 has hours Mon-Fri.
    // Use a Sunday timestamp.
    await expect(
      db.client.query(WALK_IN_SQL, walkInParams({ now: "2026-05-10 10:00" })),
    ).rejects.toMatchObject({ code: PG_ERROR.OFFICE_CLOSED });
  });

  test("office_closed when current time is before open", async () => {
    await expect(
      db.client.query(WALK_IN_SQL, walkInParams({ now: `${DATE} 07:00` })),
    ).rejects.toMatchObject({ code: PG_ERROR.OFFICE_CLOSED });
  });

  test("office_closed when current time is at or after close", async () => {
    await expect(
      db.client.query(WALK_IN_SQL, walkInParams({ now: `${DATE} 17:00` })),
    ).rejects.toMatchObject({ code: PG_ERROR.OFFICE_CLOSED });
  });

  test("txn_unavailable when transaction type is hidden at office", async () => {
    await db.client.query(
      `INSERT INTO transaction_types
         (txn_type_id, office_id, name, avg_duration_min, status)
       VALUES ('id-card', 1, 'ID Card', 15, 'hidden')`,
    );

    await expect(db.client.query(WALK_IN_SQL, walkInParams())).rejects.toMatchObject({
      code: PG_ERROR.TXN_UNAVAILABLE,
    });
  });

  test("does not auto-enqueue no queue entry created until prescreen", async () => {
    const { rows } = await db.client.query(WALK_IN_SQL, walkInParams({ email: "noqueue@x.com" }));

    const queueCheck = await db.client.query(`SELECT id FROM queue WHERE appointment_id = $1`, [
      rows[0].id,
    ]);
    expect(queueCheck.rows).toHaveLength(0);
  });

  test("rejects nonexistent transaction type id", async () => {
    await expect(
      db.client.query(WALK_IN_SQL, walkInParams({ skills: [999] })),
    ).rejects.toMatchObject({ code: PG_ERROR.TXN_UNAVAILABLE });
  });

  test("rejects empty transaction type array", async () => {
    await expect(db.client.query(WALK_IN_SQL, walkInParams({ skills: [] }))).rejects.toThrow();
  });
});
