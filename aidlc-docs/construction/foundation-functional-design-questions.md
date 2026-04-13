# Functional Design Questions — Unit 1: Foundation

Please answer each question by filling in the letter choice after the `[Answer]:` tag.
If none of the options match, choose the last option (Other) and describe your preference.
Let me know when you're done.

---

## Domain Model & Data Access

### Question 1
For the DynamoDB single-table design, how should entity versioning work for optimistic concurrency control?

A) Simple version counter (`version` attribute, increment on each write, condition check `version = :expected`)
B) Timestamp-based (`updatedAt` attribute, condition check `updatedAt = :expected`) — simpler but risk of clock skew
C) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 2
For the global config seed data (transaction type templates, pre-screening question templates), how should initial data be loaded?

A) CDK custom resource Lambda that runs on first deploy — seeds DynamoDB with JSON fixture files from the repo
B) Separate CLI script (`npm run seed`) that developers/admins run manually after deploy
C) Both — CDK custom resource for automated deploys, CLI script for local dev/testing
D) Other (please describe after [Answer]: tag below)

[Answer]: B, backlog the custom resource lambda for now.

### Question 3
The DynamoDB key structure shows `TENANT#stlucie` as the tenant prefix. For the MVP (single tenant), should the tenant ID be:

A) Hardcoded as `stlucie` in a config file — simplest for MVP, change later when multi-tenant onboarding is built
B) Configurable via environment variable per deployment — allows testing with different tenant IDs
C) Stored in a tenant registry table/item and looked up at startup — full multi-tenant ready from day one
D) Other (please describe after [Answer]: tag below)

[Answer]: B

### Question 4
~~For the WebSocket connection registry, how should stale connections (client disconnected without sending `$disconnect`) be handled?~~

> **SUPERSEDED (2026-04-08)**: This question is no longer applicable. The WebSocket → Polling decision eliminates the connection registry entirely. See application-design-plan.md Q3 revised decision.

[Answer]: C (original answer retained for audit trail; no longer applicable)

---

## Authentication & Authorization

### Question 5
For the Cognito password policy, which level should be enforced?

A) Standard — 8+ chars, requires uppercase + lowercase + number + special character
B) Relaxed — 8+ chars, requires uppercase + lowercase + number (no special char requirement) — easier for government employees
C) Strong — 12+ chars, requires uppercase + lowercase + number + special character
D) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 6
For the super-admin role (manages all counties), how should it be implemented in the MVP?

A) Cognito group `super-admin` with a custom claim — full implementation, but no UI for it in MVP (API-only access)
B) Skip super-admin entirely for MVP — only `admin` and `clerk` roles. Add super-admin when multi-tenant onboarding is built.
C) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 7
~~For WebSocket authentication, the Display App (FC-03) and Chatbot App (FC-01) are public (no Cognito auth). How should their WebSocket connections be authorized?~~

> **SUPERSEDED (2026-04-08)**: This question is no longer applicable. The WebSocket → Polling decision eliminates WebSocket connections entirely. Polling endpoints use the same auth model as other REST endpoints (public for chatbot/display, JWT for clerk). See application-design-plan.md Q3 revised decision.

[Answer]: B (original answer retained for audit trail; no longer applicable)

---

## Real-Time Service

### Question 8
~~For WebSocket event payloads, should the payload structure include the full entity data or just a change notification?~~

> **SUPERSEDED (2026-04-08)**: This question is no longer applicable. Polling endpoints return full current state on each request (equivalent to option A). See application-design-plan.md Q3 revised decision.

[Answer]: A (original answer retained for audit trail; polling endpoints adopt the same full-state approach)

### Question 9
~~Should the WebSocket API support client-to-server messages (beyond `$connect`/`$disconnect`), or is it strictly server-push?~~

> **SUPERSEDED (2026-04-08)**: This question is no longer applicable. No WebSocket API exists. All client-to-server communication uses REST. See application-design-plan.md Q3 revised decision.

[Answer]: A (original answer retained for audit trail; no longer applicable)

---

## Data Lifecycle & Retention

### Question 10
For the 30-day PII TTL (customer records, sessions, documents), should there be a grace period or hard delete?

A) Hard delete — DynamoDB TTL removes items automatically after 30 days, no recovery
B) Soft delete with archive — before TTL expiration, a scheduled Lambda copies PII-stripped records to an archive table for the 3-year retention requirement, then lets TTL delete the originals
C) Soft delete flag — mark as `deleted`, strip PII fields, keep the skeleton record for 3 years. No separate archive table.
D) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 11
For the 3-year general correspondence retention (chat transcripts, appointment history), where should this data live?

A) Same DynamoDB table — no TTL on these items, rely on DynamoDB's unlimited retention
B) DynamoDB for active data (90 days), then archive to S3 (Glacier) via scheduled Lambda for long-term retention
C) Same DynamoDB table with no TTL — revisit archival strategy post-MVP when data volume is better understood
D) Other (please describe after [Answer]: tag below)

[Answer]: C

---

## Dev Tooling & Configuration

### Question 12
For environment configuration, how should secrets (Twilio API key, Bedrock model IDs, etc.) be managed?

A) AWS SSM Parameter Store (SecureString for secrets, String for non-sensitive config) — all config in one place
B) AWS Secrets Manager for secrets (Twilio keys), SSM Parameter Store for non-sensitive config — separation of concerns, but two services to manage
C) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 13
For the `cdk-nag` integration, which rule packs should be enforced?

A) AWS Solutions only — covers common best practices, fewer false positives
B) AWS Solutions + HIPAA Security — since the platform handles DL data and government PII
C) AWS Solutions + NIST 800-53 — broader federal compliance alignment
D) All available packs (AWS Solutions + HIPAA + NIST + PCI DSS) — maximum coverage, may require more suppressions
E) Other (please describe after [Answer]: tag below)

[Answer]: B

---
