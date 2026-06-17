import type { Client } from "pg";
import { connect } from "./client.js";
import { TEST_DATE, TEST_FROZEN_NOW } from "../../../tests/config.js";

export const ROAD_TEST = 1;
export const ID_CARD = 2;

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

export async function raceTest(opts: {
  preBookParams: unknown[];
  racerAParams: unknown[];
  racerBParams: unknown[];
}) {
  const setup = await connect();
  const a = await connect();
  const b = await connect();
  try {
    await setup.query(
      `DELETE FROM documents
        WHERE appointment_id IN (
          SELECT id FROM appointments
          WHERE office_id=1 AND appointment_date=$1
        )`,
      [TEST_DATE],
    );
    await setup.query(
      `DELETE FROM appointments
        WHERE office_id=1
          AND appointment_date=$1`,
      [TEST_DATE],
    );
    await setup.query(BOOK_SQL, opts.preBookParams);

    await a.query("BEGIN");
    await b.query("BEGIN");

    const racerA = a.query(BOOK_SQL, opts.racerAParams);
    await new Promise((r) => setTimeout(r, 50));
    const racerB = b.query(BOOK_SQL, opts.racerBParams);

    const winnerRow = await racerA;
    await a.query("COMMIT");

    const loserResult = await racerB.then(
      () => null,
      (err: { code: string }) => err.code,
    );
    await b.query("ROLLBACK");

    await setup.query(
      `DELETE FROM documents
        WHERE appointment_id IN (
          SELECT id FROM appointments
          WHERE office_id=1 AND appointment_date=$1
        )`,
      [TEST_DATE],
    );
    await setup.query(
      `DELETE FROM appointments
        WHERE office_id=1
          AND appointment_date=$1`,
      [TEST_DATE],
    );

    return { winnerId: winnerRow.rows[0].id, loserCode: loserResult };
  } finally {
    await setup.end();
    await a.end();
    await b.end();
  }
}
