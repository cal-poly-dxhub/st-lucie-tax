import type { Client } from "pg";
import { connect } from "./client.ts";

export const DATE = "2026-05-12";
export const FROZEN_NOW = "2026-05-12 06:00";
export const ROAD_TEST = 1;
export const ID_CARD = 2;

export const BOOK_SQL = `
  SELECT book_appointment(
    p_county_id        := $1,
    p_office_id        := $2,
    p_date             := $3,
    p_time             := $4,
    p_txn_type_ids     := $5,
    p_required_doc_ids := $6,
    p_first_name       := $7,
    p_last_name        := $8,
    p_contact_email    := $9,
    p_contact_phone    := $10,
    p_now_ts           := $11::timestamp
  ) AS id
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
    "stlucie",
    overrides.office ?? 1,
    overrides.date ?? DATE,
    overrides.time ?? "09:00",
    overrides.skills ?? [ROAD_TEST],
    overrides.requiredDocIds ?? [],
    overrides.first ?? "Test",
    overrides.last ?? "Booker",
    overrides.email ?? "test@example.com",
    overrides.phone ?? "555-0000",
    overrides.now ?? FROZEN_NOW,
  ];
}

export async function clearOfficeDay(client: Client, office = 1) {
  await client.query(
    `DELETE FROM appointments
      WHERE county_id='stlucie' AND office_id=$1 AND appointment_date=$2`,
    [office, DATE],
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
    await setup.query(`SET app.current_tenant = 'stlucie'`);
    await a.query(`SET app.current_tenant = 'stlucie'`);
    await b.query(`SET app.current_tenant = 'stlucie'`);

    await setup.query(
      `DELETE FROM appointments
        WHERE county_id='stlucie' AND office_id=1
          AND appointment_date=$1`,
      [DATE],
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
      `DELETE FROM appointments
        WHERE county_id='stlucie' AND office_id=1
          AND appointment_date=$1`,
      [DATE],
    );

    return { winnerId: winnerRow.rows[0].id, loserCode: loserResult };
  } finally {
    await setup.end();
    await a.end();
    await b.end();
  }
}
