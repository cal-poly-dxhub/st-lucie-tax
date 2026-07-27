#!/usr/bin/env bash
# Open a local port-forward to the St. Lucie Aurora database through the
# SSM-managed bastion created by the BackOffice CloudFormation stack.

set -euo pipefail

STACK="${STACK:-BackOffice}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
REMOTE_PORT=5432

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

command -v aws >/dev/null 2>&1 || fail "AWS CLI is required"

# Homebrew's ARM and Intel paths may not be present when this script is
# launched from a shell, IDE, or another process with a reduced PATH.
if ! command -v session-manager-plugin >/dev/null 2>&1; then
  for brew_bin in /opt/homebrew/bin /usr/local/bin; do
    if [[ -x "$brew_bin/session-manager-plugin" ]]; then
      PATH="$brew_bin:$PATH"
      export PATH
      break
    fi
  done
fi

command -v session-manager-plugin >/dev/null 2>&1 \
  || fail "session-manager-plugin is required (macOS: brew install --cask session-manager-plugin)"
[[ -n "$AWS_REGION" && "$AWS_REGION" != "None" ]] \
  || fail "Set AWS_REGION or configure a default AWS region"

aws_value() {
  local value
  value="$1"
  [[ -n "$value" && "$value" != "None" ]] || fail "Could not discover a required AWS resource"
  printf '%s' "$value"
}

BASTION_ID="$(aws_value "$(
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='BastionInstanceId'].OutputValue" \
    --output text
)")"

CLUSTER_ID="$(aws_value "$(
  aws cloudformation describe-stack-resources \
    --stack-name "$STACK" \
    --region "$AWS_REGION" \
    --query "StackResources[?ResourceType=='AWS::RDS::DBCluster'].PhysicalResourceId | [0]" \
    --output text
)")"

DB_HOST="$(aws_value "$(
  aws rds describe-db-clusters \
    --db-cluster-identifier "$CLUSTER_ID" \
    --region "$AWS_REGION" \
    --query 'DBClusters[0].Endpoint' \
    --output text
)")"

SECRET_ID="$(aws_value "$(
  aws cloudformation describe-stack-resources \
    --stack-name "$STACK" \
    --region "$AWS_REGION" \
    --query "StackResources[?ResourceType=='AWS::SecretsManager::Secret'].PhysicalResourceId | [0]" \
    --output text
)")"

printf 'Opening SSM tunnel...\n'
printf '  Stack:       %s\n' "$STACK"
printf '  Region:      %s\n' "$AWS_REGION"
printf '  Bastion:     %s\n' "$BASTION_ID"
printf '  Remote host: %s:%s\n' "$DB_HOST" "$REMOTE_PORT"
printf '  Local port:  127.0.0.1:%s\n' "$LOCAL_PORT"
printf '\nKeep this session open. Database credentials are in secret: %s\n' "$SECRET_ID"
printf 'Press Ctrl-C to close the tunnel.\n\n'

exec aws ssm start-session \
  --target "$BASTION_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$DB_HOST\"],\"portNumber\":[\"$REMOTE_PORT\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}" \
  --region "$AWS_REGION"
