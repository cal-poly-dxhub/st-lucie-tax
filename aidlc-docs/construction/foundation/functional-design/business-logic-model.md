# Business Logic Model — Unit 1: Foundation

## Overview
Unit 1 contains two components with business logic: SI-03 (Data Access Layer) and SI-02 (Auth & Tenant Context). This document defines the algorithms, decision rules, and processing logic for each.

---

## SI-03: Data Access Layer

### Key Construction

All DynamoDB operations go through SI-03. The module constructs tenant-prefixed keys automatically.

**Algorithm — `buildPk(tenantId, entityType, entityId)`**:
1. Validate `tenantId` is non-empty alphanumeric string (max 64 chars)
2. Validate `entityType` is one of the allowed entity types
3. Validate `entityId` is non-empty (max 128 chars)
4. Return `TENANT#${tenantId}#${entityType}#${entityId}`

**Algorithm — `buildGlobalPk(entityType, entityId)`**:
1. Validate `entityType` is one of the allowed global entity types (`TXNTYPE`, `PRESCREENING`)
2. Return `GLOBAL#${entityType}#${entityId}`

**Allowed entity types**: `LOCATION`, `CLERK`, `TXNTYPE`, `APPT`, `CUSTOMER`, `SESSION`, `QUEUE`, `CONFIG`

### Optimistic Concurrency Control

**Algorithm — conditional write with version counter**:
1. Caller provides the item with current `version` value
2. SI-03 increments `version` by 1
3. SI-03 sets `updatedAt` to current ISO 8601 timestamp
4. SI-03 issues `PutItem` / `UpdateItem` with condition: `version = :expectedVersion`
5. If `ConditionalCheckFailedException` → throw `ConcurrencyError` with entity type and ID
6. Caller catches `ConcurrencyError` and either retries (re-read + re-apply) or returns 409 to client

**Retry policy**: SI-03 does NOT auto-retry. The caller decides whether to retry based on the operation semantics. Appointment booking retries with slot recalculation. Config updates return 409 to the admin UI.

### Config Resolution

**Algorithm — `resolveConfig(tenantId, entityType, entityId)`**:
1. Query tenant-scoped item: `PK = TENANT#${tenantId}#${entityType}#${entityId}`, `SK = METADATA`
2. If found → return tenant item
3. If not found → query global item: `PK = GLOBAL#${entityType}#${entityId}`, `SK = METADATA`
4. If found → return global item
5. If not found → throw `ConfigNotFoundError`

**Use cases**:
- Transaction type: tenant override → global template
- Pre-screening questions: tenant override → global questions
- Hot buttons: tenant config only (no global fallback)

### Error Handling Taxonomy

| Error | HTTP Status | Retryable | Description |
|-------|-------------|-----------|-------------|
| `ConcurrencyError` | 409 | Yes (re-read) | Version mismatch on conditional write |
| `ItemNotFoundError` | 404 | No | Entity does not exist |
| `ConfigNotFoundError` | 404 | No | Neither tenant nor global config found |
| `ValidationError` | 400 | No | Invalid key components or attribute values |
| `TenantMismatchError` | 403 | No | Attempted cross-tenant access |
| `DynamoDBError` | 500 | Yes (backoff) | Underlying DynamoDB service error |

All errors include: `errorCode`, `message`, `entityType`, `entityId` (no PII in error payloads).

---

## SI-02: Auth & Tenant Context

### Cognito User Pool Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Password policy | 8+ chars, uppercase + lowercase + number + special | Q5: Standard policy, SECURITY-12 compliant |
| MFA | Optional for clerks, required for admins | SECURITY-12: MFA for admin accounts |
| Account recovery | Email only | Clerks have email on file |
| User pool groups | `clerk`, `admin`, `super-admin` | Q6: super-admin plumbed, no UI |
| Custom attributes | `custom:tenantId` | Set at account creation, immutable |
| Token validity | Access: 1 hour, Refresh: 30 days | Standard for business apps |

### JWT Claims Structure

After Cognito authentication, the JWT contains:

```json
{
  "sub": "<cognito-user-id>",
  "email": "<email>",
  "cognito:groups": ["clerk"],
  "custom:tenantId": "stlucie",
  "iat": 1234567890,
  "exp": 1234571490,
  "iss": "https://cognito-idp.<region>.amazonaws.com/<poolId>",
  "aud": "<appClientId>"
}
```

### Tenant Extraction Logic

**Algorithm — extract tenant context from request**:
1. Check if route is public (chatbot endpoints)
   - If public → read `TENANT_ID` from Lambda environment variable → return `{tenantId, role: 'public', userId: null}`
2. Extract JWT from `Authorization` header (Bearer token)
3. Validate JWT: signature, expiration, issuer, audience
4. Extract `custom:tenantId` from claims → `tenantId`
5. Extract `cognito:groups[0]` → `role` (`clerk`, `admin`, or `super-admin`)
6. Extract `sub` → `userId`
7. If `role === 'super-admin'` AND request body/query contains `tenantId` → use request's `tenantId` (cross-tenant access)
8. Otherwise → use JWT's `tenantId` (enforced tenant isolation)
9. Return `{tenantId, role, userId}`

### Role-Based Access Control Rules

| Role | Scope | Allowed Operations |
|------|-------|--------------------|
| `public` | N/A | Chatbot endpoints only (`/chatbot/*`) |
| `clerk` | Own tenant, assigned office | `/clerk/*` endpoints |
| `admin` | Own tenant, all offices | `/admin/*` + `/clerk/*` endpoints |
| `super-admin` | Any tenant | All endpoints, can override `tenantId` in request |

### Endpoint Classification

| Pattern | Auth Required | Roles |
|---------|--------------|-------|
| `/chatbot/*` | No | public |
| `/clerk/*` | Yes | clerk, admin, super-admin |
| `/admin/*` | Yes | admin, super-admin |
| `/scheduling/*` | No (chatbot) / Yes (clerk) | public, clerk, admin |
| `/notifications/*` | Internal only | N/A (Lambda-to-Lambda) |

---

## Cross-Cutting: Structured Logging

### Log Format

All Lambda functions use structured JSON logging:

```json
{
  "level": "INFO",
  "timestamp": "2026-04-08T10:15:00.123Z",
  "requestId": "<API Gateway request ID>",
  "correlationId": "<X-Correlation-Id header or generated UUID>",
  "tenantId": "stlucie",
  "component": "SI-03",
  "method": "putItem",
  "message": "Item written successfully",
  "entityType": "APPOINTMENT",
  "entityId": "appt-abc123",
  "durationMs": 45
}
```

### Correlation ID Propagation

1. API Gateway passes `X-Correlation-Id` header (or generates one if absent)
2. Lambda extracts it and includes in all log entries
3. When Lambda invokes another Lambda, it passes the correlation ID
4. All log entries for a single user action share the same correlation ID

### PII Exclusion (SECURITY-03)

**Never log**: customer names, DOB, DL numbers, addresses, phone numbers, email addresses, document S3 keys, OCR results, pre-screening answers.

**Safe to log**: entity IDs (UUIDs), tenant IDs, office IDs, clerk IDs, transaction type IDs, event types, status values, timestamps, durations.

---

## Cross-Cutting: Error Response Format

All API endpoints return errors in a consistent format:

```json
{
  "error": {
    "code": "CONCURRENCY_ERROR",
    "message": "The resource was modified by another request. Please retry.",
    "requestId": "<correlationId>"
  }
}
```

**Rules** (SECURITY-09, SECURITY-15):
- Never expose stack traces, internal paths, or DynamoDB details
- Never expose which specific condition failed (e.g., don't say "version mismatch on item X")
- Use generic messages for 500 errors: "An internal error occurred. Please try again."
- Include `requestId` for support correlation
- All error paths return a valid JSON response (global error handler catches unhandled exceptions)

---

## BC-01: Chatbot Service — Pre-Screening & Exception Resolution

### Algorithm — Pre-Screen Merge and Deduplication

Runs once when the session enters the `pre-screen` state.

1. Load all pre-screening questions for each `txnTypeId` in `session.transactionTypes` via `resolveConfig()` (tenant override → global fallback)
2. Build a flat list of all questions across all transaction types, each tagged with its source `txnTypeId`
3. Deduplicate by `questionKey`: for each unique `questionKey`, keep one question entry; record all `txnTypeId`s that share it
4. Sort deduplicated list by `order`
5. Store merged question list in session context for this state's turns
6. Present questions to customer one at a time via Bedrock (conversational tone, current-state prompt)

**Output**: A deduplicated ordered question list. Each entry: `{questionKey, questionText, questionType, options, required, blockingRule, txnTypeIds[]}`.

---

### Algorithm — Exception Resolution Loop

Runs after all pre-screening answers are collected, before advancing to `checkout-check`.

1. For each `txnTypeId` in `session.transactionTypes`:
   a. Check all required questions for that transaction type
   b. For each question where `blockingRule` is present and condition is met (answer is `empty` or `no`):
      - Set `APPT_TXN.status = blocked`, `APPT_TXN.blockedReason = blockingRule.resolutionPrompt`
      - Add to `blockedTransactions` list

2. If `blockedTransactions` is empty → skip to step 6

3. For each blocked transaction (process sequentially):
   a. Load exception resolution system prompt for this `txnTypeId` from DynamoDB
   b. Enter Bedrock resolution conversation with:
      - Exception resolution system prompt
      - Transaction type, blocked reason, resolution options from `blockingRule`
      - Current-state conversation turns
   c. On each Bedrock turn: if Bedrock calls `retrieve_from_knowledge_base(query)`:
      - Execute semantic KB query against Bedrock Knowledge Base
      - Return retrieved chunks to Bedrock as tool result
      - Bedrock incorporates into response
   d. Continue turns until Bedrock returns structured `exceptionResolution` output OR turn limit reached
   e. Apply outcome:
      - `resolved` → `APPT_TXN.status = active`, store `collectedValue` in session answers
      - `dropped` → `APPT_TXN.status = dropped`
      - `parked` → `APPT_TXN.status = blocked`, `blockedReason` updated with external instructions
      - `escalated` (turn limit) → `APPT_TXN.status = blocked`, `blockedReason` preserved for clerk

4. After all blocked transactions processed:
   - Count `active` transactions
   - If zero active → end session (BR-TV-01)
   - Recalculate `session.totalDurationMinutes` from active transactions only (BR-TV-02)

5. Update `session.preWorkStatus`:
   - All active, none blocked → `complete`
   - Some blocked or dropped → `partial`
   - All blocked/dropped (but session continues — edge case) → `none`

6. Advance state machine to `checkout-check`