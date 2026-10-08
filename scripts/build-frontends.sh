#!/usr/bin/env bash
set -euo pipefail

# Build all three SPAs and sync them straight to the live S3 bucket +
# invalidate CloudFront — without a full `cdk deploy`.
#
# CDK's BucketDeployment (via s3deploy.Source.asset) packages whatever is
# already sitting in each app's dist/ directory at synth time — it does NOT
# build the app itself. If dist/ is stale (built before a source change),
# `cdk deploy` will happily re-upload the OLD bundle even though the stack
# resources (Cognito pool, API Gateway, etc.) were updated, causing the
# frontend and backend to fall out of sync silently.
#
# This script always resolves the bucket name / distribution ID live from
# the deployed Chatbot stack's outputs, so it can never point at a stale or
# orphaned bucket/distribution.
#
# Wired as `predeploy` in package.json, so `npm run deploy` (which still
# runs `cdk deploy` afterward) always builds fresh first. Can also be run
# standalone to push frontend-only changes live without touching infra.
#
# Usage: ./scripts/build-frontends.sh [--no-upload] [stack-name]
#   --no-upload : build only, skip S3 sync + CloudFront invalidation
#   stack-name  : CloudFormation stack name (default: Chatbot)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

usage_die() {
  echo "ERROR: $1"
  echo "Usage: build-frontends.sh [--no-upload] [stack-name]"
  exit 1
}

UPLOAD=true
STACK_NAME="Chatbot"
POSITIONAL=0
for arg in "$@"; do
  case "$arg" in
    --no-upload) UPLOAD=false ;;
    -*) usage_die "unknown option '${arg}'." ;;
    *) POSITIONAL=$((POSITIONAL + 1))
       [ "$POSITIONAL" -eq 1 ] || usage_die "too many arguments (unexpected '${arg}')."
       STACK_NAME="$arg" ;;
  esac
done

build_app() {
  local dir="$1"
  local name="$2"
  echo "==> Building ${name} (${dir})..."
  ( cd "$REPO_ROOT/$dir" && npm run build )
  echo "==> ${name} build complete."
  echo ""
}

build_app "frontend" "Office Operations frontend"
build_app "apps/chatbot-app" "Chatbot frontend"
build_app "apps/admin-app" "Admin frontend"

echo "==> All frontends built."

if [ "$UPLOAD" = false ]; then
  echo "==> --no-upload set, skipping S3 sync + CloudFront invalidation."
  exit 0
fi

echo ""
echo "==> Resolving live bucket + distribution from stack '${STACK_NAME}' outputs..."

get_output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET_NAME=$(get_output FrontendBucketName)
DISTRIBUTION_ID=$(get_output DistributionId)

if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" = "None" ]; then
  echo "ERROR: Could not resolve FrontendBucketName output from stack '${STACK_NAME}'."
  echo "       Redeploy the stack once (cdk deploy ${STACK_NAME}) to publish this output, then re-run."
  exit 1
fi
if [ -z "$DISTRIBUTION_ID" ] || [ "$DISTRIBUTION_ID" = "None" ]; then
  echo "ERROR: Could not resolve DistributionId output from stack '${STACK_NAME}'."
  exit 1
fi

echo "    Bucket:       ${BUCKET_NAME}"
echo "    Distribution: ${DISTRIBUTION_ID}"
echo ""

# Mirrors the destinationKeyPrefix values in infra/lib/chatbot-stack.ts
# (OfficeFrontendDeploy="", ChatbotFrontendDeploy="chat", AdminFrontendDeploy="admin").
# --delete removes stale files under each prefix. The chat/ and admin/ syncs are
# genuinely scoped to their prefix, but Office Ops deploys to the ROOT prefix, so
# its --delete sees the entire bucket. The aws CLI excludes filtered keys from
# deletion, so admin/* and chat/* are excluded there or every run of this script
# deletes both staff SPAs and only restores them two syncs later — and a Ctrl-C
# in between leaves a live origin with no /admin and no /chat. config.json
# (root-level) is left alone since the separate RuntimeConfig deployment owns it.
echo "==> Syncing Office Operations frontend -> s3://${BUCKET_NAME}/"
aws s3 sync "$REPO_ROOT/frontend/dist" "s3://${BUCKET_NAME}/" \
  --delete --exclude "config.json" --exclude "admin/*" --exclude "chat/*"

echo "==> Syncing Chatbot frontend -> s3://${BUCKET_NAME}/chat/"
aws s3 sync "$REPO_ROOT/apps/chatbot-app/dist" "s3://${BUCKET_NAME}/chat/" --delete

echo "==> Syncing Admin frontend -> s3://${BUCKET_NAME}/admin/"
aws s3 sync "$REPO_ROOT/apps/admin-app/dist" "s3://${BUCKET_NAME}/admin/" --delete

echo ""
echo "==> Invalidating CloudFront distribution ${DISTRIBUTION_ID}..."
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" >/dev/null

echo "==> Done. Live site updated."
