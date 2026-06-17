import { describe, expect, test } from "vitest";
import {
  bookAppointment,
  PG_ERROR_MAP,
  type BookApptInput,
  type BookApptError,
} from "../../src/book-appt.js";
import type { Queryable } from "../../src/utils.js";
import { TEST_FROZEN_NOW } from "../config.js";

const OFFICE_ID = 1;
const APPT_DATE = "2026-05-12";
const APPT_TIME = "09:00:00";
const DEFAULT_TXN_IDS = [1];
const QR_CODE = "QR-ABC-123";
const PARAM_IDX_QR_CODE = 9;
const PARAM_IDX_IS_WALK_IN = 10;
const PARAM_IDX_IS_PRIORITY = 11;
const PARAM_IDX_PRESCREEN_COMPLETED = 12;
const PARAM_IDX_PRESCREEN_RESPONSES = 13;

function makeDb(result: { rows: Record<string, unknown>[] }): Queryable {
  return {
    query: () => Promise.resolve({ rows: result.rows, rowCount: result.rows.length }),
  } as Queryable;
}

function makeErrorDb(code: string): Queryable {
  return {
    async query() {
      const err = new Error(`PG error ${code}`) as Error & { code: string };
      err.code = code;
      throw err;
    },
  };
}

function baseInput(overrides: Partial<BookApptInput> = {}): BookApptInput {
  return {
    officeId: OFFICE_ID,
    date: APPT_DATE,
    time: APPT_TIME,
    txnTypeIds: DEFAULT_TXN_IDS,
    requiredDocIds: [],
    firstName: "Test",
    lastName: "User",
    contactEmail: "test@example.com",
    contactPhone: "555-0000",
    qrCode: QR_CODE,
    nowTs: TEST_FROZEN_NOW,
    ...overrides,
  };
}

describe("bookAppointment: happy path", () => {
  test("books an appointment and returns the id", async () => {
    const db = makeDb({ rows: [{ book_appointment: 42 }] });
    const result = await bookAppointment(db, baseInput());
    expect(result).toEqual({ ok: true, appointmentId: 42 });
  });
});

describe("bookAppointment: txn_unavailable", () => {
  test("fails when office no longer supports the requested txnTypeIds", async () => {
    const db = makeErrorDb("P0003");
    const result = await bookAppointment(db, baseInput({ txnTypeIds: [999] }));
    expect(result).toEqual({ ok: false, error: "txn_unavailable" });
  });
});

describe("bookAppointment: slot_in_past", () => {
  test("fails when the date and time are in the past relative to office local time", async () => {
    const db = makeErrorDb("P0004");
    const result = await bookAppointment(
      db,
      baseInput({ date: "2020-01-01", time: "08:00:00", nowTs: "2026-05-12 10:00" }),
    );
    expect(result).toEqual({ ok: false, error: "slot_in_past" });
  });

  test("fails when nowTs is after the date/time being booked", async () => {
    const db = makeErrorDb("P0004");
    const result = await bookAppointment(
      db,
      baseInput({ date: APPT_DATE, time: APPT_TIME, nowTs: "2026-05-12 10:00" }),
    );
    expect(result).toEqual({ ok: false, error: "slot_in_past" });
  });
});

describe("bookAppointment: qrCode required", () => {
  test("passes null qrCode when none provided — DB enforces the constraint", async () => {
    const db = {
      async query(_sql: string, values?: unknown[]) {
        const qrCode = values?.[PARAM_IDX_QR_CODE];
        expect(qrCode).toBeNull();
        return { rows: [{ book_appointment: 1 }], rowCount: 1 };
      },
    } as Queryable;
    await bookAppointment(db, baseInput({ qrCode: undefined }));
  });

  test("passes qrCode value to the DB when provided", async () => {
    const db = {
      async query(_sql: string, values?: unknown[]) {
        const qrCode = values?.[PARAM_IDX_QR_CODE];
        expect(qrCode).toBe("QR-XYZ-789");
        return { rows: [{ book_appointment: 1 }], rowCount: 1 };
      },
    } as Queryable;
    await bookAppointment(db, baseInput({ qrCode: "QR-XYZ-789" }));
  });
});

describe("bookAppointment: walk-in", () => {
  test("walk-in passes isWalkIn=true to the DB", async () => {
    const db = {
      async query(_sql: string, values?: unknown[]) {
        const isWalkIn = values?.[PARAM_IDX_IS_WALK_IN];
        expect(isWalkIn).toBe(true);
        return { rows: [{ book_appointment: 5 }], rowCount: 1 };
      },
    } as Queryable;
    const result = await bookAppointment(
      db,
      baseInput({ isWalkIn: true, time: "14:30:00", nowTs: "2026-05-12 14:30" }),
    );
    expect(result).toEqual({ ok: true, appointmentId: 5 });
  });
});

describe("bookAppointment: isPriority", () => {
  test("passes isPriority=true to the DB", async () => {
    const db = {
      async query(_sql: string, values?: unknown[]) {
        const isPriority = values?.[PARAM_IDX_IS_PRIORITY];
        expect(isPriority).toBe(true);
        return { rows: [{ book_appointment: 7 }], rowCount: 1 };
      },
    } as Queryable;
    const result = await bookAppointment(db, baseInput({ isPriority: true }));
    expect(result).toEqual({ ok: true, appointmentId: 7 });
  });
});

describe("bookAppointment: default values for optional fields", () => {
  test("omitted optional fields are passed with correct defaults", async () => {
    const db = {
      async query(_sql: string, values?: unknown[]) {
        expect(values?.[PARAM_IDX_QR_CODE]).toBeNull();
        expect(values?.[PARAM_IDX_IS_WALK_IN]).toBe(false);
        expect(values?.[PARAM_IDX_IS_PRIORITY]).toBe(false);
        expect(values?.[PARAM_IDX_PRESCREEN_COMPLETED]).toBe(false);
        expect(values?.[PARAM_IDX_PRESCREEN_RESPONSES]).toBe("{}");
        return { rows: [{ book_appointment: 1 }], rowCount: 1 };
      },
    } as Queryable;
    await bookAppointment(
      db,
      baseInput({
        qrCode: undefined,
        isWalkIn: undefined,
        isPriority: undefined,
        prescreenCompleted: undefined,
        prescreenResponses: undefined,
      }),
    );
  });
});

describe("bookAppointment: PG_ERROR_MAP coverage", () => {
  const errorCases: Array<[string, BookApptError]> = Object.entries(PG_ERROR_MAP).map(
    ([code, error]) => [code, error],
  );

  test.each(errorCases)("PG code %s maps to %s", async (pgCode, expectedError) => {
    const db = makeErrorDb(pgCode);
    const result = await bookAppointment(db, baseInput());
    expect(result).toEqual({ ok: false, error: expectedError });
  });

  test("unmapped PG error code is re-thrown", async () => {
    const db = makeErrorDb("P9999");
    await expect(bookAppointment(db, baseInput())).rejects.toThrow("PG error P9999");
  });

  test("non-PG error is re-thrown", async () => {
    const db: Queryable = {
      async query() {
        throw new Error("connection refused");
      },
    };
    await expect(bookAppointment(db, baseInput())).rejects.toThrow("connection refused");
  });
});
