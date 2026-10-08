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
  │ /        │ /chat     │  │ /api/*          → BackOffice HTTP API  │
  │ Office   │ Chatbot   │  │ /api/ops-admin/*  ↳ office config API  │
  │ Ops SPA  │ SPA       │  │ /api/chat/*     → Chatbot REST API     │
  │          │           │  │ /api/admin/*    → Admin REST API       │
  └──────────┴─────┬─────┘  └───────┬─────────────┬─────────────┬────┘
                   │                │             │             │
              /admin SPA      AppointmentFn     QueueFn     ChatbotFn / AdminFn
                   │          (Express + LWA) (Express + LWA) (Express on Lambda)
                   └────────────────┴─────────────┴─────────────┘
                                            │
                              Aurora PostgreSQL 17.4 via RDS Proxy
```

**BackOffice Stack** — VPC, Aurora Serverless v2 (PostgreSQL 17.4), RDS Proxy, two Express-on-Lambda functions (appointments + queue), Cognito auth, WAF, SQS email worker, EventBridge scheduler.

**Chatbot Stack** — Claude Sonnet 4.6 via Bedrock Converse API, Bedrock Knowledge Base (RAG), S3 for document uploads, admin dashboard API, CloudFront distribution for frontends and routing API traffic.

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
- Docker — required for local PostgreSQL **and at deploy time**: the BackOffice stack builds Lambda container images during `cdk deploy` (`infra/lib/back-office-stack.ts`, `DockerImageCode.fromImageAsset`); the daemon must be running or the first stack fails.
- AWS CLI configured with deployment permissions, targeting **us-east-1** (the CloudFront-scoped WAF and ACM path require it; `infra/lib/env-config.ts` asserts the region at synth).
- An AWS account with Amazon Bedrock **model access explicitly enabled** (a fresh account has none by default): Claude Sonnet 4.6 (`us.anthropic.claude-sonnet-4-6`) and Titan Text Embeddings v2 (`amazon.titan-embed-text-v2:0`) in **us-east-1** for conversation + the Knowledge Base, and Claude Haiku 4.5 (`us.anthropic.claude-haiku-4-5-20251001-v1:0`) in **us-east-2** (per `BEDROCK_VISION_REGION`) for document screening. Plus Aurora Serverless v2, RDS Proxy, Lambda, API Gateway, CloudFront, S3/S3 Vectors, WAF, Cognito, SES, SQS, SNS, EventBridge, Secrets Manager, and Systems Manager.
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

| Variable                                                                                  | When needed               | Description                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`                                       | Local Compose (optional)  | Database container settings; defaults are `stlucie`, `stlucie`, and `localdev`.                                                                                                                                                                                     |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`                                  | Service database override | PostgreSQL connection settings. Local service defaults target `127.0.0.1:5432`, database/user `stlucie`, and password `localdev`.                                                                                                                                   |
| `SENDER_EMAIL`                                                                            | CDK synthesis/deployment  | Verified SES sender identity; required by the BackOffice stack.                                                                                                                                                                                                     |
| `ORIGIN_SECRET`                                                                           | CDK synthesis/deployment  | Required CloudFront-to-chatbot/admin origin header value. Use a strong secret.                                                                                                                                                                                      |
| `BASE_URL`                                                                                | Deployment (optional)     | Public base URL for customer email links. **No default** — leave blank on first deploy; set it to the Chatbot `FrontendUrl` output (or a custom domain) and redeploy **both** stacks (`npx cdk deploy --all`) before real email goes out. See `infra/DEPLOY.md` §7. |
| `DOCUMENTS_BUCKET_NAME`                                                                   | Deployment (optional)     | Leave blank — the Chatbot stack imports the live BackOffice DocumentsBucket automatically. Set only to pin a pre-existing bucket.                                                                                                                                   |
| `BEDROCK_VISION_MODEL_ID`, `BEDROCK_VISION_REGION`                                        | Deployment (optional)     | Document-screening vision model and its region (default `us-east-2`). Model access must be enabled in that region.                                                                                                                                                  |
| `AUTHID_BASE_URL`, `AUTHID_API_KEY_ID`, `AUTHID_API_KEY_VALUE`, `AUTHID_DL_DOC_TYPE_CODE` | AuthID integration        | Optional biometric-verification configuration for the chatbot.                                                                                                                                                                                                      |
| `CUSTOM_DOMAIN_NAME`, `CUSTOM_DOMAIN_CERTIFICATE_ARN`                                     | Deployment (optional)     | Custom domain: set **both or neither**. The ACM certificate must be in us-east-1. Omit to serve on the CloudFront default domain.                                                                                                                                   |
| `ALARM_EMAIL`                                                                             | Deployment (optional)     | Email recipient for the Chatbot stack’s SNS alarms.                                                                                                                                                                                                                 |
| `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`                                               | CDK deployment            | Target AWS environment. **`CDK_DEFAULT_REGION` must be `us-east-1`** (CloudFront WAF + ACM); synth throws otherwise.                                                                                                                                                |

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

**For a from-zero deploy to a new AWS account, follow the authoritative runbook [`infra/DEPLOY.md`](infra/DEPLOY.md) end to end** — it covers every prerequisite (us-east-1, Docker at deploy, Bedrock model access, SES, the RDS service-linked role, `cdk bootstrap`) and post-deploy step (DB seed, Cognito user, KB ingestion, smoke test). The summary below assumes those prerequisites are already met.

Run from the repository root:

```bash
# One-time / per-shell: pin the profile AND the region — the scripts/ calls below are plain
# `aws` CLI wrappers that pass no --region of their own; region MUST be us-east-1
export AWS_PROFILE=<your-profile>       # omit only if the default profile IS the target account
export CDK_DEFAULT_REGION=us-east-1 AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1

# Prove the account: a wrong region fails loudly at synth, a wrong account does not
aws sts get-caller-identity             # note the Account id for the bootstrap below

# Fresh account only: RDS Proxy needs AWSServiceRoleForRDS, or BackOffice rolls back entirely
aws iam get-role --role-name AWSServiceRoleForRDS \
  || aws iam create-service-linked-role --aws-service-name rds.amazonaws.com

# Configure: copy the template, then set SENDER_EMAIL + a real ORIGIN_SECRET
cp .env.example .env                    # edit SENDER_EMAIL, ORIGIN_SECRET (openssl rand -base64 32)

# Install deps + build fresh frontend assets (CDK packages dist/, it does not build the SPAs)
npm install
npm run build:frontends

# Bootstrap AFTER the build: `cdk bootstrap` synthesizes the app, so from a fresh clone with no
# frontend dist/ it dies on the synth-time guard and nothing gets bootstrapped
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1   # ACCOUNT_ID from get-caller-identity; once per account/region

# Validate and deploy the two CDK stacks (BackOffice then Chatbot; order auto-resolved)
npx cdk synth
npx cdk deploy --all --require-approval never   # both stacks create IAM roles; prompts hang CI

# Initialize the DB (schema + seed on an empty DB), upload SPAs + runtime config, invalidate CloudFront
scripts/post-deploy.sh

# Create the first staff/admin user — REQUIRED: Cognito self-signup is disabled, so without
# this EVERY SPA (including the citizen /chat) is locked out. The script echoes the groups it
# attached and exits non-zero if any failed; a user in zero groups gets 403 from every API.
# The password must meet the pool policy (min 8, upper + lower + digit) or the script fails
# after creating the user but before attaching groups. Avoid @example.com addresses: that
# domain flags sessions as test sessions, which the admin dashboard hides by default.
scripts/create-user.sh staff@yourcounty.gov 'Deploy2026temp' admin,checkin_clerk,service_clerk
```

`npm run deploy` rebuilds the frontends (build-only, no upload) via the `predeploy` hook and then runs `cdk deploy --all` — the same two steps as above and safe for a first deploy, with one difference: the script passes no `--require-approval never`, so it stops at the IAM approval prompt. Use it interactively; for a non-interactive or scripted run use `npx cdk deploy --all --require-approval never` directly. For frontend-only redeploys (build + upload + CloudFront invalidation against the live bucket) use `scripts/build-frontends.sh` (or `npm run deploy:frontends`).

Customer email links take a second pass: set `BASE_URL` in `.env` to the Chatbot `FrontendUrl` output, then rerun `npx cdk deploy --all`. **Both** stacks read `BASE_URL` (the BackOffice functions and `ChatbotFn`), so redeploying BackOffice alone leaves the chatbot's booking-confirmation email on its first-pass value. Setting `CUSTOM_DOMAIN_NAME` before the first deploy skips this entirely — see [`infra/DEPLOY.md`](infra/DEPLOY.md) §7.

# Collaboration

Thanks for your interest in our solution. Having specific examples of replication and cloning allows us to continue to grow and scale our work. If you clone or download this repository, kindly shoot us a quick email to let us know you are interested in this work!

[wwps-cic@amazon.com]

# Disclaimers

**Customers are responsible for making their own independent assessment of the information in this document.**

**This document:**

(a) is for informational purposes only,

(b) represents current AWS product offerings and practices, which are subject to change without notice, and

(c) does not create any commitments or assurances from AWS and its affiliates, suppliers or licensors. AWS products or services are provided “as is” without warranties, representations, or conditions of any kind, whether express or implied. The responsibilities and liabilities of AWS to its customers are controlled by AWS agreements, and this document is not part of, nor does it modify, any agreement between AWS and its customers.

(d) is not to be considered a recommendation or viewpoint of AWS

**Additionally, all prototype code and associated assets should be considered:**

(a) as-is and without warranties

(b) not suitable for production environments

(d) to include shortcuts in order to support rapid prototyping such as, but not limitted to, relaxed authentication and authorization and a lack of strict adherence to security best practices

**All work produced is open source. More information can be found in the GitHub repo.**

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

## Support

For queries or issues:

- Darren Kraker, Sr Solutions Architect - dkraker@amazon.com
- Mason Lewis, Software Engineer Intern - mlewis@calpoly.edu
- Nick Riley, Jr SDE - njriley@calpoly.edu
