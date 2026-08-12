# Deploying to a fresh AWS account

This is the authoritative, end-to-end runbook for deploying the St. Lucie Tax
Collector chatbot + scheduling system to a **new, empty AWS account** (e.g. an
ISB sandbox) with no manual code patching. Follow it top to bottom the first
time; later deploys only re-run the parts that changed.

The system is **two CDK stacks** (`infra/bin/app.ts`):

- **BackOffice** — VPC, Aurora Serverless v2 + RDS Proxy, Cognito, DocumentsBucket,
  SQS email worker, the DB-init Lambda, and two Docker-image Lambdas
  (AppointmentFn / QueueFn). **Deploys first.**
- **Chatbot** — S3 frontends, CloudFront (associating the BackOffice WAF
  WebACL), ChatbotFn / AdminFn, and the Bedrock Knowledge Base (S3 Vectors).
  **Deploys second**, consuming BackOffice outputs (VPC, RDS Proxy, Cognito, the
  WAF WebACL ARN, and the DocumentsBucket name).

> These are the ONLY two stacks. Older docs mention `Foundation` / `Backend` /
> `Frontend` / `Security` stacks, a DynamoDB `st-lucie-platform` table, and a
> `VITE_API_KEY` — that architecture is **dead**. Ignore it.

---

## 0. Prerequisites (host + account)

**On the deploy host:**

- Node.js 22+ and npm
- **Docker daemon running** — BackOffice builds the AppointmentFn/QueueFn
  container images at `cdk deploy`. No Docker → the first stack fails. **Verify
  with `docker info`, not `docker --version`.** On WSL the `docker` binary often
  resolves to the Windows Docker Desktop executable while WSL integration is
  switched off: `--version` prints happily and every command that needs the
  daemon fails. If `docker info` errors, enable Docker Desktop → _Settings →
  Resources → WSL integration_ for this distro (or start a native `dockerd`)
  before you reach §3.
- AWS CLI v2, authenticated to the target account
- `psql` + `pg_isready` (PostgreSQL client package), the AWS SSM
  `session-manager-plugin`, and `python3` — only needed if you seed via the SSM
  tunnel (fallback path, see §6b). `db/reset-remote.sh` preflights the tunnel
  with `pg_isready` and parses the DB secret JSON with `python3`.

**Region: `us-east-1` is required.** The WAF is CloudFront-scoped and the ACM
cert path is CloudFront-bound, both us-east-1 only. `env-config.ts` asserts this
and fails synth if `CDK_DEFAULT_REGION`/`AWS_REGION` is anything else.

**Pin the profile AND the region before anything else.** `scripts/post-deploy.sh`,
`scripts/create-user.sh` and `scripts/build-frontends.sh` are plain `aws` CLI
wrappers: they read no `AWS_*` variable of their own and pass no `--region`, so
they hit whatever account/region the CLI resolves on its own — `AWS_PROFILE` for
credentials, then `AWS_REGION` / `AWS_DEFAULT_REGION`, then that profile's own
`region`. A default profile pointing elsewhere fails _after_ an apparently clean
`cdk deploy`, when those scripts' `describe-stacks` lookups error out or return
`None`.

```bash
export AWS_PROFILE=<your-profile>   # omit only if the default profile IS the target account
export CDK_DEFAULT_REGION=us-east-1
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
```

A wrong region fails loudly at synth (the `env-config.ts` assert); a wrong
**account** does not — CDK will happily deploy into it. Prove the account first:

```bash
aws sts get-caller-identity   # Account must be the target account; note it for §2
```

**RDS service-linked role.** BackOffice creates an `AWS::RDS::DBProxy`, which
needs `AWSServiceRoleForRDS`. A brand-new account does not have it, and the proxy
then fails with `RDS is not authorized to assume service-linked role
arn:aws:iam::<acct>:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS`,
rolling the **entire** BackOffice stack back:

```bash
aws iam get-role --role-name AWSServiceRoleForRDS \
  || aws iam create-service-linked-role --aws-service-name rds.amazonaws.com
```

Creating it when it already exists is harmless — the call returns an
`InvalidInput` error saying the role name has been taken; ignore that.

**Enable Bedrock model access** (Bedrock console → _Model access_). A fresh
account has NO model access; the KB creation and every chat turn depend on it:

| Model                          | Region                                                               | Used for                                     |
| ------------------------------ | -------------------------------------------------------------------- | -------------------------------------------- |
| `anthropic.claude-sonnet-4-6`  | us-east-1 (+ us-east-2, us-west-2 for the inference-profile fan-out) | conversation + KB RetrieveAndGenerate        |
| `amazon.titan-embed-text-v2:0` | us-east-1                                                            | Knowledge Base embeddings (needed at deploy) |
| `anthropic.claude-haiku-4-5`   | us-east-2 (matches `BEDROCK_VISION_REGION`)                          | document-upload screening                    |

**SES:** a fresh account has no identities at all, so create and verify the
`SENDER_EMAIL` one:

```bash
aws sesv2 create-email-identity --email-identity <your-sender@example.org>
aws sesv2 get-email-identity --email-identity <your-sender@example.org> \
  --query "VerifiedForSendingStatus"     # false until the emailed link is clicked
```

That sends a confirmation link to the address — **a human has to click it**, so
kick this off early. Then submit an SES production-access request. This is
**non-blocking for the deploy**: both stacks deploy and bookings succeed with an
unverified sender, the emails just never send. A sandboxed account silently drops
all customer mail (confirmation/reschedule/queue) until production access **plus**
a verified/allowed recipient.

> **CDK bootstrap is NOT a step 0 item — it runs in §2, after the build.**
> `cdk bootstrap` loads and synthesizes the CDK app (it resolves environments
> from the assembly), so from a fresh clone it dies on the same synth-time
> guards a deploy would hit. Do not run it from here.

---

## 1. Configure `.env`

```bash
cp .env.example .env
```

Then set, at minimum:

- `SENDER_EMAIL` — your verified SES identity
- `ORIGIN_SECRET` — a real secret: `openssl rand -base64 32`
  (synth rejects the `.env.example` placeholder)

Leave these **blank** on the first deploy (they self-resolve — see notes):

- `DOCUMENTS_BUCKET_NAME` — the Chatbot stack imports the live DocumentsBucket
  from the BackOffice stack automatically. Only set this to pin a pre-existing
  bucket.
- `BASE_URL` — see §7 (email links). Blank is fine for an initial functional
  deploy; set it (or a custom domain) before real customer email goes out.

Leave `CUSTOM_DOMAIN_NAME` / `CUSTOM_DOMAIN_CERTIFICATE_ARN` **commented out**
(the default) to serve on the CloudFront `*.cloudfront.net` domain. To use a
custom domain, uncomment BOTH and set them to a domain you own + an ACM cert in
us-east-1 (synth rejects the template placeholders). If you have a domain,
setting it **now** is the recommended path: `BASE_URL` derives from it and you
skip the two-pass redeploy in §7 entirely.

Optional: `ALARM_EMAIL` (SNS alarm recipient), `AUTHID_*` (biometric identity;
without keys the verify-identity step degrades to skip-only).

---

## 2. Install, build the frontends, bootstrap CDK

Run every command from the repo root — `cdk.json` and the `.env` that
`infra/bin/app.ts` loads both live there. `infra/` has its own
`package.json`/lockfile but is **not** an npm workspace and needs no separate
install; the app resolves `aws-cdk-lib`/`ts-node` from the root `node_modules`.

CDK packages each SPA's `dist/` directory; it does not build them. `dist/` is
gitignored, so on a fresh clone the synth-time guard in `chatbot-stack.ts` fails
with `Frontend build output missing before synth`. **This order is mandatory:**

```bash
npm install                                        # let this finish COMPLETELY
npm run build:frontends
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1     # ACCOUNT_ID from §0's get-caller-identity
```

> Bootstrap last, not first. `cdk bootstrap` synthesizes the app: run it before
> §1 and it dies on the `SENDER_EMAIL` assert in `env-config.ts`; run it before
> the build and it dies on `Frontend build output missing before synth`. Either
> way nothing gets bootstrapped. Bootstrap itself is once per account/region.

> Never race `npm install` against `npx cdk` (e.g. backgrounding the install and
> starting a synth). A half-populated `node_modules` breaks the `ts-node` app
> command in `cdk.json` with
> `Cannot read properties of undefined (reading 'fileExists')`.

---

## 3. Deploy BackOffice

```bash
npx cdk deploy BackOffice --require-approval never
```

Creates the VPC, Aurora + RDS Proxy, Cognito, DocumentsBucket, SQS, DbInitFn,
and the two Docker Lambdas. Note the outputs (`DbInitFnName`, `UserPoolId`,
`DocumentsBucketName`).

> **Why `--require-approval never`:** both stacks create IAM roles/policies, so
> `cdk deploy` otherwise stops at an interactive approval prompt. Any
> non-interactive or agent-driven run hangs there forever. Every `cdk deploy` in
> this doc carries the flag for that reason; drop it if you want to eyeball the
> IAM diff by hand. (`npm run deploy` needs it passed through:
> `npm run deploy -- --require-approval never`.)

---

## 4. Deploy Chatbot

```bash
npx cdk deploy Chatbot --require-approval never
```

Creates the S3 frontends, CloudFront + WAF, ChatbotFn/AdminFn, and the Bedrock
KB (S3 Vectors bucket + index via custom resources). It reads the DocumentsBucket
name straight from the BackOffice stack, so the chatbot doc-bridge is wired to
the correct bucket automatically.

> You can also run both at once: `npx cdk deploy --all --require-approval never`
> (equivalently `npm run deploy`, whose `predeploy` rebuilds the frontends
> first). CDK resolves the BackOffice→Chatbot order from the cross-stack
> dependency.

---

## 5. Initialize the database + upload frontends

```bash
scripts/post-deploy.sh
```

This invokes **DbInitFn**, which on an empty database applies `db/schema.sql`
**and then loads the operational seed data** (`seed.sql`, `seed-docs.sql`,
`seed-flows.sql` — offices, transaction types, clerks, document registry,
decision-tree flows). It is idempotent: on an already-initialized DB it skips
both schema and seed. The script then builds + uploads the three SPAs, writes
`config.json`, and invalidates CloudFront.

> `force: true` bypasses the empty-DB check and re-runs `schema.sql` verbatim;
> `schema.sql` is not drop-guarded and the seed files are not conflict-guarded,
> so `force` only succeeds cleanly against an EMPTY DB. To rebuild a live DB, use
> the destructive reset in §6b, not `force`.

Confirm the invoke output is `{"status":"applied","seeded":true}` on a fresh DB
(or `{"status":"skipped"}` if the DB was already initialized). Row counts are not
surfaced in the payload — validate seeding via the §9 smoke test or a direct DB
query over the §6b SSM tunnel.

---

## 6. Create the first staff user

Cognito self-signup is disabled; all three SPAs (including the citizen chatbot)
require a login. Create an admin/clerk user:

```bash
scripts/create-user.sh you@example.com 'a-strong-password' admin,checkin_clerk,service_clerk
```

The third argument is a comma-separated group list (that same trio is the
default). Those are the only groups that exist — BackOffice creates exactly
`admin`, `checkin_clerk`, `service_clerk`.

**Verify the groups actually landed.** A user in ZERO groups authenticates fine
and then gets `403 Insufficient permissions` from every API (`office-ops` and
`admin` both gate on the `cognito:groups` claim), which reads like a broken
deploy rather than a broken user:

```bash
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name BackOffice \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
aws cognito-idp admin-list-groups-for-user \
  --user-pool-id "$USER_POOL_ID" --username you@example.com \
  --query "Groups[].GroupName"
```

Expect every group you passed to come back. (`create-user.sh` resolves the pool
id from the same `UserPoolId` output.)

### 6b. (Fallback) Manual DB seed via SSM tunnel

Only if you need to re-seed a live DB out-of-band (DbInitFn seeds automatically
on first deploy). In one terminal open the tunnel, in another run the reset:

```bash
scripts/ssm-db-tunnel.sh        # terminal A — keep open
db/reset-remote.sh              # terminal B — DROPs + recreates schema + seed (interactive 'yes')
```

Terminal B is a fresh shell and does **not** inherit §0's `AWS_PROFILE` /
`AWS_REGION` exports. `db/reset-remote.sh` reads the DB secret with plain `aws`
calls, defaulting the region to `AWS_REGION` → `AWS_DEFAULT_REGION` →
`us-east-1` (so the region is silently right here, but credentials come from
whatever profile the CLI resolves — the wrong account fails at the
`describe-stack-resources` secret lookup). Re-export both in terminal B before
running it, or set `PGPASSWORD` yourself to skip the lookup entirely.

This is **destructive** (drops the public schema). Do not run it against a DB
with real data. Note it also loads demo data (`seed-appointments.sql`,
`seed-history.sql`) beyond the operational seed that DbInitFn applies — useful
for a populated demo, not wanted in a clean prod cutover.

---

## 7. Email links (BASE_URL)

`BASE_URL` feeds customer email links in **both** stacks: the BackOffice
functions (confirmation/reschedule/queue/prescreen) and ChatbotFn's own
booking-confirmation email. Neither stack can self-discover the CloudFront
domain — a Lambda env var referencing `distribution.distributionDomainName` makes
ChatbotFn depend on FrontendDist, which depends on ChatbotApi, which depends on
ChatbotFn: an unresolvable synth-time circular dependency. So `BASE_URL` is a
plain string from `.env`.

- **Recommended — custom domain:** set `CUSTOM_DOMAIN_NAME` (+ cert) in §1 before
  the first deploy. Links derive from it, no second pass.
- **CloudFront default domain (two-pass):** after the first full deploy, read the
  Chatbot `FrontendUrl` output, set `BASE_URL` to it in `.env`, then redeploy
  **both** stacks:

  ```bash
  aws cloudformation describe-stacks --stack-name Chatbot \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" --output text
  # put that value in .env as BASE_URL=..., then:
  npx cdk deploy --all --require-approval never
  ```

  `npx cdk deploy BackOffice` alone is not enough — ChatbotFn consumes `BASE_URL`
  too and would keep its first-pass value.

On the first pass with neither `CUSTOM_DOMAIN_NAME` nor `BASE_URL` set, both
stacks omit the variable entirely, so each app falls back to its own localhost
default — BackOffice emails link to `http://localhost:3000` /
`http://localhost:5173` (`services/office-ops/server/config.ts`) and the
chatbot's booking-confirmation email to `http://localhost:5173`
(`services/chatbot/src/local-server-app.ts:1167`). The links are **visibly
wrong, not merely absent**: do not send real customer mail until the second pass
is done (SES sandbox suppresses it anyway — see §0).

---

## 8. Knowledge Base content (optional, for RAG Q&A)

The KB is created empty. Tree-driven flows (routing, required documents,
scheduling) work without it, but general Q&A (fees, hours, statutes) returns
nothing until the KB data-source bucket (`KbDataBucketName` output) is populated
and an ingestion job runs:

```bash
KB_BUCKET=$(aws cloudformation describe-stacks --stack-name Chatbot \
  --query "Stacks[0].Outputs[?OutputKey=='KbDataBucketName'].OutputValue" --output text)

# The KB id and data-source id are NOT CloudFormation outputs — look them up:
KB_ID=$(aws bedrock-agent list-knowledge-bases \
  --query "knowledgeBaseSummaries[?name=='st-lucie-tax-kb'].knowledgeBaseId" --output text)
DATA_SOURCE_ID=$(aws bedrock-agent list-data-sources --knowledge-base-id "$KB_ID" \
  --query "dataSourceSummaries[0].dataSourceId" --output text)

aws s3 cp <your-corpus>/ "s3://$KB_BUCKET/" --recursive
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id "$KB_ID" --data-source-id "$DATA_SOURCE_ID"
```

(The prototype's scraper/ingest scripts are not included in this repo.)

---

## 9. Smoke test

Every path below is relative to the Chatbot stack's `FrontendUrl` output (the
CloudFront domain, or your custom domain) — resolve it once, and print it when
you need the literal host to paste into a browser:

```bash
FRONTEND_URL=$(aws cloudformation describe-stacks --stack-name Chatbot \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" --output text)
echo "$FRONTEND_URL"
```

1. **API reachability (curl, no login needed).** Both API paths look doubled;
   they are correct:

   ```bash
   curl -s "$FRONTEND_URL/api/admin/admin/health"        # {"ok":true,"authEnabled":true}
   curl -s "$FRONTEND_URL/api/chat/chatbot/hot-buttons"  # JSON array of 6 {label,prompt}
   ```

   CloudFront forwards the matched viewer path unchanged, and each Express app
   strips only its own CloudFront prefix (`/api/admin` in
   `services/admin/src/admin-app.ts`, `/api/chat` in
   `services/chatbot/src/local-server-app.ts`) — so the remaining segment must be
   the app's own route root (`/admin/health`, `/chatbot/hot-buttons`). The
   intuitive `/api/admin/health` and `/api/chat/health` match **no route** and
   come back `{"error":"Not found"}`; the chatbot has no `/health` route at all.

   The hot-buttons call is the real end-to-end probe: it is public (no Cognito),
   and it `SELECT`s from the seeded `hotbuttons` table, so a populated array
   proves CloudFront → API Gateway → Lambda → RDS Proxy → Aurora → seed data.
   Its handler catches DB errors and returns `[]`, so an **empty array means
   broken or unseeded DB**, not "no hot buttons".

2. Log into Office Ops (`/`) and Admin (`/admin`) with the Cognito user; confirm
   offices, transaction types, and clerks load (validates seeding).
3. Start a citizen chat (`/chat`), route a transaction, reach a slot list, book.
4. Upload a document in the chat and confirm it appears in the clerk view
   (validates the DocumentsBucket wiring).
5. If SES production access is granted, confirm a booking email arrives.

---

## Secrets

Auth is enforced by **Cognito** (staff) and `ORIGIN_SECRET` (CloudFront→origin).
There is no separate Secrets-Manager population step for app auth in this
architecture. The DB password is auto-managed by CDK (`DatabaseSecret`) and read
by the Lambdas at runtime. Rotate `ORIGIN_SECRET` by changing `.env` and
redeploying the Chatbot stack (rebuild + re-upload the SPAs is not required —
the secret is server-side only).

## Region / cost notes

Single-AZ-friendly sizing (`env-config.ts`): Aurora 0.5–2 ACU, 1 NAT gateway,
`RemovalPolicy.DESTROY` on data stores (fine for a sandbox; harden for prod).
Everything is us-east-1.
