-- Scheduling Engine Queries
-- These are the queries the heatmap/capacity endpoints run.
-- Substitute officeId = 1, date = '2026-05-12', countyId = 'stlucie' as needed.
-- All queries filter on county_id even though RLS enforces tenant isolation —
-- explicit filters keep query plans tight and protect against missing
-- session GUC (`app.current_tenant`) in non-request contexts (jobs, repls).
--
-- Override model (per writeup): per-office transaction_types rows can override
-- the global row's `available_from`, `available_until`, and `status` (e.g.
-- mark 'hidden' to drop the txn at one office). Duration (avg_duration_min)
-- is treated as GLOBAL — overriding it would force per-office blocks_needed
-- and break the constant-width window-function fit check, which is not worth
-- the complexity until a real duration-override use case shows up.

-- =============================================================================
-- 1. Get office config
-- =============================================================================
SELECT id, office_name, name, total_desks, run_rate_pct
FROM offices
WHERE county_id = 'stlucie' AND id = 1;

-- =============================================================================
-- 2. Get office hours (find open/close for that day of week)
-- =============================================================================
SELECT day_of_week, open_time::text, close_time::text
FROM office_hours
WHERE county_id = 'stlucie' AND office_id = 1
ORDER BY day_of_week;

-- =============================================================================
-- 3. Get lunch shifts
-- =============================================================================
SELECT id, shift_num, start_time::text, end_time::text
FROM office_lunch_shifts
WHERE county_id = 'stlucie' AND office_id = 1
ORDER BY start_time;

-- =============================================================================
-- 4. Get active transaction types effective at an office
--    Reads from effective_transaction_types view, which resolves the global
--    row + office-specific overrides. status reflects the effective row, so
--    a 'hidden' override at this office drops the txn from the result.
-- =============================================================================
SELECT global_id AS id, txn_type_id, name, avg_duration_min,
       available_from::text, available_until::text
FROM effective_transaction_types
WHERE county_id = 'stlucie'
  AND office_id = 1
  AND status    = 'active'
ORDER BY global_id;

-- =============================================================================
-- 5. Get appointments for the day (with computed end times)
--    Reads from appointment_durations.
-- =============================================================================
SELECT id,
       appointment_time::text,
       total_duration_min,
       end_at::text,
       txn_type_ids
FROM appointment_durations
WHERE county_id = 'stlucie'
  AND office_id = 1
  AND appointment_date = '2026-05-12'
  AND status NOT IN ('cancelled', 'no_show');

-- =============================================================================
-- 6. Get scheduled clerks with lunch shift for a given skill
--    Run once per txn type. Example: skill id = 1 (road test)
-- =============================================================================
SELECT c.id as clerk_id, cs.lunch_shift_id
FROM clerk_schedules cs
JOIN clerks c ON c.id = cs.clerk_id AND c.county_id = cs.county_id
WHERE cs.county_id = 'stlucie'
  AND cs.office_id = 1
  AND cs.schedule_date = '2026-05-12'
  AND 1 = ANY(c.skill_ids)
  AND c.status = 'active';

-- =============================================================================
-- 7. Count concurrent appointments needing a skill at a specific time
--    Example: skill_id = 1, time = 08:00 on 2026-05-12.
-- =============================================================================
-- Note: in the app this is done in a loop, not SQL. This is the SQL equivalent.
-- Uses appointment_durations.start_at / end_at (TIMESTAMPs, midnight-safe).
SELECT count(*) AS concurrent
FROM appointment_durations ad
WHERE ad.county_id = 'stlucie'
  AND ad.office_id = 1
  AND ad.appointment_date = '2026-05-12'
  AND ad.status NOT IN ('cancelled', 'no_show')
  AND 1 = ANY(ad.txn_type_ids)
  AND ad.start_at <= TIMESTAMP '2026-05-12 08:00'
  AND ad.end_at   >  TIMESTAMP '2026-05-12 08:00';

-- =============================================================================
-- 8. Booking query (CTE variant): same logic, no function dependency
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

-- Per-day open/close window, scoped to offices that offer all target skills
office_window AS (
  SELECT offices.id AS office_id,
         offices.run_rate_pct,
         target_dates.date,
         office_hours.open_time,
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
            JOIN clerks ON clerks.id         = clerk_schedules.clerk_id
                       AND clerks.county_id = clerk_schedules.county_id
            LEFT JOIN office_lunch_shifts
                   ON office_lunch_shifts.id        = clerk_schedules.lunch_shift_id
                  AND office_lunch_shifts.county_id = clerk_schedules.county_id
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
-- Reads from appointment_durations view, which precomputes end_time per appt.
demand AS (
  SELECT supply.office_id, supply.date, supply.block_time, supply.skill_id,
         (SELECT count(*)
          FROM appointment_durations ad
          WHERE ad.county_id        = params.county_id
            AND ad.office_id        = supply.office_id
            AND ad.appointment_date = supply.date
            AND ad.status NOT IN ('cancelled', 'no_show')
            AND supply.skill_id      = ANY(ad.txn_type_ids)
            AND ad.appointment_time <= supply.block_time
            AND ad.end_time          > supply.block_time) AS demand
  FROM supply
  CROSS JOIN params
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
-- blocks_needed is global (constant), so a window MIN works again.
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

-- Apply per-office txn-window gating: zero out slots whose start is before
-- that office's effective earliest_start, or whose end (start + global
-- total_duration) runs past that office's effective latest_end.
heatmap AS (
  SELECT fits.office_id,
         fits.slot_date,
         fits.slot_time,
         CASE
           WHEN otw.earliest_start IS NOT NULL
                AND fits.slot_time < otw.earliest_start THEN 0
           WHEN otw.latest_end IS NOT NULL
                AND (fits.slot_time + (txn_window.total_duration_min || ' minutes')::interval)::time
                    > otw.latest_end THEN 0
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
