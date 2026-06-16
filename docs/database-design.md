# Database Design

## Overview

All data lives in a single RDS Postgres instance. Table definitions are in [`db/schema.sql`](../db/schema.sql).

Multi-tenancy is handled by `county_id` on every table. Each county's data is logically isolated via Row-Level Security. This scales from 1 county (St. Lucie) to 67 (all of Florida) without re-architecting.

---

## Config Tables

Admin-managed configuration. Low volume, read-heavy, rarely written.

- **counties** — Per-tenant scheduling defaults (timezone, block padding, lookahead days). The `id` column is the same value used as `county_id` everywhere else.
- **offices** — Office locations with desk count and run rate percentage.
- **office_hours** — One row per office per day-of-week. Enforces one entry per office per day.
- **office_lunch_shifts** — Overlapping lunch shift windows that reduce capacity.
- **transaction_types** — Services offered. `office_id = NULL` means global default; a row with `office_id` set is a per-office override (status, available_from/until).
- **clerks** — Clerk profiles with skill_ids (transaction_types they can handle) and office_ids (offices they can be assigned to).
- **hotbuttons** — Ordered quick-action prompts for the chatbot.
- **prescreen_questions** — Per-transaction-type yes/no pre-screening questions. If a txn type has no rows here, pre-screening is skipped.
- **document_registry** — Shared document definitions referenced by `doc_id` from transaction flows. Includes alternative document options.
- **transaction_flows** — Deterministic decision trees (JSONB) for chatbot pre-screening. `doc_id` strings in steps resolve against `document_registry` using the same `county_id`.

### Transaction Flow JSON Structure

Each `steps` value is an ordered array of decision nodes. The chatbot walks the tree, follows branches based on customer answers, and accumulates the required documents list.

Node types:
- `yes_no` — binary branch with `yes` / `no` paths
- `conditional` — multiple branches based on answer matching (`conditions` list with `if` / `require_docs` / `next`)
- `info` — display-only node (no branching), advances to `next`

Each branch can specify `require_docs` (list of `document_registry.doc_id` values, resolved against the same `county_id` as the flow row) and `next` (ID of the next node, or `null` to end).

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

---

## Capacity Model

Slot availability is governed by two independent constraints — both must pass:

1. **Per-skill supply** — Each clerk's `clerk_schedules.lunch_shift_id` ties them to a specific lunch shift window. To compute per-skill capacity at a given time, count clerks on overlapping shifts filtered by skill. Lunch reduces per-skill supply because clerks on lunch are subtracted from the available pool for each of their skills. A slot is rejected if demand for any required skill would exceed its supply. Clerk absences (`clerk_absences` table) also subtract from supply.

2. **Total desk cap** — `LEAST(effective_desks, clerks_on_floor)` minus total concurrent appointments at that time. `effective_desks` is `floor(total_desks * run_rate_pct / 100)`. This ensures you can never book more concurrent appointments than clerks physically on the floor, regardless of skill distribution. The remaining capacity (when `run_rate_pct < 100`) is reserved for walk-ins.

Both constraints are checked independently. A slot can fail on per-skill supply even when desk capacity is available, or vice versa.

The `validate_slot` function in `schema.sql` implements this as a change-point sweep — it evaluates capacity at every moment where supply or demand shifts within the appointment window.

---

## Transactional Tables

- **appointments** — Write-once booking data with inlined customer contact info (no separate customers table). PII is scoped to a single appointment lifecycle for easy purging.
- **documents** — Per-appointment uploaded documents with optional AI review status.
- **queue** — Ephemeral high-write state for today's active customers. Customer-facing ticket number assigned at check-in, unique per office+day.
- **service_history** — PII-free per-service duration log for analytics. No customer or clerk linkage.
- **service_history_txn_types** — Junction table linking service_history rows to their transaction types (normalized from array for FK integrity).
- **duration_recommendations** — Admin approval workflow for updating avg_duration_min based on observed actuals.
- **clerk_sessions** — Who's logged in at which desk, with availability tracking.
- **clerk_schedules** — Which clerk is assigned to which office on what day, with lunch shift assignment. One office per clerk per day.
- **clerk_absences** — Date ranges when clerks are unavailable (vacation, sick, etc.). Used by capacity planning.

---

## Row-Level Security (RLS)

All tables use PostgreSQL Row-Level Security to enforce tenant isolation at the database level. Each table gets an RLS policy that matches `county_id` against a session variable (`app.current_tenant`). The application sets this variable at the start of each request, and PostgreSQL automatically filters all reads and writes to that county. This prevents cross-county data access even if the application layer has a bug.

---

## Access Patterns

### Config

| Question | Query |
|----------|-------|
| Office capacities | `SELECT total_desks, run_rate_pct FROM offices WHERE id = $1` |
| Office by office_name | `SELECT * FROM offices WHERE county_id = $1 AND office_name = $2` |
| Office operating hours | `SELECT * FROM office_hours WHERE office_id = $1 ORDER BY day_of_week` |
| Lunch shifts / timing | `SELECT * FROM office_lunch_shifts WHERE office_id = $1 ORDER BY start_time` |
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
| Available clerks | `SELECT * FROM clerk_sessions WHERE county_id = $1 AND office_id = $2 AND is_available = TRUE AND logged_out_at IS NULL` |
| Clerks currently on lunch | `SELECT cs.*, c.first_name, c.last_name FROM clerk_sessions cs JOIN clerks c ON cs.clerk_id = c.id WHERE cs.county_id = $1 AND cs.office_id = $2 AND cs.is_available = FALSE AND cs.logged_out_at IS NULL` |
| Available skills right now | `SELECT DISTINCT unnest(c.skill_ids) AS skill_id FROM clerk_sessions cs JOIN clerks c ON cs.clerk_id = c.id WHERE cs.county_id = $1 AND cs.office_id = $2 AND cs.is_available = TRUE AND cs.logged_out_at IS NULL` |

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
