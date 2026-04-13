# User Stories — Clerk Journey

## Epic C1: Customer Check-In (Check-In Mode)

### US-C1-01: QR Code Check-In
**As a** Clerk in check-in mode, **I want to** scan a customer's QR code to pull up their appointment, **so that** I can quickly see their pre-screening status and documents.

**Acceptance Criteria**:
1. Clerk scans QR code using device camera or barcode reader
2. System displays customer record with appointment details
3. Pre-screening completeness is shown via status indicator (green = all done, yellow = partial, red = not started)
4. Uploaded documents are listed with view capability
5. If QR code is invalid or expired, system shows clear error message

**Requirements**: FR-CLERK-02, FR-CLERK-03

---

### US-C1-02: Name Lookup Check-In
**As a** Clerk in check-in mode, **I want to** look up a customer by name when they don't have a QR code, **so that** walk-ins and customers who lost their code can still check in.

**Acceptance Criteria**:
1. Clerk enters customer name in search field
2. System returns matching records (appointment-based and walk-in)
3. Clerk selects the correct customer from results
4. Same customer record view as QR code check-in
5. If no match found, clerk can create a new walk-in record

**Requirements**: FR-CLERK-02

---

## Epic C2: Queue Assignment (Check-In Mode)

### US-C2-01: Regular Queue Assignment
**As a** Clerk in check-in mode, **I want to** place a customer in the regular queue, **so that** they are served in FIFO order by the next available skilled clerk.

**Acceptance Criteria**:
1. Default queue assignment is "regular"
2. Customer enters FIFO queue filtered by required skill/transaction type
3. System matches customer's transaction type to available clerks with that skill
4. Customer receives queue number and estimated wait time
5. If pre-screening is incomplete, customer is NOT placed in queue (see US-C2-04)

**Requirements**: FR-CLERK-09

---

### US-C2-02: Priority Queue Assignment
**As a** Clerk in check-in mode, **I want to** assign a customer to the priority queue, **so that** they are moved ahead of regular queue customers for the next available skilled clerk.

**Acceptance Criteria**:
1. Clerk selects "Priority" queue type at check-in
2. Customer is placed ahead of all regular queue customers
3. Multiple priority customers are served in FIFO order among themselves
4. Skill matching still applies — customer is routed to a clerk with the right skills
5. Priority assignment is logged for audit purposes

**Requirements**: FR-CLERK-09

---

### US-C2-03: Assigned-to-Clerk Queue Assignment
**As a** Clerk in check-in mode, **I want to** assign a customer to a specific service clerk, **so that** returning customers can see the same clerk who is familiar with their case.

**Acceptance Criteria**:
1. Clerk selects "Assigned to Clerk" queue type at check-in
2. Clerk selects the target service clerk from a list of currently logged-in clerks
3. Customer waits until that specific clerk is available (not routed to anyone else)
4. If the assigned clerk logs out or becomes unavailable, system alerts the check-in clerk to reassign
5. Assignment reason can optionally be noted

**Requirements**: FR-CLERK-09

---

### US-C2-04: Pre-Screening Gate for Queue Entry
**As a** Clerk in check-in mode, **I want** the system to prevent queue placement until pre-screening is complete, **so that** counter time isn't wasted on paperwork.

**Acceptance Criteria**:
1. If pre-screening is incomplete, "Place in Queue" button is disabled
2. Clerk sees which questions remain unanswered
3. Clerk can send remaining questions to customer's phone via SMS (see US-C3-01)
4. Once customer completes questions (via SMS), they are automatically placed in queue
5. Clerk dashboard updates in real time when customer completes pre-screening

**Requirements**: FR-CLERK-08, FR-CLERK-03

---

## Epic C3: Document Review & SMS at Check-In (Check-In Mode)

### US-C3-01: Send Pre-Screening Questions via SMS
**As a** Clerk in check-in mode, **I want to** send incomplete pre-screening questions to the customer's phone, **so that** they can finish in the lobby without holding up the check-in line.

**Acceptance Criteria**:
1. Clerk clicks "Send Questions" button on customer record
2. SMS is sent to customer's phone number via Twilio
3. Only unanswered questions are sent (not ones already completed online)
4. Customer can answer questions via the SMS link
5. Clerk tells customer to "have a seat and finish on your phone"
6. System auto-queues customer upon completion (no return to front desk)

**Requirements**: FR-CLERK-07, FR-NOTIF-03

---

### US-C3-02: Document Review at Check-In
**As a** Clerk in check-in mode, **I want to** review documents the customer uploaded online, **so that** I can verify them before the customer reaches the service desk.

**Acceptance Criteria**:
1. Uploaded documents are displayed in the customer record
2. Clerk can view each document (image viewer / PDF viewer)
3. Documents flagged as "needed at check-in" (bypass customers) are highlighted
4. Clerk can upload additional documents from their device if customer brought physical copies
5. Document status updates are visible to the service clerk

**Requirements**: FR-CLERK-05

---

## Epic C4: Daily Login & Station Selection (Service Mode)

### US-C4-01: Office and Station Selection at Login
**As a** Clerk, **I want to** select my office and station number when I log in each day, **so that** the system knows where I'm working and can route customers to me.

**Acceptance Criteria**:
1. After Cognito authentication, clerk is prompted to select office from their tenant's locations
2. Clerk selects a station number at that office
3. Station selection determines whether clerk is in check-in mode or service mode
4. Clerk can change office/station during the day (e.g., moved by admin)
5. System prevents two clerks from selecting the same station simultaneously
6. Clerk's skill/transaction type mappings are loaded from their profile

**Requirements**: FR-CLERK-01

---

## Epic C5: Queue Management & Availability (Service Mode)

### US-C5-01: Availability Toggle
**As a** Clerk in service mode, **I want to** toggle myself in/out of the queue, **so that** I can take breaks or handle non-queue tasks without receiving new customers.

**Acceptance Criteria**:
1. Clerk sees a clear in/out toggle on their dashboard
2. When toggled "out," clerk stops receiving auto-assigned customers
3. When toggled "in," clerk re-enters the assignment pool
4. Current customer transaction is not affected by toggling out
5. Toggle state is visible to other clerks and admins

**Requirements**: FR-CLERK-10

---

### US-C5-02: Summon Next Customer
**As a** Clerk in service mode, **I want to** summon the next customer from the queue, **so that** I can begin processing their transaction.

**Acceptance Criteria**:
1. Clerk clicks "Summon Next" button
2. System auto-assigns the next customer based on: (a) assigned-to-clerk matches first, (b) priority queue next, (c) regular FIFO queue last
3. Assignment considers clerk's skill/transaction type mappings
4. Clerk cannot cherry-pick — system decides who is next
5. Customer receives SMS with station number
6. Public display updates with customer code and station number
7. Customer record with all documents, pre-screening answers, and notes loads on clerk's screen

**Requirements**: FR-CLERK-11, FR-CLERK-12

---

## Epic C6: Transaction Processing (Service Mode)

### US-C6-01: Process Customer Transaction
**As a** Clerk in service mode, **I want to** see all customer information (documents, pre-screening answers, notes) on one screen, **so that** I can process the transaction quickly.

**Acceptance Criteria**:
1. Customer record displays: identity info (from OCR), pre-screening answers, uploaded documents, customer notes, transaction type(s)
2. Clerk can view each document inline
3. Pre-screening answers are displayed in a readable format
4. Customer notes from previous visits are visible
5. For multi-transaction appointments, all transaction types are listed with their status

**Requirements**: FR-CLERK-04, FR-CLERK-05, FR-CLERK-06

---

### US-C6-02: Complete Appointment
**As a** Clerk in service mode, **I want to** mark a transaction as complete, **so that** the customer is removed from the queue and the system records the transaction.

**Acceptance Criteria**:
1. Clerk clicks "Complete Appointment" button
2. Transaction is marked as completed with timestamp
3. Customer is removed from the queue and display
4. Actual duration is recorded (for duration monitoring analytics)
5. Clerk's screen returns to ready state

**Requirements**: FR-CLERK-13

---

### US-C6-03: Complete and Summon Next
**As a** Clerk in service mode, **I want to** complete the current transaction and immediately summon the next customer, **so that** I can maintain throughput without extra clicks.

**Acceptance Criteria**:
1. Clerk clicks "Complete and Summon" button
2. Current transaction is completed (same as US-C6-02)
3. Next customer is immediately auto-assigned and summoned (same as US-C5-02)
4. Transition is seamless — clerk sees next customer's record load while previous customer leaves
5. If no customers are in queue, clerk sees "No customers waiting" message

**Requirements**: FR-CLERK-14

---

### US-C6-04: Send to Written Test
**As a** Clerk in service mode, **I want to** send a customer to a specific station for a written test, **so that** they can complete the test as part of their DL transaction.

**Acceptance Criteria**:
1. Clerk selects "Send to Written Test" action
2. Clerk selects or system assigns the test station
3. Customer receives SMS with test station number
4. Customer's queue status updates to "In Written Test"
5. After test completion, customer returns to queue for the same clerk or re-enters regular queue

**Requirements**: FR-CLERK-15

---

### US-C6-05: Customer Notes
**As a** Clerk, **I want to** add notes to a customer's record, **so that** other clerks can see relevant context on future visits.

**Acceptance Criteria**:
1. Clerk can add free-text notes from the customer record view
2. Notes are persistent across visits and visible to all clerks
3. Notes display the author clerk name and timestamp
4. Notes are visible in both check-in mode and service mode
5. Previous notes are displayed in reverse chronological order

**Requirements**: FR-CLERK-06

---

### US-C6-06: Upload Documents to State System
**As a** Clerk in service mode, **I want to** transfer customer documents to the state system (Orion), **so that** the transaction is perfected in the state's records.

**Acceptance Criteria**:
1. Clerk can access customer's uploaded documents from the transaction view
2. Documents can be downloaded or opened for drag-and-drop to Orion
3. Clerk marks documents as "sent to state" after manual upload
4. This is a manual process in MVP (no direct Orion API integration just stub this please).

**Requirements**: FR-CLERK-16
