import { describe, expect, test, beforeEach, afterAll, beforeAll } from "vitest";
import { useDb } from "./helpers/fixture.js";
import { connect } from "./helpers/client.js";
import { MARIA, JAMES, ANGELA, ID_CARD, LICENSE_ORIGINAL } from "./helpers/seed-ids.js";
import { Client } from "pg";

const db = useDb();

const OFFICE = 1;
const DATE = "2026-05-12";

async function createAppointment(
  client: typeof db.client,
  opts: { txnTypes: number[]; priority?: boolean },
) {
  const { rows } = await client.query(
    `INSERT INTO appointments (
      office_id, first_name, last_name,
      contact_email, contact_phone, txn_type_ids,
      appointment_date, appointment_time, status, is_walk_in, is_priority
    ) VALUES ($1, 'Test', 'User', 'test@test.com', '555-0000', $2,
              $3, '09:00', 'scheduled', FALSE, $4)
    RETURNING id`,
    [OFFICE, opts.txnTypes, DATE, opts.priority ?? false],
  );
  return rows[0].id as number;
}

async function checkIn(client: typeof db.client, appointmentId: number) {
  const { rows } = await client.query(`SELECT check_in_to_queue($1, $2) AS id`, [
    OFFICE,
    appointmentId,
  ]);
  return rows[0].id as number;
}

async function loginClerk(client: typeof db.client, clerkId: number, desk: number) {
  await client.query(
    `INSERT INTO clerk_sessions (clerk_id, office_id, desk_number, is_available)
     VALUES ($1, $2, $3, TRUE)`,
    [clerkId, OFFICE, desk],
  );
}

async function summonNext(client: typeof db.client, clerkId: number) {
  const { rows } = await client.query(`SELECT assign_next_customer($1, $2) AS queue_id`, [
    OFFICE,
    clerkId,
  ]);
  return rows[0].queue_id as number | null;
}

describe("check_in_to_queue", () => {
  test("assigns sequential queue numbers per office per day", async () => {
    const appt1 = await createAppointment(db.client, { txnTypes: [ID_CARD] });
    const appt2 = await createAppointment(db.client, { txnTypes: [ID_CARD] });
    const appt3 = await createAppointment(db.client, { txnTypes: [ID_CARD] });
    const appt4 = await createAppointment(db.client, { txnTypes: [ID_CARD] });

    const q1 = await checkIn(db.client, appt1);
    const q2 = await checkIn(db.client, appt2);
    const q3 = await checkIn(db.client, appt4);
    const q4 = await checkIn(db.client, appt3);

    const { rows } = await db.client.query(
      `SELECT id, queue_number FROM queue WHERE id IN ($1, $2, $3, $4) ORDER BY id`,
      [q1, q2, q3, q4],
    );
    expect(rows[0].queue_number).toBe(1);
    expect(rows[1].queue_number).toBe(2);
    expect(rows[2].queue_number).toBe(3);
    expect(rows[3].queue_number).toBe(4);
  });

  test("rejects duplicate check-in for the same appointment", async () => {
    const appt = await createAppointment(db.client, { txnTypes: [ID_CARD] });
    await checkIn(db.client, appt);
    await expect(checkIn(db.client, appt)).rejects.toMatchObject({ code: "23505" });
  });
});

describe("assign_next_customer FIFO based on clerk skill match", () => {
  beforeEach(async () => {
    await db.client.query(`DELETE FROM queue WHERE office_id = $1`, [OFFICE]);
    await db.client.query(`DELETE FROM clerk_sessions WHERE office_id = $1`, [OFFICE]);
  });

  test("first qualified clerk to call summon gets the assignment", async () => {
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

  test("clerk with matching skills receives the queued customer", async () => {
    await loginClerk(db.client, MARIA, 1);

    const appt = await createAppointment(db.client, {
      txnTypes: [LICENSE_ORIGINAL],
    });
    await checkIn(db.client, appt);

    const result = await summonNext(db.client, MARIA);
    expect(result).not.toBeNull();
  });

  test("returns null when clerk lacks required skills for queued customer", async () => {
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
    const { rows } = await db.client.query(`SELECT appointment_id FROM queue WHERE id = $1`, [
      result,
    ]);
    expect(rows[0].appointment_id).toBe(priority);
  });

  test("clerk session marked unavailable after receiving assignment", async () => {
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

  test("returns null when no customers are waiting in queue", async () => {
    await loginClerk(db.client, MARIA, 1);
    const result = await summonNext(db.client, MARIA);
    expect(result).toBeNull();
  });

  test("multi-skill appointment only assignable to clerk with all required skills", async () => {
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

describe("assign_next_customer — concurrent clerk race", () => {
  const clients: Client[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 10; i++) {
      clients.push(await connect());
    }
  });

  afterAll(async () => {
    const c = clients[0];
    if (c) {
      await c.query(`DELETE FROM queue WHERE office_id = $1`, [OFFICE]);
      await c.query(`DELETE FROM clerk_sessions WHERE office_id = $1`, [OFFICE]);
      await c.query(`DELETE FROM clerks WHERE first_name = 'Race'`);
      await c.query(
        `DELETE FROM appointments WHERE first_name = 'Solo' AND last_name = 'Customer'`,
      );
    }
    await Promise.all(clients.map((cl) => cl.end()));
  });

  test("10 clerks racing for 1 customer — exactly one wins", async () => {
    const setup = clients[0];

    await setup.query(`DELETE FROM queue WHERE office_id = $1`, [OFFICE]);
    await setup.query(`DELETE FROM clerk_sessions WHERE office_id = $1`, [OFFICE]);

    // Create 10 clerks with id_card skill and log them in
    const clerkIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const { rows } = await setup.query(
        `INSERT INTO clerks (first_name, last_name, email, status, skill_ids, office_ids)
         VALUES ('Race', $1, $2, 'active', $3, $4)
         RETURNING id`,
        [`Clerk${i}`, `race${i}@test.com`, [ID_CARD], [OFFICE]],
      );
      const clerkId = rows[0].id as number;
      clerkIds.push(clerkId);
      await setup.query(
        `INSERT INTO clerk_sessions (clerk_id, office_id, desk_number, is_available)
         VALUES ($1, $2, $3, TRUE)`,
        [clerkId, OFFICE, 10 + i],
      );
    }

    // One customer in queue
    const { rows: apptRows } = await setup.query(
      `INSERT INTO appointments (
        office_id, first_name, last_name,
        contact_email, contact_phone, txn_type_ids,
        appointment_date, appointment_time, status, is_walk_in, is_priority
      ) VALUES ($1, 'Solo', 'Customer', 'solo@test.com', '555-0000', $2,
                CURRENT_DATE, '09:00', 'scheduled', FALSE, FALSE)
      RETURNING id`,
      [OFFICE, [ID_CARD]],
    );
    const apptId = apptRows[0].id as number;
    await setup.query(`SELECT check_in_to_queue($1, $2)`, [OFFICE, apptId]);

    // All 10 clerks race to assign_next_customer concurrently
    const results = await Promise.all(
      clerkIds.map((clerkId, i) =>
        clients[i].query(`SELECT assign_next_customer($1, $2) AS queue_id`, [OFFICE, clerkId]),
      ),
    );

    const assigned = results
      .map((r) => r.rows[0].queue_id as number | null)
      .filter((id) => id !== null);

    // Exactly one clerk should win
    expect(assigned).toHaveLength(1);
  });
});

describe("check_in_to_queue — concurrent queue numbers", () => {
  const clients: Client[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 10; i++) {
      clients.push(await connect());
    }
  });

  afterAll(async () => {
    // Clean up committed data from the concurrency test
    const c = clients[0];
    if (c) {
      await c.query(`DELETE FROM queue WHERE office_id = $1`, [OFFICE]);
      await c.query(`DELETE FROM queue_counters WHERE office_id = $1`, [OFFICE]);
      await c.query(
        `DELETE FROM appointments WHERE first_name = 'Concurrent' AND last_name = 'User'`,
      );
    }
    await Promise.all(clients.map((cl) => cl.end()));
  });

  test("10 concurrent check-ins produce unique numbers 1–10", async () => {
    const setup = clients[0];

    await setup.query(`DELETE FROM queue WHERE office_id = $1`, [OFFICE]);
    await setup.query(`DELETE FROM queue_counters WHERE office_id = $1`, [OFFICE]);

    const appointmentIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const { rows } = await setup.query(
        `INSERT INTO appointments (
          office_id, first_name, last_name,
          contact_email, contact_phone, txn_type_ids,
          appointment_date, appointment_time, status, is_walk_in, is_priority
        ) VALUES ($1, 'Concurrent', 'User', 'c@test.com', '555-0000', $2,
                  CURRENT_DATE, '09:00', 'scheduled', FALSE, FALSE)
        RETURNING id`,
        [OFFICE, [ID_CARD]],
      );
      appointmentIds.push(rows[0].id);
    }

    const results = await Promise.all(
      appointmentIds.map((apptId, i) =>
        clients[i].query(`SELECT check_in_to_queue($1, $2) AS id`, [OFFICE, apptId]),
      ),
    );

    const queueIds = results.map((r) => r.rows[0].id as number);

    const { rows } = await setup.query(
      `SELECT queue_number FROM queue WHERE id = ANY($1) ORDER BY queue_number`,
      [queueIds],
    );

    const numbers = rows.map((r) => r.queue_number as number);
    expect(numbers).toHaveLength(10);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
