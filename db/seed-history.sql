-- St. Lucie Tax System — Historical Performance Seed Data
-- Generates ~1 year of realistic service history to populate the admin
-- Performance page (daily volume, avg service times, per-transaction stats,
-- wait times, office comparison, clerk performance, duration recommendations).
--
-- Prerequisites: run schema.sql and seed.sql first (offices, clerks, txn types).
-- This script is idempotent (TRUNCATEs related tables before inserting).
--
-- Data model:
--   appointment (completed) → queue (done) → service_history → service_history_txn_types
--   Also: duration_recommendations

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Clean slate for history tables (preserves reference data)
-- ─────────────────────────────────────────────────────────────────────────────
TRUNCATE service_history_txn_types, service_history, queue, queue_counters,
         appointments, duration_recommendations CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Configuration
-- ─────────────────────────────────────────────────────────────────────────────
-- Use setseed for reproducible "random" data
SELECT setseed(0.7);

-- ─────────────────────────────────────────────────────────────────────────────
-- Generate working days for the past year (Mon-Fri only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE work_days AS
SELECT d::date AS work_date, ROW_NUMBER() OVER (ORDER BY d) AS day_num
FROM generate_series(
    CURRENT_DATE - interval '365 days',
    CURRENT_DATE - interval '1 day',
    '1 day'
) d
WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

-- ─────────────────────────────────────────────────────────────────────────────
-- Build a weighted array of transaction type IDs for sampling.
-- Each type appears N times proportional to its frequency weight.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE txn_weighted_pool AS
SELECT ROW_NUMBER() OVER (ORDER BY id, n) AS idx, id AS txn_type_id
FROM transaction_types
CROSS JOIN LATERAL generate_series(1,
    CASE
        WHEN id IN (2, 7, 9)       THEN 5   -- dl-renewal, reg-renewal, property-tax (high volume)
        WHEN id IN (1, 4, 5, 6)    THEN 4   -- dl-transfer, dl-address-change, title-transfer, registration
        WHEN id IN (3, 14, 16)     THEN 3   -- dl-name-change, dl-replacement, real-id-upgrade
        WHEN id IN (11, 13, 15)    THEN 2   -- hunting-fishing, handicap-placard, id-card
        WHEN id IN (8, 10, 17, 18) THEN 1   -- road-test, concealed-weapon, cdl, learner-permit
        ELSE 1
    END
) AS copies(n)
WHERE status = 'active';

-- Count for modular indexing
DO $$ BEGIN PERFORM set_config('seed.pool_size', (SELECT COUNT(*)::text FROM txn_weighted_pool), true); END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Generate appointments and service visits.
-- Target: ~15-25 customers per office per day (realistic for a 3-clerk office
-- serving 8am-5pm with 15-30 min avg transaction). Total ~10,000-12,000 visits.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Create appointments (completed status)
-- Each work day, each office gets 15-25 completed appointments.
-- We pre-assign txn_type_ids in the temp table to avoid subquery caching.
CREATE TEMP TABLE gen_appointments AS
WITH daily_counts AS (
    SELECT
        wd.work_date,
        office_id,
        -- Vary volume: busier Mon/Tue, lighter Fri, seasonal bump Oct-Mar (tax season)
        GREATEST(12, LEAST(28,
            18 +
            CASE EXTRACT(DOW FROM wd.work_date)
                WHEN 1 THEN 3  -- Monday
                WHEN 2 THEN 2  -- Tuesday
                WHEN 5 THEN -3 -- Friday
                ELSE 0
            END +
            CASE
                WHEN EXTRACT(MONTH FROM wd.work_date) IN (10, 11, 12, 1, 2, 3) THEN 3
                ELSE -1
            END +
            FLOOR(random() * 7 - 3)  -- random jitter ±3
        ))::int AS num_customers
    FROM work_days wd
    CROSS JOIN (VALUES (1), (2)) AS offices(office_id)
),
expanded AS (
    SELECT
        dc.work_date,
        dc.office_id,
        generate_series(1, dc.num_customers) AS seq
    FROM daily_counts dc
)
SELECT
    e.work_date,
    e.office_id,
    e.seq,
    (random() < 0.30) AS is_walk_in,
    ('08:00'::time + (FLOOR(random() * 32) * interval '15 minutes'))::time AS appt_time,
    -- Assign a random row number into the weighted pool (1-based)
    (1 + FLOOR(random() * current_setting('seed.pool_size')::int))::int AS txn_idx1,
    (1 + FLOOR(random() * current_setting('seed.pool_size')::int))::int AS txn_idx2,
    (random() < 0.80) AS is_single_txn
FROM expanded e;

-- Insert appointments, joining to the weighted pool to resolve txn IDs
INSERT INTO appointments (
    office_id, first_name, last_name, contact_email, contact_phone,
    txn_type_ids, appointment_date, appointment_time,
    status, is_walk_in, is_priority, created_at
)
SELECT
    ga.office_id,
    (ARRAY['John','Jane','Robert','Maria','David','Lisa','Michael','Sarah',
           'William','Jennifer','Richard','Angela','Thomas','Nancy','James',
           'Patricia','Charles','Karen','Joseph','Betty'])[1 + (ga.seq % 20)],
    (ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller',
           'Davis','Rodriguez','Martinez','Wilson','Anderson','Taylor','Thomas',
           'Jackson','White','Harris','Martin','Thompson','Clark'])[1 + ((ga.seq * 7) % 20)],
    'customer' || ROW_NUMBER() OVER () || '@example.com',
    '772555' || LPAD((ga.seq * 13 % 10000)::text, 4, '0'),
    CASE
        WHEN ga.is_single_txn THEN ARRAY[p1.txn_type_id]
        ELSE ARRAY[p1.txn_type_id, p2.txn_type_id]
    END,
    ga.work_date,
    ga.appt_time,
    'completed',
    ga.is_walk_in,
    (ga.seq % 20 = 0),  -- 5% priority
    ga.work_date - ((ga.seq % 7) || ' days')::interval
FROM gen_appointments ga
JOIN txn_weighted_pool p1 ON p1.idx = ga.txn_idx1
JOIN txn_weighted_pool p2 ON p2.idx = ga.txn_idx2;

-- Step 2: Create queue entries for each appointment
-- Queue tracks check-in → service start (wait time)
INSERT INTO queue (
    office_id, appointment_id, queue_number, status,
    checked_in_at, served_at, assigned_clerk_id, assigned_desk
)
SELECT
    a.office_id,
    a.id,
    ROW_NUMBER() OVER (PARTITION BY a.office_id, a.appointment_date ORDER BY a.appointment_time, a.id),
    'done',
    -- checked_in_at: 0-10 minutes before appointment_time
    (a.appointment_date + a.appointment_time)::timestamptz
        - (FLOOR(random() * 10) || ' minutes')::interval,
    -- served_at: 5-25 minutes after check-in (realistic wait time)
    (a.appointment_date + a.appointment_time)::timestamptz
        + (5 + FLOOR(random() * 20) || ' minutes')::interval,
    -- Assign to a clerk in the correct office
    CASE
        WHEN a.office_id = 1 THEN 1 + FLOOR(random() * 3)  -- clerks 1-3
        ELSE 4 + FLOOR(random() * 3)  -- clerks 4-6
    END,
    1 + FLOOR(random() * 3)  -- desk 1-3
FROM appointments a
WHERE a.status = 'completed';

-- Step 3: Create service_history entries
-- Duration varies around the transaction type's avg_duration_min with realistic spread
INSERT INTO service_history (
    office_id, appointment_id, clerk_id, duration_sec, served_at
)
SELECT
    q.office_id,
    q.appointment_id,
    q.assigned_clerk_id,
    -- Duration in seconds: base on txn avg ± 30% variance, clamped to 3-90 min
    GREATEST(180, LEAST(5400,
        (tt.avg_duration_min * 60) +
        FLOOR((random() - 0.5) * 2 * tt.avg_duration_min * 60 * 0.30) +
        -- Clerk skill variance (some clerks are faster)
        CASE q.assigned_clerk_id
            WHEN 1 THEN -60  -- Maria is fast
            WHEN 2 THEN 30   -- James slightly slower
            WHEN 3 THEN 0    -- Angela average
            WHEN 4 THEN -30  -- Jennifer slightly fast
            WHEN 5 THEN 60   -- Thomas slower (thorough)
            WHEN 6 THEN -15  -- Nancy slightly fast
            ELSE 0
        END
    ))::int,
    q.served_at  -- Service starts when served
FROM queue q
JOIN appointments a ON a.id = q.appointment_id
-- Use the first txn_type from the appointment's array for duration calculation
JOIN transaction_types tt ON tt.id = a.txn_type_ids[1]
WHERE q.status = 'done';

-- Step 4: Create service_history_txn_types junction records
-- Link each service_history entry to its transaction type(s)
-- Use DISTINCT to handle cases where both txn slots got the same type
INSERT INTO service_history_txn_types (service_history_id, txn_type_id)
SELECT DISTINCT sh.id, unnest(a.txn_type_ids)
FROM service_history sh
JOIN appointments a ON a.id = sh.appointment_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Queue counters (track daily numbering)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO queue_counters (office_id, counter_date, last_number)
SELECT q.office_id, a.appointment_date, MAX(q.queue_number)
FROM queue q
JOIN appointments a ON a.id = q.appointment_id
GROUP BY q.office_id, a.appointment_date
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Duration Recommendations (generated by nightly worker)
-- Mix of pending, approved, and rejected
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO duration_recommendations (txn_type_id, current_avg_min, recommended_avg_min, sample_size, status, created_at) VALUES
-- Pending recommendations (recent)
(1,  25, 22, 145, 'pending',  NOW() - interval '2 days'),   -- dl-transfer: data suggests shorter
(5,  20, 23, 198, 'pending',  NOW() - interval '1 day'),    -- vehicle-title-transfer: slightly longer
(8,  45, 40, 87,  'pending',  NOW() - interval '3 days'),   -- road-test: trending shorter
-- Approved (applied in the past)
(2,  20, 15, 312, 'approved', NOW() - interval '45 days'),  -- dl-renewal: was 20, approved down to 15
(7,  15, 10, 420, 'approved', NOW() - interval '60 days'),  -- reg-renewal: was 15, approved down to 10
(9,  15, 10, 380, 'approved', NOW() - interval '30 days'),  -- property-tax: was 15, approved down to 10
-- Rejected (admin decided to keep current)
(10, 30, 35, 52,  'rejected', NOW() - interval '20 days'),  -- concealed-weapon: sample too small
(17, 30, 25, 63,  'rejected', NOW() - interval '15 days');  -- cdl: complex varies too much

-- ─────────────────────────────────────────────────────────────────────────────
-- Clean up temp tables
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS gen_appointments;
DROP TABLE IF EXISTS txn_weighted_pool;
DROP TABLE IF EXISTS work_days;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Summary: verify inserted counts
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'appointments' AS "table", COUNT(*) AS rows FROM appointments
UNION ALL
SELECT 'queue', COUNT(*) FROM queue
UNION ALL
SELECT 'service_history', COUNT(*) FROM service_history
UNION ALL
SELECT 'service_history_txn_types', COUNT(*) FROM service_history_txn_types
UNION ALL
SELECT 'duration_recommendations', COUNT(*) FROM duration_recommendations;
