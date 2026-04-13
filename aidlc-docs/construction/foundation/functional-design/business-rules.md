# Business Rules — Unit 1: Foundation

## Overview
Business rules, validation constraints, and invariants enforced by the Foundation layer.

---

## Data Access Rules (SI-03)

### BR-DA-01: Tenant Isolation
Every DynamoDB read/write operation MUST include the tenant prefix in the partition key. No query may use a PK that doesn't start with `TENANT#<tenantId>#` or `GLOBAL#` (for global config reads only). Violation is a `TenantMismatchError`.

### BR-DA-02: Version Enforcement
Entities with a `version` attribute (Location, Clerk, Transaction Type, Appointment, Config) MUST use conditional writes. Direct overwrites without version checks are prohibited.

### BR-DA-03: Global Config Read-Only
Global config items (`GLOBAL#` prefix) are read-only at runtime. They are only written by the seed script or future admin tooling. Backend services never write to `GLOBAL#` prefixed items.

### BR-DA-04: Config Resolution Order
When resolving configuration, tenant-scoped config always takes precedence over global config. If a tenant has overridden a transaction type, the global template is never consulted for that transaction type.

### BR-DA-05: Key Validation
All key components must match: `^[a-zA-Z0-9_-]+$`, max 128 characters. Reject any input containing `#` (partition key delimiter) to prevent key injection.

---

## Authentication Rules (SI-02)

### BR-AUTH-01: JWT Validation
Every non-public request MUST have a valid JWT. Validation checks: signature (RS256 against Cognito JWKS), `exp` not past, `iss` matches pool URL, `aud` matches app client ID. Any failure → 401 Unauthorized.

### BR-AUTH-02: Tenant Claim Required
Every authenticated JWT MUST contain `custom:tenantId`. Missing claim → 401 Unauthorized. This is set at Cognito account creation and is immutable.

### BR-AUTH-03: Role Enforcement
Endpoint access is denied if the user's role doesn't match the endpoint's required roles. Clerk cannot access `/admin/*`. Public cannot access `/clerk/*` or `/admin/*`. Violation → 403 Forbidden.

### BR-AUTH-04: Super-Admin Tenant Override
Only `super-admin` role may specify a different `tenantId` in the request. For all other roles, the `tenantId` from the JWT is enforced. Attempting to override without super-admin role → 403 Forbidden.

### BR-AUTH-05: Public Endpoint Tenant Resolution
Public endpoints (chatbot) use the `TENANT_ID` environment variable as the tenant context. This is the MVP single-tenant mechanism. When multi-tenant onboarding is built, this will be replaced by domain-based or path-based tenant resolution.

### BR-AUTH-06: Session Management
Cognito handles session management. Access tokens expire after 1 hour. Refresh tokens expire after 30 days. Logout invalidates the refresh token. `Secure`, `HttpOnly`, and `SameSite=Strict` cookie attributes are enforced on the frontend (SECURITY-12).

### BR-AUTH-07: Brute-Force Protection
Cognito's built-in advanced security features handle brute-force protection: account lockout after repeated failed attempts, adaptive authentication challenges. No custom implementation needed.

---

## Data Lifecycle Rules

### BR-DL-01: Document TTL
Document upload records (DynamoDB) have a 30-day TTL from upload date. When DynamoDB TTL deletes the record, a DynamoDB Streams trigger (or scheduled Lambda) deletes the corresponding S3 object.

### BR-DL-02: S3 Document Cleanup
S3 objects (DL photos, uploaded documents) MUST be deleted when their DynamoDB document record expires. The S3 bucket lifecycle policy serves as a backstop (delete objects older than 35 days) in case the primary cleanup misses an object.

### BR-DL-03: Customer Data Retention
Customer records (name, phone, email, DOB, DL number, address) are retained for 3 years per FL GS1-SL Item #17. No TTL on customer entities. No PII stripping at 30 days — only document files are deleted.

### BR-DL-04: Session/Appointment Retention
Session records (chat transcripts, conversation history) and appointment records are retained for 3 years per FL GS1-SL. No TTL. Revisit archival strategy post-MVP when data volume is understood.

---

## Input Validation Rules (SECURITY-05)

### BR-VAL-01: String Length Limits
| Field | Max Length |
|-------|-----------|
| name (any) | 256 chars |
| email | 320 chars |
| phone | 20 chars |
| address | 512 chars |
| dlNumber | 20 chars |
| note text | 2000 chars |
| config value (string) | 4000 chars |
| question text | 1000 chars |
| session ID / entity ID | 128 chars |
| tenant ID | 64 chars |

### BR-VAL-02: Format Validation
| Field | Format |
|-------|--------|
| email | RFC 5322 basic pattern |
| phone | E.164 format (`+1XXXXXXXXXX`) |
| date | ISO 8601 date (`YYYY-MM-DD`) |
| time | 24-hour format (`HH:MM`) |
| entity IDs | UUID v4 format |
| tenant ID | `^[a-z0-9-]+$` |

### BR-VAL-03: Enum Validation
| Field | Allowed Values |
|-------|---------------|
| appointment status | `booked`, `checked-in`, `in-progress`, `completed`, `cancelled`, `no-show` |
| queue type | `regular`, `priority`, `assigned` |
| queue entry status | `waiting`, `summoned`, `serving`, `completed` |
| clerk status | `active`, `inactive`, `training` |
| txn type status | `active`, `inactive`, `hidden` |
| pre-work status | `complete`, `partial`, `none` |
| document validation status | `pending`, `valid`, `invalid`, `skipped` |
| session state | `landing`, `identify-transaction`, `verify-identity`, `upload-docs`, `pre-screen`, `checkout-check`, `schedule`, `confirm`, `complete` |
| channel | `web`, `sms`, `kiosk` |

### BR-VAL-04: Numeric Bounds
| Field | Min | Max |
|-------|-----|-----|
| capacityRunRate | 0 | 200 |
| stationCount | 1 | 100 |
| averageDurationMinutes | 1 | 480 |
| totalDurationMinutes | 1 | 480 |
| question order | 1 | 999 |

### BR-VAL-05: Sanitization
All user-supplied string inputs are sanitized: HTML tags stripped, control characters removed. No raw user input is concatenated into DynamoDB expressions — all values go through expression attribute values (parameterized).

---

## Security Rules (Cross-Cutting)

### BR-SEC-01: No PII in Logs
Log entries MUST NOT contain: customer names, DOB, DL numbers, addresses, phone numbers, email addresses, document content, OCR results, pre-screening answers. Entity IDs (UUIDs) are safe to log.

### BR-SEC-02: Fail Closed
On any authentication or authorization error, the system denies access. On any unhandled exception, the global error handler returns 500 with a generic message. No error path bypasses auth checks.

### BR-SEC-03: Generic Error Messages
Production error responses contain only: error code, generic message, request ID. No stack traces, no internal paths, no DynamoDB table names, no entity details.

### BR-SEC-04: Resource Cleanup
All DynamoDB client connections use the AWS SDK's built-in connection pooling. Lambda execution context reuse handles connection lifecycle. No manual connection management needed. Error paths do not leak connections.

### BR-SEC-05: Correlation ID
Every request gets a correlation ID (from `X-Correlation-Id` header or auto-generated). This ID appears in all log entries and error responses for the request lifecycle. It does NOT contain PII.

---

## Pre-Screening Rules

### BR-PS-01: Question Deduplication
When a session has multiple transaction types, pre-screening questions MUST be merged and deduplicated by `questionKey` before being presented to the customer. A question with a given `questionKey` is asked exactly once regardless of how many transaction types require it. The collected answer is applied to all transaction types sharing that `questionKey`.

### BR-PS-02: Pre-Screening Progress Keyed by questionKey
`Session.preScreeningProgress` tracks answers by `questionKey`, not by `txnTypeId + sequence`. Per-transaction completion is derived by checking whether all required `questionKey`s for that transaction type have been answered.

### BR-PS-03: Blocking Rule Evaluation
After answers are collected, each answer is evaluated against its question's `blockingRule` (if present). A blocking rule fires when the answer matches the `condition` (`empty` or `no`). A fired blocking rule marks the associated `APPT_TXN.status = blocked` and initiates exception resolution for that transaction.

---

## Exception Resolution Rules

### BR-EX-01: Resolution Attempt Order
For each blocked transaction, exception resolution MUST attempt resolution in this order:
1. `collect` — ask the customer for the missing value inline
2. `external` — provide county-specific instructions (sourced from KB query) and offer to park the session
3. `drop` — offer to remove the transaction from the appointment

Resolution stops at the first successful outcome.

### BR-EX-02: Bedrock Exception Resolution
Exception resolution conversations are handled by Bedrock using a transaction-type-specific exception resolution system prompt loaded from DynamoDB. Bedrock MAY query the Bedrock Knowledge Base (semantic search, no metadata filter) to retrieve county-specific guidance (e.g., how to obtain a lien release letter, where to find a trailer number). The KB result is incorporated into Bedrock's response to the customer.

### BR-EX-03: Resolution Turn Limit
If exception resolution has not reached an outcome (resolved / dropped / parked) within the configured turn limit (default: 5 turns, stored in tenant config), Bedrock MUST offer the customer the option to book the appointment anyway and resolve the issue with a clerk in office. If the customer accepts, `APPT_TXN.status` remains `blocked` and `blockedReason` is persisted for clerk visibility at check-in.

### BR-EX-04: Resolution Outcomes
| Outcome | APPT_TXN.status | Effect |
|---------|----------------|--------|
| `resolved` | `active` | Collected value stored; transaction proceeds normally |
| `dropped` | `dropped` | Transaction removed from appointment; duration recalculated |
| `parked` | `blocked` | Session remains open; customer given external process instructions |
| `escalated` (turn limit hit) | `blocked` | `blockedReason` stored; clerk handles in office |

### BR-EX-05: Bedrock Structured Output for Exception Resolution
Bedrock MUST return a structured outcome for each exception resolution conversation:
```json
{
  "exceptionResolution": {
    "transactionTypeId": "<txnTypeId>",
    "outcome": "resolved | dropped | parked | escalated",
    "collectedValue": "<value if outcome=resolved>",
    "customerConfirmed": true
  }
}
```
The state machine does not advance until a valid structured outcome is received.

---

## Transaction Viability Rules

### BR-TV-01: Zero Active Transactions
If all transactions in a session reach `dropped` or `blocked` status after exception resolution, the session MUST NOT proceed to scheduling. The chatbot informs the customer that no transactions can be booked at this time and ends the session with appropriate guidance.

### BR-TV-02: Appointment Duration Uses Active Transactions Only
`Appointment.totalDurationMinutes` is calculated as the sum of `durationMinutes` for `APPT_TXN` records with `status = active` only. Dropped and blocked transactions do not contribute to duration.

### BR-TV-03: Location Filtering Uses Active Transactions Only
When filtering locations for scheduling, only `active` transactions are considered. A location must offer all active transaction types to be eligible.

### BR-TV-04: Clerk Skill Matching Uses Active Transactions Only
`summon_next()` matches clerk skills against `active` transaction types only. Blocked and dropped transactions are excluded from skill matching.

### BR-TV-05: Clerk Visibility of Blocked Transactions
At check-in, the clerk dashboard MUST display all `APPT_TXN` records regardless of status. `blocked` transactions show `blockedReason`. `dropped` transactions are shown as greyed out. This gives the clerk full context to resolve any remaining issues in office.