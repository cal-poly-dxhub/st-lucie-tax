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
-- Transaction Types (all 32 chatbot transaction types)
-- skill_ids reference: 1=road-test, 2=id-card, 3=license-original
-- =============================================================================
INSERT INTO transaction_types (txn_type_id, name, description, avg_duration_min, status, available_from, available_until) VALUES
    ('road-test',                    'Road Test',                       'Behind-the-wheel driving test',                       30, 'active', '09:00', '15:00'),
    ('id-card',                      'State ID Card',                   'Non-driver identification card',                      15, 'active', NULL,    NULL),
    ('license-original',             'Original Driver License',         'First-time FL driver license',                        20, 'active', NULL,    NULL),
    ('business-tax-receipt',         'Business Tax Receipt',            'Local business tax receipt application or renewal',    15, 'active', NULL,    NULL),
    ('cdl',                          'Commercial Driver License',       'CDL original, renewal, or endorsement',               30, 'active', NULL,    NULL),
    ('concealed-weapon',             'Concealed Weapon Permit',         'Concealed weapon or firearm license application',     20, 'active', NULL,    NULL),
    ('dealer-title-dropoff',         'Dealer Title Drop-off',           'Dealer title work drop-off',                          15, 'active', NULL,    NULL),
    ('dl-address-change',            'DL Address Change',               'Update address on driver license',                    10, 'active', NULL,    NULL),
    ('dl-name-change',               'DL Name Change',                  'Update name on driver license',                       15, 'active', NULL,    NULL),
    ('dl-renewal',                   'DL Renewal',                      'Renew an existing driver license',                    15, 'active', NULL,    NULL),
    ('dl-replacement',               'DL Replacement',                  'Replace a lost or damaged driver license',            15, 'active', NULL,    NULL),
    ('dl-sanctions-lift',            'DL Sanctions Lift',               'Reinstate a suspended or revoked driver license',     20, 'active', NULL,    NULL),
    ('dl-transfer',                  'DL Transfer',                     'Transfer out-of-state license to Florida',            20, 'active', NULL,    NULL),
    ('duplicate-title',              'Duplicate Title',                 'Obtain a duplicate vehicle title',                    15, 'active', NULL,    NULL),
    ('handicap-placard',             'Handicap Placard',                'Apply for or renew a disabled parking permit',        10, 'active', NULL,    NULL),
    ('hunting-fishing',              'Hunting/Fishing License',         'Hunting or fishing license purchase',                 10, 'active', NULL,    NULL),
    ('learner-permit',               'Learner Permit',                  'First-time learner permit application',               20, 'active', NULL,    NULL),
    ('mobile-home-retire',           'Mobile Home Retirement',          'Retire a mobile home title',                          20, 'active', NULL,    NULL),
    ('mobile-home-title',            'Mobile Home Title',               'Title a mobile home',                                 25, 'active', NULL,    NULL),
    ('new-vehicle-title',            'New Vehicle Title',               'Title a newly purchased vehicle',                     20, 'active', NULL,    NULL),
    ('plate-surrender',              'Plate Surrender',                 'Surrender a license plate',                           10, 'active', NULL,    NULL),
    ('property-tax',                 'Property Tax',                    'Property tax payment or inquiry',                     15, 'active', NULL,    NULL),
    ('real-id-upgrade',              'REAL ID Upgrade',                 'Upgrade existing license to REAL ID compliant',       20, 'active', NULL,    NULL),
    ('registration-renewal',         'Registration Renewal',            'Renew vehicle registration',                          10, 'active', NULL,    NULL),
    ('specialty-plate',              'Specialty Plate',                 'Order or renew a specialty license plate',            15, 'active', NULL,    NULL),
    ('tag-replacement',              'Tag Replacement',                 'Replace a lost or damaged license plate tag',         10, 'active', NULL,    NULL),
    ('tangible-personal-property-tax','Tangible Personal Property Tax', 'Tangible personal property tax filing or payment',    15, 'active', NULL,    NULL),
    ('tourist-development-tax',      'Tourist Development Tax',         'Tourist development tax filing or payment',           15, 'active', NULL,    NULL),
    ('trailer-registration',         'Trailer Registration',            'Register a trailer',                                  15, 'active', NULL,    NULL),
    ('vehicle-registration',         'Vehicle Registration',            'Register a vehicle',                                  15, 'active', NULL,    NULL),
    ('vehicle-title-transfer',       'Vehicle Title Transfer',          'Transfer vehicle title to a new owner',              20, 'active', NULL,    NULL),
    ('vessel-registration',          'Vessel Registration',             'Register a boat or vessel',                           20, 'active', NULL,    NULL),
    ('written-test',                 'Written Test',                    'Written knowledge test for driver license',           30, 'active', '09:00', '15:00');

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
-- txn_type_id: 1=road-test, 2=id-card, 3=license-original
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
--   Maria  (Fort Pierce): all skills — the only road-test + license-original clerk here
--   James  (Fort Pierce): id-card + license-original
--   Angela (Fort Pierce): road-test + id-card
--   Jennifer (SL West):   all skills
--   Thomas   (SL West):   id-card + license-original
--   Nancy    (SL West):   road-test + id-card
-- =============================================================================
INSERT INTO clerks (first_name, last_name, email, status, skill_ids, office_ids) VALUES
    ('Maria',    'Santos',   'maria.santos@stlucie.gov',   'active', '{1,2,3}', '{1}'),
    ('James',    'Wilson',   'james.wilson@stlucie.gov',   'active', '{2,3}',   '{1}'),
    ('Angela',   'Brown',    'angela.brown@stlucie.gov',   'active', '{1,2}',   '{1}'),
    ('Jennifer', 'Clark',    'jennifer.clark@stlucie.gov', 'active', '{1,2,3}', '{2}'),
    ('Thomas',   'Lewis',    'thomas.lewis@stlucie.gov',   'active', '{2,3}',   '{2}'),
    ('Nancy',    'Robinson', 'nancy.robinson@stlucie.gov', 'active', '{1,2}',   '{2}');

-- =============================================================================
-- Clerk Schedules (weekdays, full year from today)
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
    FROM generate_series(CURRENT_DATE, CURRENT_DATE + interval '1 year', '1 day') d
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
    FROM generate_series(CURRENT_DATE, CURRENT_DATE + interval '1 year', '1 day') d
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
) d
WHERE c.id BETWEEN 4 AND 6;
