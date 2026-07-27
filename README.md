# St. Lucie County AI-Powered Tax Office System

An AI-powered conversational interface and intelligent office operations platform for the St. Lucie County Tax Collector. Built as a proof-of-concept by the Cal Poly DxHub.

Citizens interact with an AI chatbot that pre-screens their needs, validates document requirements, and schedules appointments based on transaction complexity and clerk skills. Office staff use a real-time queue management system with dynamic routing to skill-matched clerks.

## Architecture

The system deploys as two CDK stacks sharing a single Aurora PostgreSQL database:

```text
                                  CloudFront distribution
             ┌───────────────────────┼────────────────────────┐
             │                       │                        │
        S3 frontend origin       API origins                  │
  ┌──────────┼───────────┐  ┌──────┴──────────────────────────┴──────┐
  │ /        │ /chat     │  │ /api/*       → BackOffice HTTP API     │
  │ Office   │ Chatbot   │  │ /api/chat/*  → Chatbot REST API        │
  │ Ops SPA  │ SPA       │  │ /api/admin/* → Admin REST API          │
  └──────────┴─────┬─────┘  └───────┬─────────────┬─────────────┬────┘
                   │                │             │             │
              /admin SPA      AppointmentFn     QueueFn     ChatbotFn / AdminFn
                   │          (Express + LWA) (Express + LWA) (Express on Lambda)
                   └────────────────┴─────────────┴─────────────┘
                                            │
                                    ┌───────┴───────┐
                                    │  Aurora PG    │
                                    │ (RDS Proxy)   │
                                    └───────────────┘
```

**BackOffice Stack** — VPC, Aurora Serverless v2 (PostgreSQL 17.4), RDS Proxy, two Express-on-Lambda functions (appointments + queue), Cognito auth, WAF, SQS email worker, EventBridge scheduler.

**Chatbot Stack** — Claude Sonnet via Bedrock Converse API, Bedrock Knowledge Base (RAG), S3 for document uploads, admin dashboard API, CloudFront distribution for frontends and routing API traffic.

## Source Layout

```
├── services/
│   ├── office-ops/           # Office Operations Express backend + business logic
│   │   ├── server/           #   Express HTTP layer (routes, middleware, workers)
│   │   └── src/              #   Business logic (booking, queue, check-in)
│   ├── chatbot/              # AI Chatbot Express backend (Bedrock, state machine, tools)
│   └── admin/                # Admin Dashboard Express backend (session review)
├── frontend/                 # Office Operations React SPA (check-in, queue, scheduling)
├── apps/
│   ├── chatbot-app/          # Chatbot React SPA
│   └── admin-app/            # Admin Dashboard React SPA
├── packages/
│   ├── data-access/          # @st-lucie/data-access — shared PostgreSQL operations
│   └── shared-types/         # @st-lucie/shared-types — shared TypeScript types
├── infra/                    # CDK v2 infrastructure (2 stacks)
├── db/                       # PostgreSQL schema + seed data
├── scripts/                  # Deployment automation
├── tests/                    # Unit, integration, and E2E tests (Vitest + Playwright)
└── docs/                     # Design documentation
```

## Prerequisites

- Node.js 22+
- Docker (for local PostgreSQL)
- AWS CLI configured with appropriate permissions
- AWS account with access to:
  - Amazon Bedrock (Claude Sonnet model access enabled)
  - Aurora Serverless v2, RDS Proxy
  - Lambda, API Gateway, CloudFront, S3, WAF
  - Cognito, SES (verified sender identity), SQS, SNS
  - EventBridge, Secrets Manager

## Quick Start (Local Development)

1. **Clone and install dependencies:**

   ```bash
   git clone <repo-url>
   cd st-lucie-tax
   npm install
   ```

2. **Set up environment variables:**

   ```bash
   cp .env.example .env
   # Edit .env with your local database credentials and AWS settings
   ```

3. **Start the local database:**

   ```bash
   docker compose up db
   ```

   This starts PostgreSQL with the schema and seed data auto-applied.

4. **Run the Office Operations backend:**

   ```bash
   npm -w @st-lucie/office-ops run dev
   ```

5. **Run a frontend (in a separate terminal):**

   ```bash
   # Office Operations UI
   cd frontend && npm run dev

   # Chatbot UI
   cd apps/chatbot-app && npm run dev

   # Admin Dashboard
   cd apps/admin-app && npm run dev
   ```

## Environment Variables

| Variable               | Required | Description                               |
| ---------------------- | -------- | ----------------------------------------- |
| `POSTGRES_DB`          | Yes      | Database name                             |
| `POSTGRES_USER`        | Yes      | Database user                             |
| `POSTGRES_PASSWORD`    | Yes      | Database password                         |
| `PGHOST`               | Yes      | Database host (`localhost` for local dev) |
| `SENDER_EMAIL`         | Yes      | Verified SES sender email                 |
| `BASE_URL`             | Deploy   | CloudFront distribution URL               |
| `AWS_ACCOUNT_ID`       | Deploy   | AWS account for Bedrock Knowledge Base    |
| `AUTHID_BASE_URL`      | Deploy   | AuthID verification service URL           |
| `AUTHID_API_KEY_ID`    | Deploy   | AuthID API key ID                         |
| `AUTHID_API_KEY_VALUE` | Deploy   | AuthID API key value                      |
| `ORIGIN_SECRET`        | Deploy   | CloudFront-to-origin verification header  |

## Development Commands

```bash
# Monorepo (root)
npm install                    # Install all workspaces
npm test                       # Run all tests (Vitest)
npm run lint                   # ESLint check
npm run fix                    # ESLint fix + Prettier

# Type-check
npx tsc --noEmit               # Root project
cd infra && npm run build      # CDK infrastructure

# Database
docker compose up db           # Start local PostgreSQL
docker compose down            # Stop database

# E2E tests
npx playwright test            # Chatbot end-to-end tests
```

## Deployment

```bash
# Build and synth
cd infra && npm run build
npx cdk synth

# Deploy both stacks
npx cdk deploy --all

# Post-deploy: initialize database schema + deploy frontends
scripts/post-deploy.sh
```

After deployment, initialize the database by invoking the `DbInitFn` Lambda (name in stack outputs):

```bash
aws lambda invoke --function-name <DbInitFnName> /dev/stdout
```

## Key Design Decisions

- **Decision trees as source of truth** — The AI chatbot uses deterministic decision trees and an item catalog as the authoritative source for document requirements. The LLM cannot improvise requirements.
- **10-state conversation machine** — A state machine controls chatbot progression; the LLM handles natural language within each state's boundaries.
- **Fault isolation** — Appointment and queue domains run on separate Lambdas with reserved concurrency.
- **Single CloudFront distribution** — All three SPAs and all API traffic route through one distribution (no CORS complexity).
- **Optimistic find, pessimistic book** — Slot search is fast; booking acquires row locks and rechecks capacity to ensure slots aren't double booked.

## Tech Stack

TypeScript, Express 5, React 19, Vite, Tailwind CSS 4, PostgreSQL 17.4, AWS Bedrock (Claude Sonnet), Bedrock Knowledge Base, Lambda (ARM64), Aurora Serverless v2, RDS Proxy, S3, CloudFront, WAF, Cognito, SES, SQS, EventBridge, CDK v2, Vitest, Playwright.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
