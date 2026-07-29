# Deployment Guide — Beta

## Stack deploy order

Deploy in this order — each stack publishes SSM parameters consumed by the next.

1. `StLucieFoundationStack` — DynamoDB table, S3 buckets, SSM params
2. `StLucieBackendStack` — Lambdas, API Gateway, S3 triggers
3. `StLucieFrontendStack` — S3 site bucket + CloudFront distribution
4. `StLucieSecurityStack` — API key, usage plan, WAF, billing alarms (overlay)

```bash
cd chatbot-prototype/infra
npm run cdk -- deploy StLucieFoundationStack --profile AdministratorAccess-522814693903
npm run cdk -- deploy StLucieBackendStack    --profile AdministratorAccess-522814693903
npm run cdk -- deploy StLucieFrontendStack   --profile AdministratorAccess-522814693903
npm run cdk -- deploy StLucieSecurityStack   --profile AdministratorAccess-522814693903
```

## Secrets (SEC-02) — Secrets Manager, NOT env vars

The 6 runtime credentials live in AWS Secrets Manager, fetched by the Lambdas at
cold start (`services/{chatbot,admin}/src/auth/load-secrets.ts`). They are **no
longer passed as `BETA_PASSWORD=… npm run cdk deploy` env vars** — do not put real
secrets in the deploy shell or `infra/.env.deploy`.

- `stlucie/chatbot/app-secrets` → `{BETA_PASSWORD, BETA_AUTH_SECRET, AUTHID_API_KEY_ID, AUTHID_API_KEY_VALUE}`
- `stlucie/admin/app-secrets` → `{ADMIN_PASSWORD, ADMIN_AUTH_SECRET}`

Each stack CREATES its secret with a random **placeholder** (so no real value ever
lands in `cdk.out`/the template). After deploying, populate the real values
out-of-band, then force a cold start so the warm containers pick them up:

```bash
# chatbot
aws secretsmanager put-secret-value --secret-id stlucie/chatbot/app-secrets \
  --secret-string '{"BETA_PASSWORD":"<real>","BETA_AUTH_SECRET":"<real>","AUTHID_API_KEY_ID":"<real>","AUTHID_API_KEY_VALUE":"<real>"}' \
  --profile AdministratorAccess-522814693903 --region us-east-1
aws lambda update-function-configuration --function-name st-lucie-chatbot-express-app \
  --description "SEC-02 cutover $(date -u +%FT%TZ)" \
  --profile AdministratorAccess-522814693903 --region us-east-1

# admin — if no dedicated admin creds for the closed beta, write the BETA values here
aws secretsmanager put-secret-value --secret-id stlucie/admin/app-secrets \
  --secret-string '{"ADMIN_PASSWORD":"<real>","ADMIN_AUTH_SECRET":"<real>"}' \
  --profile AdministratorAccess-522814693903 --region us-east-1
aws lambda update-function-configuration --function-name st-lucie-admin-app \
  --description "SEC-02 cutover $(date -u +%FT%TZ)" \
  --profile AdministratorAccess-522814693903 --region us-east-1
```

Notes:

- **First-create window:** between `cdk deploy` (placeholder) and `put-secret-value`,
  the secret holds empty strings. The Lambda **fails closed** (cold start throws →
  500s) rather than running with auth disabled. Do deploy + populate as one step in
  a low-traffic window for the prod cutover.
- **Rotation** is now CLI-only: `put-secret-value` + a forced cold start. No redeploy.
- Verify no leak after deploy:
  `aws lambda get-function-configuration --function-name st-lucie-chatbot-express-app --query Environment.Variables`
  → `SECRETS_ARN` present, the 6 secret keys ABSENT.

## Cross-stack contract

`StLucieSecurityStack` reads these SSM parameters; `StLucieBackendStack` MUST publish them:

| SSM parameter                           | Source       |
| --------------------------------------- | ------------ |
| `/stlucie/api-gateway-rest-api-id`      | BackendStack |
| `/stlucie/api-gateway-root-resource-id` | BackendStack |

`StLucieSecurityStack` publishes (consumed manually or by future stacks):

| SSM parameter                   | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `/stlucie/beta-api-key-id`      | API Gateway key ID — used to retrieve secret value |
| `/stlucie/beta-web-acl-arn`     | WAFv2 WebACL ARN — attach to CloudFront            |
| `/stlucie/beta-alarm-topic-arn` | SNS topic ARN for billing alarms                   |

## Required wiring in other stacks

### BackendStack (Agent A)

The proxy / chatbot resource methods must require the API key once the usage plan is in place. Add `apiKeyRequired: true` to each `addMethod()` call (or to method options on the proxy resource):

```typescript
resource.addMethod("POST", new apigateway.LambdaIntegration(fn), {
  apiKeyRequired: true,
});
```

Also publish the REST API ID + root resource ID via SSM:

```typescript
new ssm.StringParameter(this, "RestApiIdParam", {
  parameterName: "/stlucie/api-gateway-rest-api-id",
  stringValue: api.restApiId,
});
new ssm.StringParameter(this, "RootResourceIdParam", {
  parameterName: "/stlucie/api-gateway-root-resource-id",
  stringValue: api.restApiRootResourceId,
});
```

### FrontendStack (Agent C)

Attach the WebACL to the CloudFront distribution:

```typescript
const webAclArn = ssm.StringParameter.valueForStringParameter(this, "/stlucie/beta-web-acl-arn");

new cloudfront.Distribution(this, "SiteDistribution", {
  // ... existing props ...
  webAclId: webAclArn,
});
```

## Manual post-deploy steps

### 1. Confirm alarm topic email subscription

Billing alarms publish to SNS topic `stlucie-beta-alarms`. `SecurityStack` automatically subscribes `mlewis77@calpoly.edu`; AWS sends a confirmation email on first deploy and **the subscription will not deliver alerts until the recipient clicks the confirm link**.

To add additional on-call recipients:

```bash
TOPIC_ARN=$(aws ssm get-parameter \
  --name /stlucie/beta-alarm-topic-arn \
  --query Parameter.Value --output text \
  --profile AdministratorAccess-522814693903)

aws sns subscribe \
  --topic-arn "$TOPIC_ARN" \
  --protocol email \
  --notification-endpoint additional@example.com \
  --profile AdministratorAccess-522814693903
```

Each new recipient must also click the confirmation link in their email before alarms will deliver.

### 2. Enable AWS billing metrics (one-time per account)

CloudWatch billing metrics in the `AWS/Billing` namespace are only emitted if billing alerts are enabled. In the AWS console: **Billing -> Billing preferences -> Receive Billing Alerts**. Without this flag, the Bedrock cost alarms will sit in `INSUFFICIENT_DATA`.

### 3. Retrieve API key value for frontend build

The CDK output gives you only the key _ID_. To get the secret value the frontend embeds:

```bash
aws apigateway get-api-key \
  --api-key $(aws ssm get-parameter \
    --name /stlucie/beta-api-key-id \
    --query Parameter.Value --output text \
    --profile AdministratorAccess-522814693903) \
  --include-value \
  --query value \
  --output text \
  --profile AdministratorAccess-522814693903
```

Pass this value to the frontend build as `VITE_API_KEY` (or equivalent), and have the client send it as the `x-api-key` header on every request.

## Guardrails summary

| Layer          | Limit                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Usage plan     | 50 RPS sustained, 100 burst, 10,000 requests/day per key                                                          |
| WAF            | 300 requests / 5min window per IP (block when exceeded)                                                           |
| App rate-limit | 10 sessions/min + 40 messages/min per IP (SEC-15)                                                                 |
| Input scrub    | SSN/card/bank numbers stripped from chat (SEC-06) — harm-reduction, not a guarantee; DL/dates/money/ZIP preserved |
| Cost (warn)    | $25 estimated Bedrock charges                                                                                     |
| Cost (crit)    | $50 estimated Bedrock charges                                                                                     |
