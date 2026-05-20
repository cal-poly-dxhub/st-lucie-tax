-- Scheduling Engine Queries
-- The booking heatmap (this file) is read-only. Confirm-time capacity
-- recheck + INSERT lives in the book_appointment(...) PL/pgSQL function in
-- schema.sql, which locks clerk_schedules for the (office, date) and re-runs
-- supply/demand for the requested slot atomically.

-- =============================================================================
-- Booking heatmap query
-- =============================================================================
-- Inputs:
--   county_id        : tenant — every config/transactional table is filtered
--                      on this. RLS will also enforce it via app.current_tenant.
--   target_skills    : skills the booking needs, e.g. ARRAY[1,3]. Surrogate
--                      ids of txn_types rows.
--   asap             : if TRUE, ignore preferences and return earliest slot first
--                      across all offices/times.
--   preferred_office : office_id (NULL = any office)
--   preferred_dow    : day of week 0=Sun..6=Sat (NULL = any)
--   preferred_time   : 'morning' (< 12:00), 'afternoon' (>= 12:00), or NULL = any
--   start_date, days : date to start from, and how many days after to look
--   block_min        : grid resolution in minutes
--   now_ts           : "current time" used to hide slots in the past
-- =============================================================================
WITH params AS (
  SELECT
    'stlucie'::text              AS county_id,
    ARRAY[1,2]                     AS target_skills,
    FALSE                        AS asap,             -- TRUE = earliest slot, any office
    1::int                       AS preferred_office, -- NULL = any
    2::int                       AS preferred_dow,    -- 0=Sun..6=Sat, NULL = any
    'morning'::text              AS preferred_time,   -- 'morning' | 'afternoon' | NULL
    15                           AS block_min,
    DATE '2026-05-12'            AS start_date,       -- production callers pass CURRENT_DATE
    14                           AS days,
    TIMESTAMP '2026-05-12 06:00' AS now_ts            -- production callers pass NOW()
),

-- Computes the total number of minutes needed for a given set of txns
-- and the number of time blocks required.
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

-- Calculates the earliest a group of txns can start and
-- the latest they can end per office.
-- We go with the tightest window for sake of simplicity,
-- if Road Testing starts 9:30 and DL renewal at 9:00, the earliest
-- the multi transaction appt can be scheduled is 9:30.
office_txn_windows AS (
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

-- Returns a row for every date in the given range,
-- used in queries below.
target_dates AS (
  SELECT d::date AS date
  FROM params
  CROSS JOIN generate_series(
    (SELECT start_date FROM params),
    (SELECT start_date + days - 1 FROM params),
    interval '1 day'
  ) d
),

-- Returns per-office availability information (run_rate, open, close) for each target date per office.
office_daily_windows AS (
  SELECT offices.id AS office_id,
         offices.run_rate_pct,
         target_dates.date,
         office_hours.open_time,
         office_hours.close_time
  FROM offices
  CROSS JOIN params
  CROSS JOIN target_dates
  JOIN office_txn_windows ON office_txn_windows.office_id = offices.id
  JOIN office_hours
    ON office_hours.office_id   = offices.id
   AND office_hours.county_id   = params.county_id
   AND office_hours.day_of_week = EXTRACT(DOW FROM target_dates.date)::int
  WHERE offices.county_id = params.county_id
),

-- Creates a grid of times in block_min increments. Allows us to assign capacities to specific appointment blocks.
blocks AS (
  SELECT office_daily_windows.office_id,
         office_daily_windows.run_rate_pct,
         office_daily_windows.date,
         office_daily_windows.close_time,
         (office_daily_windows.open_time + (n || ' minutes')::interval)::time AS block_time
  FROM office_daily_windows
  CROSS JOIN params -- Add params to every row
  -- Create one row per block from open until close (without running over).
  CROSS JOIN generate_series(
    0,
    EXTRACT(EPOCH FROM (office_daily_windows.close_time - office_daily_windows.open_time))::int / 60
      - params.block_min,
    params.block_min
  ) AS n
),


-- Calculates the number of clerks that can do a specific skill
-- for a given time block. One row for every office, date, block_time, and skill id.
supply AS (
  SELECT blocks.office_id, blocks.date, blocks.block_time, target_skill.skill_id,
         FLOOR(
           (SELECT count(*)
            FROM clerk_schedules
            JOIN clerks ON clerks.id         = clerk_schedules.clerk_id
                       AND clerks.county_id = clerk_schedules.county_id
            LEFT JOIN office_lunch_shifts -- keep clerks with no assigned lunch
                   ON office_lunch_shifts.id        = clerk_schedules.lunch_shift_id
                  AND office_lunch_shifts.county_id = clerk_schedules.county_id
                  AND office_lunch_shifts.office_id = clerk_schedules.office_id
            WHERE clerk_schedules.county_id     = params.county_id
              AND clerk_schedules.office_id     = blocks.office_id
              AND clerk_schedules.schedule_date = blocks.date
              AND target_skill.skill_id          = ANY(clerks.skill_ids) -- Clerk has given skill
              AND clerks.status                  = 'active'
              -- Remove clerks who are out at lunch
              AND (office_lunch_shifts.id IS NULL
                OR NOT (office_lunch_shifts.start_time <= blocks.block_time
                    AND office_lunch_shifts.end_time   >  blocks.block_time)))
           * blocks.run_rate_pct / 100.0 -- Scale by run rate pct
         )::int AS supply
  FROM blocks
  CROSS JOIN params
  -- Pair every skill id with a given block
  CROSS JOIN unnest(params.target_skills) AS target_skill(skill_id)
),

-- Calculate demand as the number of appointments who are using
-- a given skill in a given time block.
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

-- Calculates the number of appointments that can start at a given
-- block time requiring all target_skills given current bookings.
min_per_block AS (
  SELECT supply.office_id, supply.date, supply.block_time,
         -- Resolves multiple transactions to ensure that all skills have capacity
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
--   1. Slot start must be strictly after now_ts (no booking in the past).
--   2. Slot must start at or after the per-office earliest_start (txn override).
--   3. Slot end (start + global total_duration) must be at or before the
--      per-office latest_end (txn override) AND at or before the office close.
heatmap AS (
  SELECT fits.office_id,
         fits.slot_date,
         fits.slot_time,
         CASE
           WHEN (fits.slot_date + fits.slot_time)::timestamp <= params.now_ts THEN 0
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
  JOIN office_txn_windows otw ON otw.office_id = fits.office_id
  CROSS JOIN txn_window
  CROSS JOIN params
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
