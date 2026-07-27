import { describe, expect, test } from "vitest";
import { computeDurationUpdates } from "../../../services/office-ops/src/generate-recommendations.js";
import { mockDb } from "./helpers/mock-db.js";

function statRow(overrides: Record<string, unknown> = {}) {
  return {
    txn_type_id: 3,
    txn_name: "Driver License Renewal",
    current_avg_min: 20,
    actual_avg_sec: 1800, // 30 min → 50% above current
    sample_size: 40,
    ...overrides,
  };
}

describe("computeDurationUpdates", () => {
  test("recommends a new duration when the observed average moves past the threshold", async () => {
    const db = mockDb([{ rows: [statRow()] }]);

    await expect(computeDurationUpdates(db, 30, 20, 15)).resolves.toEqual([
      {
        txnTypeId: 3,
        txnName: "Driver License Renewal",
        currentAvgMin: 20,
        recommendedAvgMin: 30,
        sampleSize: 40,
      },
    ]);
    expect(db.calls[0].values).toEqual(["30", 20]);
  });

  test("skips transactions whose observed average rounds below one minute", async () => {
    const db = mockDb([{ rows: [statRow({ actual_avg_sec: 20 })] }]);

    await expect(computeDurationUpdates(db, 30, 20, 15)).resolves.toEqual([]);
  });

  test("skips transactions whose drift is under the threshold", async () => {
    // 21 min observed vs 20 min configured = 5% drift.
    const db = mockDb([{ rows: [statRow({ actual_avg_sec: 1260 })] }]);

    await expect(computeDurationUpdates(db, 30, 20, 15)).resolves.toEqual([]);
  });

  test("detects downward drift as well as upward", async () => {
    // 10 min observed vs 20 min configured = 50% drift.
    const db = mockDb([{ rows: [statRow({ actual_avg_sec: 600 })] }]);

    const updates = await computeDurationUpdates(db, 30, 20, 15);

    expect(updates).toHaveLength(1);
    expect(updates[0].recommendedAvgMin).toBe(10);
  });

  test("returns an empty list when no transaction meets the sample-size floor", async () => {
    const db = mockDb([{ rows: [] }]);

    await expect(computeDurationUpdates(db, 30, 20, 15)).resolves.toEqual([]);
  });
});
