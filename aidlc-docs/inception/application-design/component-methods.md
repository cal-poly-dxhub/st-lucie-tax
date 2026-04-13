# Component Methods

## Overview
Method signatures for each backend component. Input/output types use TypeScript conventions. Detailed business rules will be defined in Functional Design (Construction phase).

---

## BC-01: Chatbot Service

### Conversation Management
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `create_session(tenant_id, channel)` | `str, str` | `Session` | Create new conversation session |
| `process_message(session_id, message, attachments?)` | `str, str, list[str]?` | `ConversationResponse` | Process user message through state machine, return AI response |
| `get_session_state(session_id)` | `str` | `SessionState` | Retrieve current conversation state and progress |
| `get_upload_url(session_id, document_type, filename)` | `str, str, str` | `PresignedUrlResponse` | Generate presigned S3 URL for document upload |

### State Machine
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `identify_transaction(session_id, user_message)` | `str, str` | `TransactionIdentification` | Use Bedrock to identify transaction type(s) from user input |
| `advance_state(session_id)` | `str` | `StateTransition` | Determine and execute next state transition |
| `load_transaction_prompt(tenant_id, transaction_type)` | `str, str` | `SystemPrompt` | Load transaction-specific system prompt from DynamoDB |
| `check_checkout_eligibility(session_id)` | `str` | `CheckoutEligibility` | Check if transaction can be completed online |
| `skip_state(session_id, state_name)` | `str, str` | `StateTransition` | Skip an optional state (upload-docs, pre-screen); flags appointment as incomplete pre-work and advances state machine |
| `handle_prescreening_complete(session_id)` | `str` | `None` | Called when walk-in customer finishes SMS pre-screening; marks session complete, delegates to BC-04 `assign_queue()` for auto-queue placement, BC-06 for queue confirmation SMS |

---

## BC-02: Identity & Document Service

| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `process_dl_photo(s3_key, session_id)` | `str, str` | `OcrResult` | Extract DL fields via Bedrock multimodal OCR |
| `validate_document(s3_key, session_id, expected_type)` | `str, str, str` | `ValidationResult` | Validate document type and quality via Bedrock |
| `confirm_ocr_fields(session_id, corrections?)` | `str, dict?` | `IdentityRecord` | Confirm or correct OCR-extracted fields |
| `get_document_status(session_id)` | `str` | `list[DocumentStatus]` | Get upload/validation status for all session documents |

---

## BC-03: Admin Service

### Location Management
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `create_location(tenant_id, location_data)` | `str, LocationInput` | `Location` | Create office location with hours, stations, capacity |
| `update_location(tenant_id, location_id, updates)` | `str, str, LocationUpdate` | `Location` | Update location configuration |
| `list_locations(tenant_id)` | `str` | `list[Location]` | List all locations for tenant |
| `deactivate_location(tenant_id, location_id)` | `str, str` | `None` | Deactivate a location |

### Transaction Type Management
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `create_transaction_type(tenant_id, txn_data)` | `str, TransactionTypeInput` | `TransactionType` | Create transaction type with duration, availability |
| `update_transaction_type(tenant_id, txn_id, updates)` | `str, str, TransactionTypeUpdate` | `TransactionType` | Update transaction type config |
| `list_transaction_types(tenant_id)` | `str` | `list[TransactionType]` | List all transaction types (includes global + tenant overrides) |

### Clerk Management
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `create_clerk(tenant_id, clerk_data)` | `str, ClerkInput` | `Clerk` | Create clerk with skills and Cognito account |
| `update_clerk(tenant_id, clerk_id, updates)` | `str, str, ClerkUpdate` | `Clerk` | Update clerk profile/skills |
| `import_clerks_csv(tenant_id, csv_file)` | `str, bytes` | `ImportResult` | Bulk import clerks from CSV |
| `list_clerks(tenant_id, location_id?)` | `str, str?` | `list[Clerk]` | List clerks, optionally filtered by location |

### Configuration
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `update_hot_buttons(tenant_id, buttons)` | `str, list[HotButton]` | `None` | Update chatbot hot-button prompts |
| `update_checkout_url(tenant_id, url)` | `str, str` | `None` | Set online checkout redirect URL |
| `manage_prescreening_questions(tenant_id, txn_type, questions)` | `str, str, list[Question]` | `None` | Set pre-screening questions for a transaction type |

### Duration Monitoring
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `get_duration_alerts(tenant_id)` | `str` | `list[DurationAlert]` | Get active duration drift alerts |
| `accept_duration_recommendation(tenant_id, alert_id)` | `str, str` | `None` | Accept recommended duration update |
| `dismiss_duration_alert(tenant_id, alert_id)` | `str, str` | `None` | Dismiss a duration alert |
| `snooze_duration_alert(tenant_id, alert_id)` | `str, str` | `None` | Snooze alert for later review |

---

## BC-04: Clerk Service

### Login & Station
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `select_station(tenant_id, clerk_id, location_id, station_number)` | `str, str, str, int` | `StationAssignment` | Assign clerk to office/station for the day |
| `release_station(tenant_id, clerk_id)` | `str, str` | `None` | Release station assignment |
| `toggle_availability(tenant_id, clerk_id, available)` | `str, str, bool` | `None` | Toggle clerk in/out of queue |

### Check-In
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `check_in_qr(tenant_id, qr_code)` | `str, str` | `CustomerRecord` | Look up customer by QR code |
| `check_in_name(tenant_id, name_query)` | `str, str` | `list[CustomerRecord]` | Search customers by name |
| `create_walkin(tenant_id, location_id, customer_data)` | `str, str, WalkInInput` | `CustomerRecord` | Create walk-in customer record |
| `assign_queue(tenant_id, customer_id, queue_type, assigned_clerk_id?)` | `str, str, QueueType, str?` | `QueueEntry` | Place customer in queue (regular/priority/assigned) |

### Service
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `summon_next(tenant_id, clerk_id)` | `str, str` | `CustomerRecord?` | Auto-assign next customer based on skills + queue rules |
| `complete_appointment(tenant_id, clerk_id, customer_id)` | `str, str, str` | `CompletionRecord` | Mark transaction complete, record actual duration |
| `complete_and_summon(tenant_id, clerk_id, customer_id)` | `str, str, str` | `CustomerRecord?` | Atomic complete + summon next |
| `send_to_written_test(tenant_id, customer_id, station?)` | `str, str, int?` | `None` | Route customer to written test station |

### SMS & Documents
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `send_prescreening_sms(tenant_id, customer_id)` | `str, str` | `None` | Send remaining pre-screening questions via SMS |
| `upload_document(tenant_id, customer_id, document)` | `str, str, UploadInput` | `DocumentRecord` | Upload document from clerk device |

### Notes
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `add_note(tenant_id, customer_id, clerk_id, text)` | `str, str, str, str` | `Note` | Add note to customer record |
| `get_notes(tenant_id, customer_id)` | `str, str` | `list[Note]` | Get all notes for a customer |

---

## BC-05: Scheduling Service

| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `get_available_slots(tenant_id, request)` | `str, SlotRequest` | `list[AvailableSlot]` | Calculate available slots on-demand |
| `book_appointment(tenant_id, session_id, slot_id)` | `str, str, str` | `Appointment` | Book appointment with optimistic concurrency |
| `cancel_appointment(tenant_id, appointment_id)` | `str, str` | `None` | Cancel an existing appointment |
| `enter_walkin_queue(tenant_id, location_id, customer_id)` | `str, str, str` | `QueueEntry` | Place walk-in directly in queue |
| `estimate_wait_time(tenant_id, location_id, queue_position)` | `str, str, int` | `WaitEstimate` | Estimate wait time based on queue depth + avg durations |
| `generate_qr_code(appointment_id)` | `str` | `bytes` | Generate QR code image for appointment |

---

## BC-06: Notification Service

| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `send_sms(tenant_id, phone, template, data)` | `str, str, str, dict` | `DeliveryResult` | Send SMS via Twilio |
| `send_email(tenant_id, email, template, data, attachments?)` | `str, str, str, dict, list?` | `DeliveryResult` | Send email via Twilio/SendGrid |
| `send_appointment_confirmation(tenant_id, appointment_id)` | `str, str` | `None` | Send SMS + email confirmation with QR code |
| `send_summon_notification(tenant_id, customer_id, station)` | `str, str, int` | `None` | Send SMS summon with station number |
| `send_queue_update(tenant_id, customer_id, position, wait_time)` | `str, str, int, int` | `None` | Send queue position update SMS |
| `generate_lien_letter(tenant_id, session_id)` | `str, str` | `bytes` | Generate lien transfer letter PDF from template |

---

## Polling Endpoints (SVC-07)

### BC-04: Queue & Display State (Polling)
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `get_queue_state(tenant_id, office_id)` | `str, str` | `QueueState` | Return full queue list, pre-screening statuses, clerk availability for an office |
| `get_display_state(tenant_id, office_id)` | `str, str` | `DisplayState` | Return customer codes + station assignments for lobby display |

### BC-01: Session State (Polling)
| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `get_session_state(session_id)` | `str` | `SessionState` | Return current session state including OCR results, queue placement (already defined above) |

---

## SI-03: Data Access Layer

| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `build_pk(tenant_id, entity_type, entity_id)` | `str, str, str` | `str` | Construct tenant-prefixed partition key |
| `put_item(tenant_id, item, condition?)` | `str, dict, str?` | `None` | Tenant-scoped put with optional condition |
| `get_item(tenant_id, entity_type, entity_id, sk)` | `str, str, str, str` | `dict?` | Tenant-scoped get |
| `query(tenant_id, entity_type, entity_id, sk_prefix?)` | `str, str, str, str?` | `list[dict]` | Tenant-scoped query |
| `query_gsi(index_name, pk, sk_prefix?)` | `str, str, str?` | `list[dict]` | GSI query |
| `get_global_config(entity_type, entity_id)` | `str, str` | `dict?` | Read global config (GLOBAL# prefix) |
| `resolve_config(tenant_id, entity_type, entity_id)` | `str, str, str` | `dict` | Resolve tenant override or fall back to global |
