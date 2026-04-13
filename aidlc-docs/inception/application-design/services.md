# Services

## Overview
Service definitions describing orchestration patterns and cross-component interactions. Services coordinate between components to fulfill business workflows.

---

## SVC-01: Conversation Orchestration Service

**Owner**: BC-01 (Chatbot Service)
**Purpose**: Orchestrates the end-to-end customer conversation flow from landing to appointment confirmation.

**Orchestration Flow**:
1. Customer opens chatbot → `create_session()` → display hot buttons (from Admin config)
2. Customer sends message or clicks hot button → `process_message()` → `identify_transaction()` via Bedrock
3. State machine advances through: identity verification → document upload → pre-screening → checkout eligibility → scheduling
   - **Bypass option**: At document upload and pre-screening states, customer can choose to skip. System warns that skipping increases in-office time, flags the appointment as "incomplete pre-work" (visible to clerks at check-in via green/yellow/red indicator), and advances to the next state.
4. At each state, Lambda loads the appropriate system prompt via `load_transaction_prompt()` and calls Bedrock Converse API for natural language
5. Document upload: generates presigned URL → frontend uploads to S3 → S3 event triggers BC-02 → results written to DynamoDB → frontend polls session state for updates
6. **Pre-screening (merge/dedup + exception resolution)**:
   a. Load questions for all transaction types; deduplicate by `questionKey` — shared questions asked once, answer applied to all transaction types that share the key (BR-PS-01, BR-PS-02)
   b. Collect answers via Bedrock conversational turn
   c. Evaluate `blockingRule` on each answer (BR-PS-03); for each blocked transaction enter exception resolution loop:
      - Load exception resolution system prompt for the transaction type
      - Bedrock converses with customer; MAY call `retrieve_from_knowledge_base(query)` (semantic search) to surface county-specific guidance (e.g., how to obtain a lien release letter, where to find a trailer number)
      - Bedrock returns structured outcome: `resolved` / `dropped` / `parked` / `escalated`
      - Apply outcome to `APPT_TXN.status` and `blockedReason` (BR-EX-04)
      - If turn limit reached without resolution → `APPT_TXN.status = blocked`, offer to book and resolve with clerk (BR-EX-03)
   d. After all exceptions processed: if zero active transactions → end session (BR-TV-01); otherwise recalculate `totalDurationMinutes` from active transactions only (BR-TV-02)
7. Checkout eligibility: evaluate active transactions only; if any eligible offer checkout redirect (URL from Admin config); otherwise proceed to scheduling
8. Scheduling: filter locations offering all **active** transaction types (BR-TV-03) → delegates to BC-05 for slot calculation and booking using active transaction durations only
9. Confirmation: appointment record written with all `APPT_TXN` records (active, dropped, blocked) → delegates to BC-06 for SMS + email with QR code

**Components Involved**: BC-01, BC-02, BC-05, BC-06, SI-03, Bedrock Knowledge Base

---

## SVC-02: Check-In & Queue Placement Service

**Owner**: BC-04 (Clerk Service)
**Purpose**: Orchestrates customer arrival through check-in to queue placement.

**Orchestration Flow**:
1. Clerk scans QR or searches by name → `check_in_qr()` / `check_in_name()` → load customer record with pre-screening status
2. If walk-in with no record → `create_walkin()` → start fresh
3. Clerk reviews pre-screening completeness (green/yellow/red indicator)
4. If incomplete → `send_prescreening_sms()` → delegates to BC-06 for Twilio SMS containing a link to a lightweight web form (hosted on FC-01) → customer completes on phone → form submits answers to BC-01 `/chatbot/prescreening` endpoint → BC-01 `handle_prescreening_complete()` → BC-04 `assign_queue()` auto-places customer in queue → BC-06 sends queue confirmation SMS (clerk dashboard picks up changes on next poll)
5. If complete → clerk selects queue type (regular/priority/assigned) → `assign_queue()`
6. Queue placement → BC-05 `estimate_wait_time()` → BC-06 sends queue entry SMS (clerk dashboards pick up queue update on next poll)

**Components Involved**: BC-04, BC-05, BC-06, SI-03

---

## SVC-03: Summon & Transaction Processing Service

**Owner**: BC-04 (Clerk Service)
**Purpose**: Orchestrates customer summoning, transaction processing, and completion.

**Orchestration Flow**:
1. Clerk clicks "Summon Next" → `summon_next()` → auto-assign based on: (a) assigned-to-clerk first, (b) priority queue, (c) regular FIFO with skill matching
2. Assignment → BC-06 sends summon SMS with station number (display and clerk dashboards pick up changes on next poll)
3. Clerk processes transaction with full customer record (documents, pre-screening, notes)
4. Clerk clicks "Complete" → `complete_appointment()` → record actual duration (display clears customer on next poll)
5. Or "Complete and Summon" → `complete_and_summon()` → atomic complete + next assignment in one call
6. Actual duration recorded → feeds into duration monitoring (BC-03 scheduled analysis)

**Components Involved**: BC-04, BC-06, SI-03

---

## SVC-04: Scheduling & Availability Service

**Owner**: BC-05 (Scheduling Service)
**Purpose**: Calculates real-time slot availability and manages appointment lifecycle.

**Orchestration Flow**:
1. Customer requests slots → `get_available_slots()` with preferences (morning/afternoon, day, location, ASAP)
2. Lambda queries: existing appointments for requested day/location, clerk skills + schedules, lunch breaks, capacity run-rate, per-transaction-type service hours
3. Calculates gaps where a skilled clerk is available, office capacity allows, and all requested transaction types fall within their service hours window
4. For multi-transaction: sums durations across all selected transaction types
5. Returns available slots to chatbot
6. Customer selects slot → `book_appointment()` with DynamoDB conditional write (prevents double-booking)
7. If condition fails (race condition) → recalculate and offer next available
8. On success → `generate_qr_code()` → delegate to BC-06 for confirmation notifications

**Components Involved**: BC-05, BC-06, SI-03

---

## SVC-05: Duration Monitoring Service

**Owner**: BC-03 (Admin Service)
**Purpose**: Scheduled analysis of actual vs. configured transaction durations using trimmed mean over a rolling window, with admin alerting.

**Algorithm**:
- **Rolling window**: Last 30 days of completed transactions (configurable per tenant, default: 30 days)
- **Trimmed mean**: Sort durations, drop top and bottom 10% (configurable), average the rest — removes outliers while reflecting normal variation
- **Drift threshold**: Alert when trimmed mean deviates more than 20% from configured duration (configurable)
- **Minimum sample size**: Require at least 30 transactions in the window before alerting (configurable)

**Orchestration Flow**:
1. Scheduled EventBridge rule triggers Lambda periodically
2. Lambda queries completed appointments within the rolling window, groups by transaction type and location
3. For each group: sort durations, trim top/bottom 10%, calculate trimmed mean
4. Compare trimmed mean against configured duration per transaction type
5. If drift exceeds threshold and sample size meets minimum → generate `DurationAlert`
6. Alert includes: transaction type, configured vs. trimmed mean duration, sample size, raw min/max spread, per-location breakdown, confidence indicator
7. Admin views alerts on dashboard → accept (updates configured duration), dismiss, or snooze

**Components Involved**: BC-03, SI-03

---

## SVC-06: Notification Dispatch Service

**Owner**: BC-06 (Notification Service)
**Purpose**: Centralized notification dispatch via Twilio SMS and Amazon SES email (POC). Email provider abstracted behind a swappable interface.

**Orchestration Flow**:
1. Any component calls BC-06 with notification request (template + data)
2. BC-06 resolves tenant-specific Twilio config from DynamoDB
3. Dispatches via Twilio (SMS) or Amazon SES (email, POC)
4. Logs delivery result (success/failure)
5. Failed delivery is logged but never blocks the calling workflow

**Notification Types**:
| Trigger | Channel | Template |
|---------|---------|----------|
| Appointment booked | SMS + Email | Confirmation with QR code |
| Queue entry | SMS | Queue number + estimated wait |
| Next in line | SMS | "You're next" alert |
| Summoned | SMS | Station number instruction |
| Pre-screening sent | SMS | Link to remaining questions |
| Lien letter | Email | PDF attachment |

**Components Involved**: BC-06, SI-03

---

## SVC-07: State Polling Service

**Owner**: BC-04 (Clerk Service)
**Purpose**: Provide polling endpoints for frontends to retrieve current queue, summon, and display state.

**Orchestration Flow**:
1. Frontend apps poll dedicated REST endpoints at 2-5s intervals
2. Each poll returns the full current state for the requested office (queue list, active summons, display data)
3. Frontends render the latest response directly — no local state management needed
4. Polling interval is configurable per app (FC-03 Display: 2s, FC-02 Staff: 3s, FC-01 Chatbot: 5s)

**Polling Endpoints**:
| Endpoint | Source | Consumers | Data |
|----------|--------|-----------|------|
| `GET /clerk/queue-state?officeId=X` | BC-04 | FC-02 (clerk dashboard) | Full queue list, pre-screening statuses, clerk availability |
| `GET /clerk/display-state?officeId=X` | BC-04 | FC-03 (display) | Customer codes + station assignments |
| `GET /chatbot/session-state/:sessionId` | BC-01 | FC-01 (chatbot) | Session state including OCR results, queue placement |

**Components Involved**: BC-04, BC-01, SI-03
