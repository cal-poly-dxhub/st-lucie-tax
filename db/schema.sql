-- St. Lucie Tax System — Schema
-- Source: docs/database-design.md

-- =============================================================================
-- Config Tables
-- =============================================================================

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
    close_time      TIME NOT NULL
);
CREATE UNIQUE INDEX idx_office_hours_unique ON office_hours (county_id, office_id, day_of_week);

CREATE TABLE office_lunch_shifts (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    shift_num       INT NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL
);

CREATE TABLE transaction_types (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    txn_type_id     TEXT NOT NULL,
    office_id       INT REFERENCES offices(id),
    name            TEXT NOT NULL,
    description     TEXT,
    avg_duration_min INT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'internal', 'hidden')),
    available_from  TIME,
    available_until TIME,
    is_online_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    online_redirect_url TEXT,
    UNIQUE NULLS NOT DISTINCT (county_id, txn_type_id, office_id)
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
$$ LANGUAGE SQL IMMUTABLE;

CREATE UNIQUE INDEX idx_queue_number_per_day ON queue (county_id, office_id, date_from_timestamptz(checked_in_at), queue_number);

CREATE TABLE service_history (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    duration_min    INT NOT NULL,
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
    current_avg_min INT NOT NULL,
    recommended_avg_min INT NOT NULL,
    sample_size     INT NOT NULL,
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

-- =============================================================================
-- Row-Level Security
-- =============================================================================
-- All tenant-scoped tables enforce isolation via the `app.current_tenant`
-- session GUC. The application sets this at the start of each request:
--   SET LOCAL app.current_tenant = 'stlucie';
-- The policies below filter every read and write to that county. The TRUE
-- fallback in current_setting(...) lets superuser/migration tooling run when
-- the GUC is unset; combined with FORCE ROW LEVEL SECURITY this still blocks
-- table owners from bypassing tenant scope in normal app sessions.
--
-- service_history_txn_types has no county_id column — its rows inherit
-- isolation through the FK to service_history, which is RLS-protected.

CREATE OR REPLACE FUNCTION current_tenant() RETURNS TEXT AS $$
  SELECT current_setting('app.current_tenant', TRUE);
$$ LANGUAGE SQL STABLE;

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
