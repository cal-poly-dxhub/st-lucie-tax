# Data Access Patterns

All patterns scoped by county_id via RLS. Numbers match the config (#1–18) and transactional (#19–85) reference docs.


CONFIG — Offices

1. List all offices for a county → offices
2. Get hours for an office on a given day → office_hours filtered by office_id + day_of_week
3. Get desk count for an office → offices.total_desks
4. Get capacity run rate for an office → offices.run_rate_pct
5. Get lunch shifts for an office → office_lunch_shifts filtered by office_id, ordered by start_time
6. Get a specific office by office_id → offices filtered by county_id + office_id

Writes: create/update office, set hours per day, set lunch shifts, set run rate.


CONFIG — Transaction Types

7. List all transaction types for a county → transaction_types where office_id IS NULL and status = 'active'
8. List transaction types available at a specific office → DISTINCT ON (txn_type_id) from transaction_types where office_id IS NULL OR office_id = $1, ordered by office_id NULLS LAST (office-scoped overrides global)
9. Check if a transaction type is available at a given time → transaction_types.available_from / available_until
10. Get estimated duration for a transaction type → transaction_types.avg_duration_min

Writes: create/update txn type (global or office-scoped), set status (active/internal/hidden), set service hour restrictions.


CONFIG — Clerks

11. List all clerks for a county → clerks
12. Get skills for a clerk → clerks.skill_ids (array of transaction_types.id)
13. Get office assignments for a clerk → clerks.office_ids (array of offices.id)
14. Get clerk status → clerks.status (active/in_training/inactive)
15. Find clerks skilled in txn type X at office Y → clerks where office_id = ANY(office_ids) AND txn_type_id = ANY(skill_ids) AND status = 'active'

Writes: create/update clerk, assign skills, assign offices, set status, bulk CSV import.


CONFIG — Chatbot

16. List hot buttons → hotbuttons ordered by sort_order
17. List all pre-screen questions → prescreen_questions joined with transaction_types, ordered by txn_type_id + sort_order
18. List pre-screen questions for a specific txn type → prescreen_questions filtered by txn_type_id, ordered by sort_order

Writes: create/update/reorder hot buttons, create/update pre-screen questions.


CONFIG — Documents & Flows

DC-1. Get a document definition by doc_id → document_registry filtered by county_id + doc_id
DC-2. List all document definitions → document_registry filtered by county_id
DC-3. Get the transaction flow for a txn type → transaction_flows.steps filtered by txn_type_id
DC-4. List all transaction flows → transaction_flows joined with transaction_types
DC-5. Resolve docs from a completed flow → walk steps in app code, collect require_docs doc_ids, then SELECT from document_registry WHERE doc_id = ANY($1)
DC-6. Find flows that require a specific document → transaction_flows WHERE steps @> JSONB pattern matching the doc_id

Writes: create/update document definitions, create/update transaction flows.


TRANSACTIONAL — Duration Engine

19. Get actual average duration for txn type X over last N days → AVG(service_history.duration_min) joined to service_history_txn_types, filtered by txn_type_id + served_at range. service_history is PII-free and carries office_id directly; the txn type list lives in the service_history_txn_types junction table since Postgres can't enforce FKs on array elements. Multi-txn appointments contribute one row per appointment with multiple junction rows.
20. List pending duration recommendations → duration_recommendations where status = 'pending'
21. Compare recommended vs current duration → duration_recommendations.recommended_avg_min vs current_avg_min

Writes: create recommendation, approve/reject (approved → update transaction_types.avg_duration_min).


TRANSACTIONAL — AI Assistant / Citizen Chatbot

Conversation & Intent
22. Get active transaction types for intent matching → same as #7, filtered to active
23. (Reserved)
24. Check if txn can be completed online → transaction_types.is_online_eligible + online_redirect_url

Pre-Screening
25. Get pre-screen questions for customer's selected txn types → same as #18, across all selected txn_type_ids, deduped
26. Save pre-screen responses → appointments.prescreen_responses (JSONB keyed by prescreen_questions.id)
27. Check pre-screen completion → compare answered keys in prescreen_responses vs required questions from #25; if all answered, UPDATE appointments.prescreen_completed = TRUE

Documents
28. Upload a document → INSERT into documents (appointment_id, name, s3_key)
29. List documents for an appointment → documents filtered by appointment_id
30. Mark document accepted/rejected by AI → UPDATE documents.ai_review_status + ai_review_notes

Identity Verification
31. Record identity verification → UPDATE appointments.identity_verified
32. Check identity verification status → appointments.identity_verified

Appointment Booking
33. Get booked minutes for office/date/time range → SUM(appointments.estimated_duration_min) filtered by office_id + date + time range, excluding cancelled/no_show
34. Get remaining capacity for office/date/period → effective capacity (#82) minus booked minutes (#33)
35. Find earliest ASAP slot across all offices → scan offices × dates, check capacity (#34) + clerk coverage (#15) + time restrictions (#9), return first fit
36. Filter slots by customer preferences → filter #35 results by office, day of week, period
37. Book appointment (online/scheduled) → INSERT into appointments with inlined first_name/last_name/contact_email/contact_phone, generate qr_code
38. Look up appointment by QR code → appointments filtered by qr_code, joined with documents and prescreen_responses (customer info is inlined on appointments)

Appointment Record
(Customer PII is inlined on appointments and scoped to a single visit; there is no cross-visit customer record. Patterns 39–43 intentionally omitted.)

Lien Transfer Letters
44. Create lien transfer letter → (future table, not yet in schema)
45. List lien letters for a customer → (future table)
46. Update letter status → (future table)
47. Get lien letter backlog → (future table)

Notifications
48. Send a notification → call AWS SES to send email (appointment confirmation, reminder, check-in confirmation, queue summon). No notifications table; SES is the system of record. Future: swap or extend to Twilio (SMS) or SendGrid via a thin notification-service abstraction.
49. List notifications for an appointment → not stored; SES delivery status available via SES event webhooks if needed in a future phase.


TRANSACTIONAL — Check-In Dashboard

Customer Lookup
50. Scan QR code → same as #38
51. Search walk-ins by name → appointments filtered by last_name ILIKE + first_name ILIKE on today's appointments (no cross-visit customer table)
52. Create walk-in → INSERT into appointments with inlined first_name/last_name/contact_email/contact_phone, qr_code NULL
53-check-in. Get preferred clerk for appointment → SELECT requested_clerk_id FROM appointments WHERE id = $1; used by check-in clerk to route to a specific clerk via #62

Document Review
53. List uploaded documents → same as #29
54. Clerk uploads document at desk → same as #28

Pre-Screen SMS Flow
55. Get unanswered pre-screen questions → same as #27, return unanswered subset
56. Send remaining questions via SMS → triggers notification (#48)
57. Customer submits answers from phone → same as #26
58. Check if all pre-screen complete → if #27 returns all answered, UPDATE appointments.prescreen_completed = TRUE, then auto-add to queue (#60)

Queue Assignment
59. (Reserved — prior-clerk lookup not supported; service_history is PII-free and has no customer or appointment linkage.)
60. Add to regular queue → INSERT into queue (status = 'waiting', is_priority = FALSE, queue_number = next available for office+day)
61. Add to priority queue → INSERT into queue (status = 'waiting', is_priority = TRUE, queue_number = next available for office+day)
62. Assign to specific clerk → INSERT into queue with assigned_clerk_id set, queue_number = next available for office+day
63. Attach check-in note → UPDATE queue.notes
64. (Reserved — persistent customer notes not supported; no customer_notes table. Per-visit notes use queue.notes, see #63.)


TRANSACTIONAL — Service Clerk Dashboard

Session Management
65. Clerk logs in → INSERT into clerk_sessions (clerk_id, office_id, desk_number); skill_ids cached in app memory from clerks table at login to avoid joining clerks on every queue pull (clerk_sessions table itself has no skill_ids column)
66. Clerk logs out → UPDATE clerk_sessions.logged_out_at
67. Toggle availability → UPDATE clerk_sessions.is_available
68. List logged-in available clerks at office → clerk_sessions where is_available = TRUE and logged_out_at IS NULL

Queue Operations
69. Get next in queue matching my skills → queue joined with appointments, filtered by office_id + status = 'waiting' + txn_type_ids overlapping clerk skills, ordered by is_priority DESC then checked_in_at ASC, LIMIT 1
70. Check if anyone is assigned to me → queue where assigned_clerk_id = my clerk_id and status = 'waiting'
71. Summon next customer → UPDATE queue set status = 'serving', assigned_clerk_id, assigned_desk
72. Get full record for summoned customer → appointment (with inlined PII) + documents + prescreen_responses + identity_verified + queue.notes
73. Send customer for written test → UPDATE queue.status = 'testing'
74. Complete transaction → UPDATE queue.status = 'done', INSERT into service_history (office_id, duration_min) and INSERT one row per txn_type_id into service_history_txn_types, UPDATE appointments.status = 'completed'. service_history is PII-free: no clerk_id, appointment_id, or customer linkage.
75. Complete and summon next → atomic: #74 then #69 + #71

Queue View
76. Full queue for this office → queue filtered by office_id, all statuses (waiting/serving/testing), joined with appointments for display (first_name/last_name inlined on appointments)


TRANSACTIONAL — Customer Display (Lobby Screen)

77. Who is at which desk → SELECT queue_number, assigned_desk, first_name, last_name FROM queue JOIN appointments ON queue.appointment_id = appointments.id WHERE queue.status = 'serving' AND assigned_desk IS NOT NULL; polled every 5s
78. My position in line → COUNT of queue entries with status = 'waiting' and checked_in_at before mine


TRANSACTIONAL — Scheduling Engine (Internal)

79. Get full office config → offices + office_hours + office_lunch_shifts for an office (#1–5)
80. Get booked minutes for office/date/period → same as #33
81. Get booked minutes for office/date full day → #33 for morning + afternoon
82. Compute effective capacity → (total_desks × period_hours × 60 − lunch_reduction) × run_rate_pct / 100
83. Check clerk coverage for txn type at office → same as #15
84. Check txn type time restrictions → same as #9
85. Scan for ASAP → iterate offices × dates from today; for each: check capacity (#82) > booked (#80), clerk coverage (#83) exists, time restrictions (#84) pass; return first fit


CROSS-CUTTING NOTES

- Lobby display (#77) is a query on queue, not a separate table.
- Skill denormalization: #65 caches skills in app memory at login so #69 avoids joining clerks on every summon. clerk_sessions has no skill_ids column.
- Pre-screen auto-queue: #58 returning complete triggers #60 automatically.
- Written test: #73 uses queue status 'testing' beyond the standard waiting/serving/done.
- All dashboards poll at ~5s. No websockets in PoC.
- No cross-visit customer record: PII is inlined on appointments and scoped to a single visit's lifecycle so it can be purged on a fixed schedule. Patterns #39–43, #59, and #64 are intentionally omitted/reserved. Walk-in lookup (#51) searches today's appointments by name.
- service_history is PII-free: it carries office_id, duration_min, served_at, with txn types in the service_history_txn_types junction table — no clerk_id, appointment_id, or customer linkage. It exists solely to drive duration_recommendations.
- Lien letters (#44–47) and notifications (#48–49) reference tables not yet in the schema.
- Many patterns are reused across surfaces (noted with "same as #N") — one implementation, multiple callers.
