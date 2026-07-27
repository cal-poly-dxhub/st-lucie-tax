import { describe, expect, test } from "vitest";
import {
  generateQrCodeDataUrl,
  checkInToQueue,
  registerWalkIn,
  updateQueueNotes,
  setAppointmentPriority,
  getAppointmentInfo,
  type WalkInInput,
} from "../../../services/office-ops/src/check-in.js";
import { mockDb, pgError } from "./helpers/mock-db.js";

describe("generateQrCodeDataUrl", () => {
  test("returns a PNG data URL for the given content", async () => {
    const dataUrl = await generateQrCodeDataUrl("CONF-1234");

    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUrl.length).toBeGreaterThan("data:image/png;base64,".length);
  });
});

describe("checkInToQueue", () => {
  test("calls the check-in function and returns the resulting queue number", async () => {
    const db = mockDb([{ rows: [{ id: 88 }] }, { rows: [{ queue_number: 14 }] }]);

    const result = await checkInToQueue(db, 1, 501, "Regular check-in");

    expect(result).toEqual({ queueId: 88, queueNumber: 14 });
    expect(db.calls[0].values).toEqual([1, 501, "Regular check-in"]);
    expect(db.calls[1].values).toEqual([88]);
  });

  test("passes null notes when none are supplied", async () => {
    const db = mockDb([{ rows: [{ id: 88 }] }, { rows: [{ queue_number: 1 }] }]);

    await checkInToQueue(db, 1, 501);

    expect(db.calls[0].values).toEqual([1, 501, null]);
  });
});

const WALK_IN: WalkInInput = {
  officeId: 1,
  txnTypeIds: [3],
  firstName: "Dave",
  lastName: "Walker",
  contactEmail: "dave@example.com",
  contactPhone: "555-9999",
};

describe("registerWalkIn", () => {
  test("returns the new appointment id and applies defaults for priority and nowTs", async () => {
    const db = mockDb([{ rows: [{ register_walk_in: 999 }] }]);

    const outcome = await registerWalkIn(db, WALK_IN);

    expect(outcome).toEqual({ ok: true, appointmentId: 999 });
    expect(db.calls[0].values).toEqual([
      1,
      [3],
      "Dave",
      "Walker",
      "dave@example.com",
      "555-9999",
      false,
      null,
    ]);
  });

  test("forwards explicit priority and frozen timestamp", async () => {
    const db = mockDb([{ rows: [{ register_walk_in: 1000 }] }]);

    await registerWalkIn(db, { ...WALK_IN, isPriority: true, nowTs: "2026-05-12 09:30" });

    expect(db.calls[0].values?.slice(6)).toEqual([true, "2026-05-12 09:30"]);
  });

  test.each([
    ["P0002", "office_closed"],
    ["P0003", "txn_unavailable"],
  ])("maps SQLSTATE %s to the %s outcome", async (code, expected) => {
    const db = mockDb([{ error: pgError(code) }]);

    const outcome = await registerWalkIn(db, WALK_IN);

    expect(outcome).toEqual({ ok: false, error: expected });
  });

  test("rethrows unmapped PostgreSQL errors", async () => {
    const db = mockDb([{ error: pgError("23505", "duplicate key") }]);

    await expect(registerWalkIn(db, WALK_IN)).rejects.toThrow("duplicate key");
  });

  test("rethrows errors without a SQLSTATE code", async () => {
    const db = mockDb([{ error: new Error("connection terminated") }]);

    await expect(registerWalkIn(db, WALK_IN)).rejects.toThrow("connection terminated");
  });

  test("rethrows non-Error rejections", async () => {
    const db = mockDb([{ error: "socket hang up" }]);

    await expect(registerWalkIn(db, WALK_IN)).rejects.toBe("socket hang up");
  });
});

describe("updateQueueNotes", () => {
  test("writes the note onto the queue entry", async () => {
    const db = mockDb([{ rowCount: 1 }]);

    await updateQueueNotes(db, 88, "Needs interpreter");

    expect(db.calls[0].values).toEqual([88, "Needs interpreter"]);
  });

  test("throws when the queue entry does not exist", async () => {
    const db = mockDb([{ rowCount: 0 }]);

    await expect(updateQueueNotes(db, 88, "x")).rejects.toThrow("Queue entry 88 not found");
  });
});

describe("setAppointmentPriority", () => {
  test("flags the appointment as priority", async () => {
    const db = mockDb([{ rowCount: 1 }]);

    await setAppointmentPriority(db, 501, true);

    expect(db.calls[0].values).toEqual([501, true]);
  });

  test("throws when the appointment does not exist", async () => {
    const db = mockDb([{ rowCount: 0 }]);

    await expect(setAppointmentPriority(db, 501, true)).rejects.toThrow(
      "Appointment 501 not found",
    );
  });
});

describe("getAppointmentInfo", () => {
  test("returns the clerk-facing appointment summary", async () => {
    const db = mockDb([
      {
        rows: [
          {
            id: 501,
            first_name: "Ana",
            last_name: "Reyes",
            identity_verified: true,
            prescreen_completed: false,
            required_doc_ids: ["photo_id"],
          },
        ],
      },
    ]);

    await expect(getAppointmentInfo(db, 501)).resolves.toEqual({
      appointmentId: 501,
      firstName: "Ana",
      lastName: "Reyes",
      identityVerified: true,
      prescreenCompleted: false,
      requiredDocIds: ["photo_id"],
    });
  });

  test("throws when the appointment does not exist", async () => {
    const db = mockDb([{ rows: [] }]);

    await expect(getAppointmentInfo(db, 501)).rejects.toThrow("Appointment 501 not found");
  });
});
