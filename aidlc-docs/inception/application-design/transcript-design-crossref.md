# Transcript ↔ Application Design Cross-Reference

**Date**: 2026-04-06
**Source**: st-lucie-tax-2026-04-01.vtt (1460 lines)
**Compared Against**: All application design artifacts (application-design.md, components.md, component-methods.md, services.md, component-dependency.md, system-overview.md) and requirements.md

---

## Summary

| Category | Count |
|----------|-------|
| Confirmed (design matches transcript) | 32 |
| Gaps (transcript mentions, design missing/weak) | 6 |
| Mismatches (design diverges from transcript intent) | 2 |
| Deferred by design (explicitly stubbed/out-of-scope) | 5 |

---

## GAPS — Transcript Requirements Not Fully Addressed in Design

### GAP-1: Bypass / Skip Option in Chatbot Flow
**Transcript**: The Tax Collector explicitly states customers should be able to "bypass some of these steps" — they may not be comfortable uploading documents or answering all questions. (~L560-565)
**Design**: FR-CHAT-08 mentions a bypass option for document upload with a warning. But the state machine design in BC-01 and SVC-01 doesn't describe a general bypass mechanism across states (e.g., skipping pre-screening, skipping identity verification). The state machine flow in system-overview.md is described as strictly sequential.
**Impact**: Medium. Without bypass paths, customers who refuse to upload docs or verify identity have no way to proceed to scheduling. The transcript is clear this should be possible — just with a warning and a flag on the appointment.
**Recommendation**: Add a `skip_state(session_id, state_name)` method to BC-01 that advances the state machine while flagging the appointment as "incomplete pre-work." Define which states are skippable (document upload, pre-screening) vs. mandatory (transaction identification, scheduling).

### GAP-2: SMS-Based Pre-Screening Completion → Auto-Queue (Walk-In Flow)
**Transcript**: The Tax Collector describes a flow where a walk-in customer who hasn't completed pre-screening is sent questions via SMS. Once they finish on their phone, they're automatically placed in the queue — no need to return to the front desk. (~L769-775, L830-835)
**Design**: FR-CLERK-08 captures this requirement. BC-04 has `send_prescreening_sms()`. But there's no component or method that handles the inbound SMS completion webhook. When the customer finishes pre-screening via SMS, something needs to detect completion and call `assign_queue()` automatically. The services doc (SVC-02) mentions "auto-queue via assign_queue() triggered by pre-screening completion" but doesn't specify the trigger mechanism.
**Impact**: Medium. This is a core walk-in workflow. Without the trigger, clerks would have to manually check and queue customers.
**Recommendation**: Add an SMS webhook handler (likely in BC-01 or BC-04) that receives Twilio inbound SMS responses, matches them to a session, updates pre-screening answers, and on completion calls `assign_queue()` + sends queue confirmation SMS. Alternatively, the SMS link could open a web form that calls the chatbot API directly.

### GAP-3: Kiosk / Walk-In Self-Service Entry Point
**Transcript**: The Tax Collector describes walk-ins scanning a QR code at the office to join the queue. The Service Corp COO/CTO elaborates on a self-service kiosk flow. (~L595, FR-SCHED-07)
**Design**: FR-SCHED-07 mentions "self-service kiosk or QR code scan at office." FC-01 (Chatbot App) lists "Support walk-in kiosk entry (QR code scan → chatbot on phone)" in responsibilities. But there's no design for what the kiosk actually is — is it the chatbot app on a tablet? A separate minimal UI? How does the QR code at the kiosk work (does it link to the chatbot with a location parameter)?
**Impact**: Low-Medium. The concept is acknowledged but the implementation path is vague. Could be as simple as a URL with query params, but should be explicitly designed.
**Recommendation**: Clarify in FC-01 that the kiosk is the Chatbot App loaded on a tablet with a `?location=loc1&mode=walkin` parameter, which pre-fills the location and skips the location selection in scheduling. Or define a separate minimal kiosk UI.

### GAP-4: Service Hours Per Transaction Type
**Transcript**: The Tax Collector explicitly states "not every transaction is provided all day long" — e.g., road tests stop 30 minutes before close. (~L680-685)
**Design**: FR-ADMIN-02 includes "service hours" and "location availability" for transaction types. The DynamoDB schema has `TXNTYPE` metadata. But the scheduling engine (BC-05 `get_available_slots`) doesn't explicitly mention filtering by transaction-type service hours — it considers clerk skills, office hours, lunch breaks, and capacity, but not per-transaction-type time windows.
**Impact**: Medium. If road tests are only available 8am-4:30pm but the office is open until 5pm, the scheduler could book a road test at 4:45pm.
**Recommendation**: Add transaction-type service hours as a filter in `get_available_slots()`. The data is already in the schema (FR-ADMIN-02); the scheduling algorithm just needs to intersect available slots with the transaction type's service window.

### GAP-5: Concealed Weapons Permitting — Location-Specific Transaction Availability
**Transcript**: The Tax Collector says "we only do concealed weapons permitting at one office, so it would only be available there." (~L685)
**Design**: FR-ADMIN-02 includes "location availability" per transaction type. The schema supports this. But the chatbot flow (BC-01) doesn't describe how it handles a customer requesting a transaction that's only available at certain locations — does it filter the location options during scheduling, or does it inform the customer earlier?
**Impact**: Low. The data model supports it. This is more of a UX flow question for the chatbot state machine.
**Recommendation**: In the scheduling state of BC-01, filter available locations to only those that offer the requested transaction type(s). If only one location qualifies, inform the customer proactively.

### GAP-6: CDK in Python (Not TypeScript)
**Transcript**: User explicitly answered Q8 with "A (cdk in python please)."
**Design**: application-design.md says "AWS CDK (TypeScript)" in the architectural decisions table. system-overview.md also says "AWS CDK (TypeScript)." The application-design-plan.md correctly records the answer as "A (cdk in python please)" but the generated artifacts didn't honor it.
**Impact**: High. This is a direct contradiction of the user's stated preference.
**Recommendation**: Update all references from "CDK (TypeScript)" to "CDK (Python)" in application-design.md and system-overview.md.

---

## MISMATCHES — Design Diverges from Transcript Intent

### MISMATCH-1: IaC Language — CDK TypeScript vs. CDK Python
**Transcript/User Answer**: "A (cdk in python please)" — user explicitly requested Python CDK.
**Design**: All artifacts say "AWS CDK (TypeScript)" with rationale "CDK is TypeScript-first; best docs, fastest access to new constructs, matches backend language."
**Resolution**: Change to CDK Python. The rationale about "matches backend language" is incorrect if the user wants Python. Update application-design.md and system-overview.md.

### MISMATCH-2: Data Access Layer Language
**Design**: SI-03 is described as a "TypeScript shared module" and system-overview.md says CDK TypeScript "matches backend language."
**Implication**: If CDK is Python, is the backend Lambda code also intended to be Python? The transcript doesn't specify Lambda runtime language — only CDK language. This needs clarification. The design currently assumes TypeScript for Lambda code (SI-03 described as TypeScript module, component-methods use TypeScript conventions).
**Resolution**: Clarify with user whether Lambda runtime should also be Python (to match CDK) or remain TypeScript. This affects SI-03 and all Lambda function implementations.

---

## DEFERRED BY DESIGN (Correctly Stubbed/Out-of-Scope)

| Item | Transcript Reference | Design Status |
|------|---------------------|---------------|
| AuthID / Clear identity verification | Service Corp COO/CTO ~L500-510 | Out of scope (MVP), stub endpoint designed for swap (TC-07) |
| IDR fraud detection for out-of-state titles | Service Corp COO/CTO ~L370-390 | Out of scope (MVP), extensibility point documented in BC-02 |
| Orion state system direct upload | Service Corp COO/CTO ~L1000-1010 | Out of scope (MVP), manual drag-and-drop (FR-CLERK-16) |
| Vehicle/vessel lookup by customer GUID | Service Corp COO/CTO ~L990-1000 | Out of scope (MVP), stubbed (TC-06) |
| SSO / federated identity | Tax Collector ~L700 | Out of scope (MVP) |

---

## CONFIRMED — Design Correctly Addresses Transcript

| # | Transcript Requirement | Design Coverage |
|---|----------------------|-----------------|
| 1 | Chatbot IS the website, not a widget | FR-CHAT-01, FC-01 |
| 2 | Hot-button suggested prompts | FR-CHAT-02, FR-ADMIN-07, BC-03 `update_hot_buttons()` |
| 3 | NLP transaction identification | FR-CHAT-03, BC-01 `identify_transaction()` |
| 4 | DL photo upload + OCR extraction | FR-CHAT-04, BC-02 `process_dl_photo()` |
| 5 | Pre-screening after identity verification | FR-CHAT-06, state machine order in SVC-01 |
| 6 | Transaction-specific pre-screening questions | FR-CHAT-07, FR-ADMIN-08, BC-03 `manage_prescreening_questions()` |
| 7 | Document upload with AI validation | FR-CHAT-08, BC-02 `validate_document()` |
| 8 | Online checkout redirect | FR-CHAT-09, BC-01 `check_checkout_eligibility()`, FR-ADMIN-09 |
| 9 | Scheduling: morning/afternoon, day, location, ASAP | FR-CHAT-10, FR-SCHED-02, BC-05 `get_available_slots()` |
| 10 | QR code on confirmation | FR-CHAT-11, BC-05 `generate_qr_code()` |
| 11 | Multi-transaction appointments with summed durations | FR-CHAT-13, FR-SCHED-03 |
| 12 | Lien transfer letter generation | FR-CHAT-14, BC-06 `generate_lien_letter()` |
| 13 | Location management (hours, seats, capacity run-rate) | FR-ADMIN-01, BC-03 location CRUD |
| 14 | Transaction type management (duration, description, status) | FR-ADMIN-02, BC-03 transaction type CRUD |
| 15 | Clerk management (skills, office assignment) | FR-ADMIN-03, BC-03 clerk CRUD |
| 16 | CSV bulk import for clerks | FR-ADMIN-04, BC-03 `import_clerks_csv()` |
| 17 | Duration monitoring with recommendations | FR-ADMIN-05, SVC-05, trimmed mean algorithm |
| 18 | Lunch shift configuration | FR-ADMIN-06, location config |
| 19 | Clerk daily login with office/station selection | FR-CLERK-01, BC-04 `select_station()` |
| 20 | QR code check-in + name lookup | FR-CLERK-02, BC-04 `check_in_qr()` / `check_in_name()` |
| 21 | Pre-screening completeness indicator | FR-CLERK-03, green/yellow/red in SVC-02 |
| 22 | Customer notes (persistent, cross-visit) | FR-CLERK-06, BC-04 `add_note()` / `get_notes()` |
| 23 | SMS pre-screening to customer phone | FR-CLERK-07, BC-04 `send_prescreening_sms()` |
| 24 | Three queue types (regular, priority, assigned) | FR-CLERK-09, BC-04 `assign_queue()` |
| 25 | No cherry-picking — auto-assign based on skills | FR-CLERK-11, BC-04 `summon_next()` |
| 26 | Summon via SMS + public display | FR-CLERK-12, SVC-03, BC-06 |
| 27 | Complete and Summon (atomic) | FR-CLERK-14, BC-04 `complete_and_summon()` |
| 28 | Send to written test | FR-CLERK-15, BC-04 `send_to_written_test()` |
| 29 | Dynamic scheduling (no static blocks) | FR-SCHED-01, on-demand calculation in BC-05 |
| 30 | Walk-in support | FR-SCHED-07, BC-05 `enter_walkin_queue()` |
| 31 | Public display (codes, not names) | FR-DISPLAY-01, FC-03 |
| 32 | Twilio SMS + SendGrid email | FR-NOTIF-01/02, BC-06, TC-03 |
