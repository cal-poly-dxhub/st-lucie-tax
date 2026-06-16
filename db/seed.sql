-- St. Lucie Tax System — Seed Data for Scheduling Engine Queries
-- Adapted from schedule-engine-poc branch, aligned to current database-design.md schema.
-- Fixed date range: 2026-05-12 through 2026-05-22 (weekdays only)
-- 2 offices, 3 clerks each, 3 transaction types, ~50% capacity bookings

-- =============================================================================
-- Config (single row)
-- =============================================================================
INSERT INTO config (timezone, scheduling_block_padding, default_lookahead_days) VALUES
    ('America/New_York', 0, 14);

-- =============================================================================
-- Offices (2 locations, 3 desks each)
-- =============================================================================
INSERT INTO offices (office_name, name, address, total_desks, run_rate_pct) VALUES
    ('ftpierce', 'Fort Pierce Office',    '2300 Virginia Ave, Fort Pierce, FL 34982',          3, 100),
    ('slwest',   'St. Lucie West Office', '250 NW Country Club Dr, Port St. Lucie, FL 34986', 3, 100);

-- =============================================================================
-- Office Hours (Mon-Fri 8am-5pm)
-- =============================================================================
INSERT INTO office_hours (office_id, day_of_week, open_time, close_time) VALUES
    (1, 1, '08:00', '17:00'),
    (1, 2, '08:00', '17:00'),
    (1, 3, '08:00', '17:00'),
    (1, 4, '08:00', '17:00'),
    (1, 5, '08:00', '17:00'),
    (2, 1, '08:00', '17:00'),
    (2, 2, '08:00', '17:00'),
    (2, 3, '08:00', '17:00'),
    (2, 4, '08:00', '17:00'),
    (2, 5, '08:00', '17:00');

-- =============================================================================
-- Lunch Shifts (2 shifts per office, 45 min each)
-- Fort Pierce: 1 clerk out 11:30-12:15, then 2 clerks out 12:15-13:00
-- St. Lucie West: 2 clerks out 11:30-12:15, then 1 clerk out 12:15-13:00
-- =============================================================================
INSERT INTO office_lunch_shifts (office_id, shift_num, start_time, end_time) VALUES
    (1, 1, '11:30', '12:15'),
    (1, 2, '12:15', '13:00'),
    (2, 1, '11:30', '12:15'),
    (2, 2, '12:15', '13:00');

-- =============================================================================
-- Transaction Types (3 types, global — no office override)
-- skill_ids reference: 1=road_test, 2=id_card, 3=license_original
-- =============================================================================
INSERT INTO transaction_types (txn_type_id, name, description, avg_duration_min, status, available_from, available_until) VALUES
    ('road_test',        'Road Test',               'Behind-the-wheel driving test',    30, 'active', '09:00', '15:00'),
    ('id_card',          'State ID Card',           'Non-driver identification card',   15, 'active', NULL,    NULL),
    ('license_original', 'Original Driver License', 'First-time FL driver license',     20, 'active', NULL,    NULL);

-- =============================================================================
-- Document Registry (required documents per transaction type)
-- =============================================================================
INSERT INTO document_registry (doc_id, name, description, alternatives) VALUES
    ('photo_id',       'Photo ID',                'Government-issued photo identification',         '{"passport","military_id"}'),
    ('proof_address',  'Proof of Residency',      'Utility bill, bank statement, or lease within 60 days', '{}'),
    ('ssn_proof',      'Social Security Proof',   'SSN card or W-2 showing full SSN',              '{"w2"}'),
    ('birth_cert',     'Birth Certificate',       'Certified US birth certificate or passport',    '{"passport"}'),
    ('learner_permit', 'Learner Permit',          'Valid FL learner permit',                        '{}'),
    ('vision_cert',    'Vision Certificate',      'Vision test results from licensed provider',     '{}'),
    ('vehicle_reg',    'Vehicle Registration',    'Current vehicle registration for test vehicle',  '{}'),
    ('insurance_card', 'Insurance Card',          'Proof of insurance for test vehicle',            '{}');

-- =============================================================================
-- Clerks (3 per office, distributed skills)
--   Maria  (Fort Pierce): all skills — the only road_test + license_original clerk here
--   James  (Fort Pierce): id_card + license_original
--   Angela (Fort Pierce): road_test + id_card
--   Jennifer (SL West):   all skills
--   Thomas   (SL West):   id_card + license_original
--   Nancy    (SL West):   road_test + id_card
-- =============================================================================
INSERT INTO clerks (first_name, last_name, email, status, skill_ids, office_ids) VALUES
    ('Maria',    'Santos',   'maria.santos@stlucie.gov',   'active', '{1,2,3}', '{1}'),
    ('James',    'Wilson',   'james.wilson@stlucie.gov',   'active', '{2,3}',   '{1}'),
    ('Angela',   'Brown',    'angela.brown@stlucie.gov',   'active', '{1,2}',   '{1}'),
    ('Jennifer', 'Clark',    'jennifer.clark@stlucie.gov', 'active', '{1,2,3}', '{2}'),
    ('Thomas',   'Lewis',    'thomas.lewis@stlucie.gov',   'active', '{2,3}',   '{2}'),
    ('Nancy',    'Robinson', 'nancy.robinson@stlucie.gov', 'active', '{1,2}',   '{2}');

-- =============================================================================
-- Clerk Schedules (weekdays 2026-05-12 through 2026-05-22)
-- All 3 Fort Pierce clerks scheduled every weekday at office 1
-- All 3 St. Lucie West clerks scheduled every weekday at office 2
-- =============================================================================
INSERT INTO clerk_schedules (clerk_id, office_id, schedule_date, lunch_shift_id)
SELECT c.id, 1, d.dt,
    CASE c.id
        WHEN 1 THEN 1  -- clerk 1 on shift 1 (11:30-12:15)
        WHEN 2 THEN 2  -- clerk 2 on shift 2 (12:15-13:00)
        WHEN 3 THEN 2  -- clerk 3 on shift 2 (12:15-13:00)
    END
FROM clerks c
CROSS JOIN (
    SELECT d::date AS dt
    FROM generate_series('2026-05-12'::date, '2026-05-22'::date, '1 day') d
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
) d
WHERE c.id BETWEEN 1 AND 3;

INSERT INTO clerk_schedules (clerk_id, office_id, schedule_date, lunch_shift_id)
SELECT c.id, 2, d.dt,
    CASE c.id
        WHEN 4 THEN 3  -- clerk 4 on shift 1 (11:30-12:15)
        WHEN 5 THEN 3  -- clerk 5 on shift 1 (11:30-12:15)
        WHEN 6 THEN 4  -- clerk 6 on shift 2 (12:15-13:00)
    END
FROM clerks c
CROSS JOIN (
    SELECT d::date AS dt
    FROM generate_series('2026-05-12'::date, '2026-05-22'::date, '1 day') d
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
) d
WHERE c.id BETWEEN 4 AND 6;

-- =============================================================================
-- Appointments (~40-45 per office per day, ~50% capacity)
-- Randomly distributed across 15-min slots from 08:00–16:45
-- =============================================================================
DO $$
DECLARE
    first_names TEXT[] := ARRAY[
        'James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda',
        'David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica',
        'Thomas','Sarah','Christopher','Karen','Charles','Lisa','Daniel','Nancy',
        'Matthew','Betty','Anthony','Margaret','Mark','Sandra','Donald','Ashley',
        'Steven','Kimberly','Paul','Emily','Andrew','Donna','Joshua','Michelle',
        'Kenneth','Carol','Kevin','Amanda','Brian','Dorothy','George','Melissa',
        'Timothy','Deborah'];
    last_names TEXT[] := ARRAY[
        'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
        'Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson',
        'Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson',
        'White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker',
        'Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores',
        'Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell',
        'Carter','Roberts'];
    -- Required docs by txn_type_id: 1=road_test, 2=id_card, 3=license_original
    road_test_docs TEXT[] := ARRAY['learner_permit','photo_id','vision_cert','vehicle_reg','insurance_card'];
    id_card_docs TEXT[] := ARRAY['birth_cert','proof_address','ssn_proof'];
    license_docs TEXT[] := ARRAY['learner_permit','photo_id','proof_address','ssn_proof'];
    day_date DATE;
    office_id_val INT;
    appt_count INT;
    i INT;
    rand_slot INT;
    rand_txn INT;
    slot_time TIME;
    fname TEXT;
    lname TEXT;
    seq INT := 0;
    appt_id INT;
    req_docs TEXT[];
    doc_upload_roll FLOAT;
    doc_idx INT;
BEGIN
    PERFORM setseed(0.42);

    FOR office_id_val IN 1..2 LOOP
        FOR day_date IN
            SELECT d::date FROM generate_series('2026-05-12'::date, '2026-05-22'::date, '1 day') d
            WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
        LOOP
            appt_count := 40 + floor(random() * 6)::int;

            FOR i IN 1..appt_count LOOP
                rand_slot := floor(random() * 35)::int;  -- 35 slots × 15 min = 08:00–16:45
                rand_txn := 1 + floor(random() * 3)::int;
                slot_time := '08:00'::time + (rand_slot * interval '15 minutes');
                fname := first_names[1 + floor(random() * 50)::int];
                lname := last_names[1 + floor(random() * 50)::int];
                seq := seq + 1;

                -- Determine required docs based on txn type
                CASE rand_txn
                    WHEN 1 THEN req_docs := road_test_docs;
                    WHEN 2 THEN req_docs := id_card_docs;
                    WHEN 3 THEN req_docs := license_docs;
                END CASE;

                INSERT INTO appointments (
                    office_id, first_name, last_name,
                    contact_email, contact_phone, txn_type_ids, required_doc_ids,
                    appointment_date, appointment_time, qr_code, status, is_walk_in
                ) VALUES (
                    office_id_val, fname, lname,
                    lower(fname) || '.' || lower(lname) || seq || '@email.com',
                    '772-555-' || lpad(seq::text, 4, '0'),
                    ARRAY[rand_txn], req_docs,
                    day_date, slot_time,
                    'QR-' || lpad(seq::text, 5, '0'),
                    'scheduled', FALSE
                ) RETURNING id INTO appt_id;

                -- Pre-populate documents: ~65% fully uploaded, ~20% partially, ~15% none
                doc_upload_roll := random();
                IF doc_upload_roll < 0.65 THEN
                    -- All docs uploaded
                    FOR doc_idx IN 1..array_length(req_docs, 1) LOOP
                        INSERT INTO documents (appointment_id, doc_id, name, ai_review_status)
                        VALUES (appt_id, req_docs[doc_idx],
                                (SELECT dr.name FROM document_registry dr WHERE dr.doc_id = req_docs[doc_idx]),
                                'accept');
                    END LOOP;
                ELSIF doc_upload_roll < 0.85 THEN
                    -- Partial upload: upload first N-1 docs
                    FOR doc_idx IN 1..GREATEST(1, array_length(req_docs, 1) - 1) LOOP
                        INSERT INTO documents (appointment_id, doc_id, name, ai_review_status)
                        VALUES (appt_id, req_docs[doc_idx],
                                (SELECT dr.name FROM document_registry dr WHERE dr.doc_id = req_docs[doc_idx]),
                                CASE WHEN random() > 0.1 THEN 'accept' ELSE 'reject' END);
                    END LOOP;
                END IF;
                -- else: no docs uploaded (15%)
            END LOOP;
        END LOOP;
    END LOOP;
END $$;
