# User Stories — Admin Journey

## Epic E1: Location Management

### US-E1-01: Manage Office Locations
**As an** Admin, **I want to** create and configure office locations, **so that** the scheduling engine and clerk assignments reflect my actual offices.

**Acceptance Criteria**:
1. Admin can create a new location with: name, address, hours of operation, number of stations
2. Admin can set a capacity run-rate percentage per office (single value, applies all day)
3. Admin can configure lunch shift periods per office (affects scheduling capacity)
4. Admin can edit or deactivate existing locations
5. Changes to location config are reflected in the scheduling engine immediately
6. Location data is tenant-scoped (admin sees only their county's locations)

**Requirements**: FR-ADMIN-01, FR-ADMIN-06, FR-ADMIN-10

---

## Epic E2: Transaction Type Management

### US-E2-01: Configure Transaction Types
**As an** Admin, **I want to** manage transaction types with their durations and availability, **so that** the chatbot and scheduling engine use accurate information.

**Acceptance Criteria**:
1. Admin can create a transaction type with: name, description/metadata, average duration, service hours
2. Admin can set which locations offer each transaction type
3. Admin can set status: active (available to customers), inactive (hidden from all), hidden (not shown in hot buttons but accessible via conversation)
4. Admin can edit existing transaction types
5. Duration changes are reflected in future scheduling calculations
6. Transaction types inherit from global templates but can be customized per tenant

**Requirements**: FR-ADMIN-02

---

## Epic E3: Clerk Management & Onboarding

### US-E3-01: Manual Clerk Onboarding
**As an** Admin, **I want to** add new clerks to the system with their skills, **so that** they can log in and start serving customers.

**Acceptance Criteria**:
1. Admin enters clerk details: name, email, default office assignment
2. Admin assigns skill/transaction type mappings (which transaction types this clerk can handle)
3. Admin sets status: active, inactive, or training
4. System creates Cognito account and sends invitation email
5. Clerk is scoped to the admin's tenant

**Requirements**: FR-ADMIN-03, FR-ADMIN-04

---

### US-E3-02: Bulk Clerk Import via CSV
**As an** Admin, **I want to** upload a CSV file to onboard multiple clerks at once, **so that** I can set up a new office quickly.

**Acceptance Criteria**:
1. Admin uploads a CSV with columns: name, email, default office, skills, status
2. System validates the CSV format and content before processing
3. Validation errors are reported with row numbers and specific issues
4. Successfully validated clerks are created with Cognito accounts
5. Admin sees a summary of created/failed records after import
6. Duplicate emails are flagged as errors (not silently skipped)

**Requirements**: FR-ADMIN-04

---

## Epic E4: Duration Monitoring & Recommendations

### US-E4-01: Automated Duration Analysis
**As an** Admin, **I want** the system to automatically analyze actual vs. configured transaction durations, **so that** I know when my estimates are drifting.

**Acceptance Criteria**:
1. System periodically analyzes completed transaction durations vs. configured averages
2. When actual average drifts beyond a configurable threshold, an alert is generated
3. Alert includes: transaction type, configured duration, actual average, sample size, per-location breakdown
4. Confidence indicator shows whether sample size is sufficient for reliable recommendation
5. Admin sees alerts on the dashboard with recommended new duration value
6. Admin can accept (updates configured duration), dismiss (ignores this alert)

**Requirements**: FR-ADMIN-05

---

## Epic E5: Pre-Screening Question Configuration

### US-E5-01: Manage Pre-Screening Questions
**As an** Admin, **I want to** configure pre-screening questions per transaction type, **so that** customers are asked the right questions for their specific transaction.

**Acceptance Criteria**:
1. Admin can add, edit, reorder, and remove questions per transaction type
2. Questions support multiple answer types (yes/no, multiple choice, free text)
3. Admin can mark questions as required or optional
4. Changes to questions apply to new conversations (not in-progress ones)
5. Questions inherit from global templates but can be customized per tenant
6. Admin can preview the question flow as a customer would see it

**Requirements**: FR-ADMIN-08

---

## Epic E6: System Configuration

### US-E6-01: Hot-Button Configuration
**As an** Admin, **I want to** configure the chatbot's landing page hot-button prompts, **so that** the most relevant transaction types are highlighted for my customers.

**Acceptance Criteria**:
1. Admin can view and edit the global default set of 3-4 hot-button prompts
2. Each prompt has a display label and maps to a transaction type
3. Admin can reorder prompts
4. Changes are reflected on the chatbot landing page immediately
5. Hot buttons are global defaults but can be customized per tenant

**Requirements**: FR-ADMIN-07

---

### US-E6-02: Online Checkout URL Configuration
**As an** Admin, **I want to** configure the external payment URL for online checkout redirect, **so that** eligible customers are sent to the correct payment portal.

**Acceptance Criteria**:
1. Admin can set the online checkout redirect URL (e.g., MyEasyGov URL)
2. URL is configurable per tenant
3. Chatbot uses this URL when redirecting eligible customers
4. Admin can test the URL from the configuration screen

**Requirements**: FR-ADMIN-09

---

# User Stories — Public Display

## Epic F1: Queue Display Screen

### US-F1-01: Public Queue Display
**As a** Customer in the lobby, **I want to** see a display showing which customer codes are being called to which stations, **so that** I know when and where to go.

**Acceptance Criteria**:
1. Display shows customer code/number and assigned station number
2. No customer names are shown (privacy)
3. Display updates in real time when a clerk summons a customer (within 2 seconds)
4. Most recently summoned customer is highlighted
5. Display is a web page that can run on any screen/TV in the office
6. Display is scoped to the current office location
7. Display polls for state updates at 2-5s intervals and renders the latest response (NFR-AVAIL-04)

**Requirements**: FR-DISPLAY-01, FR-DISPLAY-02, NFR-AVAIL-04

---

# User Stories — Cross-Cutting

## Epic G1: Authentication & Authorization

### US-G1-01: Public Chatbot Access (No Auth)
**As a** Customer, **I want to** use the chatbot without creating an account, **so that** there's no barrier to getting started.

**Acceptance Criteria**:
1. Chatbot is accessible without login or account creation
2. Session-based identity tracks the conversation
3. Customer provides phone number and email during the flow (for notifications), not for authentication
4. No PII is stored without the customer initiating a transaction flow

**Requirements**: FR-AUTH-01

---

### US-G1-02: Clerk Authentication
**As a** Clerk, **I want to** log in with my email and password, **so that** I can access the clerk dashboard securely.

**Acceptance Criteria**:
1. Clerk logs in via Cognito email/password
2. After authentication, clerk selects office and station
3. JWT token is issued and used for all subsequent API calls
4. Session expires after configurable inactivity period
5. Clerk can only access data within their tenant

**Requirements**: FR-AUTH-02, FR-AUTH-05, FR-AUTH-06

---

### US-G1-03: Admin Authentication & RBAC
**As an** Admin, **I want to** log in and see only my county's data, **so that** tenant isolation is enforced.

**Acceptance Criteria**:
1. Admin logs in via Cognito email/password with admin role
2. JWT includes tenant ID and role claims
3. All API calls enforce tenant-scoped access
4. Admin cannot see or modify other counties' data
5. Super admin role can access all tenants (future — architecture supports it)

**Requirements**: FR-AUTH-03, FR-AUTH-04, FR-AUTH-06

---

## Epic G2: Multi-Tenancy & Data Isolation

### US-G2-01: Tenant-Scoped Data Access
**As a** platform operator, **I want** all data to be isolated by tenant, **so that** one county's data is never visible to another county.

**Acceptance Criteria**:
1. Every data record includes a tenant ID
2. All queries filter by tenant ID (enforced at the data access layer, not just the API layer)
3. Global configuration (transaction type templates, state questions) is shared read-only
4. Tenant-specific configuration overrides global defaults
5. Clerk and admin users are scoped to exactly one tenant
6. API authorization rejects cross-tenant requests

**Requirements**: NFR-TENANT-01, NFR-TENANT-03, NFR-TENANT-04

---

## Epic G3: Notifications

### US-G3-01: SMS Notification Delivery
**As a** Customer, **I want to** receive SMS notifications at key points, **so that** I stay informed without checking the app.

**Acceptance Criteria**:
1. Appointment confirmation SMS sent after booking (includes date, time, location)
2. Queue entry SMS sent after entering queue (includes queue number, estimated wait)
3. "You're next" SMS sent when customer is next in line
4. Summon SMS sent when clerk calls customer (includes station number)
5. All SMS sent via Twilio
6. Failed delivery is logged but does not block the workflow

**Requirements**: FR-NOTIF-01

---

### US-G3-02: Email Notification Delivery
**As a** Customer, **I want to** receive an email confirmation with my QR code, **so that** I have a permanent record of my appointment.

**Acceptance Criteria**:
1. Confirmation email sent after appointment booking
2. Email includes: QR code image, date, time, location, transaction type(s), document reminders
3. Email sent via Twilio/SendGrid
4. Failed delivery is logged but does not block the workflow

**Requirements**: FR-NOTIF-02

---

## Epic G4: Lien Transfer Letter

### US-G4-01: Auto-Generate Lien Transfer Letter
**As a** Customer transferring an out-of-state vehicle with a lien, **I want** the system to generate a letter I can send to my lien holder, **so that** I can get the lien release without figuring out the process myself.

**Acceptance Criteria**:
1. During the chatbot flow, if customer indicates out-of-state vehicle with existing lien, system offers to generate a lien transfer letter
2. Letter is generated from a template populated with customer and vehicle data
3. Customer can view and download the letter as a PDF
4. Letter is also sent via email
5. Letter template is configurable by admin

**Requirements**: FR-CHAT-14
