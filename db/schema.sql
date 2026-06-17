-- St. Lucie Tax System — Schema

-- =============================================================================
-- Config Tables
-- =============================================================================
CREATE TABLE config (
    timezone                 TEXT NOT NULL DEFAULT 'America/New_York',
    scheduling_block_padding INT  NOT NULL DEFAULT 0
                             CHECK (scheduling_block_padding >= 0
                                AND scheduling_block_padding <= 30),
    default_lookahead_days   INT  NOT NULL DEFAULT 14
                             CHECK (default_lookahead_days BETWEEN 1 AND 365)
);
CREATE UNIQUE INDEX idx_config_singleton ON config ((TRUE));

CREATE TABLE offices (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    address         TEXT,
    total_desks     INT NOT NULL,
    run_rate_pct    INT NOT NULL DEFAULT 100 CHECK (run_rate_pct > 0 AND run_rate_pct < 200),
    UNIQUE (name)
);

CREATE TABLE office_hours (
    id              SERIAL PRIMARY KEY,
    office_id       INT NOT NULL REFERENCES offices(id),
    day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time       TIME NOT NULL,
    close_time      TIME NOT NULL,
    CHECK (open_time < close_time)
);
CREATE UNIQUE INDEX idx_office_hours_unique ON office_hours (office_id, day_of_week);

CREATE TABLE office_lunch_shifts (
    id              SERIAL PRIMARY KEY,
    office_id       INT NOT NULL REFERENCES offices(id),
    shift_num       INT NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    CHECK (start_time < end_time)
);

CREATE TABLE transaction_types (
    id              SERIAL PRIMARY KEY,
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
    UNIQUE NULLS NOT DISTINCT (txn_type_id, office_id),
    CHECK (available_from IS NULL OR available_until IS NULL OR available_from < available_until)
);

CREATE TABLE clerks (
    id              SERIAL PRIMARY KEY,
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
    sort_order      INT NOT NULL,
    label           TEXT NOT NULL,
    prompt          TEXT NOT NULL
);

CREATE TABLE prescreen_questions (
    id              SERIAL PRIMARY KEY,
    txn_type_id     INT NOT NULL REFERENCES transaction_types(id),
    sort_order      INT NOT NULL,
    question_text   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_prescreen_unique ON prescreen_questions (txn_type_id, sort_order);

CREATE TABLE document_registry (
    doc_id          TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    alternatives    TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (doc_id)
);

CREATE TABLE transaction_flows (
    id              SERIAL PRIMARY KEY,
    txn_type_id     INT NOT NULL REFERENCES transaction_types(id),
    steps           JSONB NOT NULL,
    UNIQUE (txn_type_id)
);

-- =============================================================================
-- Transactional Tables
-- =============================================================================

CREATE TABLE appointments (
    id              SERIAL PRIMARY KEY,
    office_id       INT NOT NULL REFERENCES offices(id),
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    contact_email   TEXT NOT NULL,
    contact_phone   TEXT NOT NULL,
    can_send_sms    BOOLEAN NOT NULL DEFAULT FALSE,
    txn_type_ids    INT[] NOT NULL,
    required_doc_ids TEXT[] NOT NULL DEFAULT '{}',
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
CREATE INDEX idx_appointments_schedule ON appointments (office_id, appointment_date, appointment_time);

CREATE TABLE documents (
    id              SERIAL PRIMARY KEY,
    appointment_id  INT NOT NULL REFERENCES appointments(id),
    doc_id          TEXT,
    name            TEXT NOT NULL,
    s3_key          TEXT,
    ai_review_status TEXT CHECK (ai_review_status IN ('accept', 'reject')),
    ai_review_notes  TEXT,
    clerk_validated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (doc_id) REFERENCES document_registry(doc_id)
);

CREATE TABLE queue_counters (
    office_id    INT NOT NULL REFERENCES offices(id),
    counter_date DATE NOT NULL,
    last_number  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (office_id, counter_date)
);

CREATE TABLE queue (
    id              SERIAL PRIMARY KEY,
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

CREATE TABLE service_history (
    id              SERIAL PRIMARY KEY,
    office_id       INT NOT NULL REFERENCES offices(id),
    appointment_id  INT REFERENCES appointments(id),
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
    clerk_id        INT NOT NULL REFERENCES clerks(id),
    office_id       INT NOT NULL REFERENCES offices(id),
    desk_number     INT NOT NULL,
    is_available    BOOLEAN NOT NULL DEFAULT TRUE,
    logged_in_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    logged_out_at   TIMESTAMPTZ
);

CREATE TABLE clerk_schedules (
    id              SERIAL PRIMARY KEY,
    clerk_id        INT NOT NULL REFERENCES clerks(id),
    office_id       INT NOT NULL REFERENCES offices(id),
    schedule_date   DATE NOT NULL,
    lunch_shift_id  INT REFERENCES office_lunch_shifts(id)
);
CREATE UNIQUE INDEX idx_clerk_schedule_unique ON clerk_schedules (clerk_id, schedule_date);
CREATE INDEX idx_clerk_schedule_office_date ON clerk_schedules (office_id, schedule_date);

CREATE TABLE clerk_absences (
    id          SERIAL PRIMARY KEY,
    clerk_id    INT NOT NULL REFERENCES clerks(id),
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    reason      TEXT,
    CONSTRAINT valid_range CHECK (end_date >= start_date)
);
CREATE INDEX idx_clerk_absences_lookup ON clerk_absences (clerk_id, start_date, end_date);

-- =============================================================================
-- Views
-- =============================================================================
CREATE VIEW effective_transaction_types AS
SELECT
  o.id          AS office_id,
  g.id          AS global_id,
  g.txn_type_id,
  g.name,
  g.description,
  g.avg_duration_min,
  g.is_online_eligible,
  g.online_redirect_url,
  COALESCE(ov.available_from,  g.available_from)  AS available_from,
  COALESCE(ov.available_until, g.available_until) AS available_until,
  COALESCE(ov.status,          g.status)          AS status
FROM offices o
JOIN transaction_types g
  ON g.office_id IS NULL
LEFT JOIN transaction_types ov
  ON ov.txn_type_id = g.txn_type_id
 AND ov.office_id   = o.id;

CREATE VIEW appointment_durations AS
SELECT a.id,
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
-- Capacity validation
-- =============================================================================
CREATE OR REPLACE FUNCTION validate_slot(
  p_office_id      INT,
  p_date           DATE,
  p_time           TIME,
  p_target_skills  INT[],
  p_duration_min   INT
) RETURNS INT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_padding         INT;
  v_slot_start      TIMESTAMP := (p_date + p_time)::timestamp;
  v_slot_end        TIMESTAMP;
  v_run_rate        INT;
  v_total_desks     INT;
  v_effective_desks INT;
  v_min_avail       INT;
BEGIN
  SELECT COALESCE(c.scheduling_block_padding, 0) INTO v_padding
  FROM config c;

  v_slot_end := v_slot_start + ((p_duration_min + v_padding) * interval '1 minute');

  SELECT run_rate_pct, total_desks INTO v_run_rate, v_total_desks
  FROM offices
  WHERE id = p_office_id;

  IF v_run_rate IS NULL THEN RETURN 0; END IF;

  v_effective_desks := FLOOR(v_total_desks * v_run_rate / 100.0)::int;

  WITH change_points AS (
      SELECT p_time AS cp_t
    UNION
      SELECT ols.start_time
      FROM office_lunch_shifts ols
      WHERE ols.office_id = p_office_id
        AND ols.start_time >  p_time
        AND ols.start_time <  (p_time + ((p_duration_min + v_padding) || ' minutes')::interval)::time
    UNION
      SELECT ad.appointment_time
      FROM appointment_durations ad
      WHERE ad.office_id        = p_office_id
        AND ad.appointment_date = p_date
        AND ad.status NOT IN ('cancelled', 'no_show')
        AND ad.start_at >  v_slot_start
        AND ad.start_at <  v_slot_end
  )
  SELECT MIN(LEAST(
           GREATEST(
             (SELECT count(*)
              FROM clerk_schedules cs
              JOIN clerks c
                ON c.id = cs.clerk_id
              LEFT JOIN office_lunch_shifts ols
                ON ols.id        = cs.lunch_shift_id
               AND ols.office_id = cs.office_id
              WHERE cs.office_id     = p_office_id
                AND cs.schedule_date = p_date
                AND c.status         = 'active'
                AND c.skill_ids     @> p_target_skills
                AND NOT EXISTS (
                  SELECT 1 FROM clerk_absences ca
                  WHERE ca.clerk_id  = cs.clerk_id
                    AND p_date BETWEEN ca.start_date AND ca.end_date)
                AND (ols.id IS NULL
                  OR NOT (ols.start_time <= cp.cp_t
                      AND ols.end_time   >  cp.cp_t)))::int
             - (SELECT count(*)::int
                FROM appointment_durations ad
                WHERE ad.office_id        = p_office_id
                  AND ad.appointment_date = p_date
                  AND ad.status NOT IN ('cancelled', 'no_show')
                  AND ad.txn_type_ids    && p_target_skills
                  AND ad.start_at <= (p_date + cp.cp_t)::timestamp
                  AND ad.end_at + (v_padding * interval '1 minute') > (p_date + cp.cp_t)::timestamp),
             0),
           GREATEST(
             LEAST(
               v_effective_desks,
               (SELECT count(*)
                FROM clerk_schedules cs
                JOIN clerks c
                  ON c.id = cs.clerk_id
                LEFT JOIN office_lunch_shifts ols
                  ON ols.id        = cs.lunch_shift_id
                 AND ols.office_id = cs.office_id
                WHERE cs.office_id     = p_office_id
                  AND cs.schedule_date = p_date
                  AND c.status         = 'active'
                  AND NOT EXISTS (
                    SELECT 1 FROM clerk_absences ca
                    WHERE ca.clerk_id  = cs.clerk_id
                      AND p_date BETWEEN ca.start_date AND ca.end_date)
                  AND (ols.id IS NULL
                    OR NOT (ols.start_time <= cp.cp_t
                        AND ols.end_time   >  cp.cp_t)))::int
             )
             - (SELECT count(*)::int
                FROM appointment_durations ad
                WHERE ad.office_id        = p_office_id
                  AND ad.appointment_date = p_date
                  AND ad.status NOT IN ('cancelled', 'no_show')
                  AND ad.start_at <= (p_date + cp.cp_t)::timestamp
                  AND ad.end_at + (v_padding * interval '1 minute') > (p_date + cp.cp_t)::timestamp),
             0)
         ))::int
    INTO v_min_avail
  FROM change_points cp;

  RETURN COALESCE(v_min_avail, 0);
END;
$$;

-- =============================================================================
-- Booking
-- =============================================================================
CREATE OR REPLACE FUNCTION book_appointment(
  p_office_id        INT,
  p_date             DATE,
  p_time             TIME,
  p_txn_type_ids     INT[],
  p_required_doc_ids TEXT[],
  p_first_name       TEXT,
  p_last_name        TEXT,
  p_contact_email    TEXT,
  p_contact_phone    TEXT,
  p_qr_code          TEXT DEFAULT NULL,
  p_is_walk_in       BOOLEAN DEFAULT FALSE,
  p_is_priority      BOOLEAN DEFAULT FALSE,
  p_prescreen_completed BOOLEAN DEFAULT FALSE,
  p_prescreen_responses JSONB DEFAULT '{}',
  p_now_ts           TIMESTAMP DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_slot_start  TIMESTAMP := (p_date + p_time)::timestamp;
  v_now_local   TIMESTAMP;
  v_duration    INT;
  v_slot_end    TIMESTAMP;
  v_close_time  TIME;
  v_open_time   TIME;
  v_appt_id     INT;
BEGIN
  -- "Now" in the office's local zone, so it compares against naive local slot times.
  -- Callers may pass p_now_ts (already local) for deterministic tests.
  v_now_local := COALESCE(p_now_ts,
    (now() AT TIME ZONE (SELECT timezone FROM config)));

  IF v_slot_start <= v_now_local THEN
    RAISE EXCEPTION 'slot_in_past' USING ERRCODE = 'P0004';
  END IF;

  PERFORM 1
  FROM clerk_schedules
  WHERE office_id     = p_office_id
    AND schedule_date = p_date
  FOR UPDATE;

  SELECT oh.open_time, oh.close_time
    INTO v_open_time, v_close_time
  FROM office_hours oh
  WHERE oh.office_id   = p_office_id
    AND oh.day_of_week = EXTRACT(DOW FROM p_date)::int;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_closed' USING ERRCODE = 'P0002';
  END IF;

  SELECT SUM(ett.avg_duration_min)::int
    INTO v_duration
  FROM effective_transaction_types ett
  WHERE ett.office_id = p_office_id
    AND ett.global_id = ANY(p_txn_type_ids)
    AND ett.status    = 'active';

  IF v_duration IS NULL
     OR (SELECT COUNT(*)
           FROM effective_transaction_types ett
          WHERE ett.office_id = p_office_id
            AND ett.global_id = ANY(p_txn_type_ids)
            AND ett.status    = 'active')
        <> cardinality(p_txn_type_ids)
  THEN
    RAISE EXCEPTION 'txn_unavailable' USING ERRCODE = 'P0003';
  END IF;

  v_slot_end := v_slot_start + (v_duration * interval '1 minute');

  IF p_time < v_open_time
     OR v_slot_end > (p_date + v_close_time)::timestamp THEN
    RAISE EXCEPTION 'office_closed' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM effective_transaction_types ett
  WHERE ett.office_id = p_office_id
    AND ett.global_id = ANY(p_txn_type_ids)
    AND ett.status    = 'active'
    AND ((ett.available_from  IS NOT NULL AND p_time     < ett.available_from)
      OR (ett.available_until IS NOT NULL AND v_slot_end > (p_date + ett.available_until)::timestamp));

  IF FOUND THEN
    RAISE EXCEPTION 'txn_unavailable' USING ERRCODE = 'P0003';
  END IF;

  IF validate_slot(p_office_id, p_date, p_time, p_txn_type_ids, v_duration) <= 0 THEN
    RAISE EXCEPTION 'capacity_exceeded' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO appointments (
    office_id,
    first_name, last_name, contact_email, contact_phone,
    txn_type_ids, required_doc_ids, prescreen_completed, prescreen_responses,
    appointment_date, appointment_time,
    qr_code, status, is_walk_in, is_priority
  ) VALUES (
    p_office_id,
    p_first_name, p_last_name, p_contact_email, p_contact_phone,
    p_txn_type_ids, p_required_doc_ids, p_prescreen_completed, p_prescreen_responses,
    p_date, p_time,
    p_qr_code, 'scheduled', p_is_walk_in, p_is_priority
  )
  RETURNING id INTO v_appt_id;

  RETURN v_appt_id;
END $$;

-- =============================================================================
-- Walk-in Registration
-- =============================================================================
CREATE OR REPLACE FUNCTION register_walk_in(
  p_office_id        INT,
  p_txn_type_ids     INT[],
  p_first_name       TEXT,
  p_last_name        TEXT,
  p_contact_email    TEXT,
  p_contact_phone    TEXT,
  p_is_priority      BOOLEAN DEFAULT FALSE,
  p_now_ts           TIMESTAMP DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_now_local   TIMESTAMP := COALESCE(p_now_ts,
                  (now() AT TIME ZONE (SELECT timezone FROM config)));
  v_date        DATE := v_now_local::date;
  v_time        TIME := v_now_local::time;
  v_duration    INT;
  v_slot_end    TIMESTAMP;
  v_close_time  TIME;
  v_open_time   TIME;
  v_appt_id     INT;
BEGIN
  SELECT oh.open_time, oh.close_time
    INTO v_open_time, v_close_time
  FROM office_hours oh
  WHERE oh.office_id   = p_office_id
    AND oh.day_of_week = EXTRACT(DOW FROM v_date)::int;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_closed' USING ERRCODE = 'P0002';
  END IF;

  IF v_time < v_open_time OR v_time >= v_close_time THEN
    RAISE EXCEPTION 'office_closed' USING ERRCODE = 'P0002';
  END IF;

  SELECT SUM(ett.avg_duration_min)::int
    INTO v_duration
  FROM effective_transaction_types ett
  WHERE ett.office_id = p_office_id
    AND ett.global_id = ANY(p_txn_type_ids)
    AND ett.status    = 'active';

  IF v_duration IS NULL
     OR (SELECT COUNT(*)
           FROM effective_transaction_types ett
          WHERE ett.office_id = p_office_id
            AND ett.global_id = ANY(p_txn_type_ids)
            AND ett.status    = 'active')
        <> cardinality(p_txn_type_ids)
  THEN
    RAISE EXCEPTION 'txn_unavailable' USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO appointments (
    office_id,
    first_name, last_name, contact_email, contact_phone,
    txn_type_ids, required_doc_ids, prescreen_completed, prescreen_responses,
    appointment_date, appointment_time,
    qr_code, status, is_walk_in, is_priority
  ) VALUES (
    p_office_id,
    p_first_name, p_last_name, p_contact_email, p_contact_phone,
    p_txn_type_ids, '{}', FALSE, '{}',
    v_date, v_time,
    NULL, 'scheduled', TRUE, p_is_priority
  )
  RETURNING id INTO v_appt_id;

  RETURN v_appt_id;
END $$;

-- =============================================================================
-- Queue Operations
-- =============================================================================

CREATE OR REPLACE FUNCTION check_in_to_queue(
  p_office_id      INT,
  p_appointment_id INT,
  p_notes          TEXT DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_number INT;
  v_queue_id    INT;
  v_today       DATE;
BEGIN
  -- Use current time zone for queue number, UTC for everything else for analytics
  SELECT (now() AT TIME ZONE c.timezone)::date INTO v_today
  FROM config c;

  INSERT INTO queue_counters (office_id, counter_date, last_number)
  VALUES (p_office_id, v_today, 1)
  ON CONFLICT (office_id, counter_date)
  DO UPDATE SET last_number = queue_counters.last_number + 1
  RETURNING last_number INTO v_next_number;

  INSERT INTO queue (office_id, appointment_id, queue_number, status, notes)
  VALUES (p_office_id, p_appointment_id, v_next_number, 'waiting', p_notes)
  RETURNING id INTO v_queue_id;

  RETURN v_queue_id;
END $$;

CREATE OR REPLACE FUNCTION assign_next_customer(
  p_office_id  INT,
  p_clerk_id   INT
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_clerk_skills INT[];
  v_queue_id     INT;
  v_desk         INT;
BEGIN
  SELECT c.skill_ids, cs.desk_number
    INTO v_clerk_skills, v_desk
  FROM clerks c
  JOIN clerk_sessions cs ON cs.clerk_id = c.id
    AND cs.office_id = p_office_id
    AND cs.logged_out_at IS NULL
    AND cs.is_available = TRUE
  WHERE c.id = p_clerk_id;

  IF v_clerk_skills IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT q.id INTO v_queue_id
  FROM queue q
  JOIN appointments a ON a.id = q.appointment_id
  WHERE q.office_id = p_office_id
    AND q.status = 'waiting'
    AND a.txn_type_ids <@ v_clerk_skills
  ORDER BY a.is_priority DESC, q.checked_in_at ASC
  LIMIT 1
  FOR UPDATE OF q SKIP LOCKED;

  IF v_queue_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE queue
  SET status = 'serving',
      assigned_clerk_id = p_clerk_id,
      assigned_desk = v_desk
  WHERE id = v_queue_id;

  UPDATE clerk_sessions
  SET is_available = FALSE
  WHERE clerk_id = p_clerk_id
    AND office_id = p_office_id
    AND logged_out_at IS NULL;

  RETURN v_queue_id;
END $$;
