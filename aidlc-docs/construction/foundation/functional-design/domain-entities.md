# Domain Entities — Unit 1: Foundation

## Overview
All entities live in a single DynamoDB table with tenant-prefixed partition keys. This document defines the complete attribute schema for each entity, including types, constraints, and access patterns.

---

## Entity Schemas

### Location
Represents an office/service center within a tenant.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#LOCATION#<locationId>` |
| SK | `S` | Yes | `METADATA` |
| entityType | `S` | Yes | `LOCATION` |
| locationId | `S` | Yes | UUID |
| name | `S` | Yes | Office name |
| address | `S` | Yes | Street address |
| city | `S` | Yes | City |
| state | `S` | Yes | State code (2 chars) |
| zip | `S` | Yes | ZIP code |
| hoursOfOperation | `M` | Yes | Map of day → `{open, close}` (e.g., `{"MON": {"open": "08:00", "close": "17:00"}}`) |
| lunchShift | `M` | No | `{start, end}` — affects scheduling capacity |
| stationCount | `N` | Yes | Number of service stations |
| capacityRunRate | `N` | Yes | Percentage (0-100) — single value per office |
| active | `BOOL` | Yes | Active/inactive flag |
| version | `N` | Yes | Optimistic concurrency counter |
| createdAt | `S` | Yes | ISO 8601 timestamp |
| updatedAt | `S` | Yes | ISO 8601 timestamp |

### Clerk
Represents a service clerk employee.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#CLERK#<clerkId>` |
| SK | `S` | Yes | `METADATA` |
| entityType | `S` | Yes | `CLERK` |
| clerkId | `S` | Yes | UUID |
| cognitoSub | `S` | Yes | Cognito user pool sub (links to auth) |
| name | `S` | Yes | Full name |
| email | `S` | Yes | Email address |
| defaultLocationId | `S` | Yes | Default office assignment |
| status | `S` | Yes | `active` / `inactive` / `training` |
| version | `N` | Yes | Optimistic concurrency counter |
| createdAt | `S` | Yes | ISO 8601 |
| updatedAt | `S` | Yes | ISO 8601 |

### Clerk Skill Mapping
Links a clerk to a transaction type they can service.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#CLERK#<clerkId>` |
| SK | `S` | Yes | `SKILL#<transactionTypeId>` |
| entityType | `S` | Yes | `CLERK_SKILL` |
| transactionTypeId | `S` | Yes | Reference to transaction type |
| assignedAt | `S` | Yes | ISO 8601 |

### Clerk at Location
Denormalized record for querying clerks at a specific location.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#LOCATION#<locationId>` |
| SK | `S` | Yes | `CLERK#<clerkId>` |
| entityType | `S` | Yes | `LOCATION_CLERK` |
| clerkId | `S` | Yes | Reference |
| name | `S` | Yes | Denormalized for display |
| status | `S` | Yes | Denormalized |

### Transaction Type (Tenant Override)
Tenant-specific configuration for a transaction type.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#TXNTYPE#<txnTypeId>` |
| SK | `S` | Yes | `METADATA` |
| entityType | `S` | Yes | `TXN_TYPE` |
| txnTypeId | `S` | Yes | Identifier (e.g., `dl-renewal`) |
| name | `S` | Yes | Display name |
| description | `S` | No | Description / JSON metadata |
| averageDurationMinutes | `N` | Yes | Configured average duration |
| serviceHours | `M` | No | `{start, end}` — window within office hours (e.g., road tests stop 30 min before close) |
| locationAvailability | `L` | No | List of locationIds where offered; empty = all |
| status | `S` | Yes | `active` / `inactive` / `hidden` |
| version | `N` | Yes | Optimistic concurrency counter |
| createdAt | `S` | Yes | ISO 8601 |
| updatedAt | `S` | Yes | ISO 8601 |

### Transaction Type (Global Template)
System-wide default template for a transaction type.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `GLOBAL#TXNTYPE#<txnTypeId>` |
| SK | `S` | Yes | `METADATA` |
| entityType | `S` | Yes | `GLOBAL_TXN_TYPE` |
| txnTypeId | `S` | Yes | Identifier |
| name | `S` | Yes | Display name |
| description | `S` | No | Description |
| averageDurationMinutes | `N` | Yes | Default duration |
| serviceHours | `M` | No | Default service hours window |
| status | `S` | Yes | `active` / `inactive` |
| createdAt | `S` | Yes | ISO 8601 |
| updatedAt | `S` | Yes | ISO 8601 |

### Pre-Screening Question (Global)
Global pre-screening question template for a transaction type.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `GLOBAL#PRESCREENING#<txnTypeId>` |
| SK | `S` | Yes | `Q#<sequenceNumber>` (zero-padded 3 digits) |
| entityType | `S` | Yes | `PRESCREENING_Q` |
| questionText | `S` | Yes | The question |
| questionType | `S` | Yes | `yes_no` / `text` / `multiple_choice` |
| options | `L` | No | For multiple_choice only |
| required | `BOOL` | Yes | Whether answer is required |
| order | `N` | Yes | Display order |
| questionKey | `S` | Yes | Canonical identifier for deduplication across transaction types (e.g., `proof-of-insurance`, `trailer-number`, `dl-photo`). Questions sharing the same `questionKey` across transaction types are asked once; the answer is applied to all. |
| blockingRule | `M` | No | If present, a missing or invalid answer blocks the transaction. Structure: `{condition: "empty"\|"no", resolutionType: "collect"\|"external"\|"drop", resolutionPrompt: "<text shown to customer>", externalProcessDescription: "<instructions if resolutionType=external>"}` |

**blockingRule.resolutionType values**:
- `collect` — chatbot asks the customer for the value inline; if provided, exception is resolved
- `external` — customer must complete an out-of-band process (e.g., obtain lien release letter); chatbot provides instructions from `externalProcessDescription` and offers to park the session or drop the transaction
- `drop` — transaction cannot proceed without this; chatbot offers to remove it from the appointment

### Appointment
A booked appointment for a customer.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#APPT#<appointmentId>` |
| SK | `S` | Yes | `METADATA` |
| entityType | `S` | Yes | `APPOINTMENT` |
| appointmentId | `S` | Yes | UUID |
| customerId | `S` | Yes | Reference to customer |
| sessionId | `S` | Yes | Reference to chatbot session |
| locationId | `S` | Yes | Office location |
| scheduledDate | `S` | Yes | ISO 8601 date |
| scheduledTime | `S` | Yes | HH:MM (24h) |
| totalDurationMinutes | `N` | Yes | Sum of all transaction durations |
| status | `S` | Yes | `booked` / `checked-in` / `in-progress` / `completed` / `cancelled` / `no-show` |
| preWorkStatus | `S` | Yes | `complete` / `partial` / `none` — indicates pre-screening/doc completeness |
| qrCode | `S` | No | QR code data string |
| actualDurationMinutes | `N` | No | Recorded after completion |
| completedAt | `S` | No | ISO 8601 |
| completedByClerkId | `S` | No | Clerk who completed |
| version | `N` | Yes | Optimistic concurrency counter |
| createdAt | `S` | Yes | ISO 8601 |
| updatedAt | `S` | Yes | ISO 8601 |
| GSI1PK | `S` | Yes | `TENANT#<tenantId>#LOCATION#<locationId>#DATE#<YYYY-MM-DD>` |
| GSI1SK | `S` | Yes | `APPT#<appointmentId>` |

### Appointment Transaction
A transaction type within an appointment (supports multi-transaction).

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#APPT#<appointmentId>` |
| SK | `S` | Yes | `TXN#<txnTypeId>` |
| entityType | `S` | Yes | `APPT_TXN` |
| txnTypeId | `S` | Yes | Transaction type identifier |
| durationMinutes | `N` | Yes | Duration for this transaction |
| actualDurationMinutes | `N` | No | Actual after completion |
| status | `S` | Yes | `active` / `blocked` / `dropped` — per-transaction viability status |
| blockedReason | `S` | No | Human-readable reason why this transaction is blocked; shown to clerk at check-in |

**Status values**:
- `active` — transaction is proceeding normally
- `blocked` — exception resolution exhausted without resolution; clerk handles in office
- `dropped` — customer chose to remove this transaction from the appointment

### Customer
A customer record created during chatbot interaction or walk-in.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#CUSTOMER#<customerId>` |
| SK | `S` | Yes | `METADATA` |
| entityType | `S` | Yes | `CUSTOMER` |
| customerId | `S` | Yes | UUID |
| name | `S` | No | Full name (from DL OCR or manual entry) |
| dob | `S` | No | Date of birth |
| dlNumber | `S` | No | Driver license number |
| address | `S` | No | Address |
| phone | `S` | No | Phone number |
| email | `S` | No | Email address |
| identityVerified | `BOOL` | Yes | Whether DL OCR completed |
| createdAt | `S` | Yes | ISO 8601 |
| updatedAt | `S` | Yes | ISO 8601 |

**Retention**: Customer identity fields (name, dob, dlNumber, address, phone, email) retained for 3 years per FL GS1-SL Item #17. No TTL on this entity.

### Customer Note
Free-text note attached to a customer by a clerk.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#CUSTOMER#<customerId>` |
| SK | `S` | Yes | `NOTE#<ISO8601Timestamp>` |
| entityType | `S` | Yes | `CUSTOMER_NOTE` |
| clerkId | `S` | Yes | Who wrote the note |
| text | `S` | Yes | Note content |
| createdAt | `S` | Yes | ISO 8601 |

### Queue Entry
A customer's position in the service queue at a location.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#QUEUE#<locationId>` |
| SK | `S` | Yes | `POS#<ISO8601Timestamp>#<customerId>` |
| entityType | `S` | Yes | `QUEUE_ENTRY` |
| customerId | `S` | Yes | Reference |
| appointmentId | `S` | No | Null for walk-ins without appointment |
| queueType | `S` | Yes | `regular` / `priority` / `assigned` |
| assignedClerkId | `S` | No | Only for `assigned` queue type |
| preWorkStatus | `S` | Yes | `complete` / `partial` / `none` |
| enteredAt | `S` | Yes | ISO 8601 |
| summonedAt | `S` | No | ISO 8601 when summoned |
| status | `S` | Yes | `waiting` / `summoned` / `serving` / `completed` |

**Design note**: SK uses `POS#<timestamp>#<customerId>` for natural FIFO sort. No renumbering needed when customers leave mid-wait.

### Session (Chatbot)
Conversation session state for the chatbot.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#SESSION#<sessionId>` |
| SK | `S` | Yes | `METADATA` |
| entityType | `S` | Yes | `SESSION` |
| sessionId | `S` | Yes | UUID |
| channel | `S` | Yes | `web` / `sms` / `kiosk` |
| currentState | `S` | Yes | State machine state (e.g., `landing`, `identify-transaction`, `verify-identity`, `upload-docs`, `pre-screen`, `checkout-check`, `schedule`, `confirm`, `complete`) |
| transactionTypes | `L` | No | List of identified transaction type IDs |
| identityData | `M` | No | OCR-extracted fields (name, dob, dlNumber, address) |
| preScreeningProgress | `M` | No | Map of txnTypeId → `{total, answered, complete}` |
| preWorkStatus | `S` | Yes | `complete` / `partial` / `none` |
| customerId | `S` | No | Linked after identity verification |
| appointmentId | `S` | No | Linked after booking |
| locationId | `S` | No | For kiosk/walk-in sessions |
| isWalkIn | `BOOL` | Yes | Whether session originated from kiosk/walk-in |
| contextSummary | `M` | No | Structured summary sent to Bedrock (identity, transactions, docs, pre-screening progress) |
| currentStateTurns | `L` | No | Conversation turns for current state only |
| rawHistory | `L` | Yes | Full raw conversation history (for 3-year retention) |
| createdAt | `S` | Yes | ISO 8601 |
| updatedAt | `S` | Yes | ISO 8601 |

**Retention**: Session records retained for 3 years (general correspondence under FL GS1-SL). No TTL.

### Document Upload Record
Tracks a document uploaded during a session.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#SESSION#<sessionId>` |
| SK | `S` | Yes | `DOC#<documentType>` |
| entityType | `S` | Yes | `DOCUMENT` |
| documentType | `S` | Yes | `dl-photo` / `proof-of-address` / `lien-letter` / etc. |
| s3Key | `S` | Yes | S3 object key |
| s3Bucket | `S` | Yes | Bucket name |
| uploadedAt | `S` | Yes | ISO 8601 |
| ocrResult | `M` | No | Extracted fields from Bedrock multimodal |
| validationStatus | `S` | Yes | `pending` / `valid` / `invalid` / `skipped` |
| validationMessage | `S` | No | Reason for invalid |
| ttl | `N` | Yes | Unix epoch — 30 days after `uploadedAt` |

**Retention**: TTL at 30 days deletes the DynamoDB record. A separate cleanup process deletes the S3 object at the same time. Only the document metadata record is TTL'd — the parent session record stays for 3 years.

### Tenant Config
Tenant-scoped configuration values.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| PK | `S` | Yes | `TENANT#<tenantId>#CONFIG` |
| SK | `S` | Yes | Config key (e.g., `HOT_BUTTONS`, `CHECKOUT_URL`, `DURATION_MONITORING`, `TWILIO`) |
| entityType | `S` | Yes | `CONFIG` |
| value | `S` or `M` | Yes | Config value (string or map depending on key) |
| version | `N` | Yes | Optimistic concurrency counter |
| updatedAt | `S` | Yes | ISO 8601 |
| updatedBy | `S` | Yes | Clerk/admin ID who last updated |

**Config keys**:
- `HOT_BUTTONS` — `value: {buttons: [{label, prompt}]}` — chatbot landing page prompts
- `CHECKOUT_URL` — `value: "https://..."` — online checkout redirect URL
- `DURATION_MONITORING` — `value: {rollingWindowDays: 30, trimPct: 10, driftThresholdPct: 20, minSampleSize: 30}`
- `TWILIO` — `value: {accountSid: "ssm:/stlucie/twilio-account-sid", authToken: "ssm:/stlucie/twilio-auth-token", phoneNumber: "+1..."}` — references to SSM SecureString params

---

## Global Secondary Indexes

### GSI1 — Appointments by Location + Date
| Attribute | Key | Purpose |
|-----------|-----|---------|
| GSI1PK | `TENANT#<tenantId>#LOCATION#<locationId>#DATE#<YYYY-MM-DD>` | Partition by location+date |
| GSI1SK | `APPT#<appointmentId>` | Sort by appointment |

**Projected attributes**: All (full projection for scheduling queries).

**Access patterns**: Get all appointments for a location on a given date (scheduling engine slot calculation).

---

## TTL Policies

| Entity | TTL Field | Expiration | Rationale |
|--------|-----------|------------|-----------|
| Document Upload Record | `ttl` | 30 days after upload | DL photos and identity documents — PII minimization. S3 objects deleted by same cleanup process. |

**No TTL on**: Customer, Session, Appointment, Queue Entry, Location, Clerk, Transaction Type, Config, Notes. These follow the 3-year general correspondence retention under FL GS1-SL.

---

## Seed Data Structure

Seed data lives in `fixtures/` directory as JSON files, loaded by `npm run seed`.

```
fixtures/
  global-transaction-types.json    # GLOBAL#TXNTYPE# records
  global-prescreening-questions.json  # GLOBAL#PRESCREENING# records
  tenant-stlucie-config.json       # TENANT#stlucie#CONFIG records
  tenant-stlucie-locations.json    # TENANT#stlucie#LOCATION# records (optional dev data)
```

Seed script behavior:
- Uses `putItem` with `attribute_not_exists(PK)` condition — never overwrites existing data
- Idempotent — safe to run multiple times
- Reads `TENANT_ID` from environment variable
