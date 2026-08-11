# Production Handoff Notes

For the partner team taking this prototype to production. **`infra/DEPLOY.md`
is the authoritative from-zero deploy runbook** (fresh account, prerequisites,
ordered steps). This doc captures everything else: what's deployed today, the
secrets you'll need to rotate, traps that won't fire in UAT but will in
production, and tasks intentionally left for you.

> **Doc-accuracy note (2026-08):** earlier revisions of this file described a
> four-stack architecture (`Foundation`/`Backend`/`Frontend`/`Security`), a
> DynamoDB `st-lucie-platform` table, a `VITE_API_KEY`, and "booking not wired."
> **All of that is dead.** The current system is two CDK stacks (`BackOffice`,
> `Chatbot`), Cognito auth, Aurora Postgres (no DDB), and end-to-end booking.
> Where sections below still reference the old model, trust `infra/DEPLOY.md`
> and `README.md` over this file.

---

## 1. Where things stand today

**Environment:** UAT only.

**AWS:** account `111122223333`, region `us-east-1`. SSO via the
`AdministratorAccess-111122223333` profile.

**Architecture:** two CDK stacks (`infra/bin/app.ts`):

- **BackOffice** — VPC, Aurora Serverless v2 (PostgreSQL 17.4) + RDS Proxy,
  Cognito, DocumentsBucket, SQS email worker, DbInitFn, and two Docker Lambdas
  (AppointmentFn / QueueFn).
- **Chatbot** — S3 frontends, single CloudFront distribution + WAF, ChatbotFn /
  AdminFn, Bedrock Knowledge Base (S3 Vectors). Serves the citizen chatbot
  (`/chat`), admin (`/admin`), and office-ops (`/`) SPAs, and routes `/api/*`.

The persistence store is **Aurora PostgreSQL** (`db/schema.sql`) — there is no
DynamoDB. Auth is **Cognito** (staff groups admin/checkin_clerk/service_clerk)
plus an `ORIGIN_SECRET` header enforcing CloudFront-only access to the APIs.

**State of in-flight work:**

- AuthID Proof + Verified flow (DL scan + selfie + liveness) is fully
  integrated and tested against the AuthID UAT tenant. See `services/chatbot/src/authid/`.
- The legacy Bedrock-multimodal OCR Lambda (`services/identity-doc/`) was
  removed; the S3-trigger pattern that fed it is gone. AuthID replaces it
  entirely.
- The conversation flow is end-to-end: landing → identify-transaction →
  universal-blockers (eligibility check) → resolve-facts (decision-tree-driven
  Q&A) → verify-identity (AuthID) → confirm-facts → upload-docs → checkout-check
  → schedule. **Booking is fully wired** (`book_appointment` in `db/schema.sql`),
  and chatbot document uploads bridge to the clerk view.

---

## 2. Secrets and how auth works

Auth is **Cognito** (staff pool, groups `admin`/`checkin_clerk`/`service_clerk`)
plus the **`ORIGIN_SECRET`** header that CloudFront injects and the Lambdas
validate to block direct API-Gateway access. There is **no** application-auth
password scheme (no `BETA_PASSWORD`/`ADMIN_PASSWORD`, no Secrets-Manager
app-secret, no `VITE_API_KEY`/API-Gateway key) — any older note describing those
is dead.

- **`ORIGIN_SECRET`** — a plain `.env` value read at synth. Rotate by editing
  `.env` and redeploying the Chatbot stack (`npx cdk deploy Chatbot`). No SPA
  rebuild needed; it's server-side only.
- **DB password** — CDK-managed (`DatabaseSecret`, `back-office-stack.ts`),
  auto-rotatable via RDS/Secrets Manager. Nothing manual.
- **AuthID keys** (`AUTHID_API_KEY_ID` / `AUTHID_API_KEY_VALUE`) — plain `.env`
  values injected into `ChatbotFn` at deploy (`chatbot-stack.ts`). For prod,
  generate fresh prod-tenant keys, flip `AUTHID_BASE_URL` to
  `https://id.authid.ai`, re-verify `AUTHID_DL_DOC_TYPE_CODE` against the prod
  tenant's doc-type list, and redeploy the Chatbot stack. **Treat the UAT keys
  as compromised** (they appear in development transcripts) — disable the UAT
  key in the AuthID portal once prod keys exist.

See `infra/DEPLOY.md` → "Secrets".

---

## 3. AuthID portal setup specifics

When you generate the prod-tenant API key, also confirm these portal
settings (Settings → General → Proof Portal Settings):

- **Auto Enroll on Proof Success:** ON. Required so a Proof transaction
  also enrolls the customer's biometric credential — the Verified flow at
  rehydrate time depends on this.
- **Allow Document Types:** US driver license must be in the list. Note
  the numeric code AuthID assigns — drop it into `AUTHID_DL_DOC_TYPE_CODE`.
  (UAT had it as `"2"`, but the list is per-tenant.)
- **Account Lockout:** ON, default attempt count is fine. Locked accounts
  return HTTP 409 to the Verified call; `services/chatbot/src/authid/client.ts`
  surfaces this as `code: 'ACCOUNT_LOCKED'`.

The `start_authid_proof` tool calls `ensureAccountExists` before opening a
Proof transaction. That function handles AuthID's quirk where GET account
returns `200` with body `null` for missing accounts. No action needed; just
worth knowing it's an intentional defensive parse.

---

## 4. Traps that won't fire in UAT but will in production

**Test-session flagging.** `CLAUDE.md` documents a load-bearing rule: any
session created with an `@example.com` email gets `isTestSession: true`,
which the admin dashboard hides by default. Real customer emails will not
match this — they'll show up in the dashboard as you'd expect. The `dev@`
or `test@` prefix doesn't matter; only `@example.com` does. If you want a
production-side "internal staff smoke test" exemption, add a header-driven
override (`x-test-session: 1`); the SPA can't send custom headers (CORS
strips them), but `curl` and CI scripts can.

**Email (confirmations, reschedule, queue, transcripts).** All customer email
is sent via SES from the BackOffice functions, and **SES starts in sandbox mode**
on a fresh account — sends silently no-op (booking still succeeds) until you
verify the sender identity AND request production access. Per-message feedback /
transcript content is stored in Postgres (`feedback` table), not DynamoDB. To go
live: move the account out of SES sandbox and verify `SENDER_EMAIL`.

**Bedrock / error alarms.** The Chatbot stack (`chatbot-stack.ts`) provisions
Bedrock spend/error/throttle alarms wired to an SNS topic. **No recipient is
subscribed unless you set `ALARM_EMAIL` in `.env` before deploy** (it defaults
empty); then click the AWS confirmation email. Also enable billing-metrics
emission in the console (one-time per account) if you want billing alarms.

**Knowledge Base is provisioned by CDK, not hardcoded.** The KB is created in
`infra/lib/chatbot-stack.ts`; its id reaches the Lambda as `BEDROCK_KB_ID` via a
CloudFormation attribute (`knowledgeBase.attrKnowledgeBaseId`) — nothing to edit.
The KB starts **empty** on a fresh deploy; loading content (e.g. FLHSMV
ops-manual) is a separate, optional step — see `infra/DEPLOY.md` §8.

**APIs are CloudFront-only, not API-key-gated.** No endpoint requires an API key
(there is no `apiKeyRequired`/`VITE_API_KEY`). Access control is the
`x-origin-secret` header CloudFront injects (`chatbot-stack.ts`); a direct curl
to the raw API-Gateway origin URL is rejected. Smoke-test against the CloudFront
domain, not the origin.

---

## 5. Production cutover checklist

This is the work intentionally left for you. Treat it as the first
deploy from your own credentials.

- [ ] Generate a new prod-tier AuthID API key in your portal. Copy the ID
      and value (value shown ONCE).
- [ ] Verify the prod-tenant doc-type code for "US Driver's License" via
      `GET /IDCompleteBackendEngine/Default/AdministrationServiceRest/v1/idDocumentTypes`.
- [ ] Update `.env` with prod AuthID values + flip `AUTHID_BASE_URL`
      to `https://id.authid.ai`.
- [ ] Set a fresh `ORIGIN_SECRET` in `.env` (`openssl rand -base64 32`).
- [ ] `npx cdk deploy --all` (BackOffice then Chatbot — order auto-resolved),
      then `scripts/post-deploy.sh`. Full steps: `infra/DEPLOY.md`.
- [ ] Create staff Cognito users: `scripts/create-user.sh <email> <pw> <groups>`.
- [ ] Confirm SNS subscription for the Chatbot stack's alarms (set `ALARM_EMAIL`
      and click the AWS confirmation email).
- [ ] Enable `Receive Billing Alerts` in AWS console (Billing → Billing
      preferences).
- [ ] Move SES out of sandbox (and verify the sender identity) — otherwise ALL
      customer emails (confirmation/reschedule/queue/transcripts) silently
      no-op, not just transcripts.
- [ ] Set `BASE_URL` (or a custom domain) so email links resolve to this
      deployment — see `infra/DEPLOY.md` §7.
- [ ] Smoke-test verify-identity end-to-end with a real DL on a real
      device. The first Proof transaction also creates the AuthID account
      record, so the second visit (rehydrate) should trigger Verified.
- [ ] Run `npx playwright test` against the prod URL with `@example.com`
      test emails to confirm the chat surface is healthy.

---

## 6. Things you'll find in the repo that are NOT production code

- Design/iteration context lives in `docs/` (design docs, `database-design.md`,
  `aws-serverless-architecture.md`) and `docs/superpowers/plans/` (prior-iteration
  plans). These explain _how_ the system evolved; the code is the authority.
- `services/chatbot/src/handlers/express-app.handler.ts` is the Lambda
  entrypoint. Every other `*.handler.ts` was deleted in the cleanup pass —
  routes live inline in `local-server-app.ts`.
- `local-server.ts` (20 lines) is just the dev-mode `app.listen()` runner;
  the real Express app is `local-server-app.ts`. Both export the same
  shared `app` instance.
- Tests live under `tests/unit`, `tests/integration`, and `tests/e2e`
  (Playwright), with legacy tree tests under `tests/unit-legacy/`. See
  `tests/TESTING.md`. They're useful for regression but aren't required for deploy.

---

## 7. Open known limitations

- Email delivery depends on SES being out of sandbox (see §4).
- The KB starts empty; content is loaded out-of-band and not auto-refreshed
  (`infra/DEPLOY.md` §8).
- `services/admin` is nearly read-only; the only write is
  `PATCH /admin/sessions/:id/reviewed` (marks a session reviewed).
- Walk-in / SMS channels (`channel: 'walkin' | 'sms'`) have partial
  implementations; only the `web` channel is fully exercised.

---

## 8. Who built what

This prototype was built by Mason Lewis under the Cal Poly DxHub umbrella
(`maintainer@example.com`). All design decisions are the developer's; the design
docs under `docs/` reflect the original intent but the system has diverged from
them substantially — the code and `git log` are the authority.

For questions about specific design choices, the commit history under
`git log` is the most accurate authority — commits are individually
descriptive and reference the why, not just the what.
