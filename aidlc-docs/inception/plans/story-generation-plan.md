# User Story Generation Plan

## Approach
Based on the requirements, this project has clear user personas with distinct workflows. A **Persona-Based** breakdown is the best fit — stories grouped by user type, with cross-cutting stories for shared concerns (notifications, scheduling engine).

## Execution Checklist

### Part A: Personas
- [x] Define Customer persona (two variants: prepared path via chatbot + walk-in path)
- [x] Define Clerk persona (two modes: check-in mode + service mode, rotates same day)
- [x] Define Admin persona (tenant-scoped office/clerk/transaction management)
- [x] Define Super Admin persona (cross-tenant management — future, but define now)
- [x] Save personas to `aidlc-docs/inception/user-stories/personas.md`

### Part B: User Stories — Customer Journey
- [x] Epic: Chatbot Conversation & Transaction Identification (B1: 4 stories)
- [x] Epic: Identity Verification & Document Upload (B2: 3 stories)
- [x] Epic: Pre-Screening Questions (B3: 2 stories)
- [x] Epic: Appointment Scheduling (B4: 2 stories)
- [x] Epic: Online Checkout Redirect (B5: 1 story)
- [x] Epic: Walk-In Self-Service Check-In (B6: 1 story)
- [x] Epic: In-Office SMS Interactions (B7: 2 stories)

### Part C: User Stories — Clerk Journey (Check-In Mode)
- [x] Epic: Customer Check-In (C1: 2 stories)
- [x] Epic: Queue Assignment (C2: 4 stories)
- [x] Epic: Document Review & SMS at Check-In (C3: 2 stories)

### Part D: User Stories — Clerk Journey (Service Mode)
- [x] Epic: Daily Login & Station Selection (C4: 1 story)
- [x] Epic: Queue Management & Availability Toggle (C5: 2 stories)
- [x] Epic: Transaction Processing incl. Complete/Summon/Written Test/Notes (C6: 6 stories)

### Part E: User Stories — Admin Journey
- [x] Epic: Location Management (E1: 1 story)
- [x] Epic: Transaction Type Management (E2: 1 story)
- [x] Epic: Clerk Management & Onboarding (E3: 2 stories)
- [x] Epic: Duration Monitoring & Recommendations (E4: 1 story)
- [x] Epic: Pre-Screening Question Configuration (E5: 1 story)
- [x] Epic: System Configuration (E6: 2 stories)

### Part F: User Stories — Public Display
- [x] Epic: Queue Display Screen (F1: 1 story)

### Part G: Cross-Cutting Stories
- [x] Epic: Authentication & Authorization (G1: 3 stories)
- [x] Epic: Multi-Tenancy & Data Isolation (G2: 1 story)
- [x] Epic: Notifications (G3: 2 stories)
- [x] Epic: Lien Transfer Letter (G4: 1 story)

### Part H: Finalize
- [x] Verify all stories meet INVEST criteria
- [x] Verify all stories have acceptance criteria
- [x] Map personas to stories
- [x] Save stories to `aidlc-docs/inception/user-stories/stories.md`

---

## Questions

### Persona Questions

## Question 1
For the Front Desk Clerk vs. Service Clerk — in the Tax Collector's offices, are these always different people, or does the same person sometimes work the front desk and sometimes work a service station?

A) Always separate roles — front desk staff only do check-in/triage, service clerks only process transactions
B) Same people, different days — a clerk might work front desk Monday and service desk Tuesday
C) Same people, same day — a clerk might check in customers and also process transactions depending on need
D) Other (please describe)

[Answer]: C

## Question 2
For story granularity, given this is an MVP that will be handed to a BOM partner, how detailed should acceptance criteria be?

A) High-level — "customer can schedule an appointment" with 2-3 acceptance criteria per story
B) Detailed — specific acceptance criteria covering happy path, edge cases, and error states (5-8 per story)
C) Comprehensive — BDD-style Given/When/Then for every scenario including all edge cases
D) Other (please describe)

[Answer]: B

## Question 3
The Tax Collector mentioned the system should handle customers who don't know exactly what they need (e.g., new resident who doesn't realize they need to renew registrations too). Should we create stories specifically for the "discovery" flow where the chatbot helps identify all needed transactions?

A) Yes — create dedicated discovery stories where the chatbot proactively identifies additional needed transactions
B) No — just handle it as part of the general conversation flow, no separate stories needed
C) Other (please describe)

[Answer]: A

## Question 4
For the walk-in self-service check-in (FR-SCHED-07), should the kiosk/QR experience be a separate persona or just a variant of the Customer persona?

A) Same Customer persona — walk-in is just an alternate entry point, same person
B) Separate "Walk-In Customer" persona — different characteristics and expectations than someone who booked online
C) Other (please describe)

[Answer]: A

---

Please fill in the `[Answer]:` tags above and let me know when you're done.
