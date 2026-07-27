import { describe, expect, test, beforeEach } from "vitest";
import { useDb } from "../../../../db/tests/helpers/fixture.js";
import { ID_CARD as TXN_TYPE_ID_CARD } from "../../../../db/tests/helpers/seed-ids.js";
import { generateDurationRecommendations } from "../../src/generate-recommendations.js";

const db = useDb();

const OFFICE = 1;

async function insertServiceHistory(txnTypeId: number, durationSec: number, daysAgo: number = 1) {
  const { rows } = await db.client.query<{ id: number }>(
    `INSERT INTO service_history (office_id, duration_sec, served_at)
     VALUES ($1, $2, NOW() - ($3 || ' days')::interval)
     RETURNING id`,
    [OFFICE, durationSec, daysAgo.toString()],
  );
  await db.client.query(
    `INSERT INTO service_history_txn_types (service_history_id, txn_type_id) VALUES ($1, $2)`,
    [rows[0].id, txnTypeId],
  );
}

describe("generateDurationRecommendations", () => {
  beforeEach(async () => {
    await db.client.query(`DELETE FROM duration_recommendations`);
    await db.client.query(`DELETE FROM service_history_txn_types`);
    await db.client.query(`DELETE FROM service_history`);
    await db.client.query(
      `UPDATE config SET duration_lookback_days = 30, duration_min_samples = 10, duration_threshold_pct = 15`,
    );
  });

  test("generates recommendation when actual avg diverges from configured", async () => {
    // ID card is configured at 15 min. Insert 12 samples averaging 30 min (1800 sec).
    for (let i = 0; i < 12; i++) {
      await insertServiceHistory(TXN_TYPE_ID_CARD, 1800, i + 1);
    }

    const results = await generateDurationRecommendations(db.client);

    expect(results).toHaveLength(1);
    expect(results[0].txnTypeId).toBe(TXN_TYPE_ID_CARD);
    expect(results[0].currentAvgMin).toBe(15);
    expect(results[0].recommendedAvgMin).toBe(30);
    expect(results[0].sampleSize).toBe(12);

    // Verify it was persisted
    const { rows } = await db.client.query<{ status: string; recommended_avg_min: number }>(
      `SELECT status, recommended_avg_min FROM duration_recommendations WHERE txn_type_id = $1`,
      [TXN_TYPE_ID_CARD],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].recommended_avg_min).toBe(30);
  });

  test("does not generate recommendation when difference is below threshold", async () => {
    // 15 min configured, insert samples at 16 min (960 sec) — only ~7% off
    for (let i = 0; i < 12; i++) {
      await insertServiceHistory(TXN_TYPE_ID_CARD, 960, i + 1);
    }

    const results = await generateDurationRecommendations(db.client);

    expect(results).toHaveLength(0);
  });

  test("does not generate recommendation when sample count is too low", async () => {
    // Only 5 samples at 30 min — below the minSamples threshold of 10
    for (let i = 0; i < 5; i++) {
      await insertServiceHistory(TXN_TYPE_ID_CARD, 1800, i + 1);
    }

    const results = await generateDurationRecommendations(db.client);

    expect(results).toHaveLength(0);
  });

  test("overwrites pending recommendation with fresher data", async () => {
    // First run: 12 samples at 30 min
    for (let i = 0; i < 12; i++) {
      await insertServiceHistory(TXN_TYPE_ID_CARD, 1800, i + 1);
    }
    const first = await generateDurationRecommendations(db.client);
    expect(first).toHaveLength(1);
    expect(first[0].recommendedAvgMin).toBe(30);

    // Add more samples pushing the average toward 24 min (1440 sec)
    await db.client.query(`DELETE FROM service_history_txn_types`);
    await db.client.query(`DELETE FROM service_history`);
    for (let i = 0; i < 12; i++) {
      await insertServiceHistory(TXN_TYPE_ID_CARD, 1440, i + 1);
    }

    const second = await generateDurationRecommendations(db.client);
    expect(second).toHaveLength(1);
    expect(second[0].recommendedAvgMin).toBe(24);

    // Verify only one pending row exists with the updated value
    const { rows } = await db.client.query<{
      status: string;
      recommended_avg_min: number;
      count: string;
    }>(
      `SELECT status, recommended_avg_min, COUNT(*)::text AS count FROM duration_recommendations WHERE txn_type_id = $1 GROUP BY status, recommended_avg_min`,
      [TXN_TYPE_ID_CARD],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].recommended_avg_min).toBe(24);
    expect(rows[0].count).toBe("1");
  });
});
