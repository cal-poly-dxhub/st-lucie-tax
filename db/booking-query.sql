-- Scheduling Engine Queries
-- The booking heatmap (this file) is read-only. Confirm-time capacity
-- recheck + INSERT lives in the book_appointment(...) PL/pgSQL function in
-- schema.sql, which locks clerk_schedules for the (office, date) and re-runs
-- supply/demand for the requested slot atomically.

-- =============================================================================
-- Booking heatmap query (CTE variant)
-- =============================================================================
-- Inputs (params CTE):
--   county_id        : tenant — every config/transactional table is filtered
--                      on this. RLS will also enforce it via app.current_tenant.
--   target_skills    : skills the booking needs, e.g. ARRAY[1,3]. Surrogate
--                      ids of GLOBAL (office_id IS NULL) txn_types rows.
--   asap             : if TRUE, ignore preferences and return earliest slot first
--   preferred_office : office_id (NULL = any office)
--   preferred_dow    : day of week 0=Sun..6=Sat (NULL = any)
--   preferred_time   : 'morning' (< 12:00), 'afternoon' (>= 12:00), or NULL = any
--   start_date, days : how far ahead to look
--   block_min        : grid resolution in minutes
-- =============================================================================
WITH params AS (
  SELECT
    'stlucie'::text   AS county_id,
    ARRAY[1]          AS target_skills,
    FALSE             AS asap,                -- TRUE = earliest slot, any office
    1::int            AS preferred_office,    -- NULL = any
    2::int            AS preferred_dow,       -- 0=Sun..6=Sat, NULL = any
    'morning'::text   AS preferred_time,      -- 'morning' | 'afternoon' | NULL
    15                AS block_min,
    DATE '2026-05-12' AS start_date,
    14                AS days
),

-- Global txn window: duration is global, so blocks_needed is constant across
-- offices. earliest_start / latest_end here are the global defaults — offices
-- can tighten them via overrides (handled in office_txn_window below).
txn_window AS (
  SELECT
    SUM(g.avg_duration_min)::int                            AS total_duration_min,
    CEIL(SUM(g.avg_duration_min)::numeric / params.block_min)::int AS blocks_needed
  FROM transaction_types g
  CROSS JOIN params
  WHERE g.county_id  = params.county_id
    AND g.office_id IS NULL
    AND g.id         = ANY(params.target_skills)
    AND g.status     = 'active'
  GROUP BY params.block_min
),

-- Per-office available_from/until after applying overrides. Reads from the
-- effective_transaction_types view, which resolves global + override per
-- (office, skill). HAVING drops offices that don't offer ALL requested
-- skills as 'active' (a 'hidden' override at one office removes that row).
office_txn_window AS (
  SELECT
    ett.office_id,
    MAX(ett.available_from)  AS earliest_start,
    MIN(ett.available_until) AS latest_end
  FROM effective_transaction_types ett
  CROSS JOIN params
  WHERE ett.county_id = params.county_id
    AND ett.global_id = ANY(params.target_skills)
    AND ett.status    = 'active'
  GROUP BY ett.office_id
  HAVING COUNT(*) = (SELECT cardinality(target_skills) FROM params)
),

-- One row per date in the lookahead window. `days` is inclusive: days=14
-- yields 14 dates [start_date .. start_date + 13].
target_dates AS (
  SELECT d::date AS date
  FROM params
  CROSS JOIN generate_series(
    (SELECT start_date FROM params),
    (SELECT start_date + days - 1 FROM params),
    interval '1 day'
  ) d
),

-- Per-day open/close window, scoped to offices that offer all target skills.
-- Carries close_time downstream so the heatmap can gate slots whose end runs
-- past office close (using full timestamps to avoid 24h-wrap bugs).
office_window AS (
  SELECT offices.id AS office_id,
         offices.run_rate_pct,
         target_dates.date,
         office_hours.open_time,
         office_hours.close_time,
         EXTRACT(EPOCH FROM (office_hours.close_time - office_hours.open_time))::int / 60
           AS minutes_open
  FROM offices
  CROSS JOIN params
  CROSS JOIN target_dates
  JOIN office_txn_window ON office_txn_window.office_id = offices.id
  JOIN office_hours
    ON office_hours.office_id   = offices.id
   AND office_hours.county_id   = params.county_id
   AND office_hours.day_of_week = EXTRACT(DOW FROM target_dates.date)::int
  WHERE offices.county_id = params.county_id
),

-- The grid: every block_time within every (office, date) window. close_time
-- is carried so downstream gating can compare against full timestamps.
blocks AS (
  SELECT office_window.office_id,
         office_window.run_rate_pct,
         office_window.date,
         office_window.close_time,
         (office_window.open_time + (n || ' minutes')::interval)::time AS block_time
  FROM office_window
  CROSS JOIN params
  CROSS JOIN generate_series(0, office_window.minutes_open - params.block_min, params.block_min) AS n
),

-- Supply per skill per block: clerks with that skill scheduled at office/date,
-- not on a lunch shift overlapping block_time, scaled by run_rate_pct. The
-- lunch_shifts join is constrained to the SAME office so a foreign office's
-- lunch window can't suppress this clerk's supply.
supply AS (
  SELECT blocks.office_id, blocks.date, blocks.block_time, target_skill.skill_id,
         FLOOR(
           (SELECT count(*)
            FROM clerk_schedules
            JOIN clerks ON clerks.id         = clerk_schedules.clerk_id
                       AND clerks.county_id = clerk_schedules.county_id
            LEFT JOIN office_lunch_shifts
                   ON office_lunch_shifts.id        = clerk_schedules.lunch_shift_id
                  AND office_lunch_shifts.county_id = clerk_schedules.county_id
                  AND office_lunch_shifts.office_id = clerk_schedules.office_id
            WHERE clerk_schedules.county_id     = params.county_id
              AND clerk_schedules.office_id     = blocks.office_id
              AND clerk_schedules.schedule_date = blocks.date
              AND target_skill.skill_id          = ANY(clerks.skill_ids)
              AND clerks.status                  = 'active'
              AND (office_lunch_shifts.id IS NULL
                OR NOT (office_lunch_shifts.start_time <= blocks.block_time
                    AND office_lunch_shifts.end_time   >  blocks.block_time)))
           * blocks.run_rate_pct / 100.0
         )::int AS supply
  FROM blocks
  CROSS JOIN params
  CROSS JOIN unnest(params.target_skills) AS target_skill(skill_id)
),

-- Live demand: overlapping appts that need this skill (start <= t AND end > t).
-- Reads from appointment_durations view; start_at/end_at are TIMESTAMPs so the
-- comparison is midnight-safe (vs. the time-of-day form, which wraps at 24h).
demand AS (
  SELECT supply.office_id, supply.date, supply.block_time, supply.skill_id,
         (SELECT count(*)
          FROM appointment_durations ad
          WHERE ad.county_id        = params.county_id
            AND ad.office_id        = supply.office_id
            AND ad.appointment_date = supply.date
            AND ad.status NOT IN ('cancelled', 'no_show')
            AND supply.skill_id      = ANY(ad.txn_type_ids)
            AND ad.start_at <= (supply.date + supply.block_time)::timestamp
            AND ad.end_at   >  (supply.date + supply.block_time)::timestamp) AS demand
  FROM supply
  CROSS JOIN params
),

-- Multi-skill collapse: appt needing skills [1,3] needs BOTH simultaneously.
-- Take MIN(supply - demand) across the requested skills.
min_per_block AS (
  SELECT supply.office_id, supply.date, supply.block_time,
         MIN(GREATEST(supply.supply - demand.demand, 0)) AS available,
         MIN(blocks.close_time) AS close_time
  FROM supply
  JOIN demand
    ON demand.office_id  = supply.office_id
   AND demand.date       = supply.date
   AND demand.block_time = supply.block_time
   AND demand.skill_id   = supply.skill_id
  JOIN blocks
    ON blocks.office_id  = supply.office_id
   AND blocks.date       = supply.date
   AND blocks.block_time = supply.block_time
  GROUP BY supply.office_id, supply.date, supply.block_time
),

-- Multi-block fit: a 30-min appt at 14:45 needs 14:45 AND 15:00 available.
-- blocks_needed is global (constant), so a window MIN works again.
fits AS (
  SELECT min_per_block.office_id,
         min_per_block.date AS slot_date,
         min_per_block.block_time AS slot_time,
         min_per_block.close_time,
         MIN(min_per_block.available) OVER (
           PARTITION BY min_per_block.office_id, min_per_block.date
           ORDER BY min_per_block.block_time
           ROWS BETWEEN CURRENT ROW
                    AND ((SELECT blocks_needed FROM txn_window) - 1) FOLLOWING
         ) AS available_through_appt
  FROM min_per_block
),

-- Apply gating, all using full timestamps so cross-midnight / 24:00 cases
-- don't silently wrap:
--   1. Slot must start at or after the per-office earliest_start (txn override).
--   2. Slot end (start + global total_duration) must be at or before the
--      per-office latest_end (txn override) AND at or before the office close.
heatmap AS (
  SELECT fits.office_id,
         fits.slot_date,
         fits.slot_time,
         CASE
           WHEN otw.earliest_start IS NOT NULL
                AND fits.slot_time < otw.earliest_start THEN 0
           WHEN otw.latest_end IS NOT NULL
                AND (fits.slot_date + fits.slot_time
                     + (txn_window.total_duration_min * interval '1 minute'))::timestamp
                    > (fits.slot_date + otw.latest_end)::timestamp THEN 0
           WHEN (fits.slot_date + fits.slot_time
                 + (txn_window.total_duration_min * interval '1 minute'))::timestamp
                > (fits.slot_date + fits.close_time)::timestamp THEN 0
           ELSE fits.available_through_appt
         END AS available
  FROM fits
  JOIN office_txn_window otw ON otw.office_id = fits.office_id
  CROSS JOIN txn_window
)

SELECT
  heatmap.office_id,
  heatmap.slot_date,
  heatmap.slot_time,
  heatmap.available
FROM heatmap
CROSS JOIN params
WHERE heatmap.available > 0
ORDER BY
  CASE WHEN params.asap THEN heatmap.slot_date END NULLS LAST,
  CASE WHEN params.asap THEN heatmap.slot_time END NULLS LAST,
  CASE WHEN params.asap OR params.preferred_office IS NULL THEN 0
       WHEN heatmap.office_id = params.preferred_office THEN 0
       ELSE 1 END,
  CASE WHEN params.asap OR params.preferred_dow IS NULL THEN 0
       WHEN EXTRACT(DOW FROM heatmap.slot_date)::int = params.preferred_dow THEN 0
       ELSE 1 END,
  CASE WHEN params.asap OR params.preferred_time IS NULL THEN 0
       WHEN params.preferred_time = 'morning'   AND heatmap.slot_time <  TIME '12:00' THEN 0
       WHEN params.preferred_time = 'afternoon' AND heatmap.slot_time >= TIME '12:00' THEN 0
       ELSE 1 END,
  heatmap.slot_date, heatmap.slot_time, heatmap.office_id
LIMIT 20;
