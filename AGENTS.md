# St. Lucie County AI-Powered Tax System

## What This Is

A PoC replacing the St. Lucie County Tax Collector's static website and appointment system with an AI-powered conversational interface + intelligent office operations platform. Built by AWS CIC/DxHub for the county tax collector's office. MIT licensed, designed for handoff to an implementation partner.

## Business Context

Citizens arrive at county offices missing documents or unaware of prerequisites. The current system schedules static 15-20 minute blocks regardless of complexity. This system: pre-screens via AI chatbot, validates documents, dynamically schedules based on transaction complexity + clerk skills + capacity, and routes customers to skill-matched clerks. Target: 1 hour saved/clerk/day across 3 offices (72 hours/day = 9 FTE equivalent).

## Architecture

Unified npm-workspaces monorepo deployed as two CDK stacks sharing a single Aurora PostgreSQL database:

1. **BackOffice Stack** — VPC, Aurora Serverless v2 (PostgreSQL 17.4), RDS Proxy, two fault-isolated Express-on-Lambda functions (AppointmentFn for citizen/booking, QueueFn for in-office operations) behind a single HTTP API with path-based routing. Async workers (email via SQS, nightly duration-rec via EventBridge, schema init). Cognito for staff auth. WAF WebACL.

2. **Chatbot Stack** — Receives VPC/proxy/secret from BackOffice. ChatbotFn Lambda (Express, 1536MB, 120s) backed by Claude Sonnet 4 via Bedrock Converse API. AdminFn Lambda (Express, 512MB, 30s) for dashboard API. Two REST API Gateways (chatbot + admin) with API keys. Bedrock Knowledge Base for RAG. S3 for doc uploads + KB data. Single CloudFront distribution serving all three SPAs and routing all API traffic. SNS alarm topic with Bedrock/error/throttle alarms.

All three services (Office Ops, Chatbot, Admin) connect to the same Aurora instance through RDS Proxy. The chatbot uses `@st-lucie/data-access` (PostgreSQL) for session state — DynamoDB is no longer used.

## Source Layout

```
# Monorepo Root
package.json              # Workspaces: packages/*, services/*, apps/*, frontend
cdk.json                  # CDK entry: infra/bin/app.ts (2 stacks)
compose.yml               # Local dev (PostgreSQL)
Dockerfile                # Office Ops Lambda container (LWA)

# Shared Packages
packages/data-access/     # @st-lucie/data-access — PostgreSQL operations for chat_sessions/messages/tokens
packages/shared-types/    # @st-lucie/shared-types — Session, ConversationState, TransactionType, API types

# Services
services/chatbot/         # AI Chatbot Express backend (Bedrock, state machine, tools, prompts, decision trees, KB)
services/admin/           # Admin dashboard Express backend (session list, transcripts, reviewed flag)

# Frontend Applications
apps/chatbot-app/         # Chatbot React SPA (chat UI, file upload, AuthID, scheduler, side panel)
apps/admin-app/           # Admin React SPA (session transcripts, feedback review)
frontend/                 # Office Operations React SPA (check-in, scheduling, lobby, service-clerk, etc.)

# Office Operations Backend (root-level)
src/                      # Business logic (booking, check-in, queue, documents, email, etc.)
server/                   # Express HTTP layer (routes/, workers/, middleware/, app.ts, db.ts)

# Infrastructure & Data
infra/                    # CDK v2 (2 stacks: BackOffice + Chatbot)
db/                       # PostgreSQL schema + seed data

# Support
demos/                    # HTML prototypes (admin, scheduling — endpoint source of truth)
scripts/                  # Deployment automation (post-deploy, frontend deploy)
docs/                     # Design documentation
tests/                    # Unit + integration tests (Vitest)
```

## Key Files

### Shared Packages

| File                                            | Purpose                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/data-access/src/operations.ts`        | Typed PostgreSQL CRUD for chat_sessions, chat_messages, chat_auth_tokens |
| `packages/data-access/src/client.ts`            | Connection pool (Secrets Manager for Lambda, env vars for local)         |
| `packages/shared-types/src/session.ts`          | Session, StructuredContext, ConversationState, all chatbot domain types  |
| `packages/shared-types/src/transaction-type.ts` | TransactionType definitions                                              |

### Office Operations

| File                               | Purpose                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `server/app.ts`                    | Express app — conditional router mount by SERVICE                       |
| `server/middleware/auth.ts`        | JWT validation (Cognito) + role-based route access                      |
| `server/routes/appointment.ts`     | Citizen/booking API endpoints                                           |
| `server/routes/queue.ts`           | In-office queue/clerk endpoints                                         |
| `server/routes/admin.ts`           | Admin CRUD endpoints                                                    |
| `server/workers/db-init-worker.ts` | Schema initialization Lambda (manual post-deploy)                       |
| `db/schema.sql`                    | Full database DDL (tables, RLS, functions, views, chat tables)          |
| `db/seed-prod.sql`                 | Production seed data (config, offices, clerks — no sample appointments) |
| `infra/lib/back-office-stack.ts`   | BackOffice CDK stack                                                    |
| `infra/lib/chatbot-stack.ts`       | Chatbot CDK stack (chatbot + admin + CloudFront)                        |
| `infra/bin/app.ts`                 | CDK App entry (2 stacks)                                                |
| `scripts/post-deploy.sh`           | Run after CDK deploy: init DB schema + deploy frontend                  |
| `docs/st-lucie-design-doc.md`      | Requirements, user stories, architecture decisions                      |
| `docs/database-design.md`          | Schema overview, capacity model, access patterns                        |
| `demos/prototype-server.ts`        | Source of endpoints being promoted to production                        |

### AI Chatbot (`services/chatbot/`)

| File                                  | Purpose                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `src/conversation/process-message.ts` | Core message pipeline (scrub → prompt → Bedrock → advance → guard) |
| `src/conversation/bedrock-client.ts`  | Bedrock Converse API (Sonnet 4, temp 0.3, 7 retries)               |
| `src/state-machine/states.ts`         | 10-state machine definition + transitions                          |
| `src/prompts/default-prompts.ts`      | State-specific system prompts                                      |
| `src/conversation/state-tools.ts`     | 14 state-specific toolsets (~24 tools)                             |
| `src/knowledge-base/query.ts`         | Bedrock KB RAG (tcslc.com, FLHSMV, FL statutes)                    |
| `src/middleware/input-scrub.ts`       | PII removal (SSN/card/bank; preserves DL#, ZIP, VIN)               |
| `data/decision-trees/`                | 26 transaction types (fact-gated trees)                            |
| `data/fact-definitions.json`          | 100+ facts with question text + allowed values                     |
| `data/item-catalog.json`              | 300+ required documents with doc types                             |

### Admin Dashboard (`services/admin/`)

| File                           | Purpose                               |
| ------------------------------ | ------------------------------------- |
| `src/admin-app.ts`             | Express app (routes, HMAC auth, CORS) |
| `src/queries/summary.ts`       | Dashboard summary stats               |
| `src/queries/list-sessions.ts` | Filterable session listing            |
| `src/queries/get-session.ts`   | Full transcript + debug log           |
| `src/queries/set-reviewed.ts`  | Mark session reviewed/unreviewed      |

## Development Commands

### Monorepo (Root)

```bash
npm install                          # Install all workspaces
npm test                             # Run all tests (Vitest)
npm run lint                         # ESLint + Prettier check
npm run fix                          # ESLint fix + Prettier write
```

### Office Operations

```bash
docker compose up db                 # Local database
npx tsx server/index.ts              # Server (SERVICE defaults to "all")
cd frontend && npm run dev           # Frontend (Vite proxies /api to :3000)
cd infra && npx cdk deploy BackOffice  # Deploy office stack
scripts/post-deploy.sh               # DB schema + frontend (run once after CDK)
scripts/deploy-frontend.sh           # Frontend-only redeploy
```

### AI Chatbot

```bash
cd services/chatbot && npm run dev   # Backend (hits Bedrock + PostgreSQL directly)
cd apps/chatbot-app && npm run dev   # Chatbot SPA
npx playwright test                  # E2E tests
npx cdk deploy Chatbot              # Deploy chatbot + admin stack
```

### Admin Dashboard

```bash
cd services/admin && npm run dev     # Backend
cd apps/admin-app && npm run dev     # Admin SPA
```

## Personas & Surfaces

| Surface                 | Persona          | Location                                             |
| ----------------------- | ---------------- | ---------------------------------------------------- |
| AI Chatbot              | Citizen          | `apps/chatbot-app/` — served at `/chat`              |
| Admin Dashboard         | Admin/Reviewer   | `apps/admin-app/` — served at `/admin`               |
| Check-in Desk           | Check-in Clerk   | `frontend/src/pages/CheckInDesk.tsx` — served at `/` |
| Service Clerk Dashboard | Service Clerk    | `frontend/src/pages/ServiceClerk.tsx`                |
| Lobby Display           | Public           | `frontend/src/pages/LobbyDisplay.tsx`                |
| Scheduling              | Citizen          | `frontend/src/pages/SchedulePage.tsx`                |
| Office Admin Dashboard  | Admin/Supervisor | HTML prototype (`demos/`)                            |

## Tech Stack

TypeScript, Express 5, React 19, Vite 8, Tailwind CSS 4, PostgreSQL 17.4 (Aurora Serverless v2), AWS Bedrock (Claude Sonnet 4), Bedrock Knowledge Base (RAG), AWS (Lambda/LWA ARM64, Aurora, RDS Proxy, S3, SES, SQS, Cognito, CloudFront, CloudFront Functions, WAF, EventBridge, CDK v2), AuthID (biometric verification), Docker, Node.js 22, npm workspaces, Vitest, Playwright.

## Design Principles

### Office Operations

1. **Fault isolation:** Appointment and queue domains fail independently (separate Lambdas, reserved concurrency)
2. **Serverless-first:** All compute on Lambda (ARM64/Graviton), scales to 67 counties without re-architecting
3. **Same code local and prod:** LWA runs the real Express server unchanged on Lambda
4. **Same-origin via CloudFront:** Single distribution serves all SPAs + proxies all APIs (no CORS complexity)
5. **Polling over WebSocket:** 5s polling for real-time updates (PoC simplicity)
6. **Optimistic find, pessimistic book:** Slot search is fast; booking acquires row locks and rechecks capacity
7. **PII scoped to appointment lifecycle:** No long-lived customer table, easy purging
8. **App-layer auth:** Cognito JWT validation in Express middleware, not API Gateway authorizers

### AI Chatbot

9. **Trees as source of truth:** Decision trees + item catalog are the ONLY authoritative source for "what to bring" — LLM cannot improvise
10. **Deterministic state machine + LLM dialogue:** 10-state machine controls progression; LLM handles natural language within each state
11. **Conversation scoped per state:** When state changes, prior turns are left behind (keeps context lean)
12. **Structured context persists across states:** Identity, transactions, documents, facts survive state resets via `session.structuredContext`
13. **Defense in depth:** Input scrubbing (PII), prompt rules, tool-call self-healing, post-process guard, WAF + API key + rate limiting
14. **Conservative routing:** Ambiguous user messages trigger clarification questions, not confident routing

### Unified System

15. **Shared database:** All services use the same Aurora instance via RDS Proxy — eliminates DynamoDB and cross-service data sync
16. **Shared packages:** `@st-lucie/data-access` and `@st-lucie/shared-types` provide consistent data access and type safety across services
17. **Single distribution:** One CloudFront + one S3 bucket for all frontends and API routing

## Detailed Documentation

See `.agents/application-summary/` for comprehensive docs:

- `index.md` — Full navigation guide
- `product.md` — Business problem, value, use cases, personas
- `architecture.md` — System diagram, design decisions, API reference
- `infrastructure.md` — AWS resources, environment config, deployment
- `packages.md` — Complete source tree map
- `review_notes.md` — Known gaps and recommendations
