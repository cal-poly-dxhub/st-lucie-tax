#!/bin/bash
# Reset the local database: drop all tables, recreate schema, load seed data.
# Usage: ./db/reset.sh
#
# Assumes a finch/docker postgres container named "st-lucie-tax-db-1"
# with user "stlucie" and database "stlucie".

set -e

CONTAINER="st-lucie-tax-db-1"
DB_USER="stlucie"
DB_NAME="stlucie"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Dropping and recreating public schema..."
finch exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "Loading schema..."
finch exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/schema.sql"

echo "Loading seed data..."
finch exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/seed.sql"

echo "Loading scheduling functions (find-appt.sql)..."
finch exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/find-appt.sql"

echo "Done. Verifying row counts..."
finch exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
SELECT 'offices' AS tbl, COUNT(*) FROM offices
UNION ALL SELECT 'office_hours', COUNT(*) FROM office_hours
UNION ALL SELECT 'office_lunch_shifts', COUNT(*) FROM office_lunch_shifts
UNION ALL SELECT 'transaction_types', COUNT(*) FROM transaction_types
UNION ALL SELECT 'clerks', COUNT(*) FROM clerks
UNION ALL SELECT 'clerk_schedules', COUNT(*) FROM clerk_schedules
UNION ALL SELECT 'appointments', COUNT(*) FROM appointments;
"
