# Production Handoff Notes

For the partner team taking this prototype to production. **`infra/DEPLOY.md`
covers the mechanics of `cdk deploy`** — this doc captures everything else:
what's deployed today, the secrets you'll need to rotate, traps that won't
fire in UAT but will in production, and tasks intentionally left for you.

---

## 1. Where things stand today

**Environment:** UAT only.

**AWS:** account `522814693903`, region `us-east-1`. SSO via the
`AdministratorAccess-522814693903` profile. All four core stacks are
deployed (`Foundation`, `Backend`, `Frontend`, `Security`) plus the admin
stack.

**Live URLs:**

| Surface        | URL                                                         |
| -------------- | ----------------------------------------------------------- |
| Customer SPA   | https://d2ewptrrn0hvd3.cloudfront.net                       |
| Admin SPA      | https://d2kfwcgztht3zc.cloudfront.net                       |
| API Gateway    | https://b4ki4882va.execute-api.us-east-1.amazonaws.com/api/ |
| Chatbot Lambda | `st-lucie-chatbot-express-app`                              |
| Admin Lambda   | `st-lucie-admin-app`                                        |
| DDB table      | `st-lucie-platform`                                         |
| S3 doc bucket  | published in SSM under `/stlucie/doc-bucket-name`           |

**State of in-flight work:**

- AuthID Proof + Verified flow (DL scan + selfie + liveness) is fully
  integrated and tested against the AuthID UAT tenant. See `services/chatbot/src/authid/`.
- The legacy Bedrock-multimodal OCR Lambda (`services/identity-doc/`) was
  removed; the S3-trigger pattern that fed it is gone. AuthID replaces it
  entirely.
- The conversation flow is end-to-end: landing → identify-transaction →
  universal-blockers (eligibility check) → verify-identity (AuthID) →
  resolve-facts (decision-tree-driven Q&A) → confirm-facts → upload-docs →
  checkout-check → schedule. The `schedule` state is currently a terminal
  stub — booking isn't wired up.

---

## 2. Secrets you need to rotate before production

**SEC-02 changed where secrets live.** The 4 chatbot secrets + 2 admin secrets
are now in **AWS Secrets Manager** (`stlucie/chatbot/app-secrets`,
`stlucie/admin/app-secrets`), fetched at Lambda cold start — NOT read by CDK at
synth and NOT in the Lambda env. Rotate them with `aws secretsmanager
put-secret-value` + a forced cold start (runbook: `infra/DEPLOY.md` →
"Secrets (SEC-02)"); no redeploy needed. `infra/.env.deploy` keeps these values
only as the operator's source for the populate command, plus the NON-secret
config CDK still reads (`AUTHID_BASE_URL`, `AUTHID_DL_DOC_TYPE_CODE`, `SCHEDULING_*`).

| Variable                               | Where it lives                       | What you need to do                                            |
| -------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| `AUTHID_BASE_URL`                      | env var (CDK, non-secret)            | Change to `https://id.authid.ai` for prod                      |
| `AUTHID_API_KEY_ID`                    | **Secrets Manager** (chatbot secret) | Generate a fresh prod-tenant key; `put-secret-value`           |
| `AUTHID_API_KEY_VALUE`                 | **Secrets Manager** (chatbot secret) | Same — generate fresh; AuthID shows the value ONCE             |
| `AUTHID_DL_DOC_TYPE_CODE`              | env var (CDK, non-secret)            | Re-verify against your prod tenant's doc-type list; may differ |
| `BETA_PASSWORD`                        | **Secrets Manager** (chatbot secret) | Rotate via `put-secret-value`; gates the SPA login             |
| `BETA_AUTH_SECRET`                     | **Secrets Manager** (chatbot secret) | Rotate via `put-secret-value`; HMAC key for the bearer token   |
| `ADMIN_PASSWORD` / `ADMIN_AUTH_SECRET` | **Secrets Manager** (admin secret)   | Rotate via `put-secret-value` on `stlucie/admin/app-secrets`   |

The UAT keys have been embedded in development conversation transcripts.
Treat them as compromised once you have prod keys — disable the UAT key in
the AuthID portal, generate a fresh one for any continued UAT work.

**API Gateway key** — the value the SPA bakes into builds as `VITE_API_KEY`.
The current value is in `/stlucie/beta-api-key-id` (just the ID; fetch the
value via `aws apigateway get-api-key --include-value`). Rotate by deleting
and recreating the usage-plan key. See `infra/DEPLOY.md` §"Retrieve API key
value".

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

**Email transcripts.** The SPA has a "Submit Transcript" button. Today the
backend builds a PDF and posts it to a feedback DDB row. There's a
`sendTranscriptForSession` helper wired to an SES sender, but **SES is in
sandbox mode for the AWS account** — recipients have to be verified
identities. To go live: move the account out of SES sandbox AND verify
the sending identity.

**Bedrock cost alarms.** `StLucieSecurityStack` provisions billing alarms
that fire to SNS topic `stlucie-beta-alarms`. The original developer's
email is subscribed; **AWS sends a confirmation email and won't deliver
alerts until you click it**. Add your own on-call recipients (see
`infra/DEPLOY.md` §"Confirm alarm topic email subscription"). Also enable
billing-metrics emission in the AWS console (one-time per account).

**Knowledge Base ID is hardcoded.** `BEDROCK_KB_ID = 'DREJTMKWRM'` in
`infra/backend-stack.ts`. This is the FLHSMV ops-manual KB built during
prototype work. If you want to point at a different/refreshed KB, edit
that line and redeploy. The KB ingestion pipeline is in
`scripts/ingest-flhsmv-ops-manual.ts` and `scripts/scrape-kb-*.ts`.

**API Gateway requires `x-api-key`.** Every endpoint has `apiKeyRequired: true`.
The SPA bakes the value in at build time (`VITE_API_KEY`). Curl smoke tests
must include the header. If you rotate the key, **rebuild + redeploy the SPA**
or browser users will hit 403.

---

## 5. Production cutover checklist

This is the work intentionally left for you. Treat it as the first
deploy from your own credentials.

- [ ] Generate a new prod-tier AuthID API key in your portal. Copy the ID
      and value (value shown ONCE).
- [ ] Verify the prod-tenant doc-type code for "US Driver's License" via
      `GET /IDCompleteBackendEngine/Default/AdministrationServiceRest/v1/idDocumentTypes`.
- [ ] Update `infra/.env.deploy` with prod values + flip `AUTHID_BASE_URL`
      to `https://id.authid.ai`.
- [ ] Rotate `BETA_PASSWORD` and `BETA_AUTH_SECRET` to fresh values.
- [ ] Rotate the API Gateway key (delete the existing usage-plan key,
      let CDK recreate it).
- [ ] `cdk deploy` all four stacks (`Foundation`, `Backend`, `Frontend`,
      `Security`) + admin stack.
- [ ] Confirm SNS subscription for billing alarms (click the AWS email).
- [ ] Enable `Receive Billing Alerts` in AWS console (Billing → Billing
      preferences).
- [ ] Move SES out of sandbox if email transcripts are required for
      production. Otherwise document that they'll silently no-op.
- [ ] Rebuild the customer SPA with the new `VITE_API_KEY` and deploy
      (`StLucieFrontendStack`).
- [ ] Smoke-test verify-identity end-to-end with a real DL on a real
      device. The first Proof transaction also creates the AuthID account
      record, so the second visit (rehydrate) should trigger Verified.
- [ ] Run `npx playwright test` against the prod URL with `@example.com`
      test emails to confirm the chat surface is healthy.

---

## 6. Things you'll find in the repo that are NOT production code

- `legacy/` — design-time AIDLC artifacts, prior-iteration plans, demo
  scripts. Read `legacy/README.md` if you want context on how the system
  evolved; **none of it is authoritative**.
- `services/chatbot/src/handlers/express-app.handler.ts` is the Lambda
  entrypoint. Every other `*.handler.ts` was deleted in the cleanup pass —
  routes live inline in `local-server-app.ts`.
- `local-server.ts` (20 lines) is just the dev-mode `app.listen()` runner;
  the real Express app is `local-server-app.ts`. Both export the same
  shared `app` instance.
- The `tests/eval/` and `tests/test-pass/` directories contain LLM-as-judge
  evals + tree-audit fixtures. They're useful for regression but aren't
  required for deploy.

---

## 7. Open known limitations

- `schedule` state is a terminal stub. Booking integration is unbuilt.
- Email transcripts depend on SES being out of sandbox.
- The KB is FLHSMV ops-manual content from May 2026; not auto-refreshed.
- `services/admin` is read-only — no write operations on session rows.
- No auth on the admin SPA other than the same beta password — fine for
  prototype, will need real RBAC for production staff use.
- Walk-in / SMS channels (`channel: 'walkin' | 'sms'`) have partial
  implementations; only the `web` channel is fully exercised.

---

## 8. Who built what

This prototype was built by Mason Lewis under the Cal Poly DxHub umbrella
(`mlewis77@calpoly.edu`). All design decisions are the developer's; the
AIDLC artifacts under `legacy/aidlc-docs/` reflect the original design
intent but the system has diverged from them substantially.

For questions about specific design choices, the commit history under
`git log` is the most accurate authority — commits are individually
descriptive and reference the why, not just the what.
