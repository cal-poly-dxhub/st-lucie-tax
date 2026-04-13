# Unit of Work — Dependencies

## Dependency Matrix

| Unit | Depends On | Integration Mechanism | What It Imports |
|------|-----------|----------------------|-----------------|
| 1 — Foundation | None | — | — |
| 2 — Backend | Unit 1 (Foundation) | SSM Parameters + TypeScript imports | DynamoDB table ARN, Cognito pool ID, S3 bucket ARNs, Knowledge Base ID, `data-access` module, `shared-types` |
| 3 — Frontend | Unit 1 (Foundation), Unit 2 (Backend) | SSM Parameters + TypeScript imports | API Gateway URL, Cognito pool ID, Cognito app client ID, `shared-types`, `api-client` |

---

## Dependency Diagram

```
Unit 1: Foundation
    │
    ├──► Unit 2: Backend
    │        │
    │        └──► Unit 3: Frontend
    │                 │
    └────────────────►┘
```

- Backend depends on Foundation (data layer, auth, S3, Bedrock KB)
- Frontend depends on both Foundation (Cognito config) and Backend (API Gateway URL)
- No circular dependencies

---

## Build Order

| Order | Unit | Prerequisite | Outputs for Downstream |
|-------|------|-------------|----------------------|
| 1 | Foundation | None | SSM: `/stlucie/dynamodb-table-arn`, `/stlucie/cognito-pool-id`, `/stlucie/cognito-client-id`, `/stlucie/doc-bucket-name`, `/stlucie/kb-id` |
| 2 | Backend | Foundation deployed | SSM: `/stlucie/api-gateway-url` |
| 3 | Frontend | Foundation + Backend deployed | — (terminal unit) |

---

## Cross-Stack Integration Pattern

**Mechanism**: SSM Parameter Store

Foundation stack writes outputs:
```typescript
new ssm.StringParameter(this, 'TableArn', {
  parameterName: '/stlucie/dynamodb-table-arn',
  stringValue: table.tableArn,
});
```

Backend stack reads them:
```typescript
const tableArn = ssm.StringParameter.valueForStringParameter(
  this, '/stlucie/dynamodb-table-arn'
);
```

This decouples stacks — no direct CloudFormation cross-stack references, which makes independent deployment possible.

---

## TypeScript Package Dependencies

```
shared-types          (no dependencies)
    │
    ├──► data-access  (imports shared-types)
    │        │
    │        └──► services/*  (import data-access + shared-types)
    │
    └──► api-client   (imports shared-types)
             │
             └──► apps/*  (import api-client + shared-types)
```

---

## deploy.sh Execution Order

```bash
#!/bin/bash
set -euo pipefail

# 1. Install dependencies
npm ci

# 2. Build shared packages (dependency order)
npm run build --workspace=packages/shared-types
npm run build --workspace=packages/data-access

# 3. Build services
npm run build --workspace=services/chatbot
npm run build --workspace=services/identity-doc
npm run build --workspace=services/admin
npm run build --workspace=services/clerk
npm run build --workspace=services/scheduling
npm run build --workspace=services/notification

# 4. Build frontend packages
npm run build --workspace=packages/api-client
npm run build --workspace=packages/ui-components

# 5. Build frontend apps
npm run build --workspace=apps/chatbot-app
npm run build --workspace=apps/staff-app
npm run build --workspace=apps/display-app

# 6. CDK synth + nag check
npx cdk synth

# 7. Deploy in order (CDK handles ordering via SSM dependencies)
npx cdk deploy --all --require-approval never
```

---

## Integration Points Between Units

| Integration | From | To | Mechanism | Data |
|------------|------|-----|-----------|------|
| Data access | Backend Lambdas | DynamoDB | `data-access` module via AWS SDK | All entity CRUD |
| Auth validation | API Gateway | Cognito | JWT authorizer (configured in Backend stack, pool from Foundation) | JWT claims: tenantId, role, userId |
| Document upload trigger | S3 bucket | BC-02 Lambda | S3 event notification (bucket in Foundation, Lambda in Backend) | Object key, bucket name |
| Bedrock KB query | BC-01 Lambda | Bedrock Knowledge Base | Bedrock RetrieveAndGenerate API (KB ID from Foundation) | Query string → generated answer |
| REST API calls | Frontend apps | Backend API Gateway | HTTPS (API URL from Backend) | JSON request/response |
| Polling (state updates) | Frontend apps | Backend API Gateway | HTTPS polling at 2-5s intervals (API URL from Backend) | Queue state, display state, session state |
| Cognito auth | Staff App | Cognito | Amplify Auth / Cognito SDK (pool ID from Foundation) | Login, JWT tokens |
