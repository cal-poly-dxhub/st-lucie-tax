#!/usr/bin/env bash
set -euo pipefail

# Create a Cognito user with a permanent password.
# Usage: ./scripts/create-user.sh <email> <password> [group1,group2,...]
#   groups: comma-separated (default: admin,checkin_clerk,service_clerk)

EMAIL="${1:?Usage: create-user.sh <email> <password> [groups]}"
PASSWORD="${2:?Usage: create-user.sh <email> <password> [groups]}"
# Deliberately NOT named GROUPS: bash reserves that name for the calling user's
# group IDs and silently discards assignments to it, which would drop the third
# argument and leave the new user with no group memberships at all.
GROUP_CSV="${3:-admin,checkin_clerk,service_clerk}"

STACK_NAME="BackOffice"
# `|| true`: when the stack does not exist yet — the likeliest failure here —
# describe-stacks exits non-zero, and under `set -e` that would abort with a raw
# botocore error before the friendly guard below could run.
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text 2>/dev/null || true)

if [ -z "$USER_POOL_ID" ] || [ "$USER_POOL_ID" = "None" ]; then
  echo "ERROR: Could not resolve UserPoolId output from stack '${STACK_NAME}'."
  echo "       Deploy BackOffice first (npx cdk deploy BackOffice), then re-run."
  exit 1
fi

# Built as its own assignment so a broken/missing openssl is fatal here rather
# than silently producing the password "Aa1!".
TEMP_PASSWORD="$(openssl rand -base64 16)Aa1!"

echo "==> Creating user ${EMAIL} in pool ${USER_POOL_ID}..."
# Only "already exists" is tolerated — everything else (AccessDenied, bad pool,
# password-policy rejection) must stop the script instead of falling through to
# admin-set-user-password on a user that was never created.
if CREATE_OUT=$(aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --temporary-password "$TEMP_PASSWORD" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS 2>&1); then
  echo "$CREATE_OUT"
elif [[ "$CREATE_OUT" == *UsernameExistsException* ]]; then
  echo "  (user already exists, continuing)"
else
  echo "$CREATE_OUT"
  echo "ERROR: admin-create-user failed for ${EMAIL} (see the error above)."
  exit 1
fi

echo "==> Setting permanent password..."
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent

IFS=',' read -ra GROUP_LIST <<< "$GROUP_CSV"
FAILED_GROUPS=()
for raw_group in "${GROUP_LIST[@]}"; do
  # Cognito group names never contain whitespace, so strip it: 'admin, clerk'
  # would otherwise send --group-name " clerk", and 'admin,,clerk' an empty one.
  group="${raw_group//[[:space:]]/}"
  [ -n "$group" ] || continue
  echo "==> Adding to group: ${group}"
  if ! aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" \
    --username "$EMAIL" \
    --group-name "$group"; then
    FAILED_GROUPS+=("$group")
  fi
done

if [ "${#FAILED_GROUPS[@]}" -gt 0 ]; then
  echo ""
  echo "ERROR: could not add ${EMAIL} to group(s): ${FAILED_GROUPS[*]}"
  echo "       The user EXISTS with the password you supplied, but is NOT fully"
  echo "       provisioned. All three SPAs gate on Cognito group claims, so it"
  echo "       cannot sign in usefully until every group is attached."
  echo "       BackOffice creates exactly three groups: admin, checkin_clerk,"
  echo "       service_clerk. Check the spelling, then re-run this script or"
  echo "       attach the missing group(s) by hand:"
  for group in "${FAILED_GROUPS[@]}"; do
    echo "         aws cognito-idp admin-add-user-to-group \\"
    echo "           --user-pool-id ${USER_POOL_ID} --username ${EMAIL} --group-name ${group}"
  done
  exit 1
fi

echo "==> Groups now attached: $(aws cognito-idp admin-list-groups-for-user \
  --user-pool-id "$USER_POOL_ID" --username "$EMAIL" \
  --query 'Groups[].GroupName' --output text)"

echo "==> Done! Login: ${EMAIL} / ${PASSWORD}"
