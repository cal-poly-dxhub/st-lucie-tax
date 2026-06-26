-- St. Lucie Tax System — Production Seed Data (no sample appointments)
-- Config, offices, hours, lunch shifts, transaction types, documents,
-- prescreen questions, clerks, and clerk schedules.

-- =============================================================================
-- Config (single row)
-- =============================================================================
INSERT INTO config (timezone, scheduling_block_padding, default_lookahead_days) VALUES
    ('America/New_York', 0, 14);

-- =============================================================================
-- Offices (2 locations, 3 desks each)
-- =============================================================================
INSERT INTO offices (name, address, total_desks, run_rate_pct) VALUES
    ('Fort Pierce Office',    '2300 Virginia Ave, Fort Pierce, FL 34982',          3, 100),
    ('St. Lucie West Office', '250 NW Country Club Dr, Port St. Lucie, FL 34986', 3, 100);

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
-- Prescreen Questions (per transaction type)
-- txn_type_id: 1=road_test, 2=id_card, 3=license_original
-- =============================================================================
INSERT INTO prescreen_questions (txn_type_id, sort_order, question_text) VALUES
    (1, 1, 'Do you currently hold a valid Florida learner permit?'),
    (1, 2, 'Have you completed the required 50 hours of supervised driving?'),
    (1, 3, 'Is the vehicle you will use for the test registered and insured in Florida?'),
    (1, 4, 'Are all mirrors, lights, and signals on the test vehicle functioning properly?'),
    (2, 1, 'Are you a U.S. citizen or lawful permanent resident?'),
    (2, 2, 'Do you have a valid Social Security Number?'),
    (2, 3, 'Do you have two forms of proof of residential address?'),
    (3, 1, 'Are you a U.S. citizen or lawful permanent resident?'),
    (3, 2, 'Do you have a valid Social Security Number?'),
    (3, 3, 'Have you passed the written knowledge test (or hold a valid learner permit)?'),
    (3, 4, 'Do you have proof of completion of a traffic law and substance abuse course?'),
    (3, 5, 'Do you currently wear corrective lenses for driving?');

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
