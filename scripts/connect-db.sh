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

# Cluster and secret are resolved through the stack's own resources, not by
# name-prefix search across the account: two deployments in one account would
# otherwise both match and tab-join into a single unusable value.
echo "==> Fetching Aurora cluster endpoint..."
CLUSTER_ID=$(aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" \
  --query "StackResources[?ResourceType=='AWS::RDS::DBCluster'].PhysicalResourceId | [0]" \
  --output text)
DB_HOST=$(aws rds describe-db-clusters --db-cluster-identifier "$CLUSTER_ID" \
  --query 'DBClusters[0].Endpoint' --output text)
echo "    Host: $DB_HOST"

echo "==> Fetching DB credentials from Secrets Manager..."
SECRET_ID=$(aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" \
  --query "StackResources[?ResourceType=='AWS::SecretsManager::Secret'].PhysicalResourceId | [0]" \
  --output text)
DB_PASS=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" \
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
echo "  SSL:      require"
echo "  Password: not printed — read it from secret:"
echo "            $SECRET_ID"
echo "════════════════════════════════════════════════════════"
echo ""

if [[ "${1:-}" == "--psql" ]]; then
  PGPASSWORD="$DB_PASS" psql "host=localhost port=$LOCAL_PORT dbname=$DB_NAME user=$DB_USER sslmode=require"
else
  echo "Use these in DBeaver or any client. Press Ctrl+C to close the tunnel."
  wait $SSM_PID
fi
