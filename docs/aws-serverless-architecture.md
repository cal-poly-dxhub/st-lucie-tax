# AWS Serverless Architecture — St. Lucie County Tax System (PoC)

## Context

The St. Lucie County AI-Powered Tax System is a PoC replacing the county tax
collector's website + static appointment system with: an AI chatbot, an admin
dashboard, a check-in desk, a service clerk station, and a lobby display. The
backend exists today as a TypeScript + Express 5 app run under `tsx`
(`server/app.ts` → one router → `src/*.ts` business logic), backed by
PostgreSQL 16 via a `pg` pool (`server/db.ts`), with docs in S3 and email via
SESv2 already wired. The frontend is a React 19 + Vite SPA (the check-in desk);
the other surfaces are static HTML prototypes in `demos/`.

The design doc (`docs/st-lucie-design-doc.md`) mandates: serverless-first, AWS
CDK for IaC, RDS Postgres, S3 for documents, SESv2 email, Cognito auth, API
Gateway usage plans/throttling, polling over WebSocket, and that **the
appointment system and queue system fail independently**. This plan turns the
local Express + docker-compose setup into a deployed AWS serverless
architecture honoring those requirements.

**Scope decisions (confirmed with user):**
- **No multi-tenancy / RLS.** Single-tenant St. Lucie only. The schema has no
  `county_id`/RLS today and none will be added. (Removes the largest risk item.)
- **AI chatbot is out of scope here.** It is already built as a separate module
  with its own deployment. This plan only notes where it connects to the
  appointment API.
- **Frontend stays React/Vite SPAs** (not Next.js — deliberate deviation from
  the doc, justified by no SSR need and existing code). Update the doc to match.
- **One CDK stack** containing **two Lambdas** (appointment + queue split).
- **Scope = what exists in the demo/prototype today.** The CDK only deploys
  features already implemented in `demos/prototype-server.ts` + `src/*.ts`. The
  task is to **promote demo endpoints into the production server** and deploy
  them — not to build new features. Explicitly **out of scope:** lien-transfer
  letter generation, AI document validation, SMS, transaction processing
  (vision/photo/payment), and all third-party integrations (DHSMV/Orion,
  AuthID/Clear, MyEasyGov, Twilio).

### In-scope feature inventory (all already in the demo)

Promoted from `demos/prototype-server.ts` into the two production routers:

- **Config / scheduling:** `/api/config`, `/api/schedule/appointments`,
  `/api/schedule/reschedule`, slot search + booking (`src/find-appt.ts`,
  `src/book-appt.ts`).
- **Check-in desk:** `/api/lookup`, `/api/lookup-by-id`, `/api/search-name`,
  `/api/verify-identity`, `/api/validate-document`, `/api/check-in`,
  `/api/walk-in`, `/api/send-confirmation`, `/api/send-prescreen`.
- **Prescreen:** `/api/prescreen/:code` (GET) + `/api/prescreen/:code/submit`
  (`src/prescreen.ts`).
- **Queue / service clerk:** `/api/clerks`, `/api/clerk/login`,
  `/api/clerk/availability`, `/api/clerk/summon-next`, `/api/clerk/serving`,
  `/api/clerk/complete`, **`/api/clerk/complete-and-next`**,
  `/api/clerk/send-to-test`, `/api/live-queue` (lobby polling).
- **Admin CRUD:** offices, office-hours, lunch-shifts, transaction-types,
  clerks (+ bulk-import), **hotbuttons**, **prescreen-questions**,
  skills-matrix, txn-office-matrix/override, document-registry,
  transaction-flows, performance-metrics, duration-recommendations
  (approve/reject), config.

**Complete-and-summon-next** is already chained in the demo
(`demos/prototype-server.ts:912` calls `completeAppointment()` then
`assignNextCustomer()` then `sendSummonEmail()`); promotion means moving that
handler into `QueueFn`'s router. Same for the `/api/clerk/complete` and
`send-to-test` handlers.

---

## 1. Compute — two Lambdas from one codebase

Deploy the existing Express app on **Lambda via the AWS Lambda Web Adapter
(LWA)**. LWA runs the real Express server unchanged, so the same code runs
locally under `tsx`/docker-compose and in prod — no handler rewrite. The clean
`app.ts` (exported app) / `index.ts` (`listen`) split makes this near-zero-change.

Package the **same codebase as two functions**, differing only by an env var
(`SERVICE=appointment|queue`) that selects which router mounts:

- **`AppointmentFn`** — citizen/booking path: `/config`, scheduling
  (`src/find-appt.ts`, `src/book-appt.ts`), documents (`src/documents.ts`),
  prescreen (`src/prescreen.ts`), identity (`src/identity.ts`), confirmation
  email (`src/email.ts`). This is the API the **separate chatbot module** calls.
- **`QueueFn`** — in-office path: check-in (`src/check-in.ts`), queue
  (`src/queue.ts`), service clerk (`src/service-clerk.ts`), clerk sessions
  (`src/clerk-session.ts`), completion (`src/complete.ts`), lobby/polling reads.

**Why two, not one and not fully decomposed:** the doc's fault-isolation
requirement is specifically appointment-vs-queue. Two functions give real
isolation (separate **reserved concurrency**, throttles, alarms, IAM roles,
deploys) while keeping the monolith's simplicity. Full per-endpoint
decomposition (~30–40 functions) was rejected as ~3–5 days of mechanical
shim/IaC work buying granularity unneeded at ~100 appts/day. The
`(Queryable, args)` structure of `src/*.ts` means we can decompose a hotspot
later, incrementally, without a rewrite.

Honor the separation: set reserved concurrency per function so neither starves
the other; separate alarms per function; the only shared dependency is the DB
(mitigated by RDS Proxy connection caps, §2).

**Code changes:** split the single router in `server/routes/check-in.ts` into
two routers (`appointment` and `queue`) mounted conditionally in `server/app.ts`
by `SERVICE` env var. The 8 existing routes + the 9 admin endpoints from
`MISSING_ENDPOINTS.md` slot into one of the two routers.

---

## 2. Database — RDS Postgres + RDS Proxy

- **One `db.t4g.small` RDS for PostgreSQL 16 instance** (Single-AZ in dev/test,
  Multi-AZ in prod) — matches local `postgres:16` and the doc's "single
  instance" mandate.
- **RDS Proxy in front** to solve the Lambda connection-storm problem
  (multiplexes the two functions' connections into a warm pool). Lambdas connect
  to the Proxy, not RDS directly. Prefer **RDS Proxy IAM auth** so Lambdas
  present an IAM token instead of a password.
- **Placement:** RDS + Proxy in **private isolated subnets**; Lambdas in
  **private-with-egress subnets**. SG chain: Lambda SG → Proxy SG (5432) →
  RDS SG (5432), deny all else.
- **TLS:** `server/db.ts` currently has `ssl: false` — must change to
  `ssl: { ca: <rds-bundle>, rejectUnauthorized: true }` against the Proxy. Host
  and credentials become env/IAM-driven (no `localdev` defaults in prod).
- Keep the existing `validate_slot` / `book_appointment` SQL functions and
  capacity views in `db/schema.sql` as-is.

Migrate `db/schema.sql` + `db/seed.sql` into RDS via a one-shot migration step
(local `psql` over an SSM session, or a small migration Lambda).

---

## 3. Frontends — React/Vite SPAs on S3 + CloudFront

- Build all surfaces as **Vite SPAs** (the check-in desk in `frontend/` already
  is one; build admin, service clerk, and lobby display as siblings, adapting
  the `demos/` prototypes). No Next.js — no SSR requirement.
- **Hosting:** one private **S3 bucket per surface** fronted by **CloudFront**
  (OAC), deployed via CDK `BucketDeployment`. Independently cacheable and
  access-controlled. The lobby display is its own minimal bundle.
- CloudFront can also front the API Gateways (`/api/*` behavior → API Gateway
  origin) for a single origin and one place to attach WAF. The Vite dev proxy
  (`frontend/vite.config.ts` → :3000) stays for local dev.
- The **chatbot frontend** is part of the separate chatbot module; it calls
  `AppointmentFn` for booking/scheduling/docs.

---

## 4. Auth — Cognito, role-based

- One **Cognito User Pool** with **groups** for the internal personas:
  `admin`, `checkin_clerk`, `service_clerk`.
- Internal dashboards use **Cognito Hosted UI**; the SPA holds the JWT; API
  Gateway uses a **JWT authorizer**; the Lambda enforces group→route
  authorization (admin-only for config writes, etc.).
- Citizen booking is effectively anonymous (no account) — booking-by-code +
  email/QR confirmation, protected by the API Gateway usage plan/throttle and
  WAF rather than full Cognito signup.

---

## 5. API Gateway + abuse protection

- **`AppointmentFn` and `QueueFn` each behind their own API Gateway HTTP API**
  (cheaper, native Cognito JWT authorizer). Two APIs reinforce the fault-domain
  separation (independent stages, throttles, metrics).
- Attach **throttling + daily quota** on the public-facing appointment/booking
  routes the chatbot uses (the doc's "max requests per day"). If hard per-key
  quotas are needed, front those specific routes with a REST API usage plan;
  otherwise HTTP API stage throttling is sufficient at PoC scale.
- **AWS WAF** on the CloudFront distribution fronting public surfaces
  (rate-based rule per IP + AWS managed rule sets).
- dev / test / prod **stages** map to per-environment deploys (§8).

---

## 6. Storage & async

- **S3 buckets:** `documents` (citizen uploads, 10 MB, JPG/PNG/PDF — already
  partially built in `src/documents.ts`) and per-surface `frontend-*` buckets.
  Add **presigned PUT URLs** so the browser uploads directly to S3 (avoids the
  API Gateway 10 MB payload limit + base64 inflation); `AppointmentFn` issues
  the URL.
- **Async workers (EventBridge + SQS + worker Lambdas), low volume.** Both map
  to code that already exists — no new features:
  - **Summon/confirmation email** — SQS-buffer the queue-summon and confirmation
    emails so a SES throttle never blocks a check-in/summon. Today the demo
    calls `sendSummonEmail()` / `src/email.ts` inline; moving it behind SQS is a
    refactor, not new logic.
  - **Duration-recommendation batch** — EventBridge Scheduler (nightly) →
    worker running `src/generate-recommendations.ts` over `service_history`;
    admin approves/rejects the resulting `pending` recommendations via the
    existing admin endpoints.
  - *(No lien-transfer worker — out of scope.)*
- **Polling endpoints** (doc: polling over WebSocket, 5s OK) are plain GET routes
  on `QueueFn` — `/api/live-queue` (lobby "now serving"), `/api/clerk/serving`,
  queue/customer status. Optionally cache the lobby-display read at CloudFront
  for ~3–5s.

These workers can live in the same Lambda package (different handler entry) or
be thin standalone functions — keep them in the one stack.

---

## 7. Networking & security

- **One VPC per environment.** Private isolated subnets (RDS + Proxy),
  private-with-egress subnets (Lambdas). Minimize NAT via **VPC endpoints**: S3
  (Gateway); Interface endpoints for SESv2, Secrets Manager, SQS, CloudWatch
  Logs, KMS.
- **Secrets Manager** for DB creds (rotation in prod); prefer RDS Proxy IAM auth
  so Lambdas avoid reading secrets directly.
- **Per-function IAM roles, least privilege:** `AppointmentFn` → Proxy connect,
  `documents` S3 presign/read, SES send; `QueueFn` → Proxy connect, SES send.
  No cross-grants.
- **Encryption:** TLS to RDS (fix `ssl:false`), KMS on S3/Secrets/RDS storage,
  HTTPS-only CloudFront.
- **PII posture:** schema already inlines PII per-appointment for easy purging
  and keeps `service_history` PII-free — preserve. Add S3 lifecycle to expire
  old documents.

---

## 8. IaC — one CDK stack

A single CDK v2 stack (new `infra/` package, esbuild-bundled
`NodejsFunction`s) containing all resources:

- VPC + subnets + SGs + VPC endpoints
- RDS instance + RDS Proxy + Secrets Manager secret
- Cognito User Pool + groups + app clients
- `AppointmentFn` + `QueueFn` (+ email & duration-recommendation worker
  handlers), two HTTP APIs + JWT authorizer, one SQS queue (emails), one
  EventBridge schedule (nightly duration recs)
- Per-surface S3 buckets + CloudFront distributions (OAC) + `BucketDeployment`
- WAF WebACL on the public distribution

**Environments:** select via CDK context (`-c env=dev|test|prod`), instantiating
the stack with env-specific sizing (Single-AZ + smaller instance in dev;
Multi-AZ + secret rotation + WAF in prod). One account for the PoC; document a
multi-account path as future work (doc says CI/CD is out of PoC scope).

Add an **MIT `LICENSE`** + headers (open-source deliverable requirement).

---

## 9. Phased build sequence

The work is **promote demo endpoints → production server, then deploy**. No new
features. Aligns with the doc's phasing (foundation/admin → scheduling → office
ops). The chatbot is the separate module and is not built here.

**Phase 0 — Production server promotion + CDK foundation:**
- Split `server/routes/check-in.ts` into `appointment` + `queue` routers;
  conditionally mount in `server/app.ts` by `SERVICE` env var.
- Promote the in-scope handlers from `demos/prototype-server.ts` into those two
  routers (the §"in-scope feature inventory" list). The handlers already call
  the `src/*.ts` functions; this is wiring, not new logic.
- Stand up the stack's VPC + RDS + Proxy + Secrets. Migrate `schema.sql` +
  `seed.sql` into RDS. Fix `server/db.ts` TLS + env/IAM-driven creds.
- Package both functions via LWA; deploy two HTTP APIs.

**Phase 1 — Foundation / Admin:**
- Cognito pool + groups; JWT authorizer on dashboard routes.
- `documents` bucket + presigned uploads in `src/documents.ts`.
- Build the **admin dashboard** SPA from `demos/admin.html` (config CRUD:
  offices, hours, lunch, transaction types, clerks + bulk-import, **hotbuttons**,
  **prescreen-questions**, skills/txn-office matrices, document-registry,
  transaction-flows, performance-metrics, duration-recommendation
  approve/reject); deploy via CloudFront.
- *Exit:* admin configures offices/txn types/clerks/hotbuttons/prescreen-Qs
  behind Cognito in a deployed env.

**Phase 2 — Scheduling:**
- Expose `src/find-appt.ts` / `src/book-appt.ts` via `AppointmentFn`
  (`/api/config`, `/api/schedule/*`); already exist + tested — wiring + throttles.
  The separate chatbot module and the booking UI both consume these.
- *Exit:* a capacity-validated slot books; QR confirmation email sent.

**Phase 3 — Office operations:**
- Build service clerk + lobby display SPAs from the `demos/` prototypes
  (check-in desk already real in `frontend/`; lobby from `demos/lobby-display.html`).
- `QueueFn` routes: check-in, walk-in, `assign_next_customer`,
  `/api/clerk/complete`, **`/api/clerk/complete-and-next`** (already chains
  complete → assign-next → summon-email in the demo), `send-to-test`, clerk
  sessions, prescreen submit, `/api/live-queue` polling (5s).
- Async: SQS-buffered summon/confirmation emails; nightly EventBridge
  duration-recommendation worker.
- **Prove fault isolation:** disable `AppointmentFn` and confirm `QueueFn` keeps
  serving (separate APIs, reserved concurrency, separate alarms).
- *Exit:* full in-office flow deployed; appointment and queue domains
  independently deployable and resilient.

Keep docker-compose + Vite proxy working for local dev throughout (LWA makes
prod ≈ local).

---

## Critical files

- `demos/prototype-server.ts` — **source of the endpoints to promote.** Every
  in-scope route already lives here calling `src/*.ts`; production-ify it.
- `server/app.ts` + `server/routes/check-in.ts` — split into appointment/queue
  routers, conditional mount by `SERVICE` env var; LWA packaging point. Receives
  the promoted handlers.
- `src/complete.ts` + `src/queue.ts` — `completeAppointment()` +
  `assignNextCustomer()`; the demo's `/api/clerk/complete-and-next`
  (`demos/prototype-server.ts:912`) already chains them — promote that handler.
- `server/db.ts` — TLS fix, RDS Proxy/IAM creds, env-driven config
- `src/documents.ts` — presigned S3 upload URLs
- `db/schema.sql` — migrate as-is to RDS (no tenancy changes)
- `demos/admin.html`, `demos/lobby-display.html` — prototypes the admin and
  lobby Vite SPAs are built from; `frontend/` is the established SPA pattern
- new `infra/` — the single CDK stack

## Verification

- **Local:** `docker-compose up db` + run each function locally under `tsx`
  with `SERVICE=appointment` / `SERVICE=queue`; confirm the existing Vite
  `/api` proxy still drives the check-in desk.
- **Deployed smoke test:** book via `AppointmentFn` → check in via `QueueFn` →
  assign next customer → complete; confirm QR/confirmation email arrives (SES).
- **Fault-isolation test:** disable `AppointmentFn` (or throttle it to 0) and
  verify `QueueFn` check-in/queue/lobby endpoints stay fully functional.
- **Connection test:** drive concurrent requests across both functions and
  confirm RDS Proxy holds connection count flat (no RDS `max_connections`
  errors).
- **Auth test:** confirm a `checkin_clerk` JWT is rejected on admin-only config
  routes.
