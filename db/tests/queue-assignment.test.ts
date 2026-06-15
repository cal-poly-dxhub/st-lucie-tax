import { describe, expect, test, beforeEach } from "vitest";
import { useDb } from "./helpers/fixture.ts";

const db = useDb();

const COUNTY = "stlucie";
const OFFICE = 1;
const DATE = "2026-05-12";

// Clerk IDs from seed: Maria(1)={1,2,3}, James(2)={2,3}, Angela(3)={1,2}
const MARIA = 1; // 3 skills (generalist)
const JAMES = 2; // 2 skills: id_card, license_original
const ANGELA = 3; // 2 skills: road_test, id_card

// Transaction type IDs from seed
const ROAD_TEST = 1;
const ID_CARD = 2;
const LICENSE_ORIGINAL = 3;

async function createAppointment(
  client: typeof db.client,
  opts: { txnTypes: number[]; priority?: boolean },
) {
  const { rows } = await client.query(
    `INSERT INTO appointments (
      county_id, office_id, first_name, last_name,
      contact_email, contact_phone, txn_type_ids,
      appointment_date, appointment_time, status, is_walk_in, is_priority
    ) VALUES ($1, $2, 'Test', 'User', 'test@test.com', '555-0000', $3,
              $4, '09:00', 'scheduled', FALSE, $5)
    RETURNING id`,
    [COUNTY, OFFICE, opts.txnTypes, DATE, opts.priority ?? false],
  );
  return rows[0].id as number;
}

async function checkIn(client: typeof db.client, appointmentId: number) {
  const { rows } = await client.query(
    `SELECT check_in_to_queue($1, $2, $3) AS id`,
    [COUNTY, OFFICE, appointmentId],
  );
  return rows[0].id as number;
}

async function loginClerk(
  client: typeof db.client,
  clerkId: number,
  desk: number,
) {
  await client.query(
    `INSERT INTO clerk_sessions (county_id, clerk_id, office_id, desk_number, is_available)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [COUNTY, clerkId, OFFICE, desk],
  );
}

async function summonNext(client: typeof db.client, clerkId: number) {
  const { rows } = await client.query(
    `SELECT assign_next_customer($1, $2, $3) AS queue_id`,
    [COUNTY, OFFICE, clerkId],
  );
  return rows[0].queue_id as number | null;
}

describe("check_in_to_queue", () => {
  test("assigns sequential queue numbers per office per day", async () => {
    const appt1 = await createAppointment(db.client, { txnTypes: [ID_CARD] });
    const appt2 = await createAppointment(db.client, { txnTypes: [ID_CARD] });

    const q1 = await checkIn(db.client, appt1);
    const q2 = await checkIn(db.client, appt2);

    const { rows } = await db.client.query(
      `SELECT id, queue_number FROM queue WHERE id IN ($1, $2) ORDER BY id`,
      [q1, q2],
    );
    expect(rows[0].queue_number).toBe(1);
    expect(rows[1].queue_number).toBe(2);
  });
});

describe("assign_next_customer — skill-matched FIFO", () => {
  beforeEach(async () => {
    await db.client.query(
      `DELETE FROM queue WHERE county_id = $1 AND office_id = $2`,
      [COUNTY, OFFICE],
    );
    await db.client.query(
      `DELETE FROM clerk_sessions WHERE county_id = $1 AND office_id = $2`,
      [COUNTY, OFFICE],
    );
  });

  test("any qualified clerk can pull — first come first served", async () => {
    await loginClerk(db.client, MARIA, 1);
    await loginClerk(db.client, JAMES, 2);

    const appt = await createAppointment(db.client, { txnTypes: [ID_CARD] });
    await checkIn(db.client, appt);

    // Maria pulls first — she's qualified, she gets it
    const mariaResult = await summonNext(db.client, MARIA);
    expect(mariaResult).not.toBeNull();

    const { rows } = await db.client.query(
      `SELECT assigned_clerk_id, assigned_desk, status FROM queue WHERE id = $1`,
      [mariaResult],
    );
    expect(rows[0]).toEqual({
      assigned_clerk_id: MARIA,
      assigned_desk: 1,
      status: "serving",
    });
  });

  test("clerk pulls from queue when they have matching skills", async () => {
    await loginClerk(db.client, MARIA, 1);

    const appt = await createAppointment(db.client, {
      txnTypes: [LICENSE_ORIGINAL],
    });
    await checkIn(db.client, appt);

    const result = await summonNext(db.client, MARIA);
    expect(result).not.toBeNull();
  });

  test("clerk cannot pull txn they lack skills for", async () => {
    await loginClerk(db.client, ANGELA, 3); // Angela: road_test + id_card only

    const appt = await createAppointment(db.client, {
      txnTypes: [LICENSE_ORIGINAL],
    });
    await checkIn(db.client, appt);

    const result = await summonNext(db.client, ANGELA);
    expect(result).toBeNull();
  });

  test("priority customers are served before regular FIFO", async () => {
    await loginClerk(db.client, JAMES, 2);

    const regular = await createAppointment(db.client, {
      txnTypes: [ID_CARD],
      priority: false,
    });
    const priority = await createAppointment(db.client, {
      txnTypes: [ID_CARD],
      priority: true,
    });

    await checkIn(db.client, regular);
    await checkIn(db.client, priority);

    const result = await summonNext(db.client, JAMES);
    // Should get the priority customer's queue entry
    const { rows } = await db.client.query(
      `SELECT appointment_id FROM queue WHERE id = $1`,
      [result],
    );
    expect(rows[0].appointment_id).toBe(priority);
  });

  test("clerk marked unavailable after assignment", async () => {
    await loginClerk(db.client, JAMES, 2);

    const appt = await createAppointment(db.client, { txnTypes: [ID_CARD] });
    await checkIn(db.client, appt);

    await summonNext(db.client, JAMES);

    const { rows } = await db.client.query(
      `SELECT is_available FROM clerk_sessions
       WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
      [JAMES, OFFICE],
    );
    expect(rows[0].is_available).toBe(false);
  });

  test("returns null when queue is empty", async () => {
    await loginClerk(db.client, MARIA, 1);
    const result = await summonNext(db.client, MARIA);
    expect(result).toBeNull();
  });

  test("multi-txn appointment routes to clerk with all required skills", async () => {
    await loginClerk(db.client, JAMES, 2); // skills: id_card + license_original
    await loginClerk(db.client, ANGELA, 3); // skills: road_test + id_card

    // Needs both id_card AND license_original — only James qualifies
    const appt = await createAppointment(db.client, {
      txnTypes: [ID_CARD, LICENSE_ORIGINAL],
    });
    await checkIn(db.client, appt);

    const angelaResult = await summonNext(db.client, ANGELA);
    expect(angelaResult).toBeNull();

    const jamesResult = await summonNext(db.client, JAMES);
    expect(jamesResult).not.toBeNull();
  });
});
