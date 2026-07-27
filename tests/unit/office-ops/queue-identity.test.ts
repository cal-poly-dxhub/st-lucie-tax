import { describe, expect, test } from "vitest";
import { assignNextCustomer } from "../../../services/office-ops/src/queue.js";
import { setIdentityVerified } from "../../../services/office-ops/src/identity.js";
import { mockDb } from "./helpers/mock-db.js";

describe("assignNextCustomer", () => {
  test("returns the assigned queue entry with desk and clerk", async () => {
    const db = mockDb([
      { rows: [{ queue_id: 88 }] },
      { rows: [{ queue_id: 88, desk_number: 3, clerk_id: 10 }] },
    ]);

    await expect(assignNextCustomer(db, 1, 10)).resolves.toEqual({
      queueId: 88,
      deskNumber: 3,
      clerkId: 10,
    });
    expect(db.calls[0].values).toEqual([1, 10]);
    expect(db.calls[1].values).toEqual([88]);
  });

  test("returns null when the queue is empty and skips the follow-up query", async () => {
    const db = mockDb([{ rows: [{ queue_id: null }] }]);

    await expect(assignNextCustomer(db, 1, 10)).resolves.toBeNull();
    expect(db.calls).toHaveLength(1);
  });
});

describe("setIdentityVerified", () => {
  test("flags the appointment as identity-verified", async () => {
    const db = mockDb([{ rowCount: 1 }]);

    await setIdentityVerified(db, 501);

    expect(db.calls[0].sql).toContain("identity_verified = TRUE");
    expect(db.calls[0].values).toEqual([501]);
  });

  test("throws when the appointment does not exist", async () => {
    const db = mockDb([{ rowCount: 0 }]);

    await expect(setIdentityVerified(db, 501)).rejects.toThrow("Appointment 501 not found");
  });
});
