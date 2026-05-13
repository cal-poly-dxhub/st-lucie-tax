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
SELECT id, shift_num, start_time::text, end_time::text, clerk_count
FROM office_lunch_shifts WHERE office_id = 1 ORDER BY start_time;

-- =============================================================================
-- 4. Get active transaction types
-- =============================================================================
SELECT id, name, avg_duration_min
FROM transaction_types WHERE office_id IS NULL AND status = 'active' ORDER BY id;

-- =============================================================================
-- 5. Get appointments for the day (with computed end times)
-- =============================================================================
SELECT a.id, a.appointment_time::text,
       COALESCE((SELECT SUM(tt.avg_duration_min)
                 FROM unnest(a.txn_type_ids) AS tid
                 JOIN transaction_types tt ON tt.id = tid), 0) AS total_duration,
       a.txn_type_ids
FROM appointments a
WHERE a.office_id = 1
  AND a.appointment_date = '2026-05-12'
  AND a.status NOT IN ('cancelled', 'no_show');

-- =============================================================================
-- 6. Get scheduled clerks with lunch shift for a given skill
--    Run once per txn type. Example: skill id = 1 (road test)
-- =============================================================================
SELECT c.id, cs.lunch_shift_id
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
-- BONUS: Full utilization view for a day/office
-- Shows supply (total_clerks) vs demand (concurrent) per 15-min slot per skill
-- =============================================================================
WITH time_slots AS (
  SELECT generate_series(480, 1005, 15) AS t_min
),
appts AS (
  SELECT a.id, a.txn_type_ids,
         EXTRACT(HOUR FROM a.appointment_time)::int * 60 + EXTRACT(MINUTE FROM a.appointment_time)::int AS start_min,
         EXTRACT(HOUR FROM a.appointment_time)::int * 60 + EXTRACT(MINUTE FROM a.appointment_time)::int
           + COALESCE((SELECT SUM(tt.avg_duration_min) FROM unnest(a.txn_type_ids) tid JOIN transaction_types tt ON tt.id = tid), 0) AS end_min
  FROM appointments a
  WHERE a.office_id = 1 AND a.appointment_date = '2026-05-12'
    AND a.status NOT IN ('cancelled', 'no_show')
)
SELECT
  ts.t_min,
  LPAD((ts.t_min / 60)::text, 2, '0') || ':' || LPAD((ts.t_min % 60)::text, 2, '0') AS time,
  tt.id AS skill_id,
  tt.name AS skill_name,
  (SELECT count(*) FROM clerk_schedules cs JOIN clerks c ON c.id = cs.clerk_id
   WHERE cs.office_id = 1 AND cs.schedule_date = '2026-05-12'
     AND tt.id = ANY(c.skill_ids) AND c.status = 'active') AS total_clerks,
  count(ap.id) AS concurrent_demand
FROM time_slots ts
CROSS JOIN transaction_types tt
LEFT JOIN appts ap ON tt.id = ANY(ap.txn_type_ids)
  AND ap.start_min <= ts.t_min AND ap.end_min > ts.t_min
WHERE tt.office_id IS NULL AND tt.status = 'active'
GROUP BY ts.t_min, tt.id, tt.name
ORDER BY ts.t_min, tt.id;
