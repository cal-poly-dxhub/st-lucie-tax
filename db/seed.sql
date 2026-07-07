-- St. Lucie Tax System — Consolidated Seed Data
-- Config, offices, hours, lunch shifts, transaction types, document registry,
-- prescreen questions, clerks, clerk schedules, and a sparse set of sample
-- appointments (~10% of capacity) for local dev / demo purposes.

BEGIN;

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
-- Transaction Types (32 types, source: chatbot-prototype branch)
-- Insertion order determines serial id 1-32, referenced below by clerk skill_ids
-- =============================================================================
INSERT INTO transaction_types (txn_type_id, name, description, avg_duration_min, status, is_online_eligible, online_redirect_url, available_from, available_until) VALUES
('dl-transfer', 'Driver License Transfer (Out-of-State)', 'Transfer an out-of-state or out-of-country driver license to Florida. Required for new Florida residents within 30 days of establishing residency.', 25, 'active', FALSE, NULL, NULL, NULL),
('dl-renewal', 'Driver License Renewal', 'Renew an existing Florida driver license or ID card. Available for Florida residents with a current or recently expired FL DL/ID.', 15, 'active', TRUE, 'https://mydmvportal.flhsmv.gov/Home/en/Account/Landing', NULL, NULL),
('dl-name-change', 'Driver License Name Change', 'Update your legal name on your Florida driver license or ID card due to marriage, divorce, or court order.', 20, 'active', FALSE, NULL, NULL, NULL),
('dl-address-change', 'Driver License Address Change', 'Update your residential address on your Florida driver license or ID card after moving within Florida.', 10, 'active', TRUE, 'https://mydmvportal.flhsmv.gov/Home/en/Account/Landing', NULL, NULL),
('vehicle-title-transfer', 'Vehicle Title Transfer', 'Transfer a vehicle title into your name after purchase, gift, or inheritance. Also covers transferring an out-of-state title to Florida.', 20, 'active', FALSE, NULL, NULL, NULL),
('vehicle-registration', 'Vehicle Registration (New or Transfer)', 'Register a vehicle in Florida for the first time, or transfer an out-of-state registration to Florida.', 15, 'active', FALSE, NULL, NULL, NULL),
('registration-renewal', 'Vehicle Registration Renewal', 'Renew an existing Florida vehicle registration. Can often be completed online or at an express lane.', 10, 'active', TRUE, 'https://payment.myeasygov.com/MEGPlatform/entryPoint?agencyID=1001&productTypeID=1&deliveryMethodID=0', NULL, NULL),
('road-test', 'Driving Road Test', 'Schedule and take a driving road test for a Florida Class E driver license. Available for first-time drivers and teens.', 45, 'active', FALSE, NULL, '09:00', '15:30'),
('property-tax', 'Property Tax Payment', 'Pay real property taxes for St. Lucie County. Includes annual property taxes, delinquent taxes, and tax certificate redemptions.', 10, 'active', TRUE, 'https://stlucie.county-taxes.com/tcb/app/re/accounts', NULL, NULL),
('concealed-weapon', 'Concealed Weapon Permit', 'Apply for or renew a Florida Concealed Weapon or Firearm License (CWFL). Fingerprinting and application processing.', 30, 'active', FALSE, NULL, '09:00', '16:00'),
('hunting-fishing', 'Hunting & Fishing License', 'Purchase or renew Florida hunting and fishing licenses and permits.', 10, 'active', TRUE, 'https://myfwc.com/license/recreational/how-to-order/', NULL, NULL),
('vessel-registration', 'Vessel / Boat Registration', 'Register a vessel or boat in Florida, transfer registration from another state, or renew an existing registration.', 20, 'active', TRUE, 'https://renewexpress.com/stlucie/renewals', NULL, NULL),
('handicap-placard', 'Disabled Parking Permit (Handicap Placard)', 'Apply for, renew, or replace a disabled parking permit (handicap placard). Long-term permits are free and valid for 4 years. Temporary permits cost $15 and are valid up to 6 months.', 10, 'active', FALSE, NULL, NULL, NULL),
('dl-replacement', 'Driver License / ID Card Replacement', 'Replace a lost, stolen, or damaged Florida driver license or ID card. A duplicate credential is issued with the same expiration date.', 15, 'active', FALSE, NULL, NULL, NULL),
('id-card', 'Florida Identification Card', 'Apply for or renew a Florida state identification card. For residents who do not drive but need official state-issued photo identification.', 20, 'active', FALSE, NULL, NULL, NULL),
('real-id-upgrade', 'REAL ID Upgrade', 'Upgrade your existing Florida driver license or ID card to be REAL ID-compliant (gold star). Required for domestic air travel and entering federal buildings. Must be done in person.', 20, 'active', FALSE, NULL, NULL, NULL),
('cdl', 'Commercial Driver License (CDL)', 'Apply for, renew, or upgrade a Commercial Driver License. Required for operating vehicles over 26,001 lbs GVWR, hazardous materials transport, or vehicles carrying 16+ passengers.', 30, 'active', FALSE, NULL, NULL, NULL),
('learner-permit', 'Learner''s Permit', 'Apply for a Florida learner''s permit. For first-time drivers (teens under 18 and adults 18+). Teens must complete required courses before applying.', 30, 'active', FALSE, NULL, NULL, NULL),
('written-test', 'Written Knowledge Exam (Road Rules & Signs)', 'Take the written knowledge exam (Road Rules and Signs test) required for a Florida driver license. 50 multiple-choice questions with one hour to complete.', 45, 'active', FALSE, NULL, '09:00', '15:30'),
('duplicate-title', 'Duplicate Vehicle Title', 'Apply for a duplicate vehicle title when the original has been lost, stolen, or damaged. Only the registered owner or lienholder on record may apply.', 15, 'active', FALSE, NULL, NULL, NULL),
('new-vehicle-title', 'New Vehicle Title Application (Dealer Purchase)', 'Title application for a newly purchased vehicle from a dealership. Florida dealers are required by law to process your title, but you may need to visit if there are issues or if you purchased from an out-of-state dealer.', 20, 'active', FALSE, NULL, NULL, NULL),
('tag-replacement', 'Lost or Stolen Tag / Decal Replacement', 'Replace a lost, stolen, or damaged license plate (tag) or registration decal. If stolen, report to law enforcement first.', 10, 'active', FALSE, NULL, NULL, NULL),
('plate-surrender', 'License Plate Surrender', 'Return/surrender your Florida license plates and registration. Required when selling a vehicle, moving out of state, canceling insurance, or after a vehicle is repossessed.', 10, 'active', FALSE, NULL, NULL, NULL),
('specialty-plate', 'Specialty or Personalized License Plate', 'Order a specialty license plate with a unique design supporting a specific organization, or a personalized plate with custom characters.', 15, 'active', FALSE, NULL, NULL, NULL),
('mobile-home-title', 'Mobile Home Title & Registration', 'Title and register a mobile home in Florida. Includes new titles, transfers, and annual registration decal renewals. Decals expire December 31 each year.', 20, 'active', FALSE, NULL, NULL, NULL),
('mobile-home-retire', 'Retire Mobile Home Title (Convert to Deed)', 'Retire a mobile home''s DMV title and convert it to a warranty deed. This makes the mobile home part of the real property (land), so future transfers are done via deed rather than motor vehicle title application.', 20, 'active', FALSE, NULL, NULL, NULL),
('dl-sanctions-lift', 'Driver License Reinstatement (After Suspension or Revocation)', 'Reinstate a suspended, revoked, or cancelled Florida driver license. Covers DUI, traffic-court suspensions, child-support delinquency, failure-to-comply, course-completion issues, and related scenarios.', 30, 'active', FALSE, NULL, NULL, NULL),
('business-tax-receipt', 'Local Business Tax Receipt (BTR)', 'Apply for or renew a St. Lucie County Local Business Tax Receipt. Required for any business or profession located in St. Lucie County per County Ordinance 07-016.', 20, 'active', FALSE, NULL, NULL, NULL),
('tourist-development-tax', 'Tourist Development Tax (TDT) Registration', 'Register a short-term rental property (rentals of 6 months or less) for the St. Lucie County Tourist Development Tax -- a 5% charge on rental revenue, in addition to state sales tax.', 15, 'active', TRUE, NULL, NULL, NULL),
('tangible-personal-property-tax', 'Tangible Personal Property Tax', 'Pay a Tangible Personal Property (TPP) tax bill from the St. Lucie County Tax Collector. TPP applies to business equipment, fixtures, furnishings in rental units, machinery, leased equipment, and mobile home attachments on rented land.', 10, 'active', TRUE, NULL, NULL, NULL),
('dealer-title-dropoff', 'Motor Vehicle Dealer Title Paperwork Drop-Off', 'Licensed Florida motor-vehicle dealers submitting customer title and registration paperwork for vehicles they''ve sold. This is a B2B counter service, not a consumer transaction.', 25, 'active', FALSE, NULL, NULL, NULL),
('trailer-registration', 'Trailer Registration', 'Register a trailer in Florida -- homemade or manufactured, any size. Sub-2,000 lb trailers are registration-only; 2,000-lb-and-up trailers must also be titled.', 20, 'active', FALSE, NULL, NULL, NULL);

-- =============================================================================
-- Document Registry (required documents referenced by prescreen/booking flows)
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
-- Prescreen Questions
-- Global across ALL transaction types (road-test + id-card question sets,
-- applied uniformly regardless of the actual transaction being screened).
-- =============================================================================
INSERT INTO prescreen_questions (txn_type_id, sort_order, question_text)
SELECT tt.id, q.sort_order, q.question_text
FROM transaction_types tt
CROSS JOIN (VALUES
    (1, 'Do you currently hold a valid Florida learner permit?'),
    (2, 'Have you completed the required 50 hours of supervised driving?'),
    (3, 'Is the vehicle you will use for the test registered and insured in Florida?'),
    (4, 'Are all mirrors, lights, and signals on the test vehicle functioning properly?'),
    (5, 'Are you a U.S. citizen or lawful permanent resident?'),
    (6, 'Do you have a valid Social Security Number?'),
    (7, 'Do you have two forms of proof of residential address?')
) AS q(sort_order, question_text)
WHERE tt.office_id IS NULL;

-- =============================================================================
-- Clerks (3 per office)
-- skill_ids reference the serial ids of the 32 transaction_types inserted
-- above (1=dl-transfer ... 32=trailer-registration). Each clerk is randomly
-- assigned ~75% of the 32 skills, seeded for reproducibility.
--   Maria    (Fort Pierce)
--   James    (Fort Pierce)
--   Angela   (Fort Pierce)
--   Jennifer (SL West)
--   Thomas   (SL West)
--   Nancy    (SL West)
-- =============================================================================
SELECT setseed(0.42);

INSERT INTO clerks (first_name, last_name, email, status, skill_ids, office_ids)
SELECT c.first_name, c.last_name, c.email, 'active',
    array_agg(tt.id ORDER BY tt.id),
    c.office_ids
FROM (VALUES
    ('Maria',    'Santos',   'maria.santos@stlucie.gov',   '{1}'::int[]),
    ('James',    'Wilson',   'james.wilson@stlucie.gov',   '{1}'::int[]),
    ('Angela',   'Brown',    'angela.brown@stlucie.gov',   '{1}'::int[]),
    ('Jennifer', 'Clark',    'jennifer.clark@stlucie.gov', '{2}'::int[]),
    ('Thomas',   'Lewis',    'thomas.lewis@stlucie.gov',   '{2}'::int[]),
    ('Nancy',    'Robinson', 'nancy.robinson@stlucie.gov', '{2}'::int[])
) AS c(first_name, last_name, email, office_ids)
CROSS JOIN transaction_types tt
WHERE tt.office_id IS NULL
  AND random() < 0.75
GROUP BY c.first_name, c.last_name, c.email, c.office_ids;

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

-- =============================================================================
-- Sample Appointments (sparse, ~10% of capacity)
-- Randomly distributed across the next 10 weekdays and 15-min slots from
-- 08:00-16:45, using one of the 32 seeded transaction types per appointment.
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
    txn_ids INT[];
    day_date DATE;
    office_id_val INT;
    appt_count INT;
    i INT;
    rand_slot INT;
    rand_txn_id INT;
    slot_time TIME;
    fname TEXT;
    lname TEXT;
    seq INT := 0;
    appt_id INT;
    req_docs TEXT[] := ARRAY['photo_id','proof_address'];
    doc_upload_roll FLOAT;
BEGIN
    PERFORM setseed(0.42);

    SELECT array_agg(id ORDER BY id) INTO txn_ids
    FROM transaction_types WHERE office_id IS NULL;

    FOR office_id_val IN 1..2 LOOP
        FOR day_date IN
            SELECT CURRENT_DATE + gs AS dt
            FROM generate_series(1, 14) gs
            WHERE EXTRACT(DOW FROM (CURRENT_DATE + gs)) BETWEEN 1 AND 5
        LOOP
            -- ~10% of full capacity (40-45/day at 100%): 4-5 appointments/day
            appt_count := 4 + floor(random() * 2)::int;

            FOR i IN 1..appt_count LOOP
                rand_slot := floor(random() * 35)::int;  -- 35 slots x 15 min = 08:00-16:45
                rand_txn_id := txn_ids[1 + floor(random() * array_length(txn_ids, 1))::int];
                slot_time := '08:00'::time + (rand_slot * interval '15 minutes');
                fname := first_names[1 + floor(random() * 50)::int];
                lname := last_names[1 + floor(random() * 50)::int];
                seq := seq + 1;

                INSERT INTO appointments (
                    office_id, first_name, last_name,
                    contact_email, contact_phone, txn_type_ids, required_doc_ids,
                    appointment_date, appointment_time, confirmation_code, status, is_walk_in,
                    prescreen_completed
                ) VALUES (
                    office_id_val, fname, lname,
                    lower(fname) || '.' || lower(lname) || seq || '@email.com',
                    '772-555-' || lpad(seq::text, 4, '0'),
                    ARRAY[rand_txn_id], req_docs,
                    day_date, slot_time,
                    gen_random_uuid()::text,
                    'scheduled', FALSE,
                    random() < 0.70
                ) RETURNING id INTO appt_id;

                doc_upload_roll := random();
                IF doc_upload_roll < 0.60 THEN
                    INSERT INTO documents (appointment_id, doc_id, name, ai_review_status)
                    SELECT appt_id, d, (SELECT dr.name FROM document_registry dr WHERE dr.doc_id = d),
                           CASE WHEN random() < 0.80 THEN 'accept' ELSE 'reject' END
                    FROM unnest(req_docs) AS d;
                END IF;
                -- else: no docs uploaded (~40%)
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

COMMIT;
