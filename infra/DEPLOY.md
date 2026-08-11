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
  container images at `cdk deploy`. No Docker → the first stack fails.
- AWS CLI v2, authenticated to the target account
- `psql` (PostgreSQL client) and the AWS SSM `session-manager-plugin` — only
  needed if you seed via the SSM tunnel (fallback path, see §6b)

**Region: `us-east-1` is required.** The WAF is CloudFront-scoped and the ACM
cert path is CloudFront-bound, both us-east-1 only. `env-config.ts` asserts this
and fails synth if `CDK_DEFAULT_REGION`/`AWS_REGION` is anything else.

```bash
export CDK_DEFAULT_REGION=us-east-1
export AWS_REGION=us-east-1
```

**Enable Bedrock model access** (Bedrock console → _Model access_). A fresh
account has NO model access; the KB creation and every chat turn depend on it:

| Model                          | Region                                                               | Used for                                     |
| ------------------------------ | -------------------------------------------------------------------- | -------------------------------------------- |
| `anthropic.claude-sonnet-4-6`  | us-east-1 (+ us-east-2, us-west-2 for the inference-profile fan-out) | conversation + KB RetrieveAndGenerate        |
| `amazon.titan-embed-text-v2:0` | us-east-1                                                            | Knowledge Base embeddings (needed at deploy) |
| `anthropic.claude-haiku-4-5`   | us-east-2 (matches `BEDROCK_VISION_REGION`)                          | document-upload screening                    |

**SES:** verify the `SENDER_EMAIL` identity, and submit an SES production-access
request. A sandboxed account silently drops all customer emails
(confirmation/reschedule/queue) — the booking still succeeds, but no email goes
out until production access + a verified/allowed recipient.

**Bootstrap CDK** (once per account/region):

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

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
us-east-1 (synth rejects the template placeholders).

Optional: `ALARM_EMAIL` (SNS alarm recipient), `AUTHID_*` (biometric identity;
without keys the verify-identity step degrades to skip-only).

---

## 2. Build the frontends

CDK packages each SPA's `dist/` directory; it does not build them. `dist/` is
gitignored, so on a fresh clone you must build first or synth fails with an
actionable error.

```bash
npm install
npm run build:frontends
```

---

## 3. Deploy BackOffice

```bash
npx cdk deploy BackOffice
```

Creates the VPC, Aurora + RDS Proxy, Cognito, DocumentsBucket, SQS, DbInitFn,
and the two Docker Lambdas. Note the outputs (`DbInitFnName`, `UserPoolId`,
`DocumentsBucketName`).

---

## 4. Deploy Chatbot

```bash
npx cdk deploy Chatbot
```

Creates the S3 frontends, CloudFront + WAF, ChatbotFn/AdminFn, and the Bedrock
KB (S3 Vectors bucket + index via custom resources). It reads the DocumentsBucket
name straight from the BackOffice stack, so the chatbot doc-bridge is wired to
the correct bucket automatically.

> You can also run both at once: `npx cdk deploy --all` (equivalently
> `npm run deploy`, which rebuilds the frontends first). CDK resolves the
> BackOffice→Chatbot order from the cross-stack dependency.

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

### 6b. (Fallback) Manual DB seed via SSM tunnel

Only if you need to re-seed a live DB out-of-band (DbInitFn seeds automatically
on first deploy). In one terminal open the tunnel, in another run the reset:

```bash
scripts/ssm-db-tunnel.sh        # terminal A — keep open
db/reset-remote.sh              # terminal B — DROPs + recreates schema + seed (interactive 'yes')
```

This is **destructive** (drops the public schema). Do not run it against a DB
with real data. Note it also loads demo data (`seed-appointments.sql`,
`seed-history.sql`) beyond the operational seed that DbInitFn applies — useful
for a populated demo, not wanted in a clean prod cutover.

---

## 7. Email links (BASE_URL)

Customer emails from the BackOffice functions (confirmation/reschedule/queue)
build links from `BASE_URL`. BackOffice deploys **before** the CloudFront domain
exists, so it cannot self-discover it. Two options:

- **Custom domain:** set `CUSTOM_DOMAIN_NAME` (+ cert) up front — links derive
  from it, no second pass.
- **CloudFront default domain:** after the first full deploy, take the Chatbot
  `FrontendUrl` output, set `BASE_URL=<that>` in `.env`, and redeploy BackOffice
  (`npx cdk deploy BackOffice`). Until then, email links are non-functional
  (and SES sandbox blocks them anyway).

---

## 8. Knowledge Base content (optional, for RAG Q&A)

The KB is created empty. Tree-driven flows (routing, required documents,
scheduling) work without it, but general Q&A (fees, hours, statutes) returns
nothing until the KB data-source bucket (`KbDataBucketName` output) is populated
and an ingestion job runs:

```bash
# The KB id and data-source id are NOT CloudFormation outputs — look them up:
KB_ID=$(aws bedrock-agent list-knowledge-bases \
  --query "knowledgeBaseSummaries[?name=='st-lucie-tax-kb'].knowledgeBaseId" --output text)
DATA_SOURCE_ID=$(aws bedrock-agent list-data-sources --knowledge-base-id "$KB_ID" \
  --query "dataSourceSummaries[0].dataSourceId" --output text)

aws s3 cp <your-corpus>/ "s3://<KbDataBucketName>/" --recursive
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id "$KB_ID" --data-source-id "$DATA_SOURCE_ID"
```

(The prototype's scraper/ingest scripts are not included in this repo.)

---

## 9. Smoke test

1. Log into Office Ops (`/`) and Admin (`/admin`) with the Cognito user; confirm
   offices, transaction types, and clerks load (validates seeding).
2. Start a citizen chat (`/chat`), route a transaction, reach a slot list, book.
3. Upload a document in the chat and confirm it appears in the clerk view
   (validates the DocumentsBucket wiring).
4. If SES production access is granted, confirm a booking email arrives.

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
