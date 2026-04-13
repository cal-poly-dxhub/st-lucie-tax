# NFR Requirements Questions — Unit 1: Foundation

Please answer each question by filling in the letter choice after the `[Answer]:` tag.
If none of the options match, choose the last option (Other) and describe your preference.
Let me know when you're done.

---

## DynamoDB Capacity & Performance

### Question 1
DynamoDB billing mode for the single table. MVP is ~50 concurrent users, single county, ~72 clerks.

A) On-demand (`PAY_PER_REQUEST`) — no capacity planning, auto-scales from zero, pay per request. Best for unpredictable/low traffic. Slightly higher per-request cost.
B) Provisioned with auto-scaling — set baseline RCU/WCU with auto-scaling policies. Lower per-request cost at steady traffic, but requires tuning.
C) Provisioned without auto-scaling — fixed RCU/WCU. Cheapest if traffic is very predictable, but risks throttling.
D) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 2
DynamoDB backup strategy for the single table (contains all tenant data, appointments, customer records).

A) Point-in-time recovery (PITR) enabled — continuous backups, restore to any second in the last 35 days. ~$0.20/GB/month.
B) On-demand backups only — manual or scheduled snapshots via Lambda/EventBridge. No continuous recovery.
C) Both PITR + scheduled on-demand backups (belt and suspenders — PITR for accidental deletes, on-demand for long-term archive)
D) No backups for MVP — add later
E) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## S3 Configuration

### Question 3
S3 document upload bucket encryption. This bucket holds DL photos and identity documents (PII).

A) SSE-S3 (AES-256, AWS-managed keys) — simplest, no key management, meets encryption-at-rest requirement
B) SSE-KMS with AWS-managed key (`aws/s3`) — adds CloudTrail key usage logging, no key management overhead
C) SSE-KMS with customer-managed key (CMK) — full control over key rotation, key policy, and access auditing. More operational overhead.
D) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 4
S3 bucket versioning for the document upload bucket.

A) Versioning disabled — documents are write-once (uploaded, processed, then deleted by TTL). No need for version history.
B) Versioning enabled — protects against accidental overwrites/deletes. Adds storage cost for version history.
C) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## Cognito Configuration

### Question 5
Cognito advanced security features (adaptive authentication, compromised credential detection, bot detection).

A) Enable advanced security in full-function mode — adds risk-based adaptive challenges, compromised credential checks, and detailed auth event logging. ~$0.050/MAU after free tier.
B) Enable in audit-only mode — logs risk scores and security events but doesn't block. Good for initial rollout to tune before enforcing.
C) Disabled — rely on standard Cognito security (password policy, account lockout). Add advanced security later.
D) Other (please describe after [Answer]: tag below)

[Answer]: C

---

## Observability & Monitoring

### Question 6
CloudWatch alarm strategy for Foundation resources (DynamoDB throttles, S3 errors, Cognito auth failures).

A) Basic alarms — DynamoDB throttled requests > 0, S3 5xx errors > 0, Cognito failed sign-ins > 10/min. SNS email notification to admin.
B) Comprehensive alarms — all of (A) plus DynamoDB consumed capacity trending, S3 bucket size, Cognito sign-up rate anomaly detection. CloudWatch dashboard included.
C) Minimal — no alarms for MVP. Rely on CloudWatch Logs and manual inspection. Add alarms post-launch.
D) Other (please describe after [Answer]: tag below)

[Answer]: A, but SNS topic starts with zero subscribers. Add email subscriptions pre-launch.

### Question 7
CloudWatch log retention for Foundation Lambda functions and API Gateway.

A) 90 days — meets SECURITY-14 minimum, reasonable cost
B) 1 year (365 days) — longer investigation window, aligns with annual audit cycles
C) 3 years — matches the general correspondence retention policy
D) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## Deployment & Reliability

### Question 8
CDK deployment strategy for the Foundation stack.

A) Direct `cdk deploy` — simple, immediate. Rollback is manual (`cdk deploy` with previous version). Suitable for MVP with single environment.
B) CDK Pipelines (CI/CD) — automated deploy on git push, with approval gates. More setup, but production-grade from day one.
C) Direct `cdk deploy` for MVP, backlog CDK Pipelines for production — get moving fast, add CI/CD before go-live.
D) Other (please describe after [Answer]: tag below)

[Answer]: C

---

## Tech Stack Versions

### Question 9
Node.js runtime version for Lambda functions.

A) Node.js 20.x (LTS, supported through April 2026 — current but approaching EOL)
B) Node.js 22.x (LTS, supported through April 2027 — latest LTS, longest runway)
C) Other (please describe after [Answer]: tag below)

[Answer]: B

### Question 10
Package manager for the monorepo.

A) npm workspaces — built into Node.js, no extra tooling, good enough for 3 units
B) pnpm workspaces — faster installs, strict dependency isolation, disk-efficient. Slightly more setup.
C) Yarn (Berry) workspaces — mature, plug'n'play option, but heavier config
D) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 11
AWS CDK version.

A) CDK v2 (latest stable) — current standard, all constructs in one package (`aws-cdk-lib`)
B) Other (please describe after [Answer]: tag below)

[Answer]: A

---
