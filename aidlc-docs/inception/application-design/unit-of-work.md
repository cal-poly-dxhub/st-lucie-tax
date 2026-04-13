# Units of Work

## Overview
The platform is decomposed into 3 units of work, built sequentially in a monorepo. Each unit goes through the full Construction phase loop (Functional Design → NFR Requirements → NFR Design → Infrastructure Design → Code Generation).

**Build Order**: Unit 1 (Foundation) → Unit 2 (Backend) → Unit 3 (Frontend)

---

## Unit 1: Foundation

**Purpose**: Shared infrastructure, data layer, dev tooling, and deployment automation. Everything that other units depend on.

**Components**:
- SI-02 — Auth & Tenant Context (Cognito User Pool + API Gateway Authorizer)
- SI-03 — Data Access Layer (shared TypeScript module)

**AWS Resources Created**:
- DynamoDB single table + GSI1 (appointments by location+date)
- Cognito User Pool (clerk/admin accounts) + App Client
- S3 document upload bucket (with event notification for BC-02)
- S3 data source bucket for Bedrock Knowledge Base
- Bedrock Knowledge Base (tcslc.com content, general Q&A fallback)
- SSM Parameters for cross-stack outputs (table name, Cognito pool ID, bucket names, Knowledge Base ID)

**Dev Tooling** (repo-level):
- TypeScript project references (`tsconfig.json` at root + per-package)
- ESLint + Prettier shared config
- Husky + lint-staged (pre-commit hooks)
- `cdk-nag` integration (security/best practice checks at synth time)
- Environment config: `.env.example` + config loader module
- `deploy.sh` script (builds and deploys all stacks in order)

**Shared Packages**:
- `packages/shared-types/` — DynamoDB entity types, API request/response interfaces, polling response types, tenant context types
- `packages/data-access/` — SI-03 implementation: tenant-prefixed key construction, single-table access patterns, GSI queries, TTL management, optimistic concurrency helpers, global/tenant config resolution

**CDK Stack**: `FoundationStack`

---

## Unit 2: Backend

**Purpose**: All business logic — 6 backend services deployed as separate Lambda functions from a single CDK stack.

**Components**:
- BC-01 — Chatbot Service (`/chatbot/*`)
- BC-02 — Identity & Document Service (S3 event trigger)
- BC-03 — Admin Service (`/admin/*`)
- BC-04 — Clerk Service (`/clerk/*`)
- BC-05 — Scheduling Service (`/scheduling/*`)
- BC-06 — Notification Service (`/notifications/*`)

**AWS Resources Created**:
- API Gateway (REST) — single gateway, domain-grouped routes
- Lambda functions — one or more per backend component
- S3 event notification wiring (document bucket → BC-02 Lambda)
- EventBridge rule (scheduled trigger for duration monitoring — SVC-05)
- IAM roles per Lambda (least-privilege, scoped to required DynamoDB operations, S3, Bedrock, Twilio)

**External Integrations**:
- Amazon Bedrock — Converse API (BC-01 NLP), multimodal (BC-02 OCR/validation), Knowledge Base query (BC-01 general Q&A)
- Twilio — SMS (BC-06)
- Amazon SES — Email (BC-06, POC; swappable to SendGrid)

**Services Implemented**:
- SVC-01 — Conversation Orchestration (BC-01 state machine)
- SVC-02 — Check-In & Queue Placement (BC-04)
- SVC-03 — Summon & Transaction Processing (BC-04)
- SVC-04 — Scheduling & Availability (BC-05)
- SVC-05 — Duration Monitoring (BC-03 + EventBridge)
- SVC-06 — Notification Dispatch (BC-06)
- SVC-07 — State Polling (BC-04 + BC-01 polling endpoints for queue/display/session state)

**Dependencies**: Imports Foundation stack outputs via SSM Parameters (DynamoDB table ARN, Cognito pool ID, S3 bucket ARNs, Knowledge Base ID). Uses `packages/data-access/` and `packages/shared-types/` from Foundation.

**CDK Stack**: `BackendStack`

---

## Unit 3: Frontend

**Purpose**: All user-facing applications — 3 React SPAs with a shared component library.

**Components**:
- FC-01 — Chatbot App (public, no auth)
- FC-02 — Staff App (Cognito auth, role-based routing for clerk + admin)
- FC-03 — Display App (public, office-scoped)

**AWS Resources Created**:
- 3 S3 buckets (one per app, static hosting)
- 3 CloudFront distributions (one per app)

**Shared Frontend Packages**:
- `packages/ui-components/` — shared React component library (buttons, forms, modals, status indicators, document viewer)
- `packages/api-client/` — typed API client wrapping REST calls to Backend API Gateway (includes polling helpers)

**Dependencies**: Imports Backend stack outputs via SSM Parameters (API Gateway URL). Imports Foundation stack outputs (Cognito pool ID, Cognito app client ID). Uses `packages/shared-types/` from Foundation.

**CDK Stack**: `FrontendStack`

---

## Code Organization (Monorepo)

```
st-lucie-tax/
├── packages/
│   ├── shared-types/          # TypeScript interfaces (entities, API, polling responses)
│   ├── data-access/           # SI-03 — DynamoDB access layer
│   ├── ui-components/         # Shared React component library
│   └── api-client/            # Typed REST API client (includes polling helpers)
├── services/
│   ├── chatbot/               # BC-01 Lambda handlers
│   ├── identity-doc/          # BC-02 Lambda handlers
│   ├── admin/                 # BC-03 Lambda handlers
│   ├── clerk/                 # BC-04 Lambda handlers
│   ├── scheduling/            # BC-05 Lambda handlers
│   └── notification/          # BC-06 Lambda handlers
├── apps/
│   ├── chatbot-app/           # FC-01 React SPA
│   ├── staff-app/             # FC-02 React SPA
│   └── display-app/           # FC-03 React SPA
├── infra/
│   ├── foundation-stack.ts    # Unit 1 CDK stack
│   ├── backend-stack.ts       # Unit 2 CDK stack
│   ├── frontend-stack.ts      # Unit 3 CDK stack
│   └── app.ts                 # CDK app entry point
├── deploy.sh                  # Build + deploy all stacks in order
├── .env.example               # Environment variable template
├── tsconfig.json              # Root TypeScript config with project references
├── .eslintrc.js               # Shared ESLint config
├── .prettierrc                # Shared Prettier config
├── .husky/                    # Pre-commit hooks
└── package.json               # Root package.json (workspaces)
```

---

## Unit Summary

| Unit | Components | CDK Stack | Stories | Build Order |
|------|-----------|-----------|---------|-------------|
| 1 — Foundation | SI-02, SI-03 | FoundationStack | G1, G2 (auth, tenancy) | 1st |
| 2 — Backend | BC-01 through BC-06 | BackendStack | B1-B7, C1-C6, E1-E6, G3, G4 | 2nd |
| 3 — Frontend | FC-01, FC-02, FC-03 | FrontendStack | B1-B7, C1-C6, E1-E6, F1 (UI layer) | 3rd |
