-- St. Lucie Tax System — Schema
-- Source: docs/database-design.md

-- =============================================================================
-- Config Tables
-- =============================================================================

-- counties: per-tenant scheduling defaults. id is the same value used as
-- county_id everywhere else (RLS predicate, app.current_tenant GUC).
CREATE TABLE counties (
    id                       TEXT PRIMARY KEY,
    name                     TEXT NOT NULL,
    timezone                 TEXT NOT NULL DEFAULT 'America/New_York',
    scheduling_block_min     INT  NOT NULL DEFAULT 15
                             CHECK (scheduling_block_min > 0
                                AND scheduling_block_min <= 60),
    default_lookahead_days   INT  NOT NULL DEFAULT 14
                             CHECK (default_lookahead_days BETWEEN 1 AND 365)
);

CREATE TABLE offices (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_name     TEXT NOT NULL,
    name            TEXT NOT NULL,
    address         TEXT,
    total_desks     INT NOT NULL,
    run_rate_pct    INT NOT NULL DEFAULT 100,
    UNIQUE (county_id, office_name)
);

CREATE TABLE office_hours (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time       TIME NOT NULL,
    close_time      TIME NOT NULL,
    CHECK (open_time < close_time)
);
CREATE UNIQUE INDEX idx_office_hours_unique ON office_hours (county_id, office_id, day_of_week);

CREATE TABLE office_lunch_shifts (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    shift_num       INT NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    CHECK (start_time < end_time)
);

CREATE TABLE transaction_types (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    txn_type_id     TEXT NOT NULL,
    office_id       INT REFERENCES offices(id),
    name            TEXT NOT NULL,
    description     TEXT,
    avg_duration_min INT NOT NULL CHECK (avg_duration_min > 0),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'internal', 'hidden')),
    available_from  TIME,
    available_until TIME,
    is_online_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    online_redirect_url TEXT,
    UNIQUE NULLS NOT DISTINCT (county_id, txn_type_id, office_id),
    CHECK (available_from IS NULL OR available_until IS NULL OR available_from < available_until)
);

CREATE TABLE clerks (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    email           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'in_training', 'inactive')),
    skill_ids       INT[] NOT NULL DEFAULT '{}',
    office_ids      INT[] NOT NULL DEFAULT '{}',
    UNIQUE (email)
);
CREATE INDEX idx_clerks_skill_ids ON clerks USING GIN (skill_ids);

CREATE TABLE hotbuttons (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    sort_order      INT NOT NULL,
    label           TEXT NOT NULL,
    prompt          TEXT NOT NULL
);

CREATE TABLE prescreen_questions (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    txn_type_id     INT NOT NULL REFERENCES transaction_types(id),
    sort_order      INT NOT NULL,
    question_text   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_prescreen_unique ON prescreen_questions (county_id, txn_type_id, sort_order);

CREATE TABLE document_registry (
    county_id       TEXT NOT NULL,
    doc_id          TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    alternatives    TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (county_id, doc_id)
);

CREATE TABLE transaction_flows (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    txn_type_id     INT NOT NULL REFERENCES transaction_types(id),
    steps           JSONB NOT NULL,
    UNIQUE (county_id, txn_type_id)
);

-- =============================================================================
-- Transactional Tables
-- =============================================================================

CREATE TABLE appointments (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    contact_email   TEXT NOT NULL,
    contact_phone   TEXT NOT NULL,
    can_send_sms    BOOLEAN NOT NULL DEFAULT FALSE,
    requested_clerk_id INT REFERENCES clerks(id),
    txn_type_ids    INT[] NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    qr_code         TEXT,
    identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
    prescreen_completed BOOLEAN NOT NULL DEFAULT FALSE,
    prescreen_responses JSONB DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled', 'diverted_online')),
    is_walk_in      BOOLEAN NOT NULL DEFAULT FALSE,
    is_priority     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_appointments_qr ON appointments (qr_code) WHERE qr_code IS NOT NULL;
CREATE INDEX idx_appointments_schedule ON appointments (county_id, office_id, appointment_date, appointment_time);

CREATE TABLE documents (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    appointment_id  INT NOT NULL REFERENCES appointments(id),
    doc_id          TEXT,
    name            TEXT NOT NULL,
    s3_key          TEXT,
    ai_review_status TEXT CHECK (ai_review_status IN ('accept', 'reject')),
    ai_review_notes  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (county_id, doc_id) REFERENCES document_registry(county_id, doc_id)
);

CREATE TABLE queue (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    appointment_id  INT REFERENCES appointments(id),
    queue_number    INT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'serving', 'testing', 'done')),
    checked_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_clerk_id INT REFERENCES clerks(id),
    assigned_desk   INT,
    notes           TEXT
);

-- Postgres requires an IMMUTABLE function to use in an index expression
CREATE OR REPLACE FUNCTION date_from_timestamptz(ts TIMESTAMPTZ) RETURNS DATE AS $$
  SELECT ts::date;
$$;

CREATE UNIQUE INDEX idx_queue_number_per_day ON queue (county_id, office_id, date_from_timestamptz(checked_in_at), queue_number);

CREATE TABLE service_history (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    duration_min    INT NOT NULL CHECK (duration_min >= 0),
    served_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE service_history_txn_types (
    service_history_id INT NOT NULL REFERENCES service_history(id) ON DELETE CASCADE,
    txn_type_id        INT NOT NULL REFERENCES transaction_types(id),
    PRIMARY KEY (service_history_id, txn_type_id)
);

CREATE TABLE duration_recommendations (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    txn_type_id     INT NOT NULL REFERENCES transaction_types(id),
    current_avg_min INT NOT NULL CHECK (current_avg_min > 0),
    recommended_avg_min INT NOT NULL CHECK (recommended_avg_min > 0),
    sample_size     INT NOT NULL CHECK (sample_size > 0),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clerk_sessions (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    clerk_id        INT NOT NULL REFERENCES clerks(id),
    office_id       INT NOT NULL REFERENCES offices(id),
    desk_number     INT NOT NULL,
    is_available    BOOLEAN NOT NULL DEFAULT TRUE,
    logged_in_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    logged_out_at   TIMESTAMPTZ
);

CREATE TABLE clerk_schedules (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    clerk_id        INT NOT NULL REFERENCES clerks(id),
    office_id       INT NOT NULL REFERENCES offices(id),
    schedule_date   DATE NOT NULL,
    lunch_shift_id  INT REFERENCES office_lunch_shifts(id)
);
CREATE UNIQUE INDEX idx_clerk_schedule_unique ON clerk_schedules (county_id, clerk_id, schedule_date);
CREATE INDEX idx_clerk_schedule_office_date ON clerk_schedules (county_id, office_id, schedule_date);

-- =============================================================================
-- Views
-- =============================================================================
-- effective_transaction_types: one row per (office, global txn type), with
-- per-office overrides applied. The global row (office_id IS NULL) is the
-- base; an office-specific row with the same county_id + txn_type_id slug
-- overrides available_from/until and status per-column. Duration stays
-- global. Consumers (booking engine, admin UI, prescreen lookup) read this
-- as if it were a flat table — no override resolution at the call site.
-- security_invoker = true so RLS on transaction_types/offices applies to
-- the view caller, not the view owner.
CREATE VIEW effective_transaction_types
WITH (security_invoker = true) AS
SELECT
  o.id          AS office_id,
  o.county_id,
  g.id          AS global_id,        -- surrogate id of the global row
  g.txn_type_id,                     -- slug, e.g. 'road_test'
  g.name,
  g.description,
  g.avg_duration_min,                -- global, not overridable
  g.is_online_eligible,
  g.online_redirect_url,
  COALESCE(ov.available_from,  g.available_from)  AS available_from,
  COALESCE(ov.available_until, g.available_until) AS available_until,
  COALESCE(ov.status,          g.status)          AS status
FROM offices o
JOIN transaction_types g
  ON g.county_id  = o.county_id
 AND g.office_id IS NULL
LEFT JOIN transaction_types ov
  ON ov.county_id   = g.county_id
 AND ov.txn_type_id = g.txn_type_id
 AND ov.office_id   = o.id;

-- appointment_durations: capacity-relevant projection of appointments with
-- computed total duration and start/end timestamps. Exposes only the columns
-- the booking heatmap needs (no PII).
CREATE VIEW appointment_durations
WITH (security_invoker = true) AS
SELECT a.id,
       a.county_id,
       a.office_id,
       a.appointment_date,
       a.appointment_time,
       a.txn_type_ids,
       a.status,
       COALESCE((SELECT SUM(tt.avg_duration_min)
                 FROM unnest(a.txn_type_ids) AS tid
                 JOIN transaction_types tt ON tt.id = tid), 0)
         AS total_duration_min,
       (a.appointment_date + a.appointment_time)::timestamp
         AS start_at,
       (a.appointment_date + a.appointment_time
        + (COALESCE((SELECT SUM(tt.avg_duration_min)
                     FROM unnest(a.txn_type_ids) AS tid
                     JOIN transaction_types tt ON tt.id = tid), 0)
           * interval '1 minute'))::timestamp
         AS end_at
FROM appointments a;

-- =============================================================================
-- Row-Level Security
-- =============================================================================
-- All tenant-scoped tables enforce isolation via the `app.current_tenant`
-- session GUC. The application sets this at the start of each request:
--   SET LOCAL app.current_tenant = 'stlucie';
-- The policies below filter every read and write to that county. Combined
-- with FORCE ROW LEVEL SECURITY, even table owners cannot bypass.
--
-- service_history_txn_types has no county_id column — its rows inherit
-- isolation through the FK to service_history, which is RLS-protected.

CREATE OR REPLACE FUNCTION current_tenant() RETURNS TEXT
LANGUAGE SQL STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.current_setting('app.current_tenant', TRUE);
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'offices','office_hours','office_lunch_shifts','transaction_types',
    'clerks','hotbuttons','prescreen_questions','document_registry',
    'transaction_flows','appointments','documents','queue',
    'service_history','duration_recommendations','clerk_sessions',
    'clerk_schedules'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING      (county_id = current_tenant())
        WITH CHECK (county_id = current_tenant())
    $p$, t);
  END LOOP;
END $$;

-- service_history_txn_types: no county_id column. Policy enforces tenant
-- scope by checking the parent service_history row.
ALTER TABLE service_history_txn_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_history_txn_types FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_history_txn_types
  USING (EXISTS (SELECT 1 FROM service_history sh
                  WHERE sh.id = service_history_id
                    AND sh.county_id = current_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM service_history sh
                       WHERE sh.id = service_history_id
                         AND sh.county_id = current_tenant()));

-- counties: tenant key is `id`, not `county_id`. Same isolation contract.
ALTER TABLE counties ENABLE ROW LEVEL SECURITY;
ALTER TABLE counties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON counties
  USING      (id = current_tenant())
  WITH CHECK (id = current_tenant());

-- =============================================================================
-- Booking
-- =============================================================================
-- book_appointment: atomic capacity check + insert.
--
-- Locks the (office, date) clerk_schedules rows FOR UPDATE so that two
-- concurrent bookings against the same supply pool serialize. Rechecks
-- per-skill supply > demand at the requested time, then INSERTs and returns
-- the new appointment id.
--
-- Raises 'capacity_exceeded' (SQLSTATE P0001) if any requested skill is full.
-- Raises 'office_closed'      (SQLSTATE P0002) if the slot falls outside the
--                                              office's open/close window for
--                                              that day.
-- Raises 'txn_unavailable'    (SQLSTATE P0003) if any requested skill isn't
--                                              effectively active at the
--                                              office, or the slot is outside
--                                              its available_from / until.
--
-- Capacity formula matches the booking heatmap (scheduling-queries.sql query 8):
--   supply = floor(count(scheduled clerks with skill, lunch-not-overlapping)
--                  * run_rate_pct / 100)
--   demand = count(non-cancelled overlapping appts that need this skill)
-- =============================================================================
CREATE OR REPLACE FUNCTION book_appointment(
  p_county_id        TEXT,
  p_office_id        INT,
  p_date             DATE,
  p_time             TIME,
  p_txn_type_ids     INT[],
  p_first_name       TEXT,
  p_last_name        TEXT,
  p_contact_email    TEXT,
  p_contact_phone    TEXT,
  p_qr_code          TEXT DEFAULT NULL,
  p_is_walk_in       BOOLEAN DEFAULT FALSE,
  p_is_priority      BOOLEAN DEFAULT FALSE
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_slot_start  TIMESTAMP := (p_date + p_time)::timestamp;
  v_duration    INT;
  v_slot_end    TIMESTAMP;
  v_close_time  TIME;
  v_open_time   TIME;
  v_block_min   INT;
  v_block_t     TIMESTAMP;
  v_skill       INT;
  v_supply      INT;
  v_demand      INT;
  v_run_rate    INT;
  v_appt_id     INT;
BEGIN
  -- 1. Lock the supply pool for this (office, date). Anyone else trying to
  --    book the same office/day will block on this until we COMMIT.
  PERFORM 1
  FROM clerk_schedules
  WHERE county_id     = p_county_id
    AND office_id     = p_office_id
    AND schedule_date = p_date
  FOR UPDATE;

  -- 2. Office hours gate: the requested time must be inside the day's window.
  SELECT oh.open_time, oh.close_time
    INTO v_open_time, v_close_time
  FROM office_hours oh
  WHERE oh.county_id   = p_county_id
    AND oh.office_id   = p_office_id
    AND oh.day_of_week = EXTRACT(DOW FROM p_date)::int;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_closed' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Compute total duration from effective txn rows. Also asserts every
  --    requested skill is effectively active at this office.
  SELECT SUM(ett.avg_duration_min)::int
    INTO v_duration
  FROM effective_transaction_types ett
  WHERE ett.county_id = p_county_id
    AND ett.office_id = p_office_id
    AND ett.global_id = ANY(p_txn_type_ids)
    AND ett.status    = 'active';

  IF v_duration IS NULL
     OR (SELECT COUNT(*)
           FROM effective_transaction_types ett
          WHERE ett.county_id = p_county_id
            AND ett.office_id = p_office_id
            AND ett.global_id = ANY(p_txn_type_ids)
            AND ett.status    = 'active')
        <> cardinality(p_txn_type_ids)
  THEN
    RAISE EXCEPTION 'txn_unavailable' USING ERRCODE = 'P0003';
  END IF;

  v_slot_end := v_slot_start + (v_duration * interval '1 minute');

  -- 4. Office hours: start must be at/after open, end must be at/before close.
  IF p_time < v_open_time
     OR v_slot_end > (p_date + v_close_time)::timestamp THEN
    RAISE EXCEPTION 'office_closed' USING ERRCODE = 'P0002';
  END IF;

  -- 5. Per-skill txn availability window: slot must fit inside the effective
  --    available_from / available_until for every requested skill.
  PERFORM 1
  FROM effective_transaction_types ett
  WHERE ett.county_id = p_county_id
    AND ett.office_id = p_office_id
    AND ett.global_id = ANY(p_txn_type_ids)
    AND ett.status    = 'active'
    AND ((ett.available_from  IS NOT NULL AND p_time     < ett.available_from)
      OR (ett.available_until IS NOT NULL AND v_slot_end > (p_date + ett.available_until)::timestamp));

  IF FOUND THEN
    RAISE EXCEPTION 'txn_unavailable' USING ERRCODE = 'P0003';
  END IF;

  -- 6. Per-skill capacity recheck across EVERY block the appt occupies.
  --    Walk from slot_start in scheduling_block_min increments up to (but
  --    not including) slot_end. At each block, supply > demand must hold
  --    for every requested skill. Catches mid-appt supply drops (e.g. a
  --    clerk going on lunch partway through the appointment).
  SELECT run_rate_pct INTO v_run_rate
  FROM offices
  WHERE county_id = p_county_id AND id = p_office_id;

  SELECT scheduling_block_min INTO v_block_min
  FROM counties WHERE id = p_county_id;

  v_block_t := v_slot_start;
  WHILE v_block_t < v_slot_end LOOP
    FOREACH v_skill IN ARRAY p_txn_type_ids LOOP
      -- Supply: clerks scheduled at this office/date with this skill, whose
      -- lunch shift (if any) does not overlap THIS block, scaled by run_rate.
      SELECT FLOOR(COUNT(*) * v_run_rate / 100.0)::int
        INTO v_supply
      FROM clerk_schedules cs
      JOIN clerks c
        ON c.id = cs.clerk_id AND c.county_id = cs.county_id
      LEFT JOIN office_lunch_shifts ols
        ON ols.id        = cs.lunch_shift_id
       AND ols.county_id = cs.county_id
       AND ols.office_id = cs.office_id
      WHERE cs.county_id     = p_county_id
        AND cs.office_id     = p_office_id
        AND cs.schedule_date = p_date
        AND c.status         = 'active'
        AND v_skill          = ANY(c.skill_ids)
        AND (ols.id IS NULL
          OR NOT (ols.start_time <= v_block_t::time
              AND ols.end_time   >  v_block_t::time));

      -- Demand: overlapping non-cancelled appts that need this skill.
      SELECT COUNT(*)::int
        INTO v_demand
      FROM appointment_durations ad
      WHERE ad.county_id        = p_county_id
        AND ad.office_id        = p_office_id
        AND ad.appointment_date = p_date
        AND ad.status NOT IN ('cancelled', 'no_show')
        AND v_skill = ANY(ad.txn_type_ids)
        AND ad.start_at <= v_block_t
        AND ad.end_at   >  v_block_t;

      IF v_supply <= v_demand THEN
        RAISE EXCEPTION 'capacity_exceeded' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    v_block_t := v_block_t + (v_block_min * interval '1 minute');
  END LOOP;

  -- 7. Insert.
  INSERT INTO appointments (
    county_id, office_id,
    first_name, last_name, contact_email, contact_phone,
    txn_type_ids, appointment_date, appointment_time,
    qr_code, status, is_walk_in, is_priority
  ) VALUES (
    p_county_id, p_office_id,
    p_first_name, p_last_name, p_contact_email, p_contact_phone,
    p_txn_type_ids, p_date, p_time,
    p_qr_code, 'scheduled', p_is_walk_in, p_is_priority
  )
  RETURNING id INTO v_appt_id;

  RETURN v_appt_id;
END $$;
