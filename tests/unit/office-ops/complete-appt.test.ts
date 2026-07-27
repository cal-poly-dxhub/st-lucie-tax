import { describe, expect, test } from "vitest";
import {
  completeAppointment,
  type CompleteAppointmentInput,
} from "../../../services/office-ops/src/complete.js";
import type { Queryable } from "../../../services/office-ops/src/utils.js";

type Row = Record<string, unknown>;

function makeDb(responses: Array<{ rows: Row[] }>): Queryable {
  let idx = 0;
  return {
    query() {
      if (idx >= responses.length) {
        throw new Error(`Unexpected query #${idx + 1} (only ${responses.length} mocked)`);
      }
      const r = responses[idx++];
      return Promise.resolve({ rows: r.rows, rowCount: r.rows.length });
    },
  } as Queryable;
}

const baseInput: CompleteAppointmentInput = {
  officeId: 1,
  queueId: 42,
  clerkId: 10,
};

describe("completeAppointment: error paths", () => {
  test("throws when queue entry not found", async () => {
    const db = makeDb([{ rows: [] }]);
    await expect(completeAppointment(db, baseInput)).rejects.toThrow("Queue entry 42 not found");
  });

  test("throws when queue entry is not in serving status", async () => {
    const db = makeDb([
      { rows: [{ appointment_id: 1, status: "waiting", served_at: new Date() }] },
    ]);
    await expect(completeAppointment(db, baseInput)).rejects.toThrow(
      "Queue entry 42 is not in serving status",
    );
  });
});
