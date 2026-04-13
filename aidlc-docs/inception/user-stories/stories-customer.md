# User Stories — Customer Journey

## Epic B1: Chatbot Conversation & Transaction Identification

### US-B1-01: Hot-Button Quick Start
**As a** Customer, **I want to** see 3-4 suggested prompts for common transactions when I open the chatbot, **so that** I can quickly start the most common flows without typing.

**Acceptance Criteria**:
1. Landing page displays 3-4 hot-button prompts (e.g., "Renew my driver license", "Transfer a vehicle title", "New Florida resident", "Renew registration")
2. Clicking a hot button starts the conversation for that transaction type
3. Hot buttons are configurable by admin (global defaults)
4. Customer can ignore hot buttons and type a free-form message instead
5. Hot buttons are visible on both desktop and mobile viewports

**Requirements**: FR-CHAT-02, FR-ADMIN-07

---

### US-B1-02: Free-Form Conversation Start
**As a** Customer, **I want to** describe what I need in my own words, **so that** the chatbot can figure out the right transaction type even if I don't know the official name.

**Acceptance Criteria**:
1. Customer can type a free-form message (e.g., "I just moved from New York and need to get a Florida license")
2. Chatbot identifies the correct transaction type(s) from the message
3. If the message is ambiguous, chatbot asks clarifying questions
4. Chatbot confirms the identified transaction type before proceeding
5. Conversation uses the transaction-type-specific system prompt once identified

**Requirements**: FR-CHAT-03, FR-CHAT-12

---

### US-B1-03: Multi-Transaction Discovery
**As a** Customer, **I want** the chatbot to proactively identify additional transactions I may need, **so that** I can handle everything in one visit instead of coming back.

**Acceptance Criteria**:
1. After identifying the primary transaction, chatbot checks for commonly associated transactions (e.g., new resident → DL transfer + vehicle title + registration)
2. Chatbot asks "Did you also need to [related transaction]?" for each relevant association
3. Customer can accept or decline each additional transaction
4. All accepted transactions are bundled into a single appointment
5. Total appointment duration reflects the sum of all selected transaction durations
6. Transaction associations are configurable per transaction type in admin

**Requirements**: FR-CHAT-13, FR-CHAT-03

---

### US-B1-04: Conversation Context Switching
**As a** Customer, **I want** the chatbot to handle my specific transaction type with relevant knowledge, **so that** the questions and guidance are accurate for what I need.

**Acceptance Criteria**:
1. System loads transaction-type-specific system prompt when transaction is identified
2. Prompt includes relevant document requirements, fees, and process steps from database config
3. If customer has multiple transactions, system maintains context for all of them
4. Chatbot does not ask questions irrelevant to the identified transaction type(s)
5. System prompt is assembled from structured database data at conversation start; general Q&A falls back to Bedrock Knowledge Base

**Requirements**: FR-CHAT-12, TC-05

---

## Epic B2: Identity Verification & Document Upload

### US-B2-01: Driver License Photo Upload & OCR
**As a** Customer, **I want to** upload a photo of my driver license so the system can extract my information, **so that** I don't have to manually type all my details.

**Acceptance Criteria**:
1. Chatbot prompts customer to upload a photo of their DL at the appropriate point in the flow
2. System extracts name, DOB, DL number, and address via Bedrock multimodal OCR
3. Extracted fields are displayed back to the customer for confirmation
4. Customer can correct any incorrectly extracted fields
5. OCR endpoint is wrapped in a swappable stub (designed for future state system replacement)
6. Upload accepts common image formats (JPEG, PNG) and PDF
7. Error message displayed if image is unreadable or not a DL

**Requirements**: FR-CHAT-04, FR-CHAT-05

---

### US-B2-02: Document Upload with AI Validation
**As a** Customer, **I want to** upload required documents and get immediate feedback on whether they're acceptable, **so that** I know before my appointment if something is wrong.

**Acceptance Criteria**:
1. Chatbot presents a list of required documents based on transaction type
2. Customer can upload each document (image or PDF)
3. Bedrock multimodal validates document type and basic quality (readable, correct document type)
4. If document is rejected, system explains why and asks customer to re-upload
5. If document is accepted, it's marked as complete in the customer's record
6. Upload status is visible to clerks in the check-in and service views

**Requirements**: FR-CHAT-08

---

### US-B2-03: Document Upload Bypass
**As a** Customer, **I want to** skip document upload and bring my documents to the office instead, **so that** I can still book an appointment even if I'm not comfortable uploading online.

**Acceptance Criteria**:
1. At the document upload step, customer sees an option "I'll bring them to my appointment"
2. Chatbot warns that skipping upload may increase time at the office
3. Appointment is flagged as "documents needed at check-in"
4. Flag is visible to the clerk at check-in (yellow/red status indicator)
5. Customer can still proceed to pre-screening and scheduling

**Requirements**: FR-CHAT-08

---

## Epic B3: Pre-Screening Questions

### US-B3-01: Transaction-Specific Pre-Screening
**As a** Customer, **I want to** answer pre-screening questions online before my visit, **so that** I spend less time at the counter.

**Acceptance Criteria**:
1. After identity verification, chatbot presents pre-screening questions specific to the transaction type
2. Questions are presented conversationally (one or a few at a time, not a wall of text)
3. For DL transactions, includes ~12 HIPAA-related questions
4. Customer's answers are stored and visible to the service clerk
5. Progress is tracked — partial completion is saved if customer abandons
6. Questions are configurable per transaction type by admin

**Requirements**: FR-CHAT-06, FR-CHAT-07, FR-ADMIN-08

---

### US-B3-02: Pre-Screening via SMS (Walk-In / Incomplete)
**As a** Customer who didn't complete pre-screening online, **I want to** finish the questions on my phone via SMS while sitting in the lobby, **so that** I can enter the queue without holding up the front desk.

**Acceptance Criteria**:
1. Clerk sends pre-screening questions to customer's phone via SMS
2. Customer receives a link or inline questions via text
3. Remaining unanswered questions are presented (not ones already completed)
4. Upon completion, customer is automatically placed in the queue (no return to front desk needed)
5. Customer receives their queue number and estimated wait time via SMS
6. Clerk dashboard updates to show pre-screening status change in real time

**Requirements**: FR-CLERK-07, FR-CLERK-08, FR-NOTIF-03

---

## Epic B4: Appointment Scheduling

### US-B4-01: Dynamic Appointment Booking
**As a** Customer, **I want to** book an appointment with minimal questions, **so that** I get the earliest available slot without navigating a complex calendar.

**Acceptance Criteria**:
1. Chatbot asks only 4 questions: (1) morning or afternoon, (2) specific day preference, (3) which location, (4) as soon as possible option
2. "As soon as possible" returns the earliest available slot across preferred locations
3. System calculates required duration based on selected transaction type(s) (summed for multi-transaction)
4. Slot availability accounts for clerk skills at each location
5. Slot availability accounts for office capacity run-rate percentage
6. Slot availability accounts for lunch break periods
7. Customer is presented with available options (Date, time, and office location within county) and selects one
8. No static calendar view — all scheduling is dynamic

**Requirements**: FR-CHAT-10, FR-SCHED-01 through FR-SCHED-06

---

### US-B4-02: Appointment Confirmation & QR Code
**As a** Customer, **I want to** receive a confirmation with a QR code after booking, **so that** I can check in quickly when I arrive.

**Acceptance Criteria**:
1. After selecting a slot, customer receives confirmation in the chat
2. QR code is generated containing appointment identifier
3. QR code is sent via SMS to customer's phone number
4. Confirmation email with QR code is sent via Twilio/SendGrid
5. Confirmation includes: date, time, location, transaction type(s), and any "bring to appointment" reminders

**Requirements**: FR-CHAT-11, FR-NOTIF-01, FR-NOTIF-02

---

## Epic B5: Online Checkout Redirect

### US-B5-01: Eligible Transaction Online Checkout
**As a** Customer whose transaction can be completed entirely online, **I want to** be redirected to the online payment portal, **so that** I don't have to visit the office at all.

**Acceptance Criteria**:
1. After collecting all required data, system checks if the transaction is eligible for online completion
2. If eligible, chatbot asks "Would you like to complete this online now?"
3. On confirmation, customer is redirected to the configured external payment URL (e.g., MyEasyGov)
4. Redirect URL is configurable per tenant by admin
5. If customer declines online checkout, flow continues to appointment scheduling
6. Customer data collected so far is preserved regardless of choice

**Requirements**: FR-CHAT-09, FR-ADMIN-09

---

## Epic B6: Walk-In Self-Service Check-In

### US-B6-01: Kiosk / QR Code Walk-In Entry
**As a** Customer arriving without an appointment, **I want to** check myself in at the office via a kiosk or QR code, **so that** I can join the queue without waiting for the front desk.

**Acceptance Criteria**:
1. Office displays a QR code (on kiosk or signage) that opens the chatbot on customer's phone
2. Chatbot identifies this as a walk-in flow (no existing appointment)
3. Customer provides basic information (name, phone number, transaction type needed)
4. Customer is directed to complete pre-screening questions on their phone
5. Upon pre-screening completion, customer is automatically placed in the queue
6. If customer cannot use phone, front desk clerk can check them in manually

**Requirements**: FR-SCHED-07, FR-CLERK-02

---

## Epic B7: In-Office SMS Interactions

### US-B7-01: Queue Position & Wait Time Updates
**As a** Customer waiting in the lobby, **I want to** receive SMS updates about my queue position, **so that** I know approximately when I'll be called.

**Acceptance Criteria**:
1. After entering the queue, customer receives SMS with queue number and estimated wait time
2. Customer receives update when they move to "next up" position
3. Wait time estimate is based on current queue depth and average transaction durations
4. Updates are sent via Twilio SMS

**Requirements**: FR-SCHED-09, FR-NOTIF-01

---

### US-B7-02: Summon Notification
**As a** Customer, **I want to** receive an SMS and see my number on the display when it's my turn, **so that** I know to go to the right station.

**Acceptance Criteria**:
1. When clerk summons customer, SMS is sent with station number
2. Public display updates simultaneously showing customer code and station number
3. SMS includes clear instruction (e.g., "Please proceed to Station 5")
4. Both SMS and display update happen within 2 seconds of clerk action

**Requirements**: FR-CLERK-12, FR-DISPLAY-01, FR-DISPLAY-02, FR-NOTIF-01
