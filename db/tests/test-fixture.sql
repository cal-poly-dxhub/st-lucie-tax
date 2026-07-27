-- Deterministic data used only by the database-backed integration tests.
-- Production seed data is intentionally kept separate from this fixture.

-- The scheduling and Office Operations tests cover this legacy transaction path.
INSERT INTO transaction_types (
  txn_type_id,
  name,
  description,
  avg_duration_min,
  status,
  is_online_eligible,
  available_from,
  available_until
)
SELECT
  'license-original',
  'Original Driver License',
  'Integration-test transaction fixture',
  20,
  'active',
  FALSE,
  NULL,
  NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM transaction_types
  WHERE txn_type_id = 'license-original'
    AND office_id IS NULL
);

-- Match the deterministic capacity scenarios documented by the tests while
-- leaving the production catalog unchanged.
UPDATE transaction_types
SET avg_duration_min = 30,
    available_from = '09:00',
    available_until = '15:00'
WHERE txn_type_id = 'road-test'
  AND office_id IS NULL;

UPDATE transaction_types
SET avg_duration_min = 15,
    available_from = NULL,
    available_until = NULL
WHERE txn_type_id = 'id-card'
  AND office_id IS NULL;

-- Maria/James/Angela are the Fort Pierce test clerks. The three St. Lucie
-- West clerks receive the same road-test/id-card supply profile so office-wide
-- slot-fill tests have the expected three-clerk capacity.
UPDATE clerks
SET skill_ids = CASE first_name
  WHEN 'Maria' THEN ARRAY[
    (SELECT id FROM transaction_types WHERE txn_type_id = 'road-test' AND office_id IS NULL),
    (SELECT id FROM transaction_types WHERE txn_type_id = 'id-card' AND office_id IS NULL),
    (SELECT id FROM transaction_types WHERE txn_type_id = 'license-original' AND office_id IS NULL)
  ]
  WHEN 'James' THEN ARRAY[
    (SELECT id FROM transaction_types WHERE txn_type_id = 'id-card' AND office_id IS NULL),
    (SELECT id FROM transaction_types WHERE txn_type_id = 'license-original' AND office_id IS NULL)
  ]
  WHEN 'Angela' THEN ARRAY[
    (SELECT id FROM transaction_types WHERE txn_type_id = 'road-test' AND office_id IS NULL),
    (SELECT id FROM transaction_types WHERE txn_type_id = 'id-card' AND office_id IS NULL)
  ]
  WHEN 'Jennifer' THEN ARRAY[
    (SELECT id FROM transaction_types WHERE txn_type_id = 'road-test' AND office_id IS NULL),
    (SELECT id FROM transaction_types WHERE txn_type_id = 'id-card' AND office_id IS NULL),
    (SELECT id FROM transaction_types WHERE txn_type_id = 'license-original' AND office_id IS NULL)
  ]
  WHEN 'Thomas' THEN ARRAY[
    (SELECT id FROM transaction_types WHERE txn_type_id = 'id-card' AND office_id IS NULL),
    (SELECT id FROM transaction_types WHERE txn_type_id = 'license-original' AND office_id IS NULL)
  ]
  WHEN 'Nancy' THEN ARRAY[
    (SELECT id FROM transaction_types WHERE txn_type_id = 'road-test' AND office_id IS NULL),
    (SELECT id FROM transaction_types WHERE txn_type_id = 'id-card' AND office_id IS NULL),
    (SELECT id FROM transaction_types WHERE txn_type_id = 'license-original' AND office_id IS NULL)
  ]
  ELSE skill_ids
END
WHERE first_name IN ('Maria', 'James', 'Angela', 'Jennifer', 'Thomas', 'Nancy');

-- The tests intentionally use a fixed historical date. Add weekday schedules
-- for the complete test window, including the lunch assignments expected by
-- the capacity tests.
INSERT INTO clerk_schedules (clerk_id, office_id, schedule_date, lunch_shift_id)
SELECT
  c.id,
  c.office_ids[1],
  d.schedule_date,
  CASE
    WHEN c.office_ids[1] = 1 AND c.first_name = 'Maria' THEN 1
    WHEN c.office_ids[1] = 1 THEN 2
    WHEN c.office_ids[1] = 2 AND c.first_name IN ('Jennifer', 'Thomas') THEN 3
    ELSE 4
  END
FROM clerks c
CROSS JOIN generate_series(
  DATE '2026-05-12',
  DATE '2026-05-18',
  INTERVAL '1 day'
) AS d(schedule_date)
WHERE EXTRACT(DOW FROM d.schedule_date) BETWEEN 1 AND 5
  AND c.first_name IN ('Maria', 'James', 'Angela', 'Jennifer', 'Thomas', 'Nancy')
ON CONFLICT (clerk_id, schedule_date) DO NOTHING;
