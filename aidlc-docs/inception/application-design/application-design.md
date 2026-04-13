# Application Design — Consolidated

## Project
St. Lucie County Tax Collector — Conversational AI & Office Management Platform

## Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend structure | 3 separate React SPAs (Chatbot, Staff, Display) + shared library | Isolate public/auth concerns, minimize bundle sizes, independent deployment |
| Backend API | Single API Gateway, domain-grouped Lambdas | Clean logical separation without infrastructure sprawl at MVP scale |
| Real-time | Polling (REST endpoints, 2-5s intervals) | No sub-second push needed; eliminates WebSocket API Gateway, connection management, and reconnect logic |
| Chatbot state | Custom state machine in DynamoDB + Bedrock Converse API for NLP | Deterministic flow control for government app, LLM handles conversational tone |
| Scheduling | On-demand slot calculation | No stale data, lightweight at MVP scale, matches "no static time blocks" requirement |
| Multi-tenancy | Tenant ID as DynamoDB partition key prefix | Structural isolation — impossible to accidentally query across tenants |
| Document upload | Presigned S3 URLs + S3 event trigger for Bedrock OCR/validation | Avoids API Gateway 10MB limit, decouples upload from processing |
| IaC | AWS CDK (TypeScript) | CDK is TypeScript-first; best docs, fastest access to new constructs, matches backend language |
| AI knowledge approach | Prompt-switching for transactional flows + Bedrock Knowledge Bases for general Q&A | Transactional flows use structured DB-driven prompts (deterministic, auditable). General website Q&A uses Bedrock Knowledge Bases as a RAG fallback when no transaction type matches — ingests tcslc.com content. See FR-CHAT-15. |
| Conversation memory | Structured context + current-state turns only | Turns reset at each state transition. Bedrock receives system prompt + structured session summary + current-state turns. Keeps token usage bounded, prevents LLM confusion across state changes. Full raw history persisted for records retention. |
| Exception resolution | Bedrock-driven conversational resolution loop within pre-screen state, with KB fallback | When a pre-screening blocking rule fires, Bedrock handles the resolution conversation using a transaction-type-specific exception resolution prompt. Bedrock may query the Knowledge Base (semantic search) for county-specific guidance. Outcomes are structured (resolved / dropped / parked / escalated). If turn limit exhausted, transaction is flagged blocked and escalated to clerk at check-in. This keeps the state machine linear while handling edge cases intelligently. |
| Pre-screening deduplication | Merge questions by `questionKey` across all transaction types before presenting | Multi-transaction appointments deduplicate shared questions (e.g., proof of insurance required by two transaction types) so the customer is asked once. Answer is applied to all transaction types sharing the key. Per-transaction completion is derived from shared answers. |

---

## Component Summary

### Frontend (3 apps)
| ID | Component | Auth | Deployment |
|----|-----------|------|------------|
| FC-01 | Chatbot App | None (session-based) | S3 + CloudFront |
| FC-02 | Staff App (Clerk + Admin) | Cognito JWT, role-based routing | S3 + CloudFront |
| FC-03 | Display App | None | S3 + CloudFront |

### Backend (6 domains)
| ID | Component | API Prefix | Key Responsibility |
|----|-----------|------------|-------------------|
| BC-01 | Chatbot Service | `/chatbot/*` | Conversation state machine + Bedrock NLP |
| BC-02 | Identity & Document Service | S3 event trigger | DL OCR + document validation via Bedrock multimodal |
| BC-03 | Admin Service | `/admin/*` | Location/clerk/transaction CRUD, duration monitoring, config |
| BC-04 | Clerk Service | `/clerk/*` | Check-in, queue management, summon, complete, notes |
| BC-05 | Scheduling Service | `/scheduling/*` | On-demand slot calculation, appointment booking, walk-in queue |
| BC-06 | Notification Service | `/notifications/*` | Twilio SMS + Amazon SES email (POC); swappable to SendGrid |

### Shared Infrastructure (2 layers)
| ID | Component | Type | Key Responsibility |
|----|-----------|------|-------------------|
| SI-02 | Auth & Tenant Context | Cognito + API GW Authorizer | JWT validation, tenant extraction, RBAC |
| SI-03 | Data Access Layer | TypeScript shared module | Tenant-prefixed DynamoDB access, config resolution |

---

## Service Orchestrations

| Service | Owner | Purpose | Components |
|---------|-------|---------|------------|
| SVC-01 Conversation Orchestration | BC-01 | End-to-end chatbot flow: landing → identity → docs → pre-screen → checkout → schedule → confirm | BC-01, BC-02, BC-05, BC-06 |
| SVC-02 Check-In & Queue Placement | BC-04 | Customer arrival through check-in to queue entry | BC-04, BC-05, BC-06 |
| SVC-03 Summon & Transaction Processing | BC-04 | Summon customer, process transaction, complete | BC-04, BC-06 |
| SVC-04 Scheduling & Availability | BC-05 | Real-time slot calculation and appointment booking | BC-05, BC-06 |
| SVC-05 Duration Monitoring | BC-03 | Scheduled analysis of actual vs. configured durations | BC-03 |
| SVC-06 Notification Dispatch | BC-06 | Centralized SMS/email via Twilio/SES (POC) | BC-06 |
| SVC-07 State Polling | BC-04 | Polling endpoints for queue, summon, and display state | BC-04, BC-01 |

---

## AWS Services Mapping

| AWS Service | Used By | Purpose |
|-------------|---------|---------|
| API Gateway (REST) | All BC-* | Single REST API with domain routing (includes polling endpoints for state updates) |
| Lambda | All BC-* | Compute for all backend logic |
| DynamoDB | SI-03 | Single-table design, tenant-prefixed, all data |
| S3 | FC-01/02/03, BC-02 | Frontend hosting + document storage |
| CloudFront | FC-01/02/03 | CDN for frontend apps |
| Cognito | SI-02 | User authentication for clerks and admins |
| Bedrock | BC-01, BC-02 | Converse API (NLP) + multimodal (OCR/doc validation) |
| Bedrock Knowledge Bases | BC-01 | RAG for general Q&A — tcslc.com content indexed, queried as fallback when no transaction type matches |
| EventBridge | BC-03 | Scheduled trigger for duration monitoring |
| CloudWatch | All | Logging, metrics, alarms |
| Twilio (external) | BC-06 | SMS delivery |
| Amazon SES | BC-06 | Email delivery (POC); swappable to SendGrid for production |

---

## DynamoDB Single-Table Key Structure

```
PK                                          SK                                      Entity
──────────────────────────────────────────────────────────────────────────────────────────────────
TENANT#stlucie#LOCATION#loc1                METADATA                                Location config
TENANT#stlucie#LOCATION#loc1                CLERK#clerk42                           Clerk at location
TENANT#stlucie#CLERK#clerk42                METADATA                                Clerk profile
TENANT#stlucie#CLERK#clerk42                SKILL#dl-renewal                        Clerk skill mapping
TENANT#stlucie#TXNTYPE#dl-renewal           METADATA                                Tenant transaction type override
TENANT#stlucie#APPT#appt-abc                METADATA                                Appointment record
TENANT#stlucie#APPT#appt-abc                TXN#dl-transfer                         Transaction within appointment
TENANT#stlucie#CUSTOMER#cust-xyz            METADATA                                Customer record
TENANT#stlucie#CUSTOMER#cust-xyz            NOTE#2026-04-06T10:00:00                Customer note
TENANT#stlucie#QUEUE#loc1                   POS#2026-04-06T10:15:00#cust-xyz        Queue entry (timestamp-sorted)
TENANT#stlucie#SESSION#sess-123             METADATA                                Chatbot session state
TENANT#stlucie#SESSION#sess-123             DOC#dl-photo                            Document upload record
TENANT#stlucie#CONFIG                       HOT_BUTTONS                             Tenant hot-button config
TENANT#stlucie#CONFIG                       CHECKOUT_URL                            Tenant checkout URL
TENANT#stlucie#CONFIG                       DURATION_MONITORING                     Tenant duration monitoring config (rolling_window_days, trim_pct, drift_threshold_pct, min_sample_size)
GLOBAL#TXNTYPE#dl-renewal                   METADATA                                Global transaction type template
GLOBAL#PRESCREENING#dl-renewal              Q#001                                   Global pre-screening question
```

### Global Secondary Indexes

| GSI | PK | SK | Purpose |
|-----|----|----|---------|
| GSI1 (Appointments by Location+Date) | `TENANT#stlucie#LOCATION#loc1#DATE#2026-04-06` | `APPT#appt-abc` | Scheduling engine queries all appointments for a location on a given date |

### TTL Attribute

| Entity | TTL Field | Expiration | Rationale |
|--------|-----------|------------|-----------|
| Customer records | `ttl` | 30 days after creation | PII data retention requirement (NFR-DATA-03) |
| Session records | `ttl` | 30 days after last activity | PII data retention requirement (NFR-DATA-03) |
| Document records | `ttl` | 30 days after creation | PII data retention requirement (NFR-DATA-03) |

### Design Notes
- **Queue SK format**: Uses `POS#<timestamp>#<customer-id>` instead of sequential numbering to avoid renumbering when customers leave the queue mid-wait. Natural sort order gives FIFO behavior.
- **GSI details**: Exact projected attributes and capacity settings will be defined in Functional Design (Construction phase).
- **Clerk skill indexing**: Deferred to Construction — at MVP scale, in-memory filtering of clerks per location is sufficient.

---

## Detailed Artifacts
- [Components](components.md) — full component definitions and responsibilities
- [Component Methods](component-methods.md) — method signatures and input/output types
- [Services](services.md) — service orchestration patterns and flows
- [Component Dependencies](component-dependency.md) — dependency matrix and data flow diagrams
