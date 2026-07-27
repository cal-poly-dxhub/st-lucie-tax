import { describe, expect, test } from "vitest";
import {
  bookAppointment,
  cancelAppointment,
  PG_ERROR_MAP,
  type BookApptInput,
} from "../../../services/office-ops/src/book-appt.js";
import { mockDb, pgError } from "./helpers/mock-db.js";

const INPUT: BookApptInput = {
  officeId: 1,
  date: "2026-05-12",
  time: "09:00:00",
  txnTypeIds: [3],
  requiredDocIds: ["photo_id"],
  firstName: "Alice",
  lastName: "Johnson",
  contactEmail: "alice@example.com",
  contactPhone: "555-1234",
};

describe("bookAppointment", () => {
  test("returns the appointment id and confirmation code, applying defaults", async () => {
    const db = mockDb([{ rows: [{ id: 501, confirmation_code: "ABC123" }] }]);

    const result = await bookAppointment(db, INPUT);

    expect(result).toEqual({ ok: true, appointmentId: 501, confirmationCode: "ABC123" });
    expect(db.calls[0].values).toEqual([
      1,
      "2026-05-12",
      "09:00:00",
      [3],
      ["photo_id"],
      "Alice",
      "Johnson",
      "alice@example.com",
      "555-1234",
      false, // isWalkIn
      false, // isPriority
      false, // prescreenCompleted
      "{}", // prescreenResponses
      null, // nowTs
    ]);
  });

  test("forwards walk-in, priority, prescreen, and frozen-clock overrides", async () => {
    const db = mockDb([{ rows: [{ id: 502, confirmation_code: "XYZ789" }] }]);

    await bookAppointment(db, {
      ...INPUT,
      isWalkIn: true,
      isPriority: true,
      prescreenCompleted: true,
      prescreenResponses: { "1": true, "2": false },
      nowTs: "2026-05-11 18:00",
    });

    expect(db.calls[0].values?.slice(9)).toEqual([
      true,
      true,
      true,
      JSON.stringify({ "1": true, "2": false }),
      "2026-05-11 18:00",
    ]);
  });

  test.each(Object.entries(PG_ERROR_MAP))(
    "maps SQLSTATE %s to the %s outcome",
    async (code, expected) => {
      const db = mockDb([{ error: pgError(code) }]);

      const result = await bookAppointment(db, INPUT);

      expect(result).toEqual({ ok: false, error: expected });
    },
  );

  test("rethrows unmapped PostgreSQL errors", async () => {
    const db = mockDb([{ error: pgError("40001", "serialization failure") }]);

    await expect(bookAppointment(db, INPUT)).rejects.toThrow("serialization failure");
  });

  test("rethrows errors without a SQLSTATE code", async () => {
    const db = mockDb([{ error: new Error("connection terminated") }]);

    await expect(bookAppointment(db, INPUT)).rejects.toThrow("connection terminated");
  });

  test("rethrows non-Error rejections", async () => {
    const db = mockDb([{ error: "socket hang up" }]);

    await expect(bookAppointment(db, INPUT)).rejects.toBe("socket hang up");
  });
});

describe("cancelAppointment", () => {
  test("cancels a scheduled appointment", async () => {
    const db = mockDb([{ rowCount: 1 }]);

    await cancelAppointment(db, 501);

    expect(db.calls[0].sql).toContain("status = 'cancelled'");
    expect(db.calls[0].values).toEqual([501]);
  });

  test("throws when the appointment is missing or already cancelled", async () => {
    const db = mockDb([{ rowCount: 0 }]);

    await expect(cancelAppointment(db, 501)).rejects.toThrow(
      "Appointment 501 not found or already cancelled",
    );
  });
});
