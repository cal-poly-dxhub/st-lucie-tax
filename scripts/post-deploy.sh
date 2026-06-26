#!/usr/bin/env bash
set -euo pipefail

# Post-deploy: initialize DB schema + deploy frontend.
# Usage: ./scripts/post-deploy.sh [stack-name]
#   stack-name: CloudFormation stack name (default: OfficeInfra)

STACK_NAME="${1:-OfficeInfra}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Fetching stack outputs for ${STACK_NAME}..."
OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs" --output json)

get_output() {
  echo "$OUTPUTS" | python3 -c "
import sys, json
outputs = json.load(sys.stdin)
for o in outputs:
    if o['OutputKey'] == '$1':
        print(o['OutputValue'])
        break
"
}

DB_INIT_FN=$(get_output DbInitFnName)

if [ -z "$DB_INIT_FN" ]; then
  echo "ERROR: Could not read DbInitFnName from stack outputs."
  exit 1
fi

echo "==> Invoking DB schema init lambda: ${DB_INIT_FN}..."
aws lambda invoke --function-name "$DB_INIT_FN" --log-type Tail /dev/stdout | head -1
echo ""

echo "==> Running frontend deploy..."
"${REPO_ROOT}/scripts/deploy-frontend.sh" "$STACK_NAME"
