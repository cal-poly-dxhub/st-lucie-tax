-- Scheduling Engine Queries
-- These are the queries the heatmap/capacity endpoints run.
-- Substitute officeId = 1, date = '2026-05-12', countyId = 'stlucie' as needed.

-- =============================================================================
-- 1. Get office config
-- =============================================================================
SELECT id, office_name, name, total_desks, run_rate_pct
FROM offices WHERE id = 1;

-- =============================================================================
-- 2. Get office hours (find open/close for that day of week)
-- =============================================================================
SELECT day_of_week, open_time::text, close_time::text
FROM office_hours WHERE office_id = 1 ORDER BY day_of_week;

-- =============================================================================
-- 3. Get lunch shifts
-- =============================================================================
SELECT id, shift_num, start_time::text, end_time::text
FROM office_lunch_shifts WHERE office_id = 1 ORDER BY start_time;

-- =============================================================================
-- 4. Get active transaction types (with bookable time windows)
-- =============================================================================
SELECT id, name, avg_duration_min,
       available_from::text, available_until::text
FROM transaction_types WHERE office_id IS NULL AND status = 'active' ORDER BY id;

-- =============================================================================
-- 5. Get appointments for the day (with computed end times)
-- =============================================================================
SELECT a.id, a.appointment_time::text,
       COALESCE((SELECT SUM(tt.avg_duration_min)
                 FROM unnest(a.txn_type_ids) AS tid
                 JOIN transaction_types tt ON tt.id = tid), 0) AS total_duration,
       (a.appointment_time + (COALESCE((SELECT SUM(tt.avg_duration_min)
                                        FROM unnest(a.txn_type_ids) AS tid
                                        JOIN transaction_types tt ON tt.id = tid), 0)
                              * interval '1 minute'))::text AS end_time,
       a.txn_type_ids
FROM appointments a
WHERE a.office_id = 1
  AND a.appointment_date = '2026-05-12'
  AND a.status NOT IN ('cancelled', 'no_show');

-- =============================================================================
-- 6. Get scheduled clerks with lunch shift for a given skill
--    Run once per txn type. Example: skill id = 1 (road test)
-- =============================================================================
SELECT c.id as clerk_id, cs.lunch_shift_id
FROM clerk_schedules cs JOIN clerks c ON c.id = cs.clerk_id
WHERE cs.office_id = 1
  AND cs.schedule_date = '2026-05-12'
  AND 1 = ANY(c.skill_ids)
  AND c.status = 'active';

-- =============================================================================
-- 7. Count concurrent appointments needing a skill at a specific time
--    Example: skill_id = 1, time = 08:00 (minute 480)
-- =============================================================================
-- Note: in the app this is done in a loop, not SQL. This is the SQL equivalent.
SELECT count(*) AS concurrent
FROM appointments a
WHERE a.office_id = 1
  AND a.appointment_date = '2026-05-12'
  AND a.status NOT IN ('cancelled', 'no_show')
  AND 1 = ANY(a.txn_type_ids)
  AND (EXTRACT(HOUR FROM a.appointment_time)::int * 60 + EXTRACT(MINUTE FROM a.appointment_time)::int) <= 480
  AND (EXTRACT(HOUR FROM a.appointment_time)::int * 60 + EXTRACT(MINUTE FROM a.appointment_time)::int)
      + COALESCE((SELECT SUM(tt.avg_duration_min) FROM unnest(a.txn_type_ids) tid JOIN transaction_types tt ON tt.id = tid), 0) > 480;

-- =============================================================================
-- 8. Booking query (CTE variant): same logic, no function dependency
-- =============================================================================
-- Inputs (params CTE):
--   target_skills    : skills the booking needs, e.g. ARRAY[1,3]
--   asap             : if TRUE, ignore preferences and return earliest slot first
--   preferred_office : office_id (NULL = any office)
--   preferred_dow    : day of week 0=Sun..6=Sat (NULL = any)
--   preferred_time   : 'morning' (< 12:00), 'afternoon' (>= 12:00), or NULL = any
--   start_date, days : how far ahead to look
--   block_min        : grid resolution in minutes
-- =============================================================================
WITH params AS (
  SELECT
    ARRAY[1]          AS target_skills,
    FALSE             AS asap,                -- TRUE = earliest slot, any office
    1::int            AS preferred_office,    -- NULL = any
    2::int            AS preferred_dow,       -- 0=Sun..6=Sat, NULL = any
    'morning'::text   AS preferred_time,      -- 'morning' | 'afternoon' | NULL
    15                AS block_min,
    DATE '2026-05-12' AS start_date,
    14                AS days
),

-- Effective txn window across all requested skills + total duration + blocks_needed.
-- MAX/MIN ignore NULLs, so a NULL on any skill's available_from/available_until
-- means "that skill doesn't constrain that side."
--   earliest_start     = latest available_from across skills (slot must start at/after)
--   latest_end         = earliest available_until across skills (appt must end by)
--   total_duration_min = sum of avg_duration_min across skills
--   blocks_needed      = total_duration_min rounded UP to next block_min boundary
--                        e.g. 27 min on 15-min grid -> CEIL(27/15) = 2 blocks
txn_window AS (
  SELECT
    MAX(transaction_types.available_from)                                   AS earliest_start,
    MIN(transaction_types.available_until)                                  AS latest_end,
    SUM(transaction_types.avg_duration_min)::int                            AS total_duration_min,
    CEIL(SUM(transaction_types.avg_duration_min)::numeric / params.block_min)::int AS blocks_needed
  FROM transaction_types
  CROSS JOIN params
  WHERE transaction_types.id = ANY(params.target_skills)
  GROUP BY params.block_min
),

-- One row per date in the lookahead window
target_dates AS (
  SELECT d::date AS date
  FROM params
  CROSS JOIN generate_series(
    (SELECT start_date FROM params),
    (SELECT start_date + days FROM params),
    interval '1 day'
  ) d
),

-- Per-day open/close window per office (joined on day_of_week)
office_window AS (
  SELECT offices.id AS office_id,
         offices.run_rate_pct,
         target_dates.date,
         office_hours.open_time,
         EXTRACT(EPOCH FROM (office_hours.close_time - office_hours.open_time))::int / 60
           AS minutes_open
  FROM offices
  CROSS JOIN target_dates
  JOIN office_hours
    ON office_hours.office_id = offices.id
   AND office_hours.day_of_week = EXTRACT(DOW FROM target_dates.date)::int
),

-- The grid: every block_time within every (office, date) window
blocks AS (
  SELECT office_window.office_id,
         office_window.run_rate_pct,
         office_window.date,
         (office_window.open_time + (n || ' minutes')::interval)::time AS block_time
  FROM office_window
  CROSS JOIN params
  CROSS JOIN generate_series(0, office_window.minutes_open - params.block_min, params.block_min) AS n
),

-- Supply per skill per block: clerks with that skill scheduled at office/date,
-- not on a lunch shift overlapping block_time, scaled by run_rate_pct
supply AS (
  SELECT blocks.office_id, blocks.date, blocks.block_time, target_skill.skill_id,
         FLOOR(
           (SELECT count(*)
            FROM clerk_schedules
            JOIN clerks ON clerks.id = clerk_schedules.clerk_id
            LEFT JOIN office_lunch_shifts
                   ON office_lunch_shifts.id = clerk_schedules.lunch_shift_id
            WHERE clerk_schedules.office_id    = blocks.office_id
              AND clerk_schedules.schedule_date = blocks.date
              AND target_skill.skill_id = ANY(clerks.skill_ids)
              AND clerks.status = 'active'
              AND NOT (office_lunch_shifts.start_time <= blocks.block_time
                   AND office_lunch_shifts.end_time   >  blocks.block_time))
           * blocks.run_rate_pct / 100.0
         )::int AS supply
  FROM blocks
  CROSS JOIN params
  CROSS JOIN unnest(params.target_skills) AS target_skill(skill_id)
),

-- Live demand: overlapping appts that need this skill (start <= t AND end > t)
demand AS (
  SELECT supply.office_id, supply.date, supply.block_time, supply.skill_id,
         (SELECT count(*)
          FROM appointments
          WHERE appointments.office_id        = supply.office_id
            AND appointments.appointment_date = supply.date
            AND appointments.status NOT IN ('cancelled', 'no_show')
            AND supply.skill_id = ANY(appointments.txn_type_ids)
            AND appointments.appointment_time <= supply.block_time
            AND (appointments.appointment_time
                 + (COALESCE((SELECT SUM(transaction_types.avg_duration_min)
                              FROM unnest(appointments.txn_type_ids) AS tid
                              JOIN transaction_types ON transaction_types.id = tid), 0)
                    || ' minutes')::interval)::time > supply.block_time) AS demand
  FROM supply
),

-- Multi-skill collapse: appt needing skills [1,3] needs BOTH simultaneously.
-- Take MIN(supply - demand) across the requested skills.
min_per_block AS (
  SELECT supply.office_id, supply.date, supply.block_time,
         MIN(GREATEST(supply.supply - demand.demand, 0)) AS available
  FROM supply
  JOIN demand
    ON demand.office_id  = supply.office_id
   AND demand.date       = supply.date
   AND demand.block_time = supply.block_time
   AND demand.skill_id   = supply.skill_id
  GROUP BY supply.office_id, supply.date, supply.block_time
),

-- Multi-block fit: a 30-min appt at 14:45 needs 14:45 AND 15:00 available.
-- Window MIN across the next blocks_needed rows within (office, date).
fits AS (
  SELECT min_per_block.office_id,
         min_per_block.date AS slot_date,
         min_per_block.block_time AS slot_time,
         MIN(min_per_block.available) OVER (
           PARTITION BY min_per_block.office_id, min_per_block.date
           ORDER BY min_per_block.block_time
           ROWS BETWEEN CURRENT ROW
                    AND ((SELECT blocks_needed FROM txn_window) - 1) FOLLOWING
         ) AS available_through_appt
  FROM min_per_block
),

-- Apply txn-window gating: zero out slots whose start is before the effective
-- earliest_start, or whose end (start + total_duration) runs past latest_end.
heatmap AS (
  SELECT fits.office_id,
         fits.slot_date,
         fits.slot_time,
         CASE
           WHEN txn_window.earliest_start IS NOT NULL
                AND fits.slot_time < txn_window.earliest_start THEN 0
           WHEN txn_window.latest_end IS NOT NULL
                AND (fits.slot_time + (txn_window.total_duration_min || ' minutes')::interval)::time
                    > txn_window.latest_end THEN 0
           ELSE fits.available_through_appt
         END AS available
  FROM fits
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
