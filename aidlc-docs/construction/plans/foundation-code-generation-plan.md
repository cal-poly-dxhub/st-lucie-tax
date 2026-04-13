# Code Generation Plan — Unit 1: Foundation

## Unit Context

**Unit**: Foundation (Unit 1 of 3)
**Components**: SI-02 (Auth & Tenant Context), SI-03 (Data Access Layer)
**CDK Stack**: FoundationStack
**Tech Stack**: TypeScript, Node.js 22, ESM, CDK v2, npm workspaces
**Workspace Root**: `./`

### Stories Implemented
| Story | Description |
|-------|-------------|
| US-G1-01 | Public Chatbot Access (No Auth) — session-based identity |
| US-G1-02 | Clerk Authentication — Cognito login |
| US-G1-03 | Admin Authentication & RBAC — tenant-scoped access |
| US-G2-01 | Tenant-Scoped Data Access — partition key isolation |
| US-F1-01 | Public Queue Display — polling-based state consumption |
| US-G3-01 | SMS Notification Delivery — Twilio integration |
| US-G3-02 | Email Notification Delivery — SES (POC) |

### Dependencies
- No upstream unit dependencies (Foundation is first)
- Downstream consumers: Unit 2 (Backend), Unit 3 (Frontend)
- Cross-stack contract: SSM Parameters at `/{env}/foundation/*`

### Entities Owned (14 schemas, single DynamoDB table)
Location, Clerk, Clerk Skill, Clerk at Location, Transaction Type (Tenant), Transaction Type (Global), Pre-Screening Question, Appointment, Appointment Transaction, Customer, Customer Note, Queue Entry, Session, Document Upload, Tenant Config

---

## Generation Steps

### Step 1: Project Structure Setup
- [ ] Create root `package.json` with npm workspaces config
- [ ] Create root `tsconfig.json` with project references
- [ ] Create `.env.example` with environment variable template
- [ ] Create `.eslintrc.cjs` shared ESLint config
- [ ] Create `.prettierrc` shared Prettier config
- [ ] Create `.gitignore`

**Stories**: Foundation for all stories (project scaffolding)

---

### Step 2: Shared Types Package — Entity Types
- [ ] Create `packages/shared-types/package.json`
- [ ] Create `packages/shared-types/tsconfig.json`
- [ ] Create `packages/shared-types/src/index.ts` (barrel export)
- [ ] Create `packages/shared-types/src/entities.ts` — DynamoDB entity interfaces for all 14 schemas (Location, Clerk, ClerkSkill, LocationClerk, TxnType, GlobalTxnType, PreScreeningQuestion, Appointment, AppointmentTransaction, Customer, CustomerNote, QueueEntry, Session, DocumentUpload, TenantConfig)
- [ ] Create `packages/shared-types/src/keys.ts` — PK/SK pattern types, entity type enums, GSI key types
- [ ] Create `packages/shared-types/src/api.ts` — API request/response interfaces, error response type
- [ ] Create `packages/shared-types/src/auth.ts` — TenantContext type, Role enum, JWT claims interface

**Stories**: US-G2-01 (tenant-scoped types), US-G1-01/02/03 (auth types)

---

### Step 3: Shared Types Package — Unit Tests
- [ ] Create `packages/shared-types/tests/entities.test.ts` — type compilation tests (verify interfaces compile with valid data, reject invalid shapes)
- [ ] Create `packages/shared-types/tests/keys.test.ts` — enum value tests

**Stories**: US-G2-01

---

### Step 4: Shared Types Summary
- [ ] Create `aidlc-docs/construction/foundation/code/shared-types-summary.md`

---

### Step 5: Data Access Package — Core Module
- [ ] Create `packages/data-access/package.json`
- [ ] Create `packages/data-access/tsconfig.json`
- [ ] Create `packages/data-access/src/index.ts` (barrel export)
- [ ] Create `packages/data-access/src/client.ts` — DynamoDB DocumentClient singleton (reused across Lambda invocations)
- [ ] Create `packages/data-access/src/keys.ts` — `buildPk()`, `buildGlobalPk()`, `buildGsi1Pk()` key construction with validation (BR-DA-01, BR-DA-05)
- [ ] Create `packages/data-access/src/errors.ts` — Error classes: ConcurrencyError, ItemNotFoundError, ConfigNotFoundError, ValidationError, TenantMismatchError, DynamoDBError

**Stories**: US-G2-01 (tenant isolation at key level)

---

### Step 6: Data Access Package — CRUD Operations
- [ ] Create `packages/data-access/src/operations.ts` — `putItem()`, `getItem()`, `query()`, `queryGsi()`, `deleteItem()`, `updateItem()` with tenant-scoped key enforcement, optimistic concurrency (BR-DA-02), version increment, updatedAt stamping
- [ ] Create `packages/data-access/src/config-resolver.ts` — `resolveConfig()` tenant override → global fallback (BR-DA-04), `getGlobalConfig()` read-only global access (BR-DA-03)

**Stories**: US-G2-01 (tenant-scoped data access), US-G1-01 (public config resolution)

---

### Step 7: Data Access Package — Unit Tests
- [ ] Create `packages/data-access/tests/keys.test.ts` — key construction, validation, injection prevention (BR-DA-05)
- [ ] Create `packages/data-access/tests/operations.test.ts` — CRUD operations with mocked DynamoDB client, concurrency error handling, tenant isolation enforcement
- [ ] Create `packages/data-access/tests/config-resolver.test.ts` — tenant override, global fallback, not-found scenarios

**Stories**: US-G2-01

---

### Step 8: Data Access Summary
- [ ] Create `aidlc-docs/construction/foundation/code/data-access-summary.md`

---

### Step 9: CDK FoundationStack — Infrastructure
- [ ] Create `infra/package.json`
- [ ] Create `infra/tsconfig.json`
- [ ] Create `infra/bin/app.ts` — CDK app entry point with environment context, cdk-nag aspects
- [ ] Create `infra/lib/foundation-stack.ts` — FoundationStack with all 16 resources:
  - DynamoDB table (on-demand, PITR, PK/SK, GSI1, TTL) — Pattern 1
  - S3 document bucket (SSE-S3, 35-day lifecycle, enforceSSL, block public) — Pattern 2
  - S3 KB data source bucket (SSE-S3, enforceSSL, block public) — Pattern 3
  - Cognito User Pool (email sign-in, password policy, MFA optional, TOTP, custom:tenantId) — Pattern 4
  - Cognito App Client (no secret, 1hr access, 30d refresh)
  - Cognito groups (clerk, admin, super-admin)
  - Bedrock Knowledge Base (S3 data source, managed embeddings)
  - SNS alarm topic — Pattern 5
  - CloudWatch alarms x3 (DynamoDB throttle, S3 5xx, auth failure custom metric)
  - SSM Parameters x9 — Pattern 6
- [ ] Create `infra/lib/config.ts` — environment config loader (reads CDK context values: env, tenantId, region)

**Stories**: US-G1-02/03 (Cognito), US-G2-01 (DynamoDB), US-G3-01/02 (SNS for notifications), US-F1-01 (infrastructure for polling)

---

### Step 10: CDK FoundationStack — Unit Tests
- [ ] Create `infra/tests/foundation-stack.test.ts` — CDK assertion tests: resource counts, DynamoDB config (PITR, on-demand, GSI), S3 config (encryption, lifecycle, public access block), Cognito config (password policy, groups, custom attributes), SSM parameter paths, cdk-nag compliance

**Stories**: US-G1-02/03, US-G2-01

---

### Step 11: CDK Summary
- [ ] Create `aidlc-docs/construction/foundation/code/foundation-stack-summary.md`

---

### Step 12: Seed Data & Deployment Scripts
- [ ] Create `fixtures/global-transaction-types.json` — seed data for global transaction type templates
- [ ] Create `fixtures/global-prescreening-questions.json` — seed data for global pre-screening questions
- [ ] Create `fixtures/tenant-stlucie-config.json` — seed data for St. Lucie tenant config (hot buttons, checkout URL, duration monitoring)
- [ ] Create `scripts/seed.ts` — idempotent seed script using `putItem` with `attribute_not_exists(PK)` condition
- [ ] Create `deploy.sh` — build + deploy script (npm install, tsc --build, cdk deploy)

**Stories**: US-G2-01 (tenant config), US-G1-01 (chatbot config)

---

### Step 13: Documentation
- [ ] Create `README.md` — project overview, setup instructions, environment config, deploy steps
- [ ] Create `aidlc-docs/construction/foundation/code/code-generation-summary.md` — consolidated summary of all generated code

---

## Step Sequence Summary

| Step | Scope | Files | Stories |
|------|-------|-------|---------|
| 1 | Project scaffolding | 6 | All |
| 2 | shared-types entity/API/auth types | 7 | G1-01/02/03, G2-01 |
| 3 | shared-types unit tests | 2 | G2-01 |
| 4 | shared-types summary doc | 1 | — |
| 5 | data-access core (client, keys, errors) | 6 | G2-01 |
| 6 | data-access CRUD + config resolver | 2 | G2-01, G1-01 |
| 7 | data-access unit tests | 3 | G2-01 |
| 8 | data-access summary doc | 1 | — |
| 9 | CDK FoundationStack + config | 4 | G1-02/03, G2-01, G3-01/02, F1-01 |
| 10 | CDK unit tests | 1 | G1-02/03, G2-01 |
| 11 | CDK summary doc | 1 | — |
| 12 | Seed data + deploy script | 5 | G2-01, G1-01 |
| 13 | README + code gen summary | 2 | — |

**Total**: 13 steps, ~41 files
**All 7 primary stories covered**: US-G1-01, US-G1-02, US-G1-03, US-G2-01, US-F1-01, US-G3-01, US-G3-02

**PR Workflow**: See [foundation-pr-workflow.md](foundation-pr-workflow.md)
