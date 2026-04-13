# Requirements Document — St. Lucie County Tax Collector Platform

**Project**: St. Lucie County Tax Collector — Conversational AI & Office Management Platform
**Date**: 2026-04-06
**Depth**: Comprehensive
**Status**: Approved

---

## 1. Project Overview

### 1.1 Vision
Replace the traditional tax collector website with a conversational AI-driven experience that pre-screens customers, schedules appointments dynamically, and streamlines in-office service delivery. The platform includes an admin dashboard for office/clerk/transaction management and a service clerk dashboard for real-time queue processing.

### 1.2 Scope (MVP)
- Conversational AI public-facing chatbot (standalone web app)
- Admin dashboard (locations, clerks, transaction types, scheduling config, duration monitoring)
- Service clerk dashboard (check-in, queue management, summon, complete)
- Dynamic scheduling/appointment engine (basic statistics)
- Multi-tenant architecture (built for 67 counties, deployed for St. Lucie only)
- DL identity verification via Bedrock OCR (wrapped in swappable stub endpoint)
- SMS + email notifications via Twilio
- State system integrations stubbed for future implementation

### 1.3 Out of Scope (MVP)
- AuthID / Clear liveness verification
- IDR fraud detection
- Orion state system direct integration (manual upload by clerks)
- SSO / federated identity
- Vehicle/vessel lookup by customer GUID (stubbed)
- Multi-agentic orchestration framework (use prompt-switching per transaction type with database-driven context; Bedrock Knowledge Bases for general Q&A fallback)

---

## 2. Functional Requirements

### 2.1 Conversational AI Chatbot (FR-CHAT)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-CHAT-01 | Standalone web application — the chatbot IS the website (no widget mode). Coexists alongside legacy website during transition period. | Must | Q17, Transcript L440-460, L1080-1095 |
| FR-CHAT-02 | Landing page displays 3-4 hot-button suggested prompts for most common transaction types (DL, registration renewal, title transfer, new resident) | Must | Q4, Transcript L440 |
| FR-CHAT-03 | NLP-driven conversation flow that determines transaction type(s), collects customer information, and guides through pre-screening | Must | Transcript L380-420 |
| FR-CHAT-04 | Identity verification: customer uploads DL photo, system extracts fields via Bedrock multimodal OCR (name, DOB, DL number, address) | Must | Q15, User scoping |
| FR-CHAT-05 | OCR extraction wrapped in a stub verification endpoint — designed for easy swap to state DL verification system later | Must | Q15 |
| FR-CHAT-06 | Pre-screening questions presented AFTER identity verification is complete | Must | Q3 |
| FR-CHAT-07 | Pre-screening questions are transaction-type-specific (e.g., ~12 HIPAA questions for DL) and configurable per transaction type | Must | Transcript L530-540 |
| FR-CHAT-08 | Document upload capability with AI validation (Bedrock multimodal determines if uploaded document is acceptable type/quality) and bypass option — warn customer that skipping increases in-office time, flag appointment as "documents needed at check-in" | Must | Q2, Transcript L420-425, L560-565 |
| FR-CHAT-09 | Online checkout redirect: collect all data first, then before appointment scheduling check eligibility; show in-chat prompt asking if they'd like to proceed to online checkout; redirect to configurable external payment URL (e.g., MyEasyGov) on confirmation | Must | Q1, Transcript L490-500, L1050-1070 |
| FR-CHAT-10 | Appointment scheduling flow: ask only (1) morning or afternoon, (2) specific day preference, (3) which location, (4) as soon as possible | Must | Q12, Transcript L576-596 |
| FR-CHAT-11 | QR code generation upon appointment confirmation, delivered via SMS and email | Must | Transcript L599 |
| FR-CHAT-12 | Transaction-type-specific AI behavior via prompt-switching (different system prompt per transaction type, context assembled from database at conversation start) | Must | User scoping, Transcript L843-848 |
| FR-CHAT-13 | Support multiple transaction types per appointment — customer can indicate they need DL transfer + vehicle title + registration in one visit; durations are summed for scheduling | Must | Transcript L300-310, L430-440 |
| FR-CHAT-14 | Lien transfer letter auto-generation: when customer indicates out-of-state vehicle with lien, generate a printable letter for the customer to send to their lien holder | Must | Transcript L468-480, Partner SOP §3.1 |
| FR-CHAT-15 | General Q&A fallback via Bedrock Knowledge Bases: when the chatbot cannot match a customer's message to a known transaction type, query a knowledge base built from tcslc.com content to answer general informational questions (e.g., office hours, accepted documents, service availability) | Must | Partner SOP §3.1, §4.2, OQ-01 resolution |

### 2.2 Admin Dashboard (FR-ADMIN)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-ADMIN-01 | Location management: name, address, hours of operation, number of seats/stations, capacity run-rate percentage (single value per office, applies all day) | Must | Q5, Transcript L620-640 |
| FR-ADMIN-02 | Transaction type management: name, description/JSON metadata, average duration, service hours, location availability, active/inactive/hidden status | Must | Transcript L650-670 |
| FR-ADMIN-03 | Clerk management: name, email, default office assignment, skill/transaction type mappings, status (active/inactive/training) | Must | Transcript L682-690 |
| FR-ADMIN-04 | Clerk onboarding: manual entry through admin UI + CSV bulk upload | Must | Q7 |
| FR-ADMIN-05 | Duration monitoring with automated recommendations: scheduled analysis of actual vs. configured durations per transaction type, threshold-based alerts when averages drift significantly, per-location breakdown, confidence indicator (minimum sample size), and accept/dismiss/snooze workflow for admins to update configured durations | Must | Q6, Transcript L650 |
| FR-ADMIN-06 | Lunch shift configuration per office (affects scheduling capacity) | Must | Transcript L640 |
| FR-ADMIN-07 | Hot-button/suggested prompt configuration: global default set of 3-4 prompts, manageable through admin dashboard | Should | Transcript L440, Q4 |
| FR-ADMIN-08 | Pre-screening question management per transaction type | Must | Transcript L530 |
| FR-ADMIN-09 | Configurable online checkout redirect URL per tenant (for MyEasyGov or similar external payment service) | Must | Transcript L1050-1070 |
| FR-ADMIN-10 | Multi-tenant: admin scoped to their county, super-admin can manage all counties | Must | User scoping |

### 2.3 Service Clerk Dashboard (FR-CLERK)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-CLERK-01 | Login flow: clerk selects office and station number at daily login (self-select, no admin pre-scheduling) | Must | Q8, Transcript L823 |
| FR-CLERK-02 | Check-in: QR code scan or name lookup for arriving customers | Must | Transcript L800-810 |
| FR-CLERK-03 | Queue list view with status indicator (green/yellow/red) showing pre-screening completeness per customer | Must | Q9 |
| FR-CLERK-04 | Detailed checklist view when clerk opens a customer record — shows exactly which steps are complete/pending | Must | Q9 |
| FR-CLERK-05 | Document review panel: view customer-uploaded documents, upload additional documents from clerk's device | Must | Transcript L890 |
| FR-CLERK-06 | Persistent customer notes: free-text notes attached to customer record, visible across visits | Must | Q10, Transcript L758-762 |
| FR-CLERK-07 | Text-to-customer: send incomplete pre-screening questions to customer's phone via SMS | Must | Transcript L769-770 |
| FR-CLERK-08 | Auto-queue placement: customer enters queue automatically after completing all pre-screening questions — triggered by both chatbot completion and SMS-based completion (no need to return to front desk) | Must | Transcript L773, L830-835 |
| FR-CLERK-09 | Queue management with three queue types: (1) regular — FIFO with skill matching, (2) priority — moves customer up in line for next available skilled clerk, (3) assigned-to-clerk — routes to a specific clerk. Front desk clerk assigns queue type at check-in. | Must | Transcript L785-800, L855-858 |
| FR-CLERK-10 | Clerk toggle: mark self as available/unavailable to queue (in/out toggle) | Must | Q14, Transcript L858 |
| FR-CLERK-11 | Summon next customer: system auto-assigns based on skills and queue position — no cherry-picking | Must | Q14, Transcript L849-856 |
| FR-CLERK-12 | Summon triggers both SMS text to customer mobile and update to public display | Must | Transcript L877 |
| FR-CLERK-13 | Complete appointment button (marks transaction done) | Must | Transcript L887 |
| FR-CLERK-14 | Complete and Summon button (marks done + immediately summons next) | Must | Transcript L889 |
| FR-CLERK-15 | Send to written test flow: direct customer to specific station for written test | Should | Transcript L886 |
| FR-CLERK-16 | Document upload to state system (manual drag-and-drop to Orion — stubbed in MVP) | Should | Transcript L890-891 |

### 2.4 Scheduling & Queue Engine (FR-SCHED)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-SCHED-01 | Dynamic scheduling: no static time blocks — stack transactions based on real-time duration values | Must | Transcript L588-596 |
| FR-SCHED-02 | Customer inputs: morning/afternoon preference, day preference, location preference, ASAP option | Must | Q12, Transcript L576-584 |
| FR-SCHED-03 | Engine considers transaction type(s) and their configured durations to calculate total appointment time — supports multiple transaction types per appointment with summed durations | Must | Q12, Transcript L300-310 |
| FR-SCHED-04 | Engine considers clerk skill availability at each location when finding optimal slots | Must | Q12 |
| FR-SCHED-05 | Account for office capacity run-rate (single percentage per office) | Must | Q5 |
| FR-SCHED-06 | Account for clerk lunch breaks in scheduling capacity | Must | Transcript L640 |
| FR-SCHED-07 | Walk-in support: self-service kiosk or QR code scan at office to join queue without appointment | Must | Q13 |
| FR-SCHED-08 | Walk-in capacity consideration: leave room in schedule for walk-ins based on run-rate config | Should | Transcript L595 |
| FR-SCHED-09 | Queue position estimation: show customer approximate wait time after entering queue | Should | Transcript L775 |

### 2.5 Public Display (FR-DISPLAY)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-DISPLAY-01 | Public-facing screen showing customer number/code and station number only (no names — privacy-focused) | Must | Q11 |
| FR-DISPLAY-02 | Real-time updates when customers are summoned | Must | Transcript L877 |

### 2.6 Notifications (FR-NOTIF)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-NOTIF-01 | SMS notifications via Twilio: appointment confirmation, queue position updates, "you're next" summon | Must | Q16, Transcript L877 |
| FR-NOTIF-02 | Email notifications via Amazon SES (POC) / SendGrid (production): appointment confirmation with QR code. Email provider is abstracted behind a swappable interface in BC-06. | Must | Q16, Transcript L933-937 |
| FR-NOTIF-03 | Text-to-customer for incomplete pre-screening questions | Must | Transcript L769-770 |

### 2.7 Authentication & Authorization (FR-AUTH)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-AUTH-01 | Public chatbot: no authentication required, session-based identity | Must | System design |
| FR-AUTH-02 | Clerk dashboard: Cognito email/password authentication | Must | System design |
| FR-AUTH-03 | Admin dashboard: Cognito email/password authentication with admin role | Must | System design |
| FR-AUTH-04 | Role-based access control: admin (tenant-scoped), clerk (office-scoped) | Must | System design |
| FR-AUTH-05 | JWT-based API authorization on all non-public endpoints | Must | System design |
| FR-AUTH-06 | Tenant isolation: users can only access data within their tenant | Must | System design |

---

## 3. Non-Functional Requirements

### 3.1 Performance & Scalability (NFR-PERF)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| NFR-PERF-01 | Design for under 50 concurrent users (St. Lucie MVP) — serverless architecture scales automatically | Must | Q18 |
| NFR-PERF-02 | Chatbot response time under 3 seconds for non-AI responses, under 10 seconds for Bedrock calls | Should | Best practice |
| NFR-PERF-03 | Queue updates propagated to clerk dashboards and public displays within 2 seconds | Should | Best practice |

### 3.2 Availability (NFR-AVAIL)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| NFR-AVAIL-01 | Chatbot available 24/7 for appointment booking and information | Must | Q19 |
| NFR-AVAIL-02 | Admin and clerk dashboards: high availability during business hours (8am-6pm ET) | Must | Q19 |
| NFR-AVAIL-03 | Serverless architecture provides inherent HA — no explicit multi-AZ configuration needed | Must | Q19 |
| NFR-AVAIL-04 | All frontend apps (FC-01, FC-02, FC-03) use polling (2-5s intervals) for state updates; polling endpoints return full current state on each request | Must | Architecture review (revised 2026-04-08: WebSocket → Polling) |

### 3.3 Data Retention (NFR-DATA)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| NFR-DATA-01 | Configurable retention periods per data type per tenant | Must | Q20 |
| NFR-DATA-02 | Default: 3 years for general correspondence (chat transcripts, appointment history) | Must | Q20, FL GS1-SL |
| NFR-DATA-03 | Default: 30 days for PII/sensitive data (DL photos, uploaded identity documents) | Must | Q20 |
| NFR-DATA-04 | Automated lifecycle policies for data expiration | Should | Best practice |

### 3.4 Security (NFR-SEC)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| NFR-SEC-01 | Security extension ENABLED — all 15 SECURITY rules enforced as blocking constraints | Must | Q21 |
| NFR-SEC-02 | Encryption at rest and in transit (TLS 1.2+) | Must | SECURITY-01 |
| NFR-SEC-03 | No PII in application logs | Must | SECURITY-03 |
| NFR-SEC-04 | Least-privilege IAM policies | Must | SECURITY-06 |
| NFR-SEC-05 | Input validation on all API parameters | Must | SECURITY-05 |
| NFR-SEC-06 | Application-level access control with auth on every endpoint | Must | SECURITY-08 |
| NFR-SEC-07 | Rate limiting on public-facing endpoints (chatbot, appointment booking) | Must | SECURITY-11 |

### 3.5 Multi-Tenancy (NFR-TENANT)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| NFR-TENANT-01 | Architecture supports 67 Florida counties — single platform, tenant-isolated data | Must | User scoping, Transcript L267 |
| NFR-TENANT-02 | MVP deploys St. Lucie County only | Must | User scoping |
| NFR-TENANT-03 | Multi-tenant data model with shared global configuration (transaction type templates, state-mandated questions) and tenant-scoped data (locations, clerks, customer records, customized config) | Must | Transcript L267-280 |
| NFR-TENANT-04 | Tenant-scoped admin access (admin sees only their county data) | Must | User scoping |

---

## 4. Technical Constraints

| ID | Constraint | Source |
|----|-----------|--------|
| TC-01 | AWS-only cloud — all services AWS-native unless external service required (e.g., Twilio) | User scoping |
| TC-02 | Serverless-first architecture (Lambda, DynamoDB, API Gateway, Bedrock, S3) | User scoping, Q18/Q19 |
| TC-03 | Twilio for SMS; Amazon SES for email (POC) — SendGrid integration deferred to production (existing provider relationship). BC-06 uses a provider interface so email backend is swappable. | Transcript L933-937, Q16 |
| TC-04 | Amazon Bedrock for conversational AI and DL OCR | User scoping |
| TC-05 | Prompt-switching with database-driven context for transactional flows (different system prompt per transaction type); Bedrock Knowledge Bases for general Q&A fallback when no transaction type matches | User scoping |
| TC-06 | State system integrations stubbed with mock endpoints | User scoping |
| TC-07 | Identity verification endpoint designed as swappable module (OCR now, state API later) | Q15 |

---

## 5. Assumptions

| ID | Assumption |
|----|-----------|
| A-01 | St. Lucie County has 3 offices with ~24 clerks each (~72 total) |
| A-02 | Office hours vary by location (e.g., Tradition 8am-6pm 6 days/week, others 9am-5pm 5 days/week) |
| A-03 | Transaction types and pre-screening questions will be provided by St. Lucie County staff |
| A-04 | Structured knowledge (workflows, document requirements) will be provided by the county knowledge base team for chatbot context |
| A-05 | Twilio account and credentials will be provided for SMS integration. POC uses Amazon SES for email; production will use SendGrid per existing provider relationship. |
| A-06 | Florida public records laws apply — system must support records requests |
| A-07 | Chatbot coexists alongside legacy website during transition — not a hard cutover |

---

## 6. Extension Configuration

| Extension | Status | Rationale |
|-----------|--------|-----------|
| Security Baseline (SECURITY-01 through SECURITY-15) | **ENABLED** | Government application handling PII, production-grade, multi-tenant |

---
