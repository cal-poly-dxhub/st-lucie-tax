#!/usr/bin/env bash
set -euo pipefail

# Post-deploy: initialize DB schema, build + upload frontends, upload config.json.
# Usage: ./scripts/post-deploy.sh [--skip-db] [back-office-stack] [chatbot-stack]
#   --skip-db          : skip DB schema init
#   back-office-stack  : BackOffice CFN stack name (default: BackOffice)
#   chatbot-stack      : Chatbot CFN stack name (default: Chatbot)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_DB=false
BACK_OFFICE_STACK="BackOffice"
CHATBOT_STACK="Chatbot"

for arg in "$@"; do
  case "$arg" in
    --skip-db) SKIP_DB=true ;;
    *) if [ "$BACK_OFFICE_STACK" = "BackOffice" ] && [ "$arg" != "BackOffice" ]; then
         BACK_OFFICE_STACK="$arg"
       else
         CHATBOT_STACK="$arg"
       fi ;;
  esac
done

get_stack_output() {
  local stack="$1" key="$2"
  aws cloudformation describe-stacks --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" --output text
}

# ── 1. DB schema init ──────────────────────────────────────────────────────────
if [ "$SKIP_DB" = false ]; then
  echo "==> Fetching DB init function from ${BACK_OFFICE_STACK}..."
  DB_INIT_FN=$(get_stack_output "$BACK_OFFICE_STACK" DbInitFnName)

  if [ -z "$DB_INIT_FN" ] || [ "$DB_INIT_FN" = "None" ]; then
    echo "ERROR: Could not read DbInitFnName from ${BACK_OFFICE_STACK} outputs."
    exit 1
  fi

  echo "==> Invoking DB schema init lambda: ${DB_INIT_FN}..."
  aws lambda invoke --function-name "$DB_INIT_FN" --log-type Tail /dev/stdout | head -1
  echo ""
fi

# ── 2. Resolve stack outputs ──────────────────────────────────────────────────
echo "==> Resolving outputs from ${BACK_OFFICE_STACK} + ${CHATBOT_STACK}..."
USER_POOL_ID=$(get_stack_output "$BACK_OFFICE_STACK" UserPoolId)
USER_POOL_CLIENT_ID=$(get_stack_output "$BACK_OFFICE_STACK" UserPoolClientId)
BUCKET_NAME=$(get_stack_output "$CHATBOT_STACK" FrontendBucketName)
DISTRIBUTION_ID=$(get_stack_output "$CHATBOT_STACK" DistributionId)

for var in USER_POOL_ID USER_POOL_CLIENT_ID BUCKET_NAME DISTRIBUTION_ID; do
  val="${!var}"
  if [ -z "$val" ] || [ "$val" = "None" ]; then
    echo "ERROR: Could not resolve ${var} from stack outputs."
    exit 1
  fi
done

echo "    UserPoolId:     ${USER_POOL_ID}"
echo "    ClientId:       ${USER_POOL_CLIENT_ID}"
echo "    Bucket:         ${BUCKET_NAME}"
echo "    Distribution:   ${DISTRIBUTION_ID}"
echo ""

# ── 3. Build frontends ─────────────────────────────────────────────────────────
echo "==> Building frontends..."
"$REPO_ROOT/scripts/build-frontends.sh" --no-upload
echo ""

# ── 4. Upload frontends to S3 ─────────────────────────────────────────────────
echo "==> Syncing Office Operations frontend -> s3://${BUCKET_NAME}/"
aws s3 sync "$REPO_ROOT/frontend/dist" "s3://${BUCKET_NAME}/" \
  --delete --exclude "config.json"

echo "==> Syncing Chatbot frontend -> s3://${BUCKET_NAME}/chat/"
aws s3 sync "$REPO_ROOT/apps/chatbot-app/dist" "s3://${BUCKET_NAME}/chat/" --delete

echo "==> Syncing Admin frontend -> s3://${BUCKET_NAME}/admin/"
aws s3 sync "$REPO_ROOT/apps/admin-app/dist" "s3://${BUCKET_NAME}/admin/" --delete

# ── 5. Generate + upload config.json ──────────────────────────────────────────
echo ""
echo "==> Uploading config.json..."
printf '{"userPoolId":"%s","userPoolClientId":"%s","apiUrl":"/api","chatbotApiUrl":"/api/chat","adminApiUrl":"/api/admin"}' \
  "$USER_POOL_ID" "$USER_POOL_CLIENT_ID" \
  | aws s3 cp - "s3://${BUCKET_NAME}/config.json" --content-type application/json

# ── 6. CloudFront invalidation ────────────────────────────────────────────────
echo "==> Invalidating CloudFront distribution ${DISTRIBUTION_ID}..."
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" >/dev/null

echo ""
echo "==> Done. DB initialized, frontends built + deployed, config.json uploaded."
