# Component Dependencies

## Dependency Matrix

| Component | Depends On | Communication | Data Flow |
|-----------|-----------|---------------|-----------|
| FC-01 Chatbot App | BC-01, BC-05 | REST API (polling) | Sends messages, receives AI responses; polls for state updates |
| FC-02 Staff App | BC-03, BC-04, SI-02 | REST API (polling) | CRUD operations, queue actions; polls for queue/summon updates |
| FC-03 Display App | BC-04 | REST API (polling) | Polls for summon/queue events |
| BC-01 Chatbot Svc | BC-02, BC-05, BC-06, SI-03 | Internal invoke, DynamoDB | Delegates OCR, scheduling, notifications; reads/writes session state |
| BC-02 Identity/Doc Svc | SI-03 | S3 event trigger, DynamoDB | Triggered by S3 upload, writes results to DynamoDB (frontend polls for updates) |
| BC-03 Admin Svc | SI-03 | DynamoDB | Reads/writes tenant config, locations, clerks, transaction types |
| BC-04 Clerk Svc | BC-05, BC-06, SI-03 | Internal invoke, DynamoDB | Delegates wait time, notifications; manages queue state (frontends poll for updates) |
| BC-05 Scheduling Svc | BC-06, SI-03 | Internal invoke, DynamoDB | Reads appointments/config, books slots, delegates notifications |
| BC-06 Notification Svc | SI-03 | Twilio API, DynamoDB | Reads tenant Twilio config, dispatches SMS/email, logs delivery |
| SI-02 Auth/Tenant | — | Cognito, API Gateway | Provides JWT validation, tenant context extraction |
| SI-03 Data Access | — | DynamoDB | Shared data access with tenant isolation |

---

## Communication Patterns

### Frontend → Backend (Synchronous)
```
FC-01 (Chatbot) --REST--> API Gateway --Lambda--> BC-01 (Chatbot Svc)
FC-02 (Staff)   --REST--> API Gateway --Lambda--> BC-03 (Admin Svc)
FC-02 (Staff)   --REST--> API Gateway --Lambda--> BC-04 (Clerk Svc)
```

### Backend → Frontend (Polling)
```
FC-02 (Staff App)   --REST poll--> API Gateway --Lambda--> BC-04 (Clerk Svc) [queue state]
FC-03 (Display App) --REST poll--> API Gateway --Lambda--> BC-04 (Clerk Svc) [display state]
FC-01 (Chatbot App) --REST poll--> API Gateway --Lambda--> BC-01 (Chatbot Svc) [session state]
```

### Event-Driven (S3 Trigger)
```
FC-01 (Chatbot) --presigned URL--> S3 Bucket --event--> BC-02 (Identity/Doc Svc)
```

### Backend → External Services
```
BC-06 (Notification Svc) --HTTPS--> Twilio API (SMS)
BC-06 (Notification Svc) --HTTPS--> Amazon SES (Email, POC)
BC-01 (Chatbot Svc)      --HTTPS--> Amazon Bedrock (Converse API)
BC-02 (Identity/Doc Svc) --HTTPS--> Amazon Bedrock (Multimodal)
```

### Shared Data Layer
```
All BC-* components --via SI-03--> DynamoDB (single-table, tenant-prefixed)
```

---

## Data Flow Diagrams

### Customer Appointment Flow
```
Customer --> FC-01 --> BC-01 (state machine)
                         |
                         +--> Bedrock (NLP)
                         +--> BC-02 (OCR/doc validation, via S3 event)
                         +--> BC-05 (slot calculation)
                         +--> BC-06 (confirmation SMS + email)
```

### Clerk Check-In Flow
```
Clerk --> FC-02 --> BC-04 (check-in)
                      |
                      +--> BC-06 (send pre-screening SMS)
                      +--> BC-05 (estimate wait time)
```

### Clerk Summon Flow
```
Clerk --> FC-02 --> BC-04 (summon_next)
                      |
                      +--> BC-06 (summon SMS to customer)
```

### Pre-Screening SMS Completion Flow
```
Customer Phone --> SMS Link --> BC-01 (process answers)
                                  |
                                  +--> BC-04 (auto-queue placement)
```

---

## Dependency Rules

1. **No circular dependencies**: All dependencies flow downward (Frontend → Backend → Shared Infrastructure)
2. **SI-03 has zero dependencies**: Data access layer depends on nothing — all other backend components depend on it
3. **SI-02 has zero dependencies**: Auth/tenant context is self-contained via Cognito
4. **BC-06 is fire-and-forget**: Notification failures never block calling components
5. **Frontend apps poll for state changes**: FC-01, FC-02, FC-03 poll REST endpoints at 2-5s intervals for queue, summon, and session state updates
6. **BC-02 is event-driven**: Triggered by S3 events, not called directly by other components (except for `confirm_ocr_fields` and `get_document_status` via REST)
