# PR Workflow — Unit 1: Foundation

**Source Plan**: [foundation-code-generation-plan.md](foundation-code-generation-plan.md)

---

## PR Dependency Graph

```
PR-1 (scaffolding)
 ├── PR-2 (shared-types)  ──┐
 │                           ├── PR-4 (cdk)
 └── PR-3 (data-access)  ───┘     │
                                   v
                              PR-5 (seed + deploy + docs)
```

**Parallel opportunities**: PR-2 and PR-3 can be developed and reviewed in parallel after PR-1 merges.

## Merge Order
1. PR-1 → 2. PR-2 + PR-3 (parallel) → 3. PR-4 → 4. PR-5

---

## PR-1: Project Scaffolding

**Branch**: `feat/foundation-scaffolding`
**Steps**: Step 1
**Depends on**: None (first PR)
**Assignee**: _TBD_

**Subtasks**:
- [ ] Root `package.json` with npm workspaces
- [ ] Root `tsconfig.json` with project references
- [ ] `.eslintrc.cjs` shared config
- [ ] `.prettierrc`
- [ ] `.env.example`
- [ ] `.gitignore` update

**Acceptance Criteria**:
- `npm install` succeeds at workspace root
- `npx tsc --build` succeeds (no packages yet, but config valid)
- ESLint and Prettier configs parse without errors

**Design Refs**: [tech-stack-decisions.md](../foundation/nfr-requirements/tech-stack-decisions.md)

---

## PR-2: Shared Types Package

**Branch**: `feat/foundation-shared-types`
**Steps**: Steps 2, 3, 4
**Depends on**: PR-1
**Assignee**: _TBD_

**Subtasks**:
- [ ] `packages/shared-types/package.json` + `tsconfig.json`
- [ ] `src/entities.ts` — 14 entity interfaces
- [ ] `src/keys.ts` — PK/SK pattern types, entity type enums, GSI key types
- [ ] `src/api.ts` — API request/response interfaces, error response type
- [ ] `src/auth.ts` — TenantContext, Role enum, JWT claims
- [ ] `src/index.ts` — barrel export
- [ ] `tests/entities.test.ts` — type compilation tests
- [ ] `tests/keys.test.ts` — enum value tests
- [ ] `aidlc-docs/construction/foundation/code/shared-types-summary.md`

**Acceptance Criteria**:
- `npx tsc --build` compiles shared-types with zero errors
- All 14 entity interfaces match domain-entities.md schemas
- Unit tests pass (`npm test -w packages/shared-types`)
- Barrel export exposes all public types

**Design Refs**: [domain-entities.md](../foundation/functional-design/domain-entities.md), [business-rules.md](../foundation/functional-design/business-rules.md) (BR-VAL-03 enums)

---

## PR-3: Data Access Package

**Branch**: `feat/foundation-data-access`
**Steps**: Steps 5, 6, 7, 8
**Depends on**: PR-1 (also imports from shared-types, but can use workspace link from PR-1 scaffolding + PR-2 merged or rebased)
**Assignee**: _TBD_

**Subtasks**:
- [ ] `packages/data-access/package.json` + `tsconfig.json`
- [ ] `src/client.ts` — DynamoDB DocumentClient singleton
- [ ] `src/keys.ts` — `buildPk()`, `buildGlobalPk()`, `buildGsi1Pk()` with validation
- [ ] `src/errors.ts` — error classes (ConcurrencyError, ItemNotFoundError, etc.)
- [ ] `src/operations.ts` — CRUD with tenant-scoped key enforcement, optimistic concurrency
- [ ] `src/config-resolver.ts` — tenant override → global fallback
- [ ] `src/index.ts` — barrel export
- [ ] `tests/keys.test.ts` — key construction, validation, injection prevention
- [ ] `tests/operations.test.ts` — CRUD with mocked DynamoDB, concurrency, tenant isolation
- [ ] `tests/config-resolver.test.ts` — override, fallback, not-found scenarios
- [ ] `aidlc-docs/construction/foundation/code/data-access-summary.md`

**Acceptance Criteria**:
- `npx tsc --build` compiles data-access with zero errors
- Key construction enforces BR-DA-01 (tenant isolation) and BR-DA-05 (injection prevention)
- Optimistic concurrency implements BR-DA-02
- Config resolution implements BR-DA-04 (tenant → global fallback)
- All unit tests pass (`npm test -w packages/data-access`)

**Design Refs**: [business-logic-model.md](../foundation/functional-design/business-logic-model.md), [business-rules.md](../foundation/functional-design/business-rules.md) (BR-DA-01 through BR-DA-05), [nfr-design-patterns.md](../foundation/nfr-design/nfr-design-patterns.md) (Pattern 1)

---

## PR-4: CDK FoundationStack

**Branch**: `feat/foundation-cdk`
**Steps**: Steps 9, 10, 11
**Depends on**: PR-2, PR-3 (references shared-types for type safety; needs data-access package in workspace)
**Assignee**: _TBD_

**Subtasks**:
- [ ] `infra/package.json` + `tsconfig.json`
- [ ] `infra/bin/app.ts` — CDK app entry with cdk-nag aspects
- [ ] `infra/lib/config.ts` — environment config loader
- [ ] `infra/lib/foundation-stack.ts` — all 16 resources (DynamoDB, S3 x2, Cognito, Bedrock KB, SNS, alarms x3, SSM x9)
- [ ] `infra/tests/foundation-stack.test.ts` — CDK assertion tests (resource counts, configs, cdk-nag)
- [ ] `aidlc-docs/construction/foundation/code/foundation-stack-summary.md`

**Acceptance Criteria**:
- `cdk synth` succeeds with zero cdk-nag errors (suppressions documented)
- CDK assertion tests verify: DynamoDB (PITR, on-demand, GSI), S3 (encryption, lifecycle, public access block), Cognito (password policy, groups, custom attributes), SSM parameter paths
- All 9 SSM parameters use `/{env}/foundation/*` paths
- `removalPolicy: RETAIN` on stateful resources (table, buckets, user pool)

**Design Refs**: [nfr-design-patterns.md](../foundation/nfr-design/nfr-design-patterns.md) (Patterns 1–8), [logical-components.md](../foundation/nfr-design/logical-components.md), [nfr-requirements.md](../foundation/nfr-requirements/nfr-requirements.md)

---

## PR-5: Seed Data, Deploy Scripts & Documentation

**Branch**: `feat/foundation-seed-deploy-docs`
**Steps**: Steps 12, 13
**Depends on**: PR-4 (seed script writes to DynamoDB table; deploy script runs `cdk deploy`)
**Assignee**: _TBD_

**Subtasks**:
- [ ] `fixtures/global-transaction-types.json`
- [ ] `fixtures/global-prescreening-questions.json`
- [ ] `fixtures/tenant-stlucie-config.json`
- [ ] `scripts/seed.ts` — idempotent seed using `attribute_not_exists(PK)`
- [ ] `deploy.sh` — build + deploy script
- [ ] `README.md` — project overview, setup, env config, deploy steps
- [ ] `aidlc-docs/construction/foundation/code/code-generation-summary.md`

**Acceptance Criteria**:
- Seed data JSON matches domain-entities.md schemas for global transaction types, pre-screening questions, and tenant config
- Seed script is idempotent (safe to run multiple times)
- `deploy.sh` runs `npm install`, `tsc --build`, `cdk deploy`
- README covers: prerequisites, environment setup, deploy, seed

**Design Refs**: [domain-entities.md](../foundation/functional-design/domain-entities.md) (seed data schemas), [nfr-design-patterns.md](../foundation/nfr-design/nfr-design-patterns.md) (Pattern 8)

---

## PR Coverage Matrix

| Step | Description | PR |
|------|-------------|-----|
| 1 | Project Structure Setup | PR-1 |
| 2 | Shared Types — Entity Types | PR-2 |
| 3 | Shared Types — Unit Tests | PR-2 |
| 4 | Shared Types Summary Doc | PR-2 |
| 5 | Data Access — Core Module | PR-3 |
| 6 | Data Access — CRUD Operations | PR-3 |
| 7 | Data Access — Unit Tests | PR-3 |
| 8 | Data Access Summary Doc | PR-3 |
| 9 | CDK FoundationStack — Infrastructure | PR-4 |
| 10 | CDK FoundationStack — Unit Tests | PR-4 |
| 11 | CDK Summary Doc | PR-4 |
| 12 | Seed Data & Deployment Scripts | PR-5 |
| 13 | Documentation (README + code gen summary) | PR-5 |
