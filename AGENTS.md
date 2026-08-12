# St. Lucie County AI-Powered Tax System

## What This Is

A PoC replacing the St. Lucie County Tax Collector's static website and appointment system with an AI-powered conversational interface and intelligent office-operations platform. Built by the Cal Poly DxHub for the county tax collector's office. MIT licensed and designed for handoff to an implementation partner.

## Business Context

Citizens arrive at county offices missing documents or unaware of prerequisites. The current system schedules static 15–20 minute blocks regardless of complexity. This system pre-screens via an AI chatbot, validates documents, dynamically schedules by transaction complexity, clerk skills, and capacity, and routes customers to skill-matched clerks. Target: one hour saved per clerk per day across three offices (72 hours/day, or nine FTE equivalent).

## Architecture

This is a unified npm-workspaces monorepo deployed as two CDK stacks sharing one Aurora PostgreSQL database through RDS Proxy:

1. **BackOffice stack** — VPC, Aurora Serverless v2 (PostgreSQL 17.4), RDS Proxy, and two fault-isolated ARM64 Express-on-Lambda container functions. `AppointmentFn` handles citizen and booking routes; `QueueFn` handles in-office queue and clerk routes. A single API Gateway HTTP API routes requests by path. The stack also deploys Cognito staff authentication, the CloudFront WAF Web ACL, a document bucket, an SQS email worker, a nightly EventBridge duration-recommendation worker, the schema-init Lambda, and an SSM bastion for database port forwarding. Office Operations runs unchanged on Lambda through the AWS Lambda Web Adapter (LWA).

2. **Chatbot stack** — Reuses the BackOffice VPC, RDS Proxy, database secret, security group, WAF, and Cognito client. `ChatbotFn` is an Express 4 Lambda (1536 MB, 120 seconds) using Claude Sonnet 4.6 through the Bedrock Converse API. `AdminFn` is an Express 4 Lambda (512 MB, 30 seconds) for dashboard APIs. Separate API Gateway REST APIs serve `/api/chat/*` and `/api/admin/*`; CloudFront supplies an `x-origin-secret` header to prevent direct API Gateway access. The stack deploys a single frontend S3 bucket and CloudFront distribution for all three SPAs, a chatbot document-upload bucket, and a Bedrock Knowledge Base with S3 data source and S3 Vectors/Titan Text Embeddings v2 storage. SNS alarms cover Bedrock invocation volume, chatbot errors, and throttling.

All three services (Office Ops, Chatbot, and Admin) use the same Aurora instance through RDS Proxy. The chatbot uses `@st-lucie/data-access` to persist session state in PostgreSQL; DynamoDB is not part of the current architecture.

## Source Layout

```text
# Monorepo root
package.json              # Workspaces: packages/*, services/*, apps/*, frontend
cdk.json                  # CDK entry: infra/bin/app.ts (BackOffice and Chatbot)
compose.yml               # Local PostgreSQL 16 database

# Shared packages
packages/data-access/     # @st-lucie/data-access — PostgreSQL chat-session operations
packages/shared-types/    # @st-lucie/shared-types — session, conversation, and API types
packages/ui/              # @st-lucie/ui — civic design tokens and shared React primitives

# Services
services/office-ops/      # Office Operations Express backend, workers, and LWA container
services/chatbot/         # AI Chatbot Express backend, state machine, tools, prompts, and KB
services/admin/           # Admin dashboard Express backend for session review

# Frontend applications
apps/chatbot-app/         # Chatbot React SPA
apps/admin-app/           # Admin React SPA
frontend/                 # Office Operations React SPA

# Infrastructure and data
infra/                    # CDK v2 (BackOffice and Chatbot stacks)
db/                       # PostgreSQL schema and seed data

# Support
demos/                    # HTML prototypes and reference endpoint implementation
scripts/                  # Build, deployment, and post-deployment automation
docs/                     # Design, database, architecture, and scheduling documentation
tests/                    # Unit, integration, and Playwright E2E tests
```

## Key Files

### Shared Packages

| File                                            | Purpose                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/data-access/src/operations.ts`        | Typed PostgreSQL CRUD for chat sessions, messages, and auth tokens      |
| `packages/data-access/src/client.ts`            | Connection pool; Secrets Manager in Lambda, environment variables local |
| `packages/shared-types/src/session.ts`          | Session, structured context, conversation state, and chatbot types      |
| `packages/shared-types/src/transaction-type.ts` | Transaction type definitions                                            |

### Office Operations

| File                                                   | Purpose                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `services/office-ops/server/app.ts`                    | Express app; conditionally mounts routers by `SERVICE`                                                             |
| `services/office-ops/server/middleware/auth.ts`        | Cognito JWT validation and role-based route access                                                                 |
| `services/office-ops/server/routes/appointment.ts`     | Citizen and booking API endpoints                                                                                  |
| `services/office-ops/server/routes/queue.ts`           | In-office queue and clerk endpoints                                                                                |
| `services/office-ops/server/routes/admin.ts`           | Office Operations admin CRUD endpoints                                                                             |
| `services/office-ops/server/workers/db-init-worker.ts` | Schema-init Lambda, invoked by `scripts/post-deploy.sh`                                                            |
| `db/schema.sql`                                        | Database DDL: tables, RLS, functions, views, and chat tables                                                       |
| `db/seed.sql`                                          | Seed data: config, offices, transaction types, documents, prescreening, clerks, schedules, and sample appointments |
| `infra/lib/back-office-stack.ts`                       | BackOffice CDK stack                                                                                               |
| `infra/lib/chatbot-stack.ts`                           | Chatbot CDK stack: chatbot, admin, CloudFront, and frontend deployment                                             |
| `infra/bin/app.ts`                                     | CDK app entry point                                                                                                |
| `scripts/post-deploy.sh`                               | Initialize schema, build/upload frontends and runtime config, then invalidate CloudFront                           |
| `scripts/build-frontends.sh`                           | Build all SPAs; optionally upload them and invalidate CloudFront without a CDK deployment                          |
| `docs/st-lucie-design-doc.md`                          | Requirements, user stories, and design decisions                                                                   |
| `docs/database-design.md`                              | Schema overview, capacity model, and access patterns                                                               |
| `demos/prototype-server.ts`                            | Reference endpoint implementation used by prototypes                                                               |

### AI Chatbot (`services/chatbot/`)

| File                                  | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `src/conversation/process-message.ts` | Core message pipeline: scrub, prompt, Bedrock, advance, and guard |
| `src/conversation/bedrock-client.ts`  | Bedrock Converse API client for Sonnet 4.6                        |
| `src/state-machine/states.ts`         | Conversation-state definitions and transitions                    |
| `src/prompts/default-prompts.ts`      | State-specific system prompts                                     |
| `src/conversation/state-tools.ts`     | State-specific tool selection and handlers                        |
| `src/knowledge-base/query.ts`         | Bedrock Knowledge Base retrieval                                  |
| `src/middleware/input-scrub.ts`       | Removes sensitive PII while preserving needed transaction facts   |
| `src/data/decision-trees/`            | Fact-gated transaction decision trees                             |
| `src/data/fact-definitions.json`      | Facts, question text, and allowed values                          |
| `src/data/item-catalog.json`          | Required-document catalog and document types                      |

### Admin Dashboard (`services/admin/`)

| File                           | Purpose                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `src/admin-app.ts`             | Express app with Cognito `admin`-group authorization and origin-secret validation |
| `src/queries/summary.ts`       | Dashboard summary statistics                                                      |
| `src/queries/list-sessions.ts` | Filterable session listing                                                        |
| `src/queries/get-session.ts`   | Full transcript and debug-log retrieval                                           |
| `src/queries/set-reviewed.ts`  | Mark a session reviewed or unreviewed                                             |

### Admin SPA (`apps/admin-app/`)

The SPA serves three surfaces under `BrowserRouter basename="/admin"`: **Sessions**
(chatbot transcript review, backed by `services/admin`), **Config** (office-operations
CRUD), and **Performance** (service-time and volume charts). Config and Performance
call the Office Operations admin router at `/api/ops-admin/*` — not `/api/admin/*`,
which CloudFront routes to the chatbot `AdminFn`. Presentation comes from the shared
`@st-lucie/ui` workspace package, consumed as raw `.tsx` source through a Vite alias
and a tsconfig path.

| File                               | Purpose                                                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config-api.ts`                | Typed client for every `/ops-admin/*` route                                                                                                                                                                            |
| `src/pages/config/`                | Config tabs (nav): global, offices, transactions, clerks, hotbuttons, documents, audit-log. The `prescreen` and `decision-trees` pages exist in this directory but are intentionally hidden from nav (engineer-owned). |
| `src/pages/config/use-resource.ts` | Load/mutate hook shared by every config tab                                                                                                                                                                            |
| `src/pages/PerformancePage.tsx`    | KPI tiles and Recharts views over `/performance-metrics`                                                                                                                                                               |
| `src/pages/OverviewPage.tsx`       | Session list, summary cards, and review toggles                                                                                                                                                                        |
| `packages/ui/src/`                 | Civic design tokens, form primitives, table, and matrix                                                                                                                                                                |

Required documents are **read-only** in this SPA. They live in the chatbot's decision
trees (`services/chatbot/src/data/decision-trees/*.json`) as `baseItems` plus branch
`addItems`/`removeItems`; the only write route replaces the whole `steps` column, which
would destroy the branch logic. Edit the tree source files instead.

## Development Commands

### Monorepo (Repository Root)

```bash
npm install             # Install all workspaces
npm test                # Run all Vitest unit and integration tests
npm run lint            # Run ESLint
npm run format:check    # Check Prettier formatting
npm run fix             # Apply ESLint and Prettier fixes
npm run build:frontends # Build all SPAs without uploading them
```

### Office Operations

```bash
docker compose up -d db                # Start local PostgreSQL 16
npm -w @st-lucie/office-ops run dev    # API server; SERVICE defaults to "all"
cd frontend && npm run dev             # Office UI; /api proxies to :3000
npx cdk deploy BackOffice              # Deploy from the repository root
scripts/post-deploy.sh                 # Needs BOTH stacks: it reads FrontendBucketName/DistributionId
                                       #   from Chatbot and exits 1 if they're missing (infra/DEPLOY.md §5)
scripts/build-frontends.sh             # Frontend-only rebuild, upload, and CloudFront invalidation
```

### AI Chatbot

```bash
npm -w @st-lucie/chatbot-service run dev # Backend; requires AWS credentials and Bedrock access
cd apps/chatbot-app && npm run dev       # Chatbot SPA on :5180
npx playwright test                      # E2E tests; requires a running frontend/backend and tests/.env.test
npx cdk deploy Chatbot                   # Deploy the Chatbot stack from the repository root
```

The Office Operations and Chatbot backends both default to port `3000`, and their checked-in Vite proxy configurations point there. Run one at a time unless you deliberately change the relevant port and proxy configuration.

### Admin Dashboard

```bash
npm -w @st-lucie/admin-service run dev # Backend on :3100
cd apps/admin-app && npm run dev       # Admin SPA on :5181
```

**For a from-zero deploy to a new AWS account, follow the authoritative runbook [`infra/DEPLOY.md`](infra/DEPLOY.md) end to end.** It covers the hard prerequisites a fresh account needs — us-east-1 region, a running Docker daemon (BackOffice builds container images at deploy), Bedrock model access (Sonnet 4.6 + Titan-embed-v2 in us-east-1, Haiku 4.5 in us-east-2), SES sender verification, the RDS service-linked role (without it RDS Proxy rolls the entire BackOffice stack back), `cdk bootstrap`, `.env` setup, and **creating the first Cognito user (self-signup is disabled, so every SPA including the citizen `/chat` is locked out without it)**. Condensed sequence:

```bash
export AWS_PROFILE=<your-profile>       # scripts/*.sh are plain `aws` CLI wrappers
export CDK_DEFAULT_REGION=us-east-1 AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
aws sts get-caller-identity             # prove the account; note the id for bootstrap
aws iam get-role --role-name AWSServiceRoleForRDS \
  || aws iam create-service-linked-role --aws-service-name rds.amazonaws.com   # fresh account
cp .env.example .env                    # set SENDER_EMAIL + a real ORIGIN_SECRET
npm install
npm run build:frontends                 # before bootstrap: bootstrap synthesizes the app
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1   # once per account/region
npx cdk deploy --all --require-approval never   # BackOffice then Chatbot (order auto-resolved)
scripts/post-deploy.sh                  # DB schema + seed (empty DB), upload SPAs, config.json
scripts/create-user.sh you@example.com 'pw' admin,checkin_clerk,service_clerk   # zero groups = 403 from every API
```

Email links come later: set `BASE_URL` from the Chatbot `FrontendUrl` output and rerun `npx cdk deploy --all` — both stacks consume it, so BackOffice alone is not enough (`infra/DEPLOY.md` §7).

`npm run deploy` rebuilds the frontends (build-only, no upload) via the `predeploy` hook and then runs `cdk deploy --all` — safe for a first deploy, no pre-existing stack required, but it carries no `--require-approval never`, so it stops at the IAM approval prompt. Use the explicit `npx cdk deploy --all --require-approval never` for any non-interactive run. For frontend-only redeploys use `scripts/build-frontends.sh`.

## Personas & Surfaces

| Surface                 | Persona          | Location                                                                       |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------ |
| AI Chatbot              | Citizen          | `apps/chatbot-app/` — served at `/chat`                                        |
| Admin Dashboard         | Admin/Reviewer   | `apps/admin-app/` — served at `/admin`; Sessions, Config, and Performance tabs |
| Check-in Desk           | Check-in Clerk   | `frontend/src/pages/CheckInDesk.tsx` — served at `/`                           |
| Service Clerk Dashboard | Service Clerk    | `frontend/src/pages/ServiceClerk.tsx`                                          |
| Lobby Display           | Public           | `frontend/src/pages/LobbyDisplay.tsx`                                          |
| Scheduling              | Citizen          | `frontend/src/pages/SchedulePage.tsx`                                          |
| Office Admin Dashboard  | Admin/Supervisor | HTML prototype in `demos/`                                                     |

## Tech Stack

TypeScript; npm workspaces; Node.js 22; Express 5 for Office Operations and Express 4 for Chatbot/Admin; React 19; Vite 8; Tailwind CSS 4; PostgreSQL 16 for local Compose and Aurora PostgreSQL 17.4 (Serverless v2) in AWS; AWS Bedrock (Claude Sonnet 4.6 for conversation, Claude Haiku 4.5 for document vision); Bedrock Knowledge Bases with S3 Vectors and Titan Text Embeddings v2; Lambda/LWA on ARM64; Aurora; RDS Proxy; S3; API Gateway HTTP and REST APIs; SES; SQS; SNS; Cognito; CloudFront and CloudFront Functions; WAF; EventBridge; Secrets Manager; Systems Manager; CDK v2; AuthID; Docker; Vitest; and Playwright.

## Design Principles

### Office Operations

1. **Fault isolation:** Appointment and queue domains fail independently through separate Lambdas and reserved concurrency.
2. **Lambda-first workloads:** Business compute runs on Lambda (ARM64/Graviton); the SSM bastion is intentionally retained only for database port forwarding.
3. **Same code locally and in production:** LWA runs the real Office Operations Express server unchanged on Lambda.
4. **Same-origin deployment:** One CloudFront distribution serves all SPAs and routes API traffic, avoiding a browser CORS dependency on the deployed path.
5. **Polling over WebSocket:** Five-second polling provides real-time updates with PoC-level simplicity.
6. **Optimistic find, pessimistic book:** Slot search is fast; booking acquires row locks and rechecks capacity.
7. **PII scoped to the appointment lifecycle:** No long-lived customer table; data is easier to purge.
8. **Application-layer auth:** Office Operations validates Cognito JWTs in Express middleware; public routes remain available without API Gateway authorizers.

### AI Chatbot

9. **Trees as source of truth:** Decision trees and the item catalog are the only authoritative source for required documents; the LLM cannot improvise them.
10. **Deterministic state machine with LLM dialogue:** The state machine controls progression while the LLM handles natural language within each state.
11. **Conversation scoped per state:** State transitions leave prior turns behind to keep context lean.
12. **Structured context persists across states:** Identity, transactions, documents, and facts survive state resets in `session.structuredContext`.
13. **Defense in depth:** Input scrubbing, prompt rules, tool-call self-healing, post-process guards, API throttling, WAF, and CloudFront origin-secret validation protect the system.
14. **Conservative routing:** Ambiguous messages trigger clarification rather than confident routing.

### Unified System

15. **Shared database:** All services use the same Aurora instance through RDS Proxy, eliminating DynamoDB and cross-service synchronization.
16. **Shared packages:** `@st-lucie/data-access` and `@st-lucie/shared-types` provide consistent data access and type safety.
17. **Single distribution:** One CloudFront distribution and one frontend bucket serve the SPAs and route their APIs.

## Detailed Documentation

Use the current repository documentation rather than the removed `.agents/application-summary/` path:

- `docs/st-lucie-design-doc.md` — requirements, user stories, and architecture decisions
- `docs/database-design.md` — schema, capacity model, and access patterns
- `docs/aws-serverless-architecture.md` — AWS architecture reference
- `docs/scheduling-design.md` — scheduling behavior and service flow
- `docs/queue-design.md` — queue behavior
- `tests/TESTING.md` — targeted unit, integration, and E2E commands
- `demos/run_demo.md` — prototype instructions
