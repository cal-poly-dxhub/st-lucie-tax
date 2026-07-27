# St. Lucie County AI-Powered Tax Office System

An AI-powered conversational interface and intelligent office operations platform for the St. Lucie County Tax Collector. Built as a proof-of-concept by the Cal Poly DxHub.

Citizens interact with an AI chatbot that pre-screens their needs, validates document requirements, and schedules appointments based on transaction complexity and clerk skills. Office staff use a real-time queue management system with dynamic routing to skill-matched clerks.

## Architecture

The system deploys as two CDK stacks sharing a single Aurora PostgreSQL database:

```
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
                              Aurora PostgreSQL 17.4 via RDS Proxy
```

**BackOffice Stack** — VPC, Aurora Serverless v2 (PostgreSQL 17.4), RDS Proxy, two Express-on-Lambda functions (appointments + queue), Cognito auth, WAF, SQS email worker, EventBridge scheduler.

**Chatbot Stack** — Claude Sonnet via Bedrock Converse API, Bedrock Knowledge Base (RAG), S3 for document uploads, admin dashboard API, CloudFront distribution for frontends and routing API traffic.

## Source Layout

```
├── services/
│   ├── office-ops/           # Office Operations Express backend and Lambda container
│   │   ├── server/           #   HTTP routes, middleware, and workers
│   │   ├── src/              #   Booking, queue, and check-in business logic
│   │   └── tests/            #   Service-level unit and integration tests
│   ├── chatbot/              # AI Chatbot Express backend, state machine, tools, and prompts
│   └── admin/                # Admin Dashboard Express backend and session-review API
├── apps/
│   ├── chatbot-app/          # Chatbot React SPA
│   └── admin-app/            # Admin Dashboard React SPA
├── frontend/                 # Office Operations React SPA
├── packages/
│   ├── data-access/          # @st-lucie/data-access PostgreSQL operations
│   └── shared-types/         # @st-lucie/shared-types domain and API types
├── infra/                    # CDK v2: BackOffice and Chatbot stacks
├── db/                       # PostgreSQL schema and seed data
├── demos/                    # HTML prototypes and reference API endpoints
├── scripts/                  # Frontend build/deployment and post-deploy automation
├── tests/                    # Cross-service unit, integration, and Playwright E2E tests
└── docs/                     # Design and database documentation
```

## Prerequisites

- Node.js 22+
- Docker (for local PostgreSQL)
- AWS CLI configured with deployment permissions
- An AWS account with access to Amazon Bedrock (Claude Sonnet 4 and Titan Text Embeddings v2), Aurora Serverless v2, RDS Proxy, Lambda, API Gateway, CloudFront, S3/S3 Vectors, WAF, Cognito, SES, SQS, SNS, EventBridge, Secrets Manager, and Systems Manager
- A verified SES sender identity for deployed email delivery

## Quick Start (Local Development)

1. **Clone, install, and configure local settings:**

   ```bash
   git clone https://github.com/cal-poly-dxhub/st-lucie-tax
   cd st-lucie-tax
   npm install
   cp .env.example .env
   ```

   The Compose database defaults to `stlucie` / `stlucie` / `localdev`. If you change the `POSTGRES_*` values, also set the matching `PGDATABASE`, `PGUSER`, and `PGPASSWORD` values used by the services.

2. **Start PostgreSQL with schema and seed data:**

   ```bash
   docker compose up -d db
   ```

3. **Run a surface and its matching backend in separate terminals:**

   ```bash
   # Office Operations API and UI
   npm -w @st-lucie/office-ops run dev
   cd frontend && npm run dev

   # Chatbot API and UI (requires AWS credentials and Bedrock model access)
   npm -w @st-lucie/chatbot-service run dev
   cd apps/chatbot-app && npm run dev

   # Admin API and UI
   npm -w @st-lucie/admin-service run dev
   cd apps/admin-app && npm run dev
   ```

   The Office Operations API and Chatbot API both default to port `3000`; run one of them at a time with the checked-in Vite proxy configuration. The Admin API uses port `3100`; the Chatbot and Admin SPAs use ports `5180` and `5181`, respectively.

## Environment Variables

| Variable                                                                                  | When needed               | Description                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`                                       | Local Compose (optional)  | Database container settings; defaults are `stlucie`, `stlucie`, and `localdev`.                                                   |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`                                  | Service database override | PostgreSQL connection settings. Local service defaults target `127.0.0.1:5432`, database/user `stlucie`, and password `localdev`. |
| `SENDER_EMAIL`                                                                            | CDK synthesis/deployment  | Verified SES sender identity; required by the BackOffice stack.                                                                   |
| `ORIGIN_SECRET`                                                                           | CDK synthesis/deployment  | Required CloudFront-to-chatbot/admin origin header value. Use a strong secret.                                                    |
| `BASE_URL`                                                                                | Deployment (optional)     | Public CloudFront URL used in email links; the stack has a fallback value.                                                        |
| `AUTHID_BASE_URL`, `AUTHID_API_KEY_ID`, `AUTHID_API_KEY_VALUE`, `AUTHID_DL_DOC_TYPE_CODE` | AuthID integration        | Optional biometric-verification configuration for the chatbot.                                                                    |
| `ALARM_EMAIL`                                                                             | Deployment (optional)     | Email recipient for the Chatbot stack’s SNS alarms.                                                                               |
| `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`                                               | CDK deployment            | Target AWS environment, normally supplied by the AWS CLI/CDK configuration.                                                       |

The CDK app loads the root `.env` file. Do not commit environment files containing credentials or origin secrets.

## Development Commands

```bash
# Monorepo
npm install                    # Install all workspaces
npm test                       # Run Vitest unit and integration tests
npm run lint                   # Run ESLint
npm run format:check           # Check Prettier formatting
npm run fix                    # Apply ESLint and Prettier fixes

# TypeScript and CDK
npx tsc --noEmit               # Check the root TypeScript project
(cd infra && npm run build)    # Compile CDK infrastructure
npx cdk synth                  # Synthesize both stacks from the repository root

# Local database
docker compose up -d db        # Start local PostgreSQL 16 with schema and seed data
```

## Testing

See [`tests/TESTING.md`](tests/TESTING.md) for targeted unit, integration, and Playwright commands.

## Deployment

Run these commands from the repository root after setting `SENDER_EMAIL` and `ORIGIN_SECRET` in `.env` and bootstrapping the target AWS environment. The frontend build is explicit because CDK packages the existing `dist/` directories; it does not build the SPAs itself.

```bash
# Build fresh frontend assets without uploading them
npm run build:frontends

# Validate and deploy the two CDK stacks
npx cdk synth
npx cdk deploy --all

# Initialize the deployed database, upload all SPAs and runtime config, and invalidate CloudFront
scripts/post-deploy.sh
```

`npm run deploy` runs the frontend upload script before CDK deploy, so use it only after the `Chatbot` stack has already created the frontend bucket and CloudFront distribution. For frontend-only redeployments, use `scripts/build-frontends.sh`.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.
