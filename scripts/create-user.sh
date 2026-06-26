#!/usr/bin/env bash
set -euo pipefail

# Create a Cognito user with a permanent password.
# Usage: ./scripts/create-user.sh <email> <password> [group1,group2,...]
#   groups: comma-separated (default: admin,checkin_clerk,service_clerk)

EMAIL="${1:?Usage: create-user.sh <email> <password> [groups]}"
PASSWORD="${2:?Usage: create-user.sh <email> <password> [groups]}"
GROUPS="${3:-admin,checkin_clerk,service_clerk}"

STACK_NAME="OfficeInfra"
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)

echo "==> Creating user ${EMAIL} in pool ${USER_POOL_ID}..."
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --temporary-password "Temp1234!" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS

echo "==> Setting permanent password..."
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent

IFS=',' read -ra GROUP_LIST <<< "$GROUPS"
for group in "${GROUP_LIST[@]}"; do
  echo "==> Adding to group: ${group}"
  aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" \
    --username "$EMAIL" \
    --group-name "$group"
done

echo "==> Done! Login: ${EMAIL} / ${PASSWORD}"
