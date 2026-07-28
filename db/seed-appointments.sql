-- Standalone appointment seed: ~25% capacity, full year, 1–3 txn types each.
-- Uses a temp table to batch inserts for fast execution over network tunnels.
BEGIN;

TRUNCATE documents CASCADE;
TRUNCATE appointments CASCADE;

CREATE TEMP TABLE _seed_appts (
    office_id INT,
    first_name TEXT,
    last_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    txn_type_ids INT[],
    appointment_date DATE,
    appointment_time TIME,
    prescreen_completed BOOLEAN,
    add_docs BOOLEAN
) ON COMMIT DROP;

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
    txn_count INT;
    day_date DATE;
    office_id_val INT;
    appt_count INT;
    i INT;
    rand_slot INT;
    slot_time TIME;
    fname TEXT;
    lname TEXT;
    seq INT := 0;
    num_txns INT;
    chosen_txns INT[];
    j INT;
    pick INT;
BEGIN
    PERFORM setseed(0.42);

    SELECT array_agg(id ORDER BY id) INTO txn_ids
    FROM transaction_types WHERE office_id IS NULL;
    txn_count := array_length(txn_ids, 1);

    FOR office_id_val IN 1..2 LOOP
        FOR day_date IN
            SELECT d::date AS dt
            FROM generate_series(CURRENT_DATE, CURRENT_DATE + interval '1 year', '1 day') d
            WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
        LOOP
            appt_count := 25 + floor(random() * 5)::int;

            FOR i IN 1..appt_count LOOP
                rand_slot := floor(random() * 35)::int;
                slot_time := '08:00'::time + (rand_slot * interval '15 minutes');

                num_txns := 1 + floor(random() * 3)::int;
                chosen_txns := ARRAY[]::int[];
                FOR j IN 1..num_txns LOOP
                    pick := txn_ids[1 + floor(random() * txn_count)::int];
                    IF NOT (pick = ANY(chosen_txns)) THEN
                        chosen_txns := chosen_txns || pick;
                    END IF;
                END LOOP;

                fname := first_names[1 + floor(random() * 50)::int];
                lname := last_names[1 + floor(random() * 50)::int];
                seq := seq + 1;

                INSERT INTO _seed_appts VALUES (
                    office_id_val, fname, lname,
                    lower(fname) || '.' || lower(lname) || seq || '@email.com',
                    '772-555-' || lpad((seq % 10000)::text, 4, '0'),
                    chosen_txns,
                    day_date, slot_time,
                    random() < 0.70,
                    random() < 0.60
                );
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

-- Bulk insert from temp table into appointments
INSERT INTO appointments (
    office_id, first_name, last_name,
    contact_email, contact_phone, txn_type_ids, required_doc_ids,
    appointment_date, appointment_time, confirmation_code, status, is_walk_in,
    prescreen_completed
)
SELECT
    office_id, first_name, last_name,
    contact_email, contact_phone, txn_type_ids,
    ARRAY['photo_id','proof_address'],
    appointment_date, appointment_time,
    gen_random_uuid()::text,
    'scheduled', FALSE,
    prescreen_completed
FROM _seed_appts;

-- Add documents for ~60% of appointments (those flagged add_docs)
INSERT INTO documents (appointment_id, doc_id, name, ai_review_status)
SELECT a.id, d.doc_id, dr.name,
       CASE WHEN random() < 0.80 THEN 'accept' ELSE 'reject' END
FROM appointments a
CROSS JOIN unnest(ARRAY['photo_id','proof_address']) AS d(doc_id)
JOIN document_registry dr ON dr.doc_id = d.doc_id
WHERE a.id IN (
    SELECT ap.id FROM appointments ap
    TABLESAMPLE BERNOULLI(60)
);

COMMIT;
