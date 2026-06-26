#!/usr/bin/env bash
set -euo pipefail

# Deploy the frontend to S3 and invalidate the CloudFront cache.
# Usage: ./scripts/deploy-frontend.sh [stack-name]
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

BUCKET=$(get_output FrontendBucketName)
DIST_ID=$(get_output DistributionId)
API_URL=$(get_output ApiUrl)
USER_POOL_ID=$(get_output UserPoolId)
CLIENT_ID=$(get_output UserPoolClientId)

if [ -z "$BUCKET" ] || [ -z "$DIST_ID" ]; then
  echo "ERROR: Could not read stack outputs. Is the stack deployed?"
  exit 1
fi

echo "==> Building frontend..."
echo "    API_URL=${API_URL}"
echo "    USER_POOL_ID=${USER_POOL_ID}"
echo "    CLIENT_ID=${CLIENT_ID}"

cd "${REPO_ROOT}/frontend"
VITE_API_URL="$API_URL" \
VITE_COGNITO_USER_POOL_ID="$USER_POOL_ID" \
VITE_COGNITO_CLIENT_ID="$CLIENT_ID" \
  npm run build

echo "==> Syncing dist/ to s3://${BUCKET}..."
aws s3 sync dist/ "s3://${BUCKET}" --delete

echo "==> Invalidating CloudFront distribution ${DIST_ID}..."
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --output text

echo "==> Done! Frontend deployed."
FRONTEND_URL=$(get_output FrontendUrl)
echo "    ${FRONTEND_URL}"
