import { type Queryable } from "./utils.js";

export interface Recommendation {
  txnTypeId: number;
  txnName: string;
  currentAvgMin: number;
  recommendedAvgMin: number;
  sampleSize: number;
}

// Looks back over lookbackDays, keeps only txns with >= minSamples, and returns updates whose duration shifted by >= thresholdPct
export async function computeDurationUpdates(
  db: Queryable,
  lookbackDays: number,
  minSamples: number,
  thresholdPct: number,
): Promise<Recommendation[]> {
  const { rows: stats } = await db.query<{
    txn_type_id: number;
    txn_name: string;
    current_avg_min: number;
    actual_avg_sec: number;
    sample_size: number;
  }>(
    `SELECT tt.id AS txn_type_id,
            tt.name AS txn_name,
            tt.avg_duration_min AS current_avg_min,
            AVG(sh.duration_sec) AS actual_avg_sec,
            COUNT(*)::int AS sample_size
     FROM service_history sh
     JOIN service_history_txn_types sht ON sht.service_history_id = sh.id
     JOIN transaction_types tt ON tt.id = sht.txn_type_id
     WHERE sh.served_at >= NOW() - ($1 || ' days')::interval
       AND tt.office_id IS NULL
     GROUP BY tt.id, tt.name, tt.avg_duration_min
     HAVING COUNT(*) >= $2`,
    [lookbackDays.toString(), minSamples],
  );

  const updates: Recommendation[] = [];

  for (const row of stats) {
    const recommendedAvgMin = Math.round(row.actual_avg_sec / 60);
    if (recommendedAvgMin < 1) continue;

    const pctDiff = (Math.abs(recommendedAvgMin - row.current_avg_min) / row.current_avg_min) * 100;
    if (pctDiff < thresholdPct) continue;

    updates.push({
      txnTypeId: row.txn_type_id,
      txnName: row.txn_name,
      currentAvgMin: row.current_avg_min,
      recommendedAvgMin,
      sampleSize: row.sample_size,
    });
  }

  return updates;
}

// Fetches config, computes above-threshold updates, and overwrites any existing pending recommendation
export async function generateDurationRecommendations(db: Queryable): Promise<Recommendation[]> {
  const { rows: configRows } = await db.query<{
    duration_lookback_days: number;
    duration_min_samples: number;
    duration_threshold_pct: number;
  }>(`SELECT duration_lookback_days, duration_min_samples, duration_threshold_pct FROM config`);

  const {
    duration_lookback_days: lookbackDays,
    duration_min_samples: minSamples,
    duration_threshold_pct: thresholdPct,
  } = configRows[0];

  const updates = await computeDurationUpdates(db, lookbackDays, minSamples, thresholdPct);
  const recommendations: Recommendation[] = [];

  for (const update of updates) {
    await db.query(
      `INSERT INTO duration_recommendations (txn_type_id, current_avg_min, recommended_avg_min, sample_size)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (txn_type_id) WHERE status = 'pending'
       DO UPDATE SET current_avg_min = EXCLUDED.current_avg_min,
                     recommended_avg_min = EXCLUDED.recommended_avg_min,
                     sample_size = EXCLUDED.sample_size`,
      [update.txnTypeId, update.currentAvgMin, update.recommendedAvgMin, update.sampleSize],
    );

    recommendations.push(update);
  }

  return recommendations;
}
