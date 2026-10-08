#!/usr/bin/env bash
# Reset the REMOTE database through an existing SSM tunnel.
# Usage: ./db/reset-remote.sh
#
# Prerequisites:
#   - An SSM tunnel must already be open (e.g. scripts/ssm-db-tunnel.sh)
#   - psql must be installed locally
#
# Environment variables (all have defaults matching ssm-db-tunnel.sh):
#   LOCAL_PORT  — local tunnel port (default: 15432)
#   DB_NAME     — database name (default: stlucie)
#   DB_USER     — database user (default: stlucie)
#   STACK       — CloudFormation stack name for secret lookup (default: BackOffice)
#   AWS_REGION  — AWS region (default: us-east-1)
#   PGPASSWORD  — if set, skips Secrets Manager lookup

set -euo pipefail

LOCAL_PORT="${LOCAL_PORT:-15432}"
DB_NAME="${DB_NAME:-stlucie}"
DB_USER="${DB_USER:-stlucie}"
STACK="${STACK:-BackOffice}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Preflight checks ────────────────────────────────────────────────────────

command -v psql >/dev/null 2>&1 || { echo "Error: psql is required" >&2; exit 1; }

# Verify the tunnel is reachable
if ! pg_isready -h localhost -p "$LOCAL_PORT" -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; then
  echo "Error: Cannot reach database at localhost:$LOCAL_PORT" >&2
  echo "       Is your SSM tunnel running? (scripts/ssm-db-tunnel.sh)" >&2
  exit 1
fi

# ─── Fetch credentials if not provided ───────────────────────────────────────

if [[ -z "${PGPASSWORD:-}" ]]; then
  echo "==> Fetching DB credentials from Secrets Manager..."
  SECRET_ID="$(
    aws cloudformation describe-stack-resources \
      --stack-name "$STACK" \
      --region "$AWS_REGION" \
      --query "StackResources[?ResourceType=='AWS::SecretsManager::Secret'].PhysicalResourceId | [0]" \
      --output text
  )"
  PGPASSWORD="$(
    aws secretsmanager get-secret-value \
      --secret-id "$SECRET_ID" \
      --region "$AWS_REGION" \
      --query SecretString --output text | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])"
  )"
fi
export PGPASSWORD

# ─── Safety prompt ───────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  WARNING: This will DROP and recreate the REMOTE database.  ║"
echo "║  Target: localhost:$LOCAL_PORT (tunneled to Aurora)            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
read -rp "Type 'yes' to continue: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 0
fi

# ─── Common psql args ────────────────────────────────────────────────────────

# An array, not a string: every value below is env-overridable, and unquoted
# word-splitting would turn DB_NAME="my db" into two psql arguments.
PSQL=(psql -h localhost -p "$LOCAL_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 --no-psqlrc)

# ─── Reset ───────────────────────────────────────────────────────────────────

echo "==> Dropping and recreating public schema..."
"${PSQL[@]}" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "==> Loading schema..."
"${PSQL[@]}" < "$SCRIPT_DIR/schema.sql"

echo "==> Loading seed data..."
"${PSQL[@]}" < "$SCRIPT_DIR/seed.sql"

echo "==> Loading document registry..."
"${PSQL[@]}" < "$SCRIPT_DIR/seed-docs.sql"

echo "==> Loading sample appointments..."
"${PSQL[@]}" < "$SCRIPT_DIR/seed-appointments.sql"

echo "==> Loading sample flows..."
"${PSQL[@]}" < "$SCRIPT_DIR/seed-flows.sql"

echo "==> Loading history..."
"${PSQL[@]}" < "$SCRIPT_DIR/seed-history.sql"

if [[ -f "$SCRIPT_DIR/find-appt.sql" ]]; then
  echo "==> Loading scheduling functions (find-appt.sql)..."
  "${PSQL[@]}" < "$SCRIPT_DIR/find-appt.sql"
fi

echo ""
echo "==> Verifying row counts..."
"${PSQL[@]}" -c "
SELECT 'offices' AS tbl, COUNT(*) FROM offices
UNION ALL SELECT 'office_hours', COUNT(*) FROM office_hours
UNION ALL SELECT 'office_lunch_shifts', COUNT(*) FROM office_lunch_shifts
UNION ALL SELECT 'transaction_types', COUNT(*) FROM transaction_types
UNION ALL SELECT 'clerks', COUNT(*) FROM clerks
UNION ALL SELECT 'clerk_schedules', COUNT(*) FROM clerk_schedules
UNION ALL SELECT 'appointments', COUNT(*) FROM appointments;
"

echo ""
echo "✓ Remote database reset complete."
