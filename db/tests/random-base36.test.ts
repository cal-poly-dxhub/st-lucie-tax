import { describe, expect, test } from "vitest";
import { useDb } from "./helpers/fixture.js";

const db = useDb();

describe("random_base36", () => {
  test("returns 8-char uppercase base36 string by default", async () => {
    const { rows } = await db.client.query(`SELECT random_base36() AS code`);
    const code = rows[0].code;
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[0-9A-Z]{8}$/);
  });

  test("respects custom length", async () => {
    const { rows } = await db.client.query(`SELECT random_base36(12) AS code`);
    expect(rows[0].code).toHaveLength(12);
    expect(rows[0].code).toMatch(/^[0-9A-Z]{12}$/);
  });

  test("generates unique values across calls", async () => {
    const { rows } = await db.client.query(
      `SELECT random_base36() AS code FROM generate_series(1, 100)`,
    );
    const codes = rows.map((r) => r.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(100);
  });

  test("appointment gets a base36 qr_code by default", async () => {
    const { rows } = await db.client.query(
      `INSERT INTO appointments (
        office_id, first_name, last_name, contact_email, contact_phone,
        txn_type_ids, appointment_date, appointment_time
      ) VALUES (1, 'Test', 'User', 'test@example.com', '555-0000', '{1}', '2026-07-01', '09:00')
      RETURNING qr_code`,
    );
    const code = rows[0].qr_code;
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[0-9A-Z]{8}$/);
  });

  test("unique constraint prevents duplicate qr_code", async () => {
    await db.client.query(
      `INSERT INTO appointments (
        office_id, first_name, last_name, contact_email, contact_phone,
        txn_type_ids, appointment_date, appointment_time, qr_code
      ) VALUES (1, 'A', 'B', 'a@b.com', '555-0000', '{1}', '2026-07-01', '09:00', 'TESTCODE')`,
    );
    await expect(
      db.client.query(
        `INSERT INTO appointments (
          office_id, first_name, last_name, contact_email, contact_phone,
          txn_type_ids, appointment_date, appointment_time, qr_code
        ) VALUES (1, 'C', 'D', 'c@d.com', '555-0000', '{1}', '2026-07-01', '09:30', 'TESTCODE')`,
      ),
    ).rejects.toThrow(/unique/i);
  });
});
