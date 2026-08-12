#!/bin/bash
# Reset the local database: drop all tables, recreate schema, load seed data.
# Usage: ./db/reset.sh
#
# Assumes a postgres container named "st-lucie-tax-db-1"
# with user "stlucie" and database "stlucie".

set -e

CONTAINER="st-lucie-tax-db-1"
DB_USER="stlucie"
DB_NAME="stlucie"
# Container runtime: defaults to docker (see README/compose.yml); set
# CONTAINER_CLI=finch (or nerdctl/podman) to use a different one.
CLI="${CONTAINER_CLI:-docker}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Dropping and recreating public schema..."
"$CLI" exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "Loading schema..."
"$CLI" exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/schema.sql"

echo "Loading seed data..."
"$CLI" exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/seed.sql"

echo "Loading document registry..."
"$CLI" exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/seed-docs.sql"

echo "Loading sample appointments..."
"$CLI" exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/seed-appointments.sql"

echo "Loading sample flows..."
"$CLI" exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/seed-flows.sql"

echo "Loading history..."
"$CLI" exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/seed-history.sql"

if [ -f "$SCRIPT_DIR/find-appt.sql" ]; then
  echo "Loading scheduling functions (find-appt.sql)..."
  "$CLI" exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/find-appt.sql"
fi

echo "Done. Verifying row counts..."
"$CLI" exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
SELECT 'offices' AS tbl, COUNT(*) FROM offices
UNION ALL SELECT 'office_hours', COUNT(*) FROM office_hours
UNION ALL SELECT 'office_lunch_shifts', COUNT(*) FROM office_lunch_shifts
UNION ALL SELECT 'transaction_types', COUNT(*) FROM transaction_types
UNION ALL SELECT 'clerks', COUNT(*) FROM clerks
UNION ALL SELECT 'clerk_schedules', COUNT(*) FROM clerk_schedules
UNION ALL SELECT 'appointments', COUNT(*) FROM appointments;
"
