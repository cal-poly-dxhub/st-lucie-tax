-- =============================================================================
-- Booking validation query (single-slot)
-- =============================================================================
-- Given a specific (county, office, date, time, skills), validates the slot is
-- still bookable using validate_slot() — the same change-point capacity sweep
-- that find_appointment and book_appointment use.
--
-- Returns one row with `available` > 0 if bookable, or no rows if not.
-- Intended as a read-only pre-check before calling book_appointment().
--
-- Inputs (edit the params CTE for psql exploration):
--   county_id    : tenant
--   office_id    : the specific office
--   slot_date    : the date of the appointment
--   slot_time    : the start time of the appointment
--   target_skills: skills the booking needs, e.g. ARRAY[1,3]
--   now_ts       : "current time" used to reject past slots
-- =============================================================================
WITH params AS (
  SELECT
    'stlucie'::text              AS county_id,
    1::int                       AS office_id,
    DATE '2026-05-12'            AS slot_date,       -- Tuesday in seed range
    TIME '10:00'                 AS slot_time,       -- slot found by find_appointment with seed(0.42)
    ARRAY[1,2]                   AS target_skills,   -- road_test + id_card
    TIMESTAMP '2026-05-12 06:00' AS now_ts           -- production callers pass NOW()
),
duration AS (
  SELECT SUM(g.avg_duration_min)::int AS total_min
  FROM transaction_types g
  CROSS JOIN params
  WHERE g.county_id  = params.county_id
    AND g.office_id IS NULL
    AND g.id         = ANY(params.target_skills)
    AND g.status     = 'active'
)
SELECT
  params.office_id,
  params.slot_date,
  params.slot_time,
  validate_slot(
    params.county_id, params.office_id, params.slot_date,
    params.slot_time, params.target_skills, duration.total_min
  ) AS available
FROM params, duration
WHERE (params.slot_date + params.slot_time)::timestamp > params.now_ts
  AND validate_slot(
    params.county_id, params.office_id, params.slot_date,
    params.slot_time, params.target_skills, duration.total_min
  ) > 0;
