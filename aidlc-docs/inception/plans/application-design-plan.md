# Application Design Plan

## Overview
This plan defines the high-level component architecture for the St. Lucie County Tax Collector platform. Please answer the design questions below by filling in the letter choice after each `[Answer]:` tag.

---

## Part 1: Design Questions

### Question 1
How should the frontend applications be structured?

A) Single React SPA with role-based routing (chatbot, clerk dashboard, admin dashboard, public display all in one app)
B) Separate React SPAs per audience (chatbot app, clerk/admin app, display app) — shared component library
C) Separate React SPAs per application (chatbot, clerk dashboard, admin dashboard, display — 4 apps)
D) Other (please describe after [Answer]: tag below)

[Answer]: B

### Question 2
How should the backend API be organized?

A) Single API Gateway with Lambda functions grouped by domain (chatbot/, admin/, clerk/, scheduling/, notifications/)
B) Multiple API Gateways — one per subsystem (chatbot API, admin API, clerk API, etc.)
C) Single API Gateway with a monolithic Lambda (one Lambda handles all routes)
D) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 3
For real-time features (queue updates to clerk dashboard, public display updates, customer summon notifications), which approach?

A) WebSocket API Gateway with Lambda handlers — persistent connections for clerk dashboard and public display
B) Polling — clerk dashboard and display poll a REST endpoint every few seconds
C) AppSync GraphQL subscriptions for real-time updates
D) Other (please describe after [Answer]: tag below)

[Answer]: B

> **REVISED DECISION (2026-04-08)**: Changed from A (WebSocket) to B (Polling).
>
> **Rationale**: The system has no use case requiring sub-second push. The primary real-time moments are: lobby display updates (secondary to SMS summon notifications), clerk dashboard queue state (clerks only check when clicking "Summon Next," which is a synchronous REST call), and chatbot OCR results (customer is already waiting for async processing). All are well-served by 2-5s polling intervals.
>
> Switching to polling eliminates: WebSocket API Gateway, `$connect`/`$disconnect` Lambda handlers, SI-01 (Real-Time Service) component entirely, GSI2 (WebSocket connections), WebSocket Connection DynamoDB entity, `ws-client` frontend module and reconnect logic in all 3 apps, and `broadcast_event` calls in BC-02/BC-04. Net reduction: ~700-900 lines of code, 1 component, 1 API Gateway, 1 GSI, 2 Lambda functions.
>
> Chatbot streaming (Bedrock ConverseStream) uses Lambda function URL with `RESPONSE_STREAM` invoke mode — no WebSocket needed for LLM token streaming.
>
> WebSocket can be added later if scale (20+ offices) or user feedback demands it. The polling endpoints serve as reconnect-fallback regardless.
>
> **Approved by**: User (2026-04-08T09:08:35Z)

### Question 4
How should the conversational AI chatbot manage conversation state and context?

A) Bedrock Converse API with conversation history stored in DynamoDB — stateless Lambda reconstructs context per message from DB
B) Bedrock Agents with session management — Bedrock manages conversation state
C) Custom state machine — Lambda manages conversation flow with explicit states (identify-transaction, verify-identity, pre-screen, schedule) stored in DynamoDB
D) Other (please describe after [Answer]: tag below)

[Answer]: C

### Question 5
For the scheduling engine, how should slot availability be calculated?

A) Pre-computed slots — background job generates available slots periodically, chatbot reads from a slots table
B) On-demand calculation — scheduling Lambda computes availability in real-time from appointments + clerk schedules + capacity config when customer requests
C) Hybrid — pre-compute a daily availability snapshot, then adjust in real-time as appointments are booked
D) Other (please describe after [Answer]: tag below)

[Answer]: B

### Question 6
How should multi-tenant data isolation be implemented in DynamoDB?

A) Tenant ID as partition key prefix on all tables (e.g., PK = `TENANT#stlucie#LOCATION#loc1`)
B) Separate DynamoDB tables per tenant (e.g., `stlucie-appointments`, `broward-appointments`)
C) Single-table design with tenant ID as a top-level attribute and enforced at the data access layer via condition expressions
D) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 7
For the document/image upload flow (DL photos, supporting documents), which storage pattern?

A) Direct S3 upload via presigned URLs from the frontend, with S3 event triggering Lambda for Bedrock OCR/validation
B) Upload through API Gateway to Lambda, Lambda stores in S3 and calls Bedrock synchronously
C) Direct S3 upload via presigned URLs, then frontend calls a separate validation API endpoint that triggers Bedrock
D) Other (please describe after [Answer]: tag below)

[Answer]: A

### Question 8
What IaC approach for defining AWS infrastructure?

A) AWS CDK (TypeScript) — programmatic infrastructure definition
B) AWS SAM — serverless-focused template approach
C) Terraform — provider-agnostic IaC
D) AWS CloudFormation — native YAML/JSON templates
E) Other (please describe after [Answer]: tag below)

[Answer]: A (user initially requested Python but confirmed TypeScript for both CDK and Lambda runtime)

---

## Part 2: Design Execution Plan

After questions are answered, the following artifacts will be generated:

- [x] **Step 1**: Analyze answers and resolve any ambiguities — All 8 answers validated, no contradictions or ambiguities. Q8 customized: CDK in Python.
- [x] **Step 2**: Generate `components.md` — component definitions, responsibilities, and interfaces
- [x] **Step 3**: Generate `component-methods.md` — method signatures, input/output types, high-level purpose
- [x] **Step 4**: Generate `services.md` — service definitions, orchestration patterns, interactions
- [x] **Step 5**: Generate `component-dependency.md` — dependency matrix, communication patterns, data flow
- [x] **Step 6**: Generate `application-design.md` — consolidated design document
- [x] **Step 7**: Validate design completeness against requirements traceability
