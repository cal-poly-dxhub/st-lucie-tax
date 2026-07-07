#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="BackOffice"
DB_NAME="stlucie"
DB_USER="stlucie"
LOCAL_PORT="5432"

echo "==> Fetching bastion instance ID..."
BASTION_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='BastionInstanceId'].OutputValue" --output text)
echo "    Bastion: $BASTION_ID"

echo "==> Fetching Aurora cluster endpoint..."
DB_HOST=$(aws rds describe-db-clusters \
  --query "DBClusters[?starts_with(DBClusterIdentifier,'backoffice')].Endpoint" --output text)
echo "    Host: $DB_HOST"

echo "==> Fetching DB credentials from Secrets Manager..."
SECRET_NAME=$(aws secretsmanager list-secrets \
  --query "SecretList[?starts_with(Name,'DbSecret')].Name" --output text)
DB_PASS=$(aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" \
  --query SecretString --output text | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])")

echo "==> Starting SSM port-forward tunnel (localhost:$LOCAL_PORT -> $DB_HOST:5432)..."
aws ssm start-session \
  --target "$BASTION_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$DB_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}" &
SSM_PID=$!
trap "kill $SSM_PID 2>/dev/null" EXIT

sleep 3

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Tunnel is up. Connection details:"
echo ""
echo "  Host:     localhost"
echo "  Port:     $LOCAL_PORT"
echo "  Database: $DB_NAME"
echo "  User:     $DB_USER"
echo "  Password: $DB_PASS"
echo "  SSL:      require"
echo "════════════════════════════════════════════════════════"
echo ""

if [[ "${1:-}" == "--psql" ]]; then
  PGPASSWORD="$DB_PASS" psql "host=localhost port=$LOCAL_PORT dbname=$DB_NAME user=$DB_USER sslmode=require"
else
  echo "Use these in DBeaver or any client. Press Ctrl+C to close the tunnel."
  wait $SSM_PID
fi
