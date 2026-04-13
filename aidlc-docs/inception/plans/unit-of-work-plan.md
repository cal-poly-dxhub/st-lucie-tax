# Unit of Work Plan

## Overview
Decompose the St. Lucie County Tax Collector platform into units of work for incremental construction. Each unit will go through the full Construction phase loop (Functional Design → NFR Requirements → NFR Design → Infrastructure Design → Code Generation).

## System Summary
- **10 components**: 3 frontend (FC-01/02/03), 6 backend (BC-01 through BC-06), 1 shared infra layer (SI-02/SI-03)
- **7 services**: SVC-01 through SVC-07
- **46 user stories** across 24 epics
- **68+ functional requirements**

---

## Part 1: Decomposition Questions

### Question 1
How should the codebase be organized?

A) Monorepo — single repository with all units in subdirectories (e.g., `packages/shared-infra/`, `packages/chatbot-service/`, `packages/staff-app/`)
B) Polyrepo — separate repository per unit of work
C) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 2
How granular should the backend units be?

A) One unit per backend domain — 6 backend units (Chatbot Service, Identity/Doc Service, Admin Service, Clerk Service, Scheduling Service, Notification Service) each deployed independently
B) Grouped by service interaction — 3 backend units: Customer-Facing (BC-01 + BC-02 + BC-05), Staff-Facing (BC-03 + BC-04), Shared Services (BC-06)
C) Single backend unit — all 6 backend services + shared infra built together as one unit, deployed as separate Lambdas but from one CDK stack
D) Other (please describe after [Answer]: tag below)

[Answer]: C

### Question 3
How should the 3 frontend apps be organized as units?

A) One unit per frontend app — 3 separate units (Chatbot App, Staff App, Display App) each with its own build/deploy
B) Single frontend unit — all 3 React apps in one unit with a shared component library, built and deployed together
C) Two units — Chatbot App as one unit (public-facing, no auth), Staff + Display as another unit (internal)
D) Other (please describe after [Answer]: tag below)

[Answer]: B

### Question 4
Where should the shared infrastructure layer (SI-02 Auth/Tenant, SI-03 Data Access) live?

A) Dedicated "Foundation" unit — built first, contains shared infra + DynamoDB table + Cognito + data access layer. All other units depend on it.
B) Distributed — each backend unit includes the shared infra pieces it needs
C) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 5
What should the CI/CD unit include?

A) Full pipeline — CodePipeline + CodeBuild for each unit, multi-environment (dev/staging/prod), automated deploy on merge to main, manual approval gate for prod
B) Basic pipeline — single CodeBuild project per unit, deploy to dev on push, manual deploy to prod
C) Minimal — just buildspec files and CDK pipeline stack, single environment (dev) for MVP, add staging/prod later
D) Other (please describe after [Answer]: tag below)

[Answer]: D — No CI/CD unit. POC uses a deploy.sh script in the Foundation unit for repeatable `cdk deploy` commands. CI/CD pipeline deferred to post-POC if project moves to production.

### Question 6
What order should units be built in? (Rank your preference)

A) Foundation first → CI/CD → Backend services (dependency order) → Frontend apps → Integration
B) Foundation first → CI/CD → Vertical slices (one full feature end-to-end at a time, e.g., chatbot backend + frontend together)
C) CI/CD first → Foundation → Backend → Frontend (pipeline exists before any app code)
D) Other (please describe after [Answer]: tag below)

[Answer]: D — Foundation → Backend → Frontend (no CI/CD unit, deploy.sh handles deployment)

---

## Part 2: Generation Execution Plan

After questions are answered, the following artifacts will be generated:

- [x] **Step 1**: Analyze answers and resolve any ambiguities — All 6 answers validated, no contradictions. Q5/Q6 customized: no CI/CD unit, deploy.sh in Foundation. Additional tooling decisions captured: ESLint, Prettier, Husky, TypeScript project refs, shared types, cdk-nag, env config. Bedrock KB and S3 doc bucket placed in Foundation.
- [x] **Step 2**: Generate `aidlc-docs/inception/application-design/unit-of-work.md` — 3 units defined (Foundation, Backend, Frontend) with components, responsibilities, and monorepo code organization
- [x] **Step 3**: Generate `aidlc-docs/inception/application-design/unit-of-work-dependency.md` — dependency matrix, SSM-based cross-stack integration, deploy.sh execution order
- [x] **Step 4**: Generate `aidlc-docs/inception/application-design/unit-of-work-story-map.md` — all 47 stories mapped to units with primary/secondary ownership
- [x] **Step 5**: Validate unit boundaries — all 10 components assigned, all 7 services assigned, all 47 stories mapped, no orphans
- [x] **Step 6**: Validate dependencies — linear dependency chain (Foundation → Backend → Frontend), no circular dependencies, build order achievable
