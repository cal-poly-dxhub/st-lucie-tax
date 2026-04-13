# Tech Stack Decisions — Unit 1: Foundation

## Overview
Technology choices for the Foundation unit. These decisions apply to all subsequent units unless explicitly overridden.

---

## Runtime & Language

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Type safety across Lambda handlers, CDK, and shared packages. Single language for full stack. |
| Node.js version | 22.x (LTS) | Latest LTS, supported through April 2027. Longest runway for a new project. |
| Lambda runtime | `nodejs22.x` | Matches Node.js version decision. |
| Module system | ESM (`"type": "module"`) | Modern standard, tree-shakeable, native top-level await. |

---

## Package Management & Monorepo

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package manager | npm workspaces | Built into Node.js, zero extra tooling. Sufficient for a 3-unit monorepo with ~7 packages. |
| Monorepo structure | npm workspaces with TypeScript project references | Workspace linking for local packages + `tsc --build` for incremental compilation. |
| Lock file | `package-lock.json` | npm default. Committed to version control (SECURITY-10). |

---

## Infrastructure as Code

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IaC framework | AWS CDK v2 (`aws-cdk-lib`) | Current standard. All constructs in one package. TypeScript-native. |
| CDK version | Latest stable v2 | Pinned in `package.json` with exact version. |
| Security scanning | `cdk-nag` (AWS Solutions + HIPAA Security packs) | Per Q13 from Functional Design. Runs at synth time. |
| Stack structure | 3 stacks: `FoundationStack`, `BackendStack`, `FrontendStack` | One per unit. Cross-stack references via SSM Parameters. |

---

## AWS Services (Foundation Unit)

| Service | Purpose | Configuration |
|---------|---------|---------------|
| DynamoDB | Single table, all entities | On-demand, PITR enabled, SSE default (AWS-owned key) |
| Cognito | User pool for clerk/admin auth | Standard security, MFA optional/required by role |
| S3 (document bucket) | DL photos, identity documents | SSE-S3, no versioning, 35-day lifecycle, public access blocked |
| S3 (KB data source) | tcslc.com content for Bedrock KB | SSE-S3, no versioning, public access blocked |
| Bedrock Knowledge Base | General Q&A fallback for chatbot | S3 data source, managed embeddings |
| SSM Parameter Store | Cross-stack outputs | String params (table name, pool ID, bucket names, KB ID) |
| CloudWatch Logs | Lambda + API Gateway logs | 90-day retention |
| CloudWatch Alarms | DynamoDB throttles, S3 errors, Cognito auth failures | SNS topic, zero subscribers initially |
| SNS | Alarm notification hub | Single topic, no subscribers until pre-launch |

---

## Dev Tooling

| Tool | Version/Config | Purpose |
|------|---------------|---------|
| TypeScript | Latest stable (pinned) | Type checking, project references |
| ESLint | Latest stable + `@typescript-eslint` | Linting, code quality |
| Prettier | Latest stable | Code formatting |
| Husky | Latest stable | Git hooks (pre-commit) |
| lint-staged | Latest stable | Run lint/format on staged files only |
| esbuild | Via `aws-cdk-lib` `NodejsFunction` | Lambda bundling (CDK handles this) |

---

## Dependency Pinning (SECURITY-10)

All dependencies use exact versions in `package.json` (no `^` or `~` prefixes). `package-lock.json` committed to version control.

| Category | Approach |
|----------|----------|
| Production deps | Exact versions |
| Dev deps | Exact versions |
| CDK constructs | Exact version of `aws-cdk-lib` |
| Lock file | `package-lock.json` committed |
| Vulnerability scanning | `npm audit` in build instructions (backlog: CI integration) |

---

## Decisions Deferred to Later Units

| Decision | Deferred To | Rationale |
|----------|-------------|-----------|
| API Gateway configuration | Unit 2 (Backend) | REST API routes, throttling, CORS defined with backend services |
| Frontend framework (React) | Unit 3 (Frontend) | React version, build tool (Vite), UI library chosen with frontend unit |
| Twilio SDK version | Unit 2 (Backend) | Notification service is in Backend unit |
| Bedrock model selection | Unit 2 (Backend) | Chatbot service owns model choice (Converse API) |
