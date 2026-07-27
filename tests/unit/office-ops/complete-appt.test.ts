import { describe, expect, test } from "vitest";
import {
  completeAppointment,
  type CompleteAppointmentInput,
} from "../../../services/office-ops/src/complete.js";
import type { Queryable } from "../../../services/office-ops/src/utils.js";
import { mockDb } from "./helpers/mock-db.js";

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

describe("completeAppointment: success paths", () => {
  test("closes the queue entry, records service history, and frees the clerk", async () => {
    const db = mockDb([
      { rows: [{ appointment_id: 501, status: "serving" }] },
      { rowCount: 1 }, // UPDATE queue -> done
      { rowCount: 1 }, // UPDATE appointments -> completed
      { rows: [{ id: 900, duration_sec: 742 }] }, // INSERT service_history
      { rows: [{ txn_type_ids: [3, 4] }] },
      { rowCount: 2 }, // INSERT service_history_txn_types
      { rowCount: 1 }, // UPDATE clerk_sessions
    ]);

    await expect(completeAppointment(db, baseInput)).resolves.toEqual({ durationSec: 742 });

    expect(db.calls[1].sql).toContain("status = 'done'");
    expect(db.calls[2].sql).toContain("status = 'completed'");
    expect(db.calls[3].values).toEqual([1, 501, 42, 10]);

    const insertTxns = db.calls[5];
    expect(insertTxns.sql).toContain("VALUES ($1, $2), ($1, $3)");
    expect(insertTxns.values).toEqual([900, 3, 4]);

    expect(db.calls[6].sql).toContain("is_available = TRUE");
    expect(db.calls[6].values).toEqual([10, 1]);
  });

  test("skips the transaction-type insert when the appointment has no transactions", async () => {
    const db = mockDb([
      { rows: [{ appointment_id: 501, status: "serving" }] },
      { rowCount: 1 },
      { rowCount: 1 },
      { rows: [{ id: 900, duration_sec: 60 }] },
      { rows: [{ txn_type_ids: [] }] },
      { rowCount: 1 }, // UPDATE clerk_sessions
    ]);

    await expect(completeAppointment(db, baseInput)).resolves.toEqual({ durationSec: 60 });

    expect(db.calls).toHaveLength(6);
    expect(db.calls.some((c) => c.sql.includes("service_history_txn_types"))).toBe(false);
  });
});
