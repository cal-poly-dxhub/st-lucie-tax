# Database Design

## Overview

All data lives in a single RDS Postgres instance.

Multi-tenancy is handled by `county_id` on every table. Each county's data is logically isolated via Row-Level Security. This scales from 1 county (St. Lucie) to 67 (all of Florida) without re-architecting.

---

## Config Tables

Admin-managed configuration. Low volume, read-heavy, rarely written.

```sql
-- Offices
CREATE TABLE offices (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,          -- e.g. 'stlucie'
    office_id            TEXT NOT NULL,          -- e.g. 'ftpierce', 'slwest'
    name            TEXT NOT NULL,
    address         TEXT,
    total_desks     INT NOT NULL,
    run_rate_pct    INT NOT NULL DEFAULT 100, -- e.g. 90 or 110
    UNIQUE (county_id, office_id)
);

-- Office operating hours (one row per office per day)
CREATE TABLE office_hours (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
    open_time       TIME NOT NULL,
    close_time      TIME NOT NULL
);
CREATE UNIQUE INDEX idx_office_hours_unique ON office_hours (county_id, office_id, day_of_week); -- Enforce only one hour entry per office per day

-- Office lunch shifts (overlapping shifts reduce capacity)
CREATE TABLE office_lunch_shifts (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    shift_num       INT NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    clerk_count     INT NOT NULL            -- how many clerks go on this shift
);

-- Transaction types
-- office_id NULL = available at all offices (global default)
-- office_id set  = override for that specific office
CREATE TABLE transaction_types (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    txn_type_id     TEXT NOT NULL,          -- e.g. 'license_renewal', 'road_test'
    office_id       INT REFERENCES offices(id), -- NULL = global
    name            TEXT NOT NULL,
    description     TEXT,
    avg_duration_min INT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'internal', 'hidden')),
    available_from  TIME,                   -- optional time window
    available_until TIME,                   -- optional time window
    is_online_eligible BOOLEAN NOT NULL DEFAULT FALSE, -- can be completed online (e.g. simple renewal)
    online_redirect_url TEXT,               -- e.g. MyEasyGov payment page
    UNIQUE NULLS NOT DISTINCT (county_id, txn_type_id, office_id) -- Enforces one row per office_id = NULL for global constraint
);

-- Clerks
CREATE TABLE clerks (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    email           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'in_training', 'inactive')),
    skill_ids       INT[] NOT NULL DEFAULT '{}',  -- list of transaction_types.id
    office_ids      INT[] NOT NULL DEFAULT '{}',  -- list of offices.id that a clerk can be assigned to
    UNIQUE (email)
);

-- Chatbot hot buttons (ordered quick-action prompts)
CREATE TABLE hotbuttons (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    sort_order      INT NOT NULL,
    label           TEXT NOT NULL,
    prompt          TEXT NOT NULL
);

-- Pre-screen questions (per transaction type, all yes/no)
-- If a txn type has no rows here, pre-screening is skipped.
CREATE TABLE prescreen_questions (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    txn_type_id     INT NOT NULL REFERENCES transaction_types(id),
    sort_order      INT NOT NULL,
    question_text   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_prescreen_unique ON prescreen_questions (county_id, txn_type_id, sort_order); -- Enforces unique sort order per question

-- Document registry (shared definitions, referenced by doc_id from transaction flows)
CREATE TABLE document_registry (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,     
    doc_id        TEXT NOT NULL, -- e.g. 'drivers_license', 'hsmv_82040'
    name        TEXT NOT NULL,
    description     TEXT,
    alternatives    TEXT[] NOT NULL DEFAULT '{}',  -- e.g. '{"passport","state_id"}'
    UNIQUE (county_id, doc_id)
);

-- Transaction flows (deterministic decision trees for chatbot pre-screening)
-- Each flow is a self-contained JSON document walked client-side.
CREATE TABLE transaction_flows (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    txn_type_id     INT NOT NULL REFERENCES transaction_types(id),
    steps           JSONB NOT NULL,
    UNIQUE (county_id, txn_type_id)
);
```

### Transaction Flow JSON Structure

Each `steps` value is an ordered array of decision nodes. The chatbot walks the tree, follows branches based on customer answers, and accumulates the required documents list.

Node types:
- `yes_no` — binary branch with `yes` / `no` paths
- `conditional` — multiple branches based on answer matching (`conditions` list with `if` / `require_docs` / `next`)
- `info` — display-only node (no branching), advances to `next`

Each branch can specify `require_docs` (list of `document_registry.doc_id` references) and `next` (ID of the next node, or `null` to end).

Example: `txn_type_id = 'oos_title_transfer'`

```json
[
  {
    "id": "lien_check",
    "question": "Is there a lien on the vehicle?",
    "type": "yes_no",
    "yes": { "require_docs": ["oos_writing_packet"], "next": "state_check" },
    "no": { "next": "state_check" }
  },
  {
    "id": "state_check",
    "question": "What state are you coming from?",
    "type": "conditional",
    "conditions": [
      { "if": "title_holding_state", "require_docs": ["original_title", "hsmv_82040", "vin_verification"], "next": "registration_check" },
      { "if": "non_title_holding_state", "require_docs": ["electronic_title_from_state"], "next": "registration_check" }
    ]
  },
  {
    "id": "registration_check",
    "question": "Do you have a copy of your current registration?",
    "type": "yes_no",
    "yes": { "next": "vehicle_location" },
    "no": { "require_docs": ["registration_copy_6mo"], "next": "vehicle_location" }
  },
  {
    "id": "vehicle_location",
    "question": "Is the vehicle physically in our parking lot?",
    "type": "yes_no",
    "yes": { "require_docs": ["vin_verification_deputy"], "next": null },
    "no": { "require_docs": ["vin_verification_law_enforcement"], "next": null }
  }
]
```

Chatbot flow: walk all `transaction_flows` for selected txn types, then get all docs and prescreen Qs and then dedupe by doc_id and question text.

### Lunch Capacity

Lunch capacity is calculated by overlap. When multiple shifts overlap at a point in time, capacity is reduced by the sum of clerk_count across overlapping shifts:

```
Lunches
==== =====
  ======
====
  X
Capacity has three reductions at point X due to overlap
```

---

## Transactional Tables

```sql
-- Appointments (write-once booking data)
-- Customer contact info is inlined here rather than in a separate customers table.
-- This keeps PII scoped to a single appointment's lifecycle so it can be purged
-- on a fixed schedule without cross-visit linkage.
CREATE TABLE appointments (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    contact_email   TEXT NOT NULL,
    contact_phone   TEXT NOT NULL,
    can_send_sms BOOLEAN NOT NULL DEFAULT FALSE,
    requested_clerk_id INT REFERENCES clerks(id), -- Used for check-in clerk to send to specific clerk
    txn_type_ids    INT[] NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    qr_code         TEXT, -- Unique code to generate qr code from ()
    identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
    prescreen_completed BOOLEAN NOT NULL DEFAULT FALSE,
    prescreen_responses JSONB DEFAULT '{}', -- keys are prescreen_questions.id, values are boolean e.g. {"12": true, "15": false}
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled', 'diverted_online')),
    is_priority     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_appointments_qr ON appointments (qr_code) WHERE qr_code IS NOT NULL;
CREATE INDEX idx_appointments_schedule ON appointments (county_id, office_id, appointment_date, appointment_time);

-- Documents (per-appointment, not persistent across visits)
CREATE TABLE documents (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    appointment_id  INT NOT NULL REFERENCES appointments(id),
    doc_id          TEXT REFERENCES document_registry(doc_id), -- NULL for walk-in uploads not tied to a required doc
    name            TEXT NOT NULL,
    s3_key          TEXT,
    ai_review_status TEXT CHECK (ai_review_status IN ('accept', 'reject')),
    ai_review_notes  TEXT,               -- AI-generated reasoning, e.g. "Valid FL utility bill, issued 2026-03-15"
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queue (ephemeral, high-write state for today's active customers)
CREATE TABLE queue (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    appointment_id  INT REFERENCES appointments(id),
    queue_number    INT NOT NULL,  -- Customer-facing ticket number, assigned at check-in, unique per office+day
    status          TEXT NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'serving', 'testing', 'done')),
    checked_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_clerk_id INT REFERENCES clerks(id),
    assigned_desk   INT,
    notes           TEXT  -- check-in clerk notes for service clerk
);
CREATE UNIQUE INDEX idx_queue_number_per_day ON queue (county_id, office_id, (checked_in_at::date), queue_number);

-- Service history (for duration analytics)
-- Intentionally carries no customer or clerk linkage. The only analytics use
-- case is per-txn-type average duration to power duration_recommendations.
-- Keeping this table PII-free lets it be retained indefinitely.
CREATE TABLE service_history (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    office_id       INT NOT NULL REFERENCES offices(id),
    duration_min    INT NOT NULL,
    served_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Junction table for the many-to-many between service_history and
-- transaction_types. Postgres can't enforce FKs on array elements, so the
-- txn_type list is normalized into its own table to keep referential
-- integrity with transaction_types.
CREATE TABLE service_history_txn_types (
    service_history_id INT NOT NULL REFERENCES service_history(id) ON DELETE CASCADE,
    txn_type_id        INT NOT NULL REFERENCES transaction_types(id),
    PRIMARY KEY (service_history_id, txn_type_id)
);

-- Duration recommendations (admin approval workflow)
CREATE TABLE duration_recommendations (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    txn_type_id     INT NOT NULL REFERENCES transaction_types(id),
    current_avg_min INT NOT NULL,
    recommended_avg_min INT NOT NULL,
    sample_size     INT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clerk sessions (who's logged in where)
CREATE TABLE clerk_sessions (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    clerk_id        INT NOT NULL REFERENCES clerks(id),
    office_id       INT NOT NULL REFERENCES offices(id),
    desk_number     INT NOT NULL,
    is_available    BOOLEAN NOT NULL DEFAULT TRUE, -- Tracks to see if clerk is available (clerks can set if they are available manually)
    on_lunch_shift_id INT REFERENCES office_lunch_shifts(id), -- NULL = not on lunch; set when clerk goes to lunch, cleared on return
    logged_in_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    logged_out_at   TIMESTAMPTZ
);

-- Clerk schedules (which clerk is assigned to which office on what day)
-- Used for capacity planning and scheduling. clerks.office_ids tracks which
-- offices a clerk *can* work at; this table tracks where they *will* work.
CREATE TABLE clerk_schedules (
    id              SERIAL PRIMARY KEY,
    county_id       TEXT NOT NULL,
    clerk_id        INT NOT NULL REFERENCES clerks(id),
    office_id       INT NOT NULL REFERENCES offices(id),
    schedule_date   DATE NOT NULL
);
CREATE UNIQUE INDEX idx_clerk_schedule_unique ON clerk_schedules (county_id, clerk_id, schedule_date); -- One office per clerk per day
CREATE INDEX idx_clerk_schedule_office_date ON clerk_schedules (county_id, office_id, schedule_date);
```

---

## Row-Level Security (RLS)

All tables use PostgreSQL Row-Level Security to enforce tenant isolation at the database level. Each table gets an RLS policy that matches `county_id` against a session variable (`app.current_tenant`). The application sets this variable at the start of each request, and PostgreSQL automatically filters all reads and writes to that county. This prevents cross-county data access even if the application layer has a bug.

---

## Access Patterns

### Config

| Question | Query |
|----------|-------|
| Office capacities | `SELECT total_desks, run_rate_pct FROM offices WHERE id = $1` |
| Office by office_id | `SELECT * FROM offices WHERE county_id = $1 AND office_id = $2` |
| Office operating hours | `SELECT * FROM office_hours WHERE office_id = $1 ORDER BY day_of_week` |
| Lunch shifts / timing / overlap | `SELECT * FROM office_lunch_shifts WHERE office_id = $1 ORDER BY start_time` |
| Desks per office | `SELECT total_desks FROM offices WHERE id = $1` |
| Transaction types at all offices | `SELECT * FROM transaction_types WHERE county_id = $1 AND office_id IS NULL AND status = 'active'` |
| Transaction types scoped to one office | `SELECT * FROM transaction_types WHERE county_id = $1 AND office_id = $2 AND status = 'active'` |
| All txn types available at an office (with override) | `SELECT DISTINCT ON (txn_type_id) * FROM transaction_types WHERE county_id = $1 AND (office_id IS NULL OR office_id = $2) AND status = 'active' ORDER BY txn_type_id, office_id NULLS LAST` |
| Online-eligible txn types | `SELECT * FROM transaction_types WHERE county_id = $1 AND is_online_eligible = TRUE AND status = 'active'` |
| All active clerks at an office | `SELECT * FROM clerks WHERE county_id = $1 AND $2 = ANY(office_ids) AND status = 'active'` |
| Clerks with a specific skill at an office | `SELECT * FROM clerks WHERE county_id = $1 AND $2 = ANY(office_ids) AND $3 = ANY(skill_ids) AND status = 'active'` |
| Hot button questions | `SELECT * FROM hotbuttons WHERE county_id = $1 ORDER BY sort_order` |
| Pre-screen questions for a txn type | `SELECT * FROM prescreen_questions WHERE txn_type_id = $1 ORDER BY sort_order` |
| All pre-screen questions | `SELECT pq.*, tt.name AS txn_name FROM prescreen_questions pq JOIN transaction_types tt ON pq.txn_type_id = tt.id WHERE pq.county_id = $1 ORDER BY pq.txn_type_id, pq.sort_order` |
| Document definition by doc_id | `SELECT * FROM document_registry WHERE county_id = $1 AND doc_id = $2` |
| All document definitions | `SELECT * FROM document_registry WHERE county_id = $1` |
| Transaction flow for a txn type | `SELECT steps FROM transaction_flows WHERE txn_type_id = $1` |
| All transaction flows | `SELECT tf.*, tt.name FROM transaction_flows tf JOIN transaction_types tt ON tf.txn_type_id = tt.id WHERE tf.county_id = $1` |
| Resolve docs from a completed flow | Walk `steps` in app code, collect `require_docs` doc_id, then `SELECT * FROM document_registry WHERE county_id = $1 AND doc_id = ANY($2::text[])` |
| Flows that require a specific doc | `SELECT txn_type_id FROM transaction_flows WHERE steps @> '[{"yes": {"require_docs": ["hsmv_82040"]}}]'` |

### Appointments & Scheduling

| Question | Query |
|----------|-------|
| Booked minutes for date/office/time range | `SELECT SUM(tt.avg_duration_min) FROM appointments a, unnest(a.txn_type_ids) AS tid JOIN transaction_types tt ON tt.id = tid WHERE a.county_id = $1 AND a.office_id = $2 AND a.appointment_date = $3 AND a.appointment_time BETWEEN $4 AND $5 AND a.status NOT IN ('cancelled','no_show')` |
| Appointments at a specific time | `SELECT * FROM appointments WHERE county_id = $1 AND office_id = $2 AND appointment_date = $3 AND appointment_time = $4 AND status NOT IN ('cancelled','no_show')` |
| Earliest ASAP availability | Compute: query appointments per office/date, compare against capacity from `offices` + `office_hours` + `office_lunch_shifts` |
| Lookup by QR | `SELECT * FROM appointments WHERE qr_code = $1` |
| Capacity check with skill matching | `SELECT COUNT(*) FROM clerks WHERE $1 = ANY(office_ids) AND $2 = ANY(skill_ids) AND status = 'active'` compared against booked appointments for that skill |

### Queue (Live Operations)

| Question | Query |
|----------|-------|
| Next in queue (skill-matched) | `SELECT q.* FROM queue q JOIN appointments a ON q.appointment_id = a.id WHERE q.county_id = $1 AND q.office_id = $2 AND q.status = 'waiting' AND a.txn_type_ids && $3::int[] ORDER BY q.is_priority DESC, q.checked_in_at LIMIT 1` |
| Customers currently testing | `SELECT * FROM queue WHERE county_id = $1 AND office_id = $2 AND status = 'testing'` |
| Lobby display (now serving) | `SELECT q.queue_number, q.assigned_desk, a.first_name, a.last_name FROM queue q JOIN appointments a ON q.appointment_id = a.id WHERE q.county_id = $1 AND q.office_id = $2 AND q.status = 'serving' AND q.assigned_desk IS NOT NULL ORDER BY q.checked_in_at` |
| Customer status by queue number | `SELECT status, assigned_desk FROM queue WHERE county_id = $1 AND office_id = $2 AND queue_number = $3 AND checked_in_at::date = CURRENT_DATE` |
| Appointments assigned to a specific clerk | `SELECT * FROM appointments WHERE county_id = $1 AND requested_clerk_id = $2 AND appointment_date = $3` |
| Available clerks | `SELECT * FROM clerk_sessions WHERE county_id = $1 AND office_id = $2 AND is_available = TRUE AND logged_out_at IS NULL` |
| Clerks currently on lunch | `SELECT cs.*, c.first_name, c.last_name FROM clerk_sessions cs JOIN clerks c ON cs.clerk_id = c.id WHERE cs.county_id = $1 AND cs.office_id = $2 AND cs.on_lunch_shift_id IS NOT NULL AND cs.logged_out_at IS NULL` |
| Available skills right now (excludes lunch) | `SELECT DISTINCT unnest(c.skill_ids) AS skill_id FROM clerk_sessions cs JOIN clerks c ON cs.clerk_id = c.id WHERE cs.county_id = $1 AND cs.office_id = $2 AND cs.is_available = TRUE AND cs.on_lunch_shift_id IS NULL AND cs.logged_out_at IS NULL` |

### Clerk Schedules

| Question | Query |
|----------|-------|
| Clerks scheduled at an office on a date | `SELECT cs.*, c.first_name, c.last_name, c.skill_ids FROM clerk_schedules cs JOIN clerks c ON cs.clerk_id = c.id WHERE cs.county_id = $1 AND cs.office_id = $2 AND cs.schedule_date = $3` |
| Where is a clerk scheduled on a date | `SELECT cs.*, o.name AS office_name FROM clerk_schedules cs JOIN offices o ON cs.office_id = o.id WHERE cs.county_id = $1 AND cs.clerk_id = $2 AND cs.schedule_date = $3` |
| Scheduled clerk count for capacity planning | `SELECT COUNT(*) FROM clerk_schedules WHERE county_id = $1 AND office_id = $2 AND schedule_date = $3` |

### Analytics

| Question | Query |
|----------|-------|
| Duration stats for recommendations | `SELECT AVG(sh.duration_min) FROM service_history sh JOIN service_history_txn_types sht ON sht.service_history_id = sh.id WHERE sh.county_id = $1 AND sht.txn_type_id = $2 AND sh.served_at > NOW() - INTERVAL '30 days'` |
| Pending recommendations | `SELECT * FROM duration_recommendations WHERE county_id = $1 AND status = 'pending'` |
| Estimate vs actual per service | `SELECT sh.id, ARRAY_AGG(sht.txn_type_id) AS txn_type_ids, sh.duration_min AS actual_min, SUM(tt.avg_duration_min) AS estimated_min FROM service_history sh JOIN service_history_txn_types sht ON sht.service_history_id = sh.id JOIN transaction_types tt ON tt.id = sht.txn_type_id WHERE sh.county_id = $1 AND sh.office_id = $2 AND sh.served_at > NOW() - INTERVAL '30 days' GROUP BY sh.id, sh.duration_min` |
| Average drift per txn type at office | `SELECT tt.id, tt.name, tt.avg_duration_min AS estimated_min, AVG(sh.duration_min) AS avg_actual_min, AVG(sh.duration_min) - tt.avg_duration_min AS avg_drift_min, COUNT(*) AS sample_size FROM service_history sh JOIN service_history_txn_types sht ON sht.service_history_id = sh.id JOIN transaction_types tt ON tt.id = sht.txn_type_id WHERE sh.county_id = $1 AND sh.office_id = $2 AND sh.served_at > NOW() - INTERVAL '30 days' GROUP BY tt.id, tt.name, tt.avg_duration_min` |

---

## Summary

| Table | Purpose |
|-------|---------|
| `offices` | Office locations, capacity, run rate |
| `office_hours` | Per-day operating hours |
| `office_lunch_shifts` | Lunch shift schedules for capacity reduction |
| `transaction_types` | Services offered (global or office-scoped, online-eligible flag) |
| `clerks` | Clerk profiles, skills, office assignments |
| `hotbuttons` | Chatbot quick-action buttons |
| `prescreen_questions` | Per-txn-type yes/no pre-screening questions |
| `document_registry` | Document definitions with alternatives |
| `transaction_flows` | Chatbot decision trees (JSONB) |
| `appointments` | Booking data + inlined customer contact (date, time, office, transactions, prescreen) |
| `documents` | Per-appointment uploaded documents |
| `queue` | Ephemeral queue state with customer-facing ticket number (today's active customers, includes testing status) |
| `service_history` | PII-free per-service duration log for analytics |
| `service_history_txn_types` | Junction table linking service_history rows to their transaction types |
| `duration_recommendations` | Admin approval workflow for duration updates |
| `clerk_sessions` | Who's logged in at which desk, lunch shift tracking |
| `clerk_schedules` | Which clerk is assigned to which office on what day |
