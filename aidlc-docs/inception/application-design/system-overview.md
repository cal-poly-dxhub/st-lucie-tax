# St. Lucie County Tax Collector — System Overview

## Purpose

This document provides a high-level overview of the Conversational AI & Office Management Platform for the St. Lucie County Tax Collector's office. It is intended for implementation partners and stakeholders who need to understand what the system does, how the major subsystems work together, and why key design decisions were made.

---

## What We're Building

A platform that replaces the traditional county tax collector website and in-office workflow with four integrated systems:

1. **Conversational AI Chatbot** — public-facing, replaces the website
2. **Service Clerk Dashboard** — internal tool for processing customers
3. **Admin Dashboard** — office and workforce management
4. **Scheduling & Queue Engine** — ties everything together

The platform is designed for multi-tenancy from day one — built for St. Lucie County but architecturally ready for any Florida county to onboard without code changes.

---

## 1. Conversational AI Chatbot

**What it does**: A chat-based interface that guides customers through their entire transaction — from identifying what they need, through identity verification and document upload, to scheduling an appointment or completing the transaction online.

**How it works**:

The chatbot is built as a custom state machine, not a free-form AI conversation. Each customer interaction follows a deterministic flow:

1. **Transaction identification** — Customer describes what they need (e.g., "I need to renew my driver's license"). Amazon Bedrock's language model identifies the transaction type. If the customer needs multiple services, they're bundled into a single appointment.

2. **Identity verification** — Customer uploads a photo of their driver's license. Bedrock's multimodal model extracts name, DOB, DL number, and address via OCR. The customer confirms or corrects the extracted data.

3. **Document collection** — Based on the transaction type, the system requests any required supporting documents. Documents are uploaded directly to S3 via presigned URLs (avoids size limits on the API).

4. **Pre-screening** — Transaction-specific questions configured by the admin (e.g., "Do you have proof of insurance?" for a vehicle registration). Answers determine if the customer is ready for their appointment.

   When a customer has multiple transactions, pre-screening questions are **merged and deduplicated** across all transaction types before being presented. Questions that apply to more than one transaction (e.g., "proof of insurance" required by both vehicle registration and trailer registration) are asked exactly once. The answer is applied to every transaction type that requires it.

   If a pre-screening answer triggers a **blocking condition** (e.g., no trailer number provided, no lien release letter), the chatbot enters an **exception resolution conversation** for that transaction:
   - First, it tries to collect the missing information inline ("What is your trailer number?")
   - If the customer can't provide it, Bedrock queries the **Knowledge Base** (semantic search against tcslc.com content) to surface county-specific guidance — e.g., where to obtain a lien release letter, how to locate a trailer VIN
   - If the issue requires an out-of-band process, the chatbot explains the steps and offers to park the session so the customer can return once they have what they need
   - If the customer can't resolve it at all, they're offered the option to drop that transaction from the appointment or book anyway and resolve it with a clerk in office
   - If the conversation exhausts the turn limit without resolution, the transaction is flagged as blocked with a reason, and the clerk handles it at check-in

   Each transaction in a multi-transaction appointment ends up with a per-transaction status: **active** (proceeding), **dropped** (removed by customer), or **blocked** (escalated to clerk). Scheduling, duration calculation, and location filtering all use active transactions only.

5. **Checkout eligibility** — Some transactions can be completed entirely online. If eligible, the customer is redirected to the county's existing online checkout system.

6. **Appointment scheduling** — For in-person transactions, the customer picks a time slot. The system calculates availability in real-time (see Scheduling section below).

7. **Confirmation** — Customer receives SMS and email confirmation with a QR code for check-in.

**Why a state machine instead of free-form AI**: This is a government application handling identity documents and appointments. The state machine ensures every required step happens in order — no skipping identity verification, no booking without pre-screening. Bedrock handles the conversational tone within each state, but the flow itself is deterministic and auditable.

**Bypass option**: Customers can skip document upload and pre-screening if they're not comfortable completing them online. The system warns that skipping will increase in-office time and flags the appointment as "incomplete pre-work." Clerks see this flag at check-in (the green/yellow/red indicator) and can collect documents at the desk or send pre-screening questions via SMS. Transaction identification, identity verification, and scheduling are mandatory and cannot be skipped.

**Why transaction-specific prompts**: Each transaction type loads a different system prompt from the database. This means the AI's behavior for a DL renewal is different from a lien transfer — different questions, different document requirements, different pre-screening. Admins can update these prompts without code changes.

**General Q&A via Bedrock Knowledge Bases**: When a customer's message doesn't match a known transaction type (e.g., "what are your office hours?", "do I need an appointment for property tax?"), the chatbot falls back to a Bedrock Knowledge Base built from tcslc.com content. This is a managed RAG service — AWS handles the vector store, chunking, and retrieval. The state machine is unaffected; RAG is purely a fallback path.

**Conversation memory strategy**: The chatbot does NOT pass full conversation history to Bedrock on every call. Instead, each Bedrock request receives three things: (1) the system prompt for the current transaction type and state, (2) a structured context summary built from the DynamoDB session record (customer identity, transaction types, documents uploaded, pre-screening progress), and (3) only the conversation turns from the current state. When the state machine advances to a new state, the conversation turns reset — the structured session data carries forward everything that matters. This keeps token usage bounded, prevents the LLM from being confused by old context under a new system prompt, and is simpler to implement than history summarization. The full raw conversation is still persisted to DynamoDB for the 3-year Florida public records retention requirement.

---

## 2. Service Clerk Dashboard

**What it does**: The internal tool clerks use to check in customers, manage the queue, process transactions, and summon the next customer.

**Two modes of operation**:

### Check-In Mode
When a customer arrives at the office:
- Clerk scans the customer's QR code (from their appointment confirmation) or searches by name for walk-ins
- System displays the customer's record: transaction type, pre-screening status, uploaded documents
- If pre-screening is incomplete, the clerk can send remaining questions via SMS — the customer completes them on their phone while waiting
- Clerk places the customer in the appropriate queue (regular, priority, or assigned to a specific clerk)
- Customer receives an SMS with their queue position and estimated wait time

### Service Mode
When processing a customer:
- Clerk clicks "Summon Next" — the system auto-assigns the next customer based on the clerk's skills and queue priority rules
- Customer receives an SMS with their station number, and the lobby display updates
- Clerk sees the full customer record: identity info, documents, pre-screening answers, any notes from previous interactions
- Clerk processes the transaction, can add notes, upload additional documents, or send the customer to a written test station
- Clerk clicks "Complete" (or "Complete and Summon Next" for back-to-back processing)
- Actual transaction duration is recorded automatically

**Queue logic**: Three queue types exist — "assigned to clerk" (highest priority, specific clerk requested), "priority" (urgent cases), and "regular" (FIFO with skill matching). When a clerk summons next, the system checks assigned-to-clerk first, then priority, then regular — only offering customers whose transaction type matches the clerk's skills.

**Real-time updates**: The dashboard polls for updates at short intervals (2-5 seconds). When another clerk checks someone in, when a customer completes pre-screening, when queue positions change — all reflected within seconds without page refreshes.

---

## 3. Admin Dashboard

**What it does**: Office management tool for configuring locations, managing clerks, defining transaction types, and monitoring operational performance.

**Key capabilities**:

### Office & Workforce Management
- **Location management** — Create and configure office locations with hours, station count, capacity run-rate, and lunch shift schedules
- **Clerk management** — Add clerks individually or via CSV bulk import, assign skills (which transaction types each clerk can handle), manage status
- **Transaction type management** — Define transaction types with expected durations, which locations offer them, required documents, pre-screening questions, and online checkout eligibility

### Configuration
- **Hot-button prompts** — Configure the quick-action buttons shown on the chatbot landing page (e.g., "Renew DL", "Vehicle Registration", "Property Tax")
- **Checkout URL** — Set the redirect URL for online-eligible transactions
- **Pre-screening questions** — Define per-transaction-type questions that customers must answer before their appointment

### Duration Monitoring
This is the feedback loop that keeps the scheduling engine accurate. See the Scheduling section below for details.

---

## 4. Scheduling & Queue Engine

**How appointment scheduling works**:

The scheduling engine calculates available slots on-demand — nothing is pre-computed. When a customer requests an appointment, the system:

1. Queries all existing appointments for the requested location and date
2. Looks up which clerks are at that location and what skills they have
3. Factors in office hours, lunch breaks, capacity run-rate, and per-transaction-type service hours (e.g., road tests stop 30 minutes before close)
4. Calculates the total duration needed (summed across all transaction types if multi-transaction)
5. Finds gaps where a qualified clerk is available and office capacity allows
6. Returns available slots to the customer

Booking uses optimistic concurrency — a DynamoDB conditional write ensures that if two customers try to book the same slot simultaneously, one succeeds and the other gets recalculated options. No double-booking is possible.

**Walk-in handling**: Walk-ins skip the scheduling flow entirely. They're checked in by a clerk and placed directly in the queue. The capacity run-rate configuration reserves a portion of each day's capacity for walk-ins so appointments don't consume 100% of available time.

**How transaction durations stay accurate**:

Every time a clerk completes a transaction, the actual duration is recorded. A scheduled EventBridge job analyzes these durations using a trimmed mean over a rolling 30-day window:

1. Query all completed transactions for each transaction type + location from the last 30 days
2. Sort durations, trim the top and bottom 10% to remove outliers (the 1-minute fluke, the 45-minute disaster)
3. Calculate the trimmed mean of the remaining durations
4. Compare against the configured expected duration

When the trimmed mean drifts beyond a configurable threshold (default: 20%) and the sample size meets the minimum (default: 30 transactions in the window), the system generates an alert on the admin dashboard showing:
- The transaction type and location
- Configured duration vs. trimmed mean
- Sample size and raw min/max spread
- Confidence indicator

The admin can **accept** (updates the configured duration immediately), **dismiss**, or **snooze**. Once accepted, the updated duration immediately affects all future slot calculations.

The rolling window ensures the system reflects current performance — not stale data from months ago. The trimmed mean is used instead of a simple average or median because it accounts for normal variation in transaction times while excluding true outliers, giving the scheduling engine the most accurate "how long should I block on the calendar" number.

Duration monitoring configuration (rolling window days, trim percentage, drift threshold, minimum sample size) is stored per-tenant with global defaults, so each county can tune sensitivity to their volume.

This creates a self-correcting loop: clerks work → durations recorded → drift detected → admin approves → scheduling becomes more accurate → better customer experience.

---

## 5. Lobby Display

A read-only screen designed for TVs in the office lobby. Shows customer codes (not names — privacy requirement) and their assigned station numbers. Updates within seconds via polling when a clerk summons a customer.

---

## Architecture Decisions

| Decision | What We Chose | Why |
|----------|--------------|-----|
| Frontend structure | 3 separate React apps (Chatbot, Staff, Display) | Different auth requirements, independent deployment, smaller bundles |
| Backend | Single API Gateway + domain-grouped Lambda functions | Clean separation without infrastructure sprawl at MVP scale |
| Real-time | Polling (REST endpoints, 2-5s intervals) | No sub-second push needed; eliminates WebSocket infrastructure, connection management, and reconnect logic. Can add WebSocket later if scale demands it. |
| AI | Amazon Bedrock (Converse API + Multimodal) | Managed service, no model hosting, supports both text and image/OCR |
| AI knowledge | Prompt-switching for transactions + Bedrock Knowledge Bases for general Q&A | Transactional flows use deterministic DB-driven prompts; general website Q&A uses managed RAG as fallback |
| Database | DynamoDB single-table design, tenant-prefixed keys | Structural multi-tenant isolation — impossible to accidentally query across counties |
| Document storage | S3 with presigned URLs | Avoids API Gateway 10MB payload limit, decouples upload from processing |
| Notifications | Twilio (SMS) + SendGrid (email) | Industry standard, reliable delivery, per-tenant configuration |
| Infrastructure as Code | AWS CDK (TypeScript) | CDK is TypeScript-first; best docs, fastest access to new constructs, matches backend language |
| Multi-tenancy | Tenant ID as DynamoDB partition key prefix | New county = new tenant ID, zero code changes, data isolation by design |

---

## Multi-Tenancy

The platform is built for St. Lucie County but designed so any Florida county can onboard by creating a new tenant ID. Each tenant gets:
- Their own locations, clerks, transaction types, and configuration
- Isolated data (structurally impossible to see another county's data)
- Ability to override global defaults (e.g., different transaction durations, different pre-screening questions)

Global templates (transaction types, pre-screening questions) provide sensible defaults. Each county can override any template for their specific needs.

No separate infrastructure is needed per county — same tables, same code, same deployment.

---

## Data & Privacy

- All PII (customer records, session data, uploaded documents) expires automatically after 30 days via DynamoDB TTL
- Customer codes (not names) are used on the lobby display
- All data encrypted at rest and in transit
- Cognito handles clerk/admin authentication with JWT tokens
- Every API request is scoped to the caller's tenant — enforced at the data access layer
