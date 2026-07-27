/**
 * Integration tests for the chatbot scheduling adapter (scheduling/client.ts).
 *
 * The chatbot delegates slot search and booking to the canonical Office
 * Operations engine (@st-lucie/office-ops/scheduling), so these tests assert
 * the adapter's contract rather than re-testing the engine (see
 * tests/unit/office-ops/find-appt.test.ts for that):
 *
 *   - txn_type_id strings resolve to global integer IDs
 *   - a partial or unknown resolution is reported, never silently scheduled
 *   - whatever slot is offered is actually bookable
 *   - appointments pack back-to-back on duration boundaries, NOT a 15-minute
 *     grid (docs/scheduling-design.md — "Appointment Packing")
 *
 * The original implementation carried its own SQL, which both drifted from the
 * design (15-minute grid) and raised 42883 via
 * generate_series(TIME, TIME, INTERVAL) — surfacing as an HTTP 502.
 */
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, test } from "vitest";
import { Client } from "pg";
import { getPool } from "@st-lucie/data-access";
import { connect } from "./helpers/client.js";
import { clearOfficeDay, BOOK_SQL } from "./helpers/booking.js";
import { ROAD_TEST, ID_CARD } from "./helpers/seed-ids.js";
import { TEST_DATE, TEST_FROZEN_NOW } from "../../config.js";

import { findSlot, book } from "../../../services/chatbot/src/scheduling/client.js";

const ROAD_TEST_TXN_ID = "road-test";
const ID_CARD_TXN_ID = "id-card";

// road-test is seeded available_from 09:00 / available_until 15:00 — the
// transaction that exposes availability-window bugs.
const ROAD_TEST_WINDOW = { from: "09:00:00", until: "15:00:00" };
const ROAD_TEST_DURATION_MIN = 30;

let client: Client;

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.query("BEGIN");
  await clearOfficeDay(client, 1, TEST_DATE);
  await clearOfficeDay(client, 2, TEST_DATE);
});

afterEach(async () => {
  await client.query("ROLLBACK");
});

describe("findSlot — chatbot scheduling adapter", () => {
  test("returns a slot for a known schedulable transaction", async () => {
    const result = await findSlot({
      chatbotTxnIds: [ROAD_TEST_TXN_ID],
      startDate: TEST_DATE,
      maxDays: 1,
      nowTs: TEST_FROZEN_NOW,
    });

    expect(result.schedulable).toBe(true);
    expect(result.unmapped).toHaveLength(0);
    expect(result.slot).not.toBeNull();
    expect(result.slot!.date).toBe(TEST_DATE);
    expect(result.slot!.time).toMatch(/^\d{2}:\d{2}/);
    expect(result.slot!.officeName).toBeTruthy();
  });

  test("does not throw on a valid search (regression for the 502)", async () => {
    // The old hand-rolled query raised 42883 here, which the
    // /scheduling/slot handler turned into an opaque HTTP 502.
    await expect(
      findSlot({
        chatbotTxnIds: [ROAD_TEST_TXN_ID],
        startDate: TEST_DATE,
        maxDays: 1,
        nowTs: TEST_FROZEN_NOW,
      }),
    ).resolves.toBeDefined();
  });

  test("reports an unrecognised transaction id as unmapped", async () => {
    const result = await findSlot({
      chatbotTxnIds: ["does-not-exist"],
      startDate: TEST_DATE,
      maxDays: 1,
      nowTs: TEST_FROZEN_NOW,
    });

    expect(result.schedulable).toBe(false);
    expect(result.unmapped).toContain("does-not-exist");
    expect(result.slot).toBeNull();
  });

  test("refuses to schedule a subset when only some txns resolve", async () => {
    // Scheduling just the valid half would silently drop a transaction the
    // citizen asked for, and under-book the appointment duration.
    const result = await findSlot({
      chatbotTxnIds: [ROAD_TEST_TXN_ID, "does-not-exist"],
      startDate: TEST_DATE,
      maxDays: 1,
      nowTs: TEST_FROZEN_NOW,
    });

    expect(result.schedulable).toBe(false);
    expect(result.slot).toBeNull();
    expect(result.unmapped).toEqual(["does-not-exist"]);
  });

  test("returns no-availability when the office is closed all window", async () => {
    // Sunday — offices are open Mon–Fri, so no office_hours row for DOW=0.
    const result = await findSlot({
      chatbotTxnIds: [ROAD_TEST_TXN_ID],
      startDate: "2026-05-17",
      maxDays: 1,
      nowTs: "2026-05-16 18:00",
    });

    expect(result.schedulable).toBe(true);
    expect(result.slot).toBeNull();
    expect(result.reason).toBe("no-availability");
  });

  test("handles multi-transaction appointments", async () => {
    const result = await findSlot({
      chatbotTxnIds: [ROAD_TEST_TXN_ID, ID_CARD_TXN_ID],
      startDate: TEST_DATE,
      maxDays: 1,
      nowTs: TEST_FROZEN_NOW,
    });

    expect(result.unmapped).toHaveLength(0);
    expect(result.schedulable).toBe(true);
  });

  test("respects the transaction availability window", async () => {
    const result = await findSlot({
      chatbotTxnIds: [ROAD_TEST_TXN_ID],
      startDate: TEST_DATE,
      maxDays: 1,
      nowTs: TEST_FROZEN_NOW,
    });

    expect(result.slot).not.toBeNull();
    expect(result.slot!.time >= ROAD_TEST_WINDOW.from).toBe(true);
    expect(toMinutes(result.slot!.time) + ROAD_TEST_DURATION_MIN).toBeLessThanOrEqual(
      toMinutes(ROAD_TEST_WINDOW.until),
    );
  });

  test("offered slot ends before the office closes", async () => {
    const result = await findSlot({
      chatbotTxnIds: [ROAD_TEST_TXN_ID],
      startDate: TEST_DATE,
      maxDays: 1,
      nowTs: TEST_FROZEN_NOW,
    });

    expect(result.slot).not.toBeNull();
    const { rows } = await client.query<{ close_time: string }>(
      `SELECT close_time FROM office_hours
        WHERE office_id = $1 AND day_of_week = EXTRACT(DOW FROM $2::date)::int`,
      [result.slot!.officeId, result.slot!.date],
    );

    expect(toMinutes(result.slot!.time) + ROAD_TEST_DURATION_MIN).toBeLessThanOrEqual(
      toMinutes(rows[0].close_time),
    );
  });

  test("the offered slot is actually bookable", async () => {
    // The end-to-end invariant: whatever findSlot offers must survive
    // book_appointment()'s office-hours, window, and capacity checks.
    const result = await findSlot({
      chatbotTxnIds: [ROAD_TEST_TXN_ID],
      startDate: TEST_DATE,
      maxDays: 1,
      nowTs: TEST_FROZEN_NOW,
    });

    expect(result.slot).not.toBeNull();
    const slot = result.slot!;

    const { rows } = await client.query(BOOK_SQL, [
      slot.officeId,
      slot.date,
      slot.time,
      [ROAD_TEST],
      [],
      "Test",
      "Booker",
      "test@example.com",
      "555-0000",
      TEST_FROZEN_NOW,
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBeGreaterThan(0);
  });

  test("packs back-to-back on duration boundaries, not a 15-minute grid", async () => {
    // The design rejects a fixed grid: the next appointment starts when the
    // previous one ends (plus config.scheduling_block_padding). id-card is 15
    // minutes, so booking it at 09:05 must make 09:20 reachable — a time a
    // 15-minute grid (:00/:15/:30/:45) could never offer.
    const { rows: cfg } = await client.query<{ scheduling_block_padding: number }>(
      `SELECT scheduling_block_padding FROM config`,
    );
    const padding = cfg[0].scheduling_block_padding;

    // Saturate every desk at BOTH offices from 08:00 (open) with a 15-minute
    // id-card, but starting 5 minutes in. The first free capacity is then the
    // 08:20 boundary those appointments create — a time no 15-minute grid
    // (:00/:15/:30/:45) can express.
    const fillFrom = "08:05";

    // findSlot() runs on the shared pool, not this test's transaction, so the
    // fill has to be committed to be visible to it — and cleaned up by hand.
    const pool = getPool();
    const { rows: offices } = await pool.query<{ id: number; effective_desks: number }>(
      `SELECT id, FLOOR(total_desks * run_rate_pct / 100.0)::int AS effective_desks
         FROM offices ORDER BY id`,
    );

    try {
      for (const office of offices) {
        for (let i = 0; i < office.effective_desks; i++) {
          await pool.query(BOOK_SQL, [
            office.id,
            TEST_DATE,
            fillFrom,
            [ID_CARD],
            [],
            "Filler",
            `Desk${i}`,
            "filler@example.com",
            "555-0001",
            TEST_FROZEN_NOW,
          ]);
        }
      }

      const result = await findSlot({
        chatbotTxnIds: [ID_CARD_TXN_ID],
        startDate: TEST_DATE,
        maxDays: 1,
        nowTs: TEST_FROZEN_NOW,
      });

      expect(result.slot).not.toBeNull();
      expect(result.slot!.date).toBe(TEST_DATE);

      const offered = toMinutes(result.slot!.time);
      const boundary = toMinutes(fillFrom) + 15 + padding;

      // The engine must land exactly on the boundary the prior appointments
      // created, rather than rounding up to the next quarter hour.
      expect(offered).toBe(boundary);
      expect(offered % 15).not.toBe(0);
    } finally {
      await pool.query(
        `DELETE FROM appointments
          WHERE appointment_date = $1 AND contact_phone = '555-0001'`,
        [TEST_DATE],
      );
    }
  });
});

describe("book — chatbot scheduling adapter", () => {
  test("books the slot findSlot offered", async () => {
    const found = await findSlot({
      chatbotTxnIds: [ROAD_TEST_TXN_ID],
      startDate: TEST_DATE,
      maxDays: 1,
      nowTs: TEST_FROZEN_NOW,
    });
    expect(found.slot).not.toBeNull();

    const result = await book({
      chatbotTxnIds: [ROAD_TEST_TXN_ID],
      officeId: found.slot!.officeId,
      date: found.slot!.date,
      time: found.slot!.time,
      firstName: "Test",
      lastName: "Booker",
      email: "test@example.com",
      phone: "555-0000",
      nowTs: TEST_FROZEN_NOW,
    });

    expect(result.appointmentId).toBeGreaterThan(0);
    expect(result.qrCode).toMatch(/^[0-9A-Z]{8}$/);
    expect(result.slot.officeName).toBeTruthy();
  });

  test("surfaces a past slot as SLOT_TAKEN so the caller retries", async () => {
    // book_appointment() raises slot_in_past (P0004). Previously this escaped
    // as an unmapped error and became a 502 instead of a retryable 409.
    await expect(
      book({
        chatbotTxnIds: [ROAD_TEST_TXN_ID],
        officeId: 1,
        date: "2020-01-02",
        time: "09:00",
        firstName: "Test",
        lastName: "Booker",
        email: "test@example.com",
        phone: "555-0000",
        nowTs: TEST_FROZEN_NOW,
      }),
    ).rejects.toMatchObject({ code: "SLOT_TAKEN" });
  });

  test("surfaces an out-of-window time as TXN_UNAVAILABLE", async () => {
    // road-test is unavailable at 16:00 (window ends 15:00) → P0003.
    await expect(
      book({
        chatbotTxnIds: [ROAD_TEST_TXN_ID],
        officeId: 1,
        date: TEST_DATE,
        time: "16:00",
        firstName: "Test",
        lastName: "Booker",
        email: "test@example.com",
        phone: "555-0000",
        nowTs: TEST_FROZEN_NOW,
      }),
    ).rejects.toMatchObject({ code: "TXN_UNAVAILABLE" });
  });

  test("rejects an unresolvable transaction before touching the DB", async () => {
    await expect(
      book({
        chatbotTxnIds: ["does-not-exist"],
        officeId: 1,
        date: TEST_DATE,
        time: "09:00",
        firstName: "Test",
        lastName: "Booker",
        email: "test@example.com",
        phone: "555-0000",
        nowTs: TEST_FROZEN_NOW,
      }),
    ).rejects.toMatchObject({ code: "TXN_UNAVAILABLE" });
  });
});
