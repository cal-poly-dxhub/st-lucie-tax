-- =============================================================================
-- find_appointment: scheduling engine (decomposed)
-- =============================================================================
-- Returns ONE bookable slot matching the user's preferences, or no rows.
-- Preferences are hard filters, we return an empty result if no appt fits criteria.
--
-- Packing model where each new appt must build on a prior one.
--  Possible start times are:
--   1. office open_time (first-of-day slot)
--   2. end_time of each lunch shift (capacity returns post-lunch)
--   3. end time of every existing non-cancelled appointment that day
--
-- Capacity check to ensure that any appt has one available clerk for the entire appt time.
--  We walk every change-point inside [start, start+duration) and require >= 1 free clerk at all of them.
--   Change-points occur when:
--    1. The appointment starts (baseline capacity check)
--    2. A lunch shift begins inside the window (supply drops)
--    3. Another appointment begins inside the window (demand rises)

-- =============================================================================
-- 1. get_required_appointment_profile
-- =============================================================================
-- Resolves the appointment's scheduling profile from the requested transaction
-- types: total duration, skill count, and the joint transaction time window
-- (tightest available_from/until across all requested types).
CREATE OR REPLACE FUNCTION get_required_appointment_profile(
  p_county_id      TEXT,
  p_target_skills  INT[],
  OUT duration_min       INT,
  OUT n_skills           INT,
  OUT txn_earliest_start TIME,
  OUT txn_latest_end     TIME
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  n_skills := cardinality(p_target_skills);

  SELECT SUM(g.avg_duration_min)::int,
         MAX(g.available_from),
         MIN(g.available_until)
    INTO duration_min, txn_earliest_start, txn_latest_end
  FROM transaction_types g
  WHERE g.county_id  = p_county_id
    AND g.office_id IS NULL
    AND g.id        = ANY(p_target_skills)
    AND g.status    = 'active';
END;
$$;

-- =============================================================================
-- 2. eligible_offices
-- =============================================================================
-- Returns offices that can handle ALL requested transaction types (every skill
-- is effectively active at the office). Applies the preferred_office filter
-- unless p_asap is true.
CREATE OR REPLACE FUNCTION eligible_offices(
  p_county_id        TEXT,
  p_target_skills    INT[],
  p_n_skills         INT,
  p_asap             BOOLEAN DEFAULT FALSE,
  p_preferred_office INT     DEFAULT NULL
) RETURNS TABLE (
  office_id       INT,
  run_rate_pct    INT,
  earliest_start  TIME,
  latest_end      TIME
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id,
         o.run_rate_pct,
         MAX(ett.available_from)  AS earliest_start,
         MIN(ett.available_until) AS latest_end
  FROM offices o
  JOIN effective_transaction_types ett
    ON ett.county_id = o.county_id
   AND ett.office_id = o.id
   AND ett.global_id = ANY(p_target_skills)
   AND ett.status    = 'active'
  WHERE o.county_id = p_county_id
    AND (p_asap OR p_preferred_office IS NULL OR o.id = p_preferred_office)
  GROUP BY o.id, o.run_rate_pct
  HAVING COUNT(*) = p_n_skills;
END;
$$;

-- =============================================================================
-- 3. appointment_candidates
-- =============================================================================
-- Generates (office, date, time) candidate slots across a date range for
-- eligible offices. Applies DOW, time-of-day, office-hours, transaction-window,
-- and past-slot filters. Results ordered chronologically.
CREATE OR REPLACE FUNCTION appointment_candidates(
  p_county_id        TEXT,
  p_target_skills    INT[],
  p_n_skills         INT,
  p_total_duration   INT,
  p_asap             BOOLEAN DEFAULT FALSE,
  p_preferred_office INT     DEFAULT NULL,
  p_preferred_dow    INT     DEFAULT NULL,
  p_preferred_time   TEXT    DEFAULT NULL,
  p_start_date       DATE    DEFAULT CURRENT_DATE,
  p_days             INT     DEFAULT 180,
  p_now_ts           TIMESTAMP DEFAULT NOW()
) RETURNS TABLE (
  office_id   INT,
  slot_date   DATE,
  slot_time   TIME
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH dates AS (
    SELECT d::date AS dt
    FROM generate_series(p_start_date, p_start_date + p_days - 1,
                         interval '1 day') d
    WHERE p_asap
       OR p_preferred_dow IS NULL
       OR EXTRACT(DOW FROM d)::int = p_preferred_dow
  ),
  offices AS (
    SELECT eo.*
    FROM eligible_offices(p_county_id, p_target_skills, p_n_skills,
                          p_asap, p_preferred_office) eo
  ),
  candidates AS (
    SELECT oc.office_id,
           oc.earliest_start,
           oc.latest_end,
           d.dt             AS slot_date,
           oh.open_time,
           oh.close_time,
           cand.candidate_time AS slot_time
    FROM offices oc
    CROSS JOIN dates d
    JOIN office_hours oh
      ON oh.county_id   = p_county_id
     AND oh.office_id   = oc.office_id
     AND oh.day_of_week = EXTRACT(DOW FROM d.dt)::int
    CROSS JOIN LATERAL (
        SELECT oh.open_time AS candidate_time
      UNION
        SELECT ols.end_time
        FROM office_lunch_shifts ols
        WHERE ols.county_id = p_county_id
          AND ols.office_id = oc.office_id
      UNION
        SELECT ad.end_at::time
        FROM appointment_durations ad
        WHERE ad.county_id        = p_county_id
          AND ad.office_id        = oc.office_id
          AND ad.appointment_date = d.dt
          AND ad.status NOT IN ('cancelled', 'no_show')
    ) cand
  )
  SELECT c.office_id, c.slot_date, c.slot_time
  FROM candidates c
  WHERE
    (p_asap
     OR p_preferred_time IS NULL
     OR (p_preferred_time = 'morning'   AND c.slot_time <  TIME '12:00')
     OR (p_preferred_time = 'afternoon' AND c.slot_time >= TIME '12:00'))
    AND (c.slot_date + c.slot_time)::timestamp > p_now_ts
    AND c.slot_time >= c.open_time
    AND (c.slot_date + c.slot_time + (p_total_duration * interval '1 minute'))::timestamp
        <= (c.slot_date + c.close_time)::timestamp
    AND (c.earliest_start IS NULL OR c.slot_time >= c.earliest_start)
    AND (c.latest_end IS NULL
      OR (c.slot_date + c.slot_time + (p_total_duration * interval '1 minute'))::timestamp
         <= (c.slot_date + c.latest_end)::timestamp)
  ORDER BY c.slot_date, c.slot_time, c.office_id;
END;
$$;

-- =============================================================================
-- 4. validate_slot — defined in schema.sql (unchanged)
-- =============================================================================
-- validate_slot(county, office, date, time, skills, duration) → INT
-- Pure capacity check. Returns minimum available capacity across all
-- change-points in [time, time + duration). Returns 0 if no capacity.

-- =============================================================================
-- 5. find_appointment — orchestrator
-- =============================================================================
-- Ties everything together: resolves the appointment profile, generates
-- candidates, validates each with the change-point capacity sweep, and
-- returns the first valid slot.
CREATE OR REPLACE FUNCTION find_appointment(
  p_county_id        TEXT,
  p_target_skills    INT[],
  p_asap             BOOLEAN DEFAULT FALSE,
  p_preferred_office INT     DEFAULT NULL,
  p_preferred_dow    INT     DEFAULT NULL,   -- 0=Sun..6=Sat
  p_preferred_time   TEXT    DEFAULT NULL,   -- 'morning' | 'afternoon' | NULL
  p_start_date       DATE    DEFAULT CURRENT_DATE,
  p_days             INT     DEFAULT 180,
  p_now_ts           TIMESTAMP DEFAULT NOW()
) RETURNS TABLE (
  office_id  INT,
  slot_date  DATE,
  slot_time  TIME,
  available  INT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_profile   RECORD;
  v_cell      RECORD;
  v_min_avail INT;
BEGIN
  PERFORM 1 FROM counties WHERE id = p_county_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_profile
  FROM get_required_appointment_profile(p_county_id, p_target_skills);

  IF v_profile.duration_min IS NULL THEN RETURN; END IF;

  FOR v_cell IN
    SELECT ac.office_id, ac.slot_date, ac.slot_time
    FROM appointment_candidates(
      p_county_id, p_target_skills, v_profile.n_skills,
      v_profile.duration_min,
      p_asap, p_preferred_office, p_preferred_dow,
      p_preferred_time, p_start_date, p_days, p_now_ts
    ) ac
  LOOP
    v_min_avail := validate_slot(
      p_county_id, v_cell.office_id, v_cell.slot_date,
      v_cell.slot_time, p_target_skills, v_profile.duration_min
    );

    IF v_min_avail > 0 THEN
      office_id := v_cell.office_id;
      slot_date := v_cell.slot_date;
      slot_time := v_cell.slot_time;
      available := v_min_avail;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;

  RETURN;
END;
$$;
