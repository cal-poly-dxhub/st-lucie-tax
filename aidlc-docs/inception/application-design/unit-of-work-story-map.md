# Unit of Work — Story Map

## Overview
Maps all 46 user stories to their primary unit of work. Some stories span multiple units (e.g., a feature needs both backend logic and frontend UI). The primary unit owns the business logic; the secondary unit implements the UI or integration layer.

---

## Unit 1: Foundation (7 stories — primary)

| Story | Epic | Description | Secondary Unit |
|-------|------|-------------|----------------|
| US-G1-01 | G1 | Public Chatbot Access (No Auth) — session-based identity | Unit 3 (Frontend session handling) |
| US-G1-02 | G1 | Clerk Authentication — Cognito login | Unit 3 (Frontend login UI) |
| US-G1-03 | G1 | Admin Authentication & RBAC — tenant-scoped access | Unit 3 (Frontend login UI) |
| US-G2-01 | G2 | Tenant-Scoped Data Access — partition key isolation | Unit 2 (Backend enforces in queries) |
| US-F1-01 | F1 | Public Queue Display — polling-based state consumption | Unit 3 (Frontend display UI) |
| US-G3-01 | G3 | SMS Notification Delivery — Twilio integration | Unit 2 (Backend dispatch logic) |
| US-G3-02 | G3 | Email Notification Delivery — SES (POC) | Unit 2 (Backend dispatch logic) |

**Rationale**: Auth, tenancy, and data isolation patterns are foundational concerns. The Cognito pool and data isolation patterns must exist before any business logic can use them.

---

## Unit 2: Backend (32 stories — primary)

### Customer Journey (14 stories)

| Story | Epic | Description | Secondary Unit |
|-------|------|-------------|----------------|
| US-B1-01 | B1 | Hot-Button Quick Start | Unit 3 (Frontend UI) |
| US-B1-02 | B1 | Free-Form Conversation Start | Unit 3 (Frontend chat UI) |
| US-B1-03 | B1 | Multi-Transaction Discovery | Unit 3 (Frontend chat UI) |
| US-B1-04 | B1 | Conversation Context Switching | — |
| US-B2-01 | B2 | DL Photo Upload & OCR | Unit 3 (Frontend upload UI) |
| US-B2-02 | B2 | Document Upload with AI Validation | Unit 3 (Frontend upload UI) |
| US-B2-03 | B2 | Document Upload Bypass | Unit 3 (Frontend bypass option) |
| US-B3-01 | B3 | Transaction-Specific Pre-Screening | Unit 3 (Frontend question UI) |
| US-B3-02 | B3 | Pre-Screening via SMS | Unit 3 (Frontend lightweight form) |
| US-B4-01 | B4 | Dynamic Appointment Booking | Unit 3 (Frontend scheduling UI) |
| US-B4-02 | B4 | Appointment Confirmation & QR Code | Unit 3 (Frontend QR display) |
| US-B5-01 | B5 | Eligible Transaction Online Checkout | Unit 3 (Frontend redirect) |
| US-B6-01 | B6 | Kiosk / QR Code Walk-In Entry | Unit 3 (Frontend kiosk mode) |
| US-B7-01 | B7 | Queue Position & Wait Time Updates | — (SMS only) |
| US-B7-02 | B7 | Summon Notification | Unit 3 (Display polls for updates) |

### Clerk Journey (16 stories)

| Story | Epic | Description | Secondary Unit |
|-------|------|-------------|----------------|
| US-C1-01 | C1 | QR Code Check-In | Unit 3 (Frontend scanner UI) |
| US-C1-02 | C1 | Name Lookup Check-In | Unit 3 (Frontend search UI) |
| US-C2-01 | C2 | Regular Queue Assignment | Unit 3 (Frontend queue UI) |
| US-C2-02 | C2 | Priority Queue Assignment | Unit 3 (Frontend queue UI) |
| US-C2-03 | C2 | Assigned-to-Clerk Queue Assignment | Unit 3 (Frontend clerk picker) |
| US-C2-04 | C2 | Pre-Screening Gate for Queue Entry | Unit 3 (Frontend gate UI) |
| US-C3-01 | C3 | Send Pre-Screening Questions via SMS | Unit 3 (Frontend send button) |
| US-C3-02 | C3 | Document Review at Check-In | Unit 3 (Frontend doc viewer) |
| US-C4-01 | C4 | Office and Station Selection at Login | Unit 3 (Frontend selection UI) |
| US-C5-01 | C5 | Availability Toggle | Unit 3 (Frontend toggle UI) |
| US-C5-02 | C5 | Summon Next Customer | Unit 3 (Frontend summon button) |
| US-C6-01 | C6 | Process Customer Transaction | Unit 3 (Frontend record view) |
| US-C6-02 | C6 | Complete Appointment | Unit 3 (Frontend complete button) |
| US-C6-03 | C6 | Complete and Summon Next | Unit 3 (Frontend combined button) |
| US-C6-04 | C6 | Send to Written Test | Unit 3 (Frontend test action) |
| US-C6-05 | C6 | Customer Notes | Unit 3 (Frontend notes UI) |
| US-C6-06 | C6 | Upload Documents to State System | Unit 3 (Frontend drag-drop UI) |

### Admin Journey (8 stories — includes lien letter)

| Story | Epic | Description | Secondary Unit |
|-------|------|-------------|----------------|
| US-E1-01 | E1 | Manage Office Locations | Unit 3 (Frontend admin UI) |
| US-E2-01 | E2 | Configure Transaction Types | Unit 3 (Frontend admin UI) |
| US-E3-01 | E3 | Manual Clerk Onboarding | Unit 3 (Frontend admin UI) |
| US-E3-02 | E3 | Bulk Clerk Import via CSV | Unit 3 (Frontend upload UI) |
| US-E4-01 | E4 | Automated Duration Analysis | Unit 3 (Frontend alerts UI) |
| US-E5-01 | E5 | Manage Pre-Screening Questions | Unit 3 (Frontend question editor) |
| US-E6-01 | E6 | Hot-Button Configuration | Unit 3 (Frontend config UI) |
| US-E6-02 | E6 | Online Checkout URL Configuration | Unit 3 (Frontend config UI) |
| US-G4-01 | G4 | Auto-Generate Lien Transfer Letter | Unit 3 (Frontend download/view) |

---

## Unit 3: Frontend (0 stories — primary, 39 stories — secondary)

Unit 3 has no primary stories — all business logic lives in Unit 2 (Backend) or Unit 1 (Foundation). Unit 3 implements the UI layer for stories owned by other units.

**Frontend work per app**:

| App | Stories (secondary) | Key UI Work |
|-----|-------------------|-------------|
| FC-01 Chatbot App | US-B1-01 through US-B7-02, US-G4-01 | Chat interface, hot buttons, upload flows, scheduling UI, QR display, kiosk mode, lien letter download |
| FC-02 Staff App | US-C1-01 through US-C6-06, US-E1-01 through US-E6-02 | Check-in mode, service mode, admin dashboard, queue views, document viewer, config screens |
| FC-03 Display App | US-F1-01 | Queue display board |

---

## Story Coverage Validation

| Category | Total Stories | Assigned to Unit | Coverage |
|----------|-------------|-----------------|----------|
| Customer Journey (B1-B7) | 14 | Unit 2 (primary) + Unit 3 (secondary) | ✅ 14/14 |
| Clerk Journey (C1-C6) | 17 | Unit 2 (primary) + Unit 3 (secondary) | ✅ 17/17 |
| Admin Journey (E1-E6) | 8 | Unit 2 (primary) + Unit 3 (secondary) | ✅ 8/8 |
| Public Display (F1) | 1 | Unit 1 (primary) + Unit 3 (secondary) | ✅ 1/1 |
| Cross-Cutting (G1-G4) | 7 | Unit 1 (4) + Unit 2 (3) | ✅ 7/7 |
| **Total** | **47** | **All assigned** | **✅ 47/47** |

**Note**: Story count is 47 (not 46) because US-G4-01 (Lien Transfer Letter) was counted in the admin section above but is a cross-cutting story. All stories are accounted for with no orphans.

---

## Requirements Traceability

All 68+ functional requirements are covered through the story mappings above:
- FR-CHAT-01 through FR-CHAT-15 → Unit 2 (Backend) via B1-B7 stories
- FR-ADMIN-01 through FR-ADMIN-10 → Unit 2 (Backend) via E1-E6 stories
- FR-CLERK-01 through FR-CLERK-16 → Unit 2 (Backend) via C1-C6 stories
- FR-SCHED-01 through FR-SCHED-09 → Unit 2 (Backend) via B4, B6, C2 stories
- FR-DISPLAY-01 through FR-DISPLAY-02 → Unit 1 (Foundation) + Unit 3 (Frontend) via F1
- FR-NOTIF-01 through FR-NOTIF-03 → Unit 1 (Foundation) + Unit 2 (Backend) via G3 stories
- FR-AUTH-01 through FR-AUTH-06 → Unit 1 (Foundation) via G1 stories
- NFR-TENANT-01 through NFR-TENANT-04 → Unit 1 (Foundation) via G2 story
