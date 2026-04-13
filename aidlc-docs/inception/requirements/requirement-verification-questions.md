# Requirements Verification Questions

Please answer the following questions by filling in the letter choice after each `[Answer]:` tag. If none of the options match, choose the last option (Other) and describe your preference.

---

## Functional Requirements — Conversational AI Chatbot

## Question 1
What should happen when the chatbot determines a customer is eligible to complete their transaction online (e.g., simple registration renewal)?

A) Redirect immediately to an external payment page (like MyEasyGov) with no further chatbot interaction
B) Show an in-chat prompt asking if they'd like to proceed to online checkout, and only redirect on confirmation
C) Collect all information first, then at the end offer the online option before scheduling an appointment
D) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 2
For the document upload step in the chatbot flow, what should happen when a customer declines to upload documents?

A) Allow them to skip and proceed to appointment scheduling — flag the appointment as "documents needed at check-in"
B) Allow them to skip but warn them it will increase their in-office time, then proceed to scheduling
C) Require at least identity verification before allowing them to skip other document uploads
D) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 3
The Tax Collector mentioned HIPAA-related pre-screening questions (adjudication, mental health, etc. — about 12 questions for driver license). How should these be handled?

A) Present all applicable pre-screening questions in the chatbot before appointment scheduling
B) Present pre-screening questions only after identity verification is complete
C) Allow customers to answer pre-screening questions either in the chatbot or via text message at the office
D) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 4
For the "suggested prompts" / hot buttons on the chatbot landing page, how many should be displayed?

A) 3-4 most common transaction types (driver license, registration renewal, title transfer, new resident)
B) 5-6 covering all major categories
C) Configurable per-tenant through the admin dashboard
D) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## Functional Requirements — Admin Dashboard

## Question 5
For the location/office configuration, the Tax Collector described capacity run rate (e.g., 100%, 110% for overbooking, or less to allow walk-ins). What granularity should this have?

A) Single capacity percentage per office (applies all day)
B) Capacity percentage per office per time block (morning vs. afternoon)
C) Capacity percentage per office per day of week
D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 6
The Tax Collector mentioned the AI should monitor transaction durations and recommend adjustments ("hey, this transaction is taking 15 minutes now instead of 20"). For the MVP, how should this work?

A) Simple dashboard showing average actual duration vs. configured duration per transaction type — no automated recommendations yet
B) Dashboard with basic statistical alerts when actual duration deviates significantly from configured duration
C) Skip duration monitoring entirely for MVP — just use the manually configured durations
D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 7
For clerk management, the Tax Collector mentioned bulk upload (CSV) and eventually SSO. For the MVP, what's the clerk onboarding method?

A) Manual entry only (name, email, office, skills) through the admin UI
B) Manual entry plus CSV bulk upload
C) Manual entry plus CSV bulk upload plus basic email/password authentication
D) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 8
The Tax Collector described clerks being moved between offices and desks frequently. Should the admin dashboard support scheduling clerks to specific offices on specific days?

A) No — clerks self-select their office and station when they log in each day
B) Yes — admin can assign clerks to offices/stations on a daily schedule, but clerks can override
C) Yes — admin assigns clerks to offices/stations and clerks cannot override
D) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## Functional Requirements — Service Clerk Dashboard

## Question 9
For the check-in process, the Tax Collector described three tiers: (1) customer did everything online, (2) partial — front desk scans remaining docs, (3) nothing done — service desk handles all. How should the clerk dashboard display this?

A) A simple status indicator (green/yellow/red) showing completeness level on each customer in queue
B) A detailed checklist per customer showing exactly which steps are complete and which are pending
C) Both — status indicator in the queue list view, detailed checklist when the clerk opens a customer record
D) Other (please describe after [Answer]: tag below)

[Answer]: C

## Question 10
The Tax Collector mentioned the ability to send notes to the service clerk about a customer (e.g., "this customer has been difficult"). Should these notes be:

A) Free-text notes attached to the appointment only (visible for this visit)
B) Free-text notes attached to the customer record (persistent across visits)
C) Both — appointment-specific notes and persistent customer notes
D) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 11
For the queue display (the public-facing screen showing who's being called), what information should be shown?

A) Customer number/code and station number only (privacy-focused)
B) Customer first name and station number
C) Configurable per-tenant — choose between number-only or name-based display
D) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## Functional Requirements — Scheduling & Queue Engine

## Question 12
The Tax Collector described asking customers only: morning or afternoon, specific day preference, which location, and "as soon as possible." Should the scheduling engine also consider:

A) Just those 4 inputs — keep it exactly as the Tax Collector described
B) Those 4 inputs plus the customer's transaction type(s) to calculate total appointment duration
C) Those 4 inputs plus transaction type(s) plus clerk skill availability to find optimal slots
D) Other (please describe after [Answer]: tag below)

[Answer]: C

## Question 13
For walk-in customers (no appointment), how should they enter the queue?

A) Front desk manually adds them to the queue through the clerk dashboard
B) Customer uses a self-service kiosk or scans a QR code at the office to join the queue
C) Both options available
D) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 14
The Tax Collector mentioned the queuing system should auto-assign customers to clerks based on skills (clerks should NOT cherry-pick customers). Should clerks have any ability to:

A) No choice at all — system auto-assigns the next customer based on skills and queue position
B) See what's coming next but cannot skip — must serve in order
C) Request a brief delay (e.g., "not ready") but cannot choose specific customers
D) Other (please describe after [Answer]: tag below)

[Answer]: A, Clerks CAN toggle themselves in/out of the queue though

---

## Technical & Architecture

## Question 15
For identity verification in the MVP, you mentioned using Bedrock image calls for driver license. Should this be:

A) Basic OCR extraction of DL fields (name, DOB, DL number, address) using Bedrock multimodal — no liveness check
B) OCR extraction plus a simple comparison of extracted data against what the customer typed in the chatbot
C) OCR extraction plus stub endpoint for future state system verification (return mock "verified" response)
D) Other (please describe after [Answer]: tag below)

[Answer]: OCR extraction should live inside the stub endpoint for verification) (so that it can easily be swapped out later). lets start with A for now.

## Question 16
For notifications (appointment confirmations, queue position updates, "you're next" alerts), which channels should be supported in MVP?

A) SMS only (via Twilio/SNS)
B) SMS and email (via Twilio/SNS + SES)
C) SMS, email, and in-browser push notifications
D) Other (please describe after [Answer]: tag below)

[Answer]: B Via twilio

## Question 17
For the chatbot UI, the Tax Collector showed a full-page conversational interface replacing the traditional website. Should the MVP be:

A) A standalone web app — the chatbot IS the website (as the Tax Collector envisioned)
B) A chatbot widget that can be embedded on an existing website
C) Both — standalone app for the new experience, plus embeddable widget for gradual migration
D) Other (please describe after [Answer]: tag below)

[Answer]: A

---

## Non-Functional Requirements

## Question 18
What is the expected concurrent user load for St. Lucie County?

A) Low — under 50 concurrent users (3 offices, ~24 clerks, moderate public traffic)
B) Medium — 50-200 concurrent users (accounting for peak appointment booking times)
C) High — 200+ concurrent users (accounting for all 67 counties eventually)
D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 19
What are the availability requirements?

A) Business hours only (offices are open ~8am-6pm ET, system can have maintenance windows overnight)
B) High availability during business hours, best-effort outside hours (chatbot should work 24/7 for appointment booking)
C) 24/7 high availability for all components
D) Other (please describe after [Answer]: tag below)

[Answer]: B (we should basicaly get 24/7 for free since serverless though)

## Question 20
For data retention, how long should customer interaction data (chat transcripts, uploaded documents, appointment history) be retained?

A) 30 days after appointment completion
B) 90 days after appointment completion
C) 1 year after appointment completion
D) Configurable per-tenant through admin dashboard
E) Other (please describe after [Answer]: tag below)

[Answer]: Set this to be easily configurable, but 3 years for general correspondence then maybe 30 days for drivers license photo/pii

---

## Security Extension

## Question 21
Should security extension rules be enforced for this project?

A) Yes — enforce all SECURITY rules as blocking constraints (recommended for production-grade applications)
B) No — skip all SECURITY rules (suitable for PoCs, prototypes, and experimental projects)
X) Other (please describe after [Answer]: tag below)

[Answer]: A

---
