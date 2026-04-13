# Components

## Overview
The platform is organized into 10 components across 3 frontend applications, 6 backend domains, and 1 shared infrastructure layer.

---

## Frontend Components

### FC-01: Chatbot App
**Purpose**: Public-facing conversational AI web application that replaces the traditional county website.
**Type**: React SPA (no authentication)
**Deployment**: S3 + CloudFront

**Responsibilities**:
- Render conversational chat UI with hot-button prompts
- Manage client-side conversation session
- Handle DL photo and document uploads via presigned URLs
- Display OCR extraction results for customer confirmation
- Present pre-screening questions conversationally
- Drive appointment scheduling flow (morning/afternoon, day, location, ASAP) — filter locations to only those offering the requested transaction type(s)
- Display QR code on appointment confirmation
- Handle online checkout redirect flow
- Support walk-in kiosk entry: same Chatbot App loaded with URL params (`?location=<id>&mode=walkin`) — pre-fills location, skips location question in scheduling, tags session as walk-in. Kiosk can be a tablet in the lobby or a QR code poster that encodes the parameterized URL for customers to scan with their phone.

**Interfaces**:
- REST API: `/chatbot/*` endpoints for conversation, upload URLs, scheduling
- Polling: polls session state endpoint (2-5s interval) for async updates (OCR results, queue placement confirmation)

---

### FC-02: Staff App (Clerk + Admin Dashboard)
**Purpose**: Internal application for clerks (check-in and service modes) and admins (office/clerk/transaction management).
**Type**: React SPA with Cognito authentication, role-based routing
**Deployment**: S3 + CloudFront

**Responsibilities**:
- Cognito login flow with office/station selection for clerks
- Check-in mode: QR scan, name lookup, queue assignment, SMS dispatch, document review
- Service mode: summon next, customer record view, complete/complete-and-summon, notes, written test
- Availability toggle (in/out of queue)
- Admin views: location CRUD, transaction type CRUD, clerk management, CSV import, duration monitoring, pre-screening question config, hot-button config, checkout URL config
- Role-based access: clerk role sees clerk views, admin role sees admin views
- Polling-based queue updates (2-5s interval)

**Interfaces**:
- REST API: `/admin/*`, `/clerk/*` endpoints
- Polling: polls queue state endpoint (2-5s interval) for queue changes, summon events, pre-screening completion updates

---

### FC-03: Display App
**Purpose**: Public-facing read-only screen showing customer codes and station assignments.
**Type**: React SPA (no authentication or simple token)
**Deployment**: S3 + CloudFront

**Responsibilities**:
- Display customer code/number and station number (no names — privacy)
- Highlight most recently summoned customer
- Poll display state endpoint (2-5s interval) scoped to current office
- Full-screen TV-optimized layout

**Interfaces**:
- REST API: polls display state endpoint for summon events and queue updates for the office

---

## Backend Components

### BC-01: Chatbot Service
**Purpose**: Manages conversational AI flows, state machine transitions, and Bedrock integration.
**API Prefix**: `/chatbot/*`

**Responsibilities**:
- Conversation session creation and management
- State machine orchestration (identify-transaction → verify-identity → upload-docs → pre-screen → checkout-check → schedule)
- Transaction type identification via Bedrock NLP
- Prompt-switching: load transaction-type-specific system prompt from DynamoDB
- General Q&A fallback: query Bedrock Knowledge Base (tcslc.com content) when no transaction type matches
- Multi-transaction bundling (sum durations, track parallel pre-screening progress)
- Bedrock Converse API calls for natural language generation within each state
- Presigned URL generation for document uploads
- Online checkout eligibility check and redirect URL retrieval
- State bypass: allow customers to skip optional states (document upload, pre-screening) — warns customer of increased in-office time, flags appointment as "incomplete pre-work" visible to clerks at check-in
- SMS pre-screening completion: receive submissions from walk-in customers completing pre-screening via SMS link, update session, and trigger auto-queue placement via BC-04

**Data Owned**: Conversation sessions, conversation state, pre-screening answers, per-state conversation turns, full raw conversation history (for records retention)

**Conversation Memory**: Each Bedrock call receives the current state's system prompt, a structured context summary from the session record (identity, transactions, documents, pre-screening progress), and only the conversation turns from the current state. Turns reset at each state transition. Full raw history is persisted for the 3-year retention requirement but is not sent to Bedrock.

---

### BC-02: Identity & Document Service
**Purpose**: Handles DL OCR extraction and document validation via Bedrock multimodal.
**Trigger**: S3 event notification on document upload

**Responsibilities**:
- DL photo OCR: extract name, DOB, DL number, address via Bedrock multimodal
- Document type validation: verify uploaded document matches expected type
- Document quality assessment: check readability
- Write extraction/validation results to DynamoDB session record
- Results available to frontend via polling (session state endpoint)
- Stub endpoint design for future state DL verification system swap

**Data Owned**: Document metadata, OCR extraction results, validation status

**Extensibility — Document Fraud Detection (IDR)**: BC-02 is the integration point for future Intelligent Document Recognition. The S3 event trigger pattern allows additional processing steps (fraud detection, advanced validation) to be added as downstream Lambda functions without modifying the upload flow or any upstream components. Vendor should implement IDR as a new Lambda triggered by the same S3 event or chained via EventBridge.

---

### BC-03: Admin Service
**Purpose**: CRUD operations for all administrative configuration.
**API Prefix**: `/admin/*`

**Responsibilities**:
- Location management (CRUD, capacity run-rate, lunch shifts, hours)
- Transaction type management (CRUD, durations, location availability, status)
- Clerk management (CRUD, skill mappings, status)
- Clerk CSV bulk import with validation
- Pre-screening question management per transaction type
- Hot-button prompt configuration
- Online checkout URL configuration
- Duration monitoring: scheduled analysis of actual vs. configured durations, threshold alerts, accept/dismiss workflow
- Tenant-scoped access enforcement

**Data Owned**: Locations, transaction types, clerk profiles, pre-screening question templates, system configuration

---

### BC-04: Clerk Service
**Purpose**: Check-in and service mode operations for clerks.
**API Prefix**: `/clerk/*`

**Responsibilities**:
- Daily login: office/station selection, prevent duplicate station assignment
- Check-in: QR code lookup, name search, create walk-in records
- Queue assignment: regular (FIFO + skill match), priority, assigned-to-clerk
- Pre-screening gate enforcement (block queue entry until complete)
- Send pre-screening questions via SMS (delegates to Notification Service)
- Document review and upload from clerk device
- Summon next customer (auto-assign based on skills + queue rules)
- Complete appointment (record actual duration)
- Complete and summon (atomic complete + next)
- Send to written test
- Customer notes CRUD
- Availability toggle (in/out of queue)
- Push queue state changes to frontends via polling (frontends poll queue state endpoint)

**Data Owned**: Queue state, clerk station assignments, clerk availability, customer notes

---

### BC-05: Scheduling Service
**Purpose**: On-demand appointment slot calculation and booking.
**API Prefix**: `/scheduling/*`

**Responsibilities**:
- On-demand slot availability calculation considering: existing appointments, clerk skills per location, office capacity run-rate, lunch breaks, transaction durations (summed for multi-transaction), per-transaction-type service hours (e.g., road tests stop 30 min before close)
- Appointment booking with optimistic concurrency (DynamoDB conditional write to prevent double-booking)
- Walk-in queue entry (no appointment, direct queue placement)
- QR code generation for confirmed appointments
- Walk-in capacity consideration (leave room based on run-rate config)
- Queue position estimation (approximate wait time)

**Data Owned**: Appointments, appointment slots (computed, not stored)

---

### BC-06: Notification Service
**Purpose**: SMS dispatch via Twilio, email dispatch via Amazon SES (POC). Email provider abstracted behind a swappable interface for future SendGrid integration.
**API Prefix**: `/notifications/*`

**Responsibilities**:
- SMS via Twilio: appointment confirmation, queue entry, "you're next," summon with station number, pre-screening questions link
- Email via Amazon SES (POC): appointment confirmation with QR code image
- Lien transfer letter generation (PDF from template + customer/vehicle data)
- Failed delivery logging (non-blocking)
- Tenant-scoped Twilio configuration

**Data Owned**: Notification delivery logs

---

## Shared Infrastructure

### SI-02: Auth & Tenant Context
**Purpose**: Authentication, authorization, and tenant isolation enforcement.
**Type**: Cognito User Pool + API Gateway Authorizer + shared middleware

**Responsibilities**:
- Cognito User Pool management (clerk and admin accounts)
- JWT validation on all non-public endpoints
- Tenant ID extraction from JWT claims
- Role-based access control (clerk, admin, super-admin)
- Tenant-scoped partition key prefix construction for all DynamoDB operations
- Public endpoint identification (chatbot routes — no auth)

**Data Owned**: User accounts (via Cognito), role assignments

---

### SI-03: Data Access Layer
**Purpose**: Shared DynamoDB access patterns with built-in tenant isolation.
**Type**: TypeScript module (shared across all Lambda functions)

**Responsibilities**:
- Tenant-prefixed partition key construction (all queries automatically scoped)
- Single-table design access patterns (PK/SK construction, GSI queries)
- Global config read access (`GLOBAL#` prefix for shared templates)
- Tenant override resolution (tenant config overrides global defaults)
- TTL management for PII data (30-day expiration)
- Optimistic concurrency helpers (conditional writes)
