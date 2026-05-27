-- =============================================================================
-- find_appointment: scheduling engine
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
  v_total_duration INT;
  v_n_skills       INT := cardinality(p_target_skills);
  v_cell           RECORD;
  v_min_avail      INT;
BEGIN
  -- Validate the county exists.
  PERFORM 1 FROM counties WHERE id = p_county_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Calculate appointment length based off transactions
  SELECT SUM(g.avg_duration_min)::int INTO v_total_duration
  FROM transaction_types g
  WHERE g.county_id  = p_county_id
    AND g.office_id IS NULL
    AND g.id        = ANY(p_target_skills)
    AND g.status    = 'active';

  IF v_total_duration IS NULL THEN RETURN; END IF;

  FOR v_cell IN
    -- Days within the lookahead that match preferred DOW (skipped under ASAP).
    WITH dates AS (
      SELECT d::date AS dt
      FROM generate_series(p_start_date, p_start_date + p_days - 1,
                           interval '1 day') d
      WHERE p_asap
         OR p_preferred_dow IS NULL
         OR EXTRACT(DOW FROM d)::int = p_preferred_dow
    ),
    -- Find offices that cover every requested skill
    -- Along with earliest_start and latest_end according to custom TXN windows
    -- If no custom TXN window, we default to NULL (Office hours decide eligibility)
    office_capability AS (
      SELECT o.id, o.run_rate_pct,
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
      HAVING COUNT(*) = v_n_skills
    ),
    -- Per (office, date) we find the possible times an appointment could start.
    -- Importantly they can start at office open, at the end of a lunch shift, and after another appointment
    -- given our packing approach.
    -- Sort by earliest appointment.
    candidates AS (
      SELECT oc.id            AS office_id,
             oc.run_rate_pct,
             oc.earliest_start,
             oc.latest_end,
             d.dt             AS slot_date,
             oh.open_time,
             oh.close_time,
             cand.candidate_time AS slot_time
      FROM office_capability oc
      -- Join every office with every possible date
      CROSS JOIN dates d
      JOIN office_hours oh
        ON oh.county_id   = p_county_id
       AND oh.office_id   = oc.id
       AND oh.day_of_week = EXTRACT(DOW FROM d.dt)::int
      CROSS JOIN LATERAL (
          -- First possible appt at office open
          SELECT oh.open_time AS candidate_time
        UNION
          -- End of every lunch shift new clerk could become available
          SELECT ols.end_time
          FROM office_lunch_shifts ols
          WHERE ols.county_id = p_county_id
            AND ols.office_id = oc.id
        UNION
          -- End of every existing non-cancelled appt, pack the next one
          -- right after.
          SELECT ad.end_at::time
          FROM appointment_durations ad
          WHERE ad.county_id        = p_county_id
            AND ad.office_id        = oc.id
            AND ad.appointment_date = d.dt
            AND ad.status NOT IN ('cancelled', 'no_show')
      ) cand
    )
    SELECT c.office_id, c.run_rate_pct, c.slot_date, c.slot_time
    FROM candidates c
    WHERE
      -- Time-of-day preference (skipped under ASAP).
      (p_asap
       OR p_preferred_time IS NULL
       OR (p_preferred_time = 'morning'   AND c.slot_time <  TIME '12:00')
       OR (p_preferred_time = 'afternoon' AND c.slot_time >= TIME '12:00'))
      -- Not in the past.
      AND (c.slot_date + c.slot_time)::timestamp > p_now_ts
      -- Within office hours start ≥ open and finish ≤ close.
      AND c.slot_time >= c.open_time
      AND (c.slot_date + c.slot_time + (v_total_duration * interval '1 minute'))::timestamp
          <= (c.slot_date + c.close_time)::timestamp
      -- Within the joint txn time window.
      AND (c.earliest_start IS NULL OR c.slot_time >= c.earliest_start)
      AND (c.latest_end IS NULL
        OR (c.slot_date + c.slot_time + (v_total_duration * interval '1 minute'))::timestamp
           <= (c.slot_date + c.latest_end)::timestamp)
    ORDER BY c.slot_date, c.slot_time, c.office_id
  LOOP
    -- Sweep across [slot_time, slot_time + duration) to look for points of change.
    -- We look for points where supply could drop (lunch start) or demand could rise
    -- (other appt starts), plus the start itself.
    -- We do this to ensure that there is at least one available clerk throughout
    -- the entire appointment.
    WITH change_points AS (
        SELECT v_cell.slot_time AS cp_t
      UNION
        SELECT ols.start_time
        FROM office_lunch_shifts ols
        WHERE ols.county_id = p_county_id
          AND ols.office_id = v_cell.office_id
          AND ols.start_time >  v_cell.slot_time
          AND ols.start_time
              <  (v_cell.slot_time + (v_total_duration || ' minutes')::interval)::time
      UNION
        SELECT ad.appointment_time
        FROM appointment_durations ad
        WHERE ad.county_id        = p_county_id
          AND ad.office_id        = v_cell.office_id
          AND ad.appointment_date = v_cell.slot_date
          AND ad.status NOT IN ('cancelled', 'no_show')
          AND ad.start_at >  (v_cell.slot_date + v_cell.slot_time)::timestamp
          AND ad.start_at <  (v_cell.slot_date + v_cell.slot_time
                              + (v_total_duration * interval '1 minute'))::timestamp
    )
    -- For each change-point, supply − demand. MIN across rows is the
    -- worst-case free capacity during the appointment, if any point has
    -- no free clerks, the slot is unbookable.
    SELECT MIN(GREATEST(
             FLOOR(
                -- Calculate supply as number of clerks with requested skills
                -- not on lunch, then apply run rate scaling to this number.
               (SELECT count(*)
                FROM clerk_schedules cs
                JOIN clerks c
                  ON c.id = cs.clerk_id AND c.county_id = cs.county_id
                LEFT JOIN office_lunch_shifts ols
                  ON ols.id        = cs.lunch_shift_id
                 AND ols.county_id = cs.county_id
                 AND ols.office_id = cs.office_id
                WHERE cs.county_id     = p_county_id
                  AND cs.office_id     = v_cell.office_id
                  AND cs.schedule_date = v_cell.slot_date
                  AND c.status         = 'active'
                  AND c.skill_ids     @> p_target_skills
                  AND (ols.id IS NULL
                    OR NOT (ols.start_time <= cp.cp_t
                        AND ols.end_time   >  cp.cp_t)))
               * v_cell.run_rate_pct / 100.0
             )::int
             -- Calculate demand as the number of appointments scheduled to be running
             -- at this block (each one consumes one clerk).
             -- Skill-agnostic on purpose: any active appt is using a clerk
             -- no matter the skills used by each clerk.
             - (SELECT count(*)::int
                FROM appointment_durations ad
                WHERE ad.county_id        = p_county_id
                  AND ad.office_id        = v_cell.office_id
                  AND ad.appointment_date = v_cell.slot_date
                  AND ad.status NOT IN ('cancelled', 'no_show')
                  AND ad.start_at <= (v_cell.slot_date + cp.cp_t)::timestamp
                  AND ad.end_at   >  (v_cell.slot_date + cp.cp_t)::timestamp),
             0
           ))::int
      INTO v_min_avail
    FROM change_points cp;

    IF v_min_avail > 0 THEN
      office_id := v_cell.office_id;
      slot_date := v_cell.slot_date;
      slot_time := v_cell.slot_time;
      available := v_min_avail;
      RETURN NEXT;
      RETURN;     -- short-circuit: stop the cursor, no more candidates visited
    END IF;
  END LOOP;

  -- Window exhausted. Caller relaxes a preference (or sets p_asap) and retries.
  RETURN;
END;
$$;
