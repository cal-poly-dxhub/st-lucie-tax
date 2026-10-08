# Working notes for AI agents in this repo

Conventions and gotchas accumulated across the chatbot work. Read these
before doing anything that touches the deployed app, the data files, or
the test infrastructure.

## Test sessions vs. real tester sessions

The admin dashboard hides "test sessions" by default (Playwright probes,
curl smoke checks, dev-time exploration). The flag on the SESSION row is
`isTestSession: true`. Two ways a session gets flagged at create time:

1. **Email ends in `@example.com`** — IETF-reserved test domain. No real
   tester ever owns one of these. **This is the load-bearing rule.**
2. **Request carries `x-test-session: 1`** header. Works for direct curl
   smoke tests and eval scripts. Does NOT work from a browser tab — the
   browser's CORS layer strips custom headers added post-preflight, and
   the SPA's `fetch()` can't pre-declare the header without becoming
   permanently coupled to test behavior.

**The rule for agents writing new tests:**

- **Always use `@example.com` emails for test sessions.** Existing
  Playwright specs already do (`probe-${Date.now()}@example.com`,
  `route-newdealer-${Date.now()}@example.com`, etc.). Maintain that.
- For curl smoke tests, also use `@example.com`. The header is optional
  and redundant when the email already does the job.

The verification you should run after a Playwright spec lands sessions:
log into the admin dashboard, toggle "Show test sessions" on, confirm
your sessions show the gray TEST badge. If they show without the badge
under "Show test sessions" off, your spec didn't use @example.com — fix
the spec's email.

## Trees as source of truth

The decision trees + item catalog are the only authoritative source for
"what does the customer need to bring." Three layers enforce this:

1. **State prompts include `NO_DOC_LIST_FROM_MEMORY`** — explicit rule
   forbidding the LLM from improvising checklists. State prompts that
   should NOT carry this rule: `confirm-facts`, `confirm`
   (those states ARE the doc-rendering surface). Every other state must
   include it. See `services/chatbot/src/prompts/default-prompts.ts`.

2. **`render_resolved_buckets` is the only sanctioned doc-listing
   tool.** When the customer asks "what do I need?" mid-flow, the LLM
   calls this tool, which returns the live `resolvedBuckets` from the
   session or `{ status: 'not-yet-resolved' }`. The bot must render
   the result verbatim — never paraphrase.

3. **`assertNoRogueChecklist` post-process guard** rewrites
   checklist-shaped output in non-rendering states. Catches the 1% of
   LLM violations the prompt rule misses. Don't disable this when
   tests start failing — fix the prompt or fix the state.

If you're tempted to make the bot summarize requirements outside of
`confirm-facts`, you're doing it wrong. The side panel renders the
canonical list; the chat reply should be silent or punt.

## Conservative routing

The bot must never confidently route an ambiguous customer message to a
single transaction. The `vehicle-purchase-ambiguous` cluster is the
canonical example:

- `"I bought a new car from a dealer"` → routes to `new-vehicle-title`
- `"I bought a used car from my brother"` → routes to `vehicle-title-transfer`
- `"I bought a car"` → returns `{ status: 'requires-clarification' }`,
  the LLM asks the customer to pick from 4 options, no `confirm_selections`
  fires until they answer.

When adding a new cluster, ask: "could this customer's words plausibly
mean two different transactions?" If yes, build a disambiguator parent

- tight children. The cost of one extra question is much lower than
  the cost of routing to the wrong tree. See
  `services/chatbot/src/tools/suggest-transactions/tools.ts` for the
  three-bucket cluster model (specific / disambiguators / children).

## Deploys and AWS state

The system is **two CDK stacks** defined in `infra/bin/app.ts`: `BackOffice`
(VPC, Aurora + RDS Proxy, Cognito, DocumentsBucket, DbInitFn, the two Docker
Lambdas) and `Chatbot` (S3 frontends, CloudFront + WAF, ChatbotFn/AdminFn,
Bedrock KB). BackOffice deploys first; Chatbot consumes its outputs. There is no
`StLucieBackendStack`/`Foundation`/`Backend`/`Security` stack and no DynamoDB —
if you see those names in older notes, they're dead.

**The authoritative deploy runbook is `infra/DEPLOY.md`.** Summary:

```bash
export AWS_PROFILE=<target-account>   # the scripts below are plain `aws` calls
export CDK_DEFAULT_REGION=us-east-1   # required (CloudFront WAF/ACM)
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
aws sts get-caller-identity           # prove the account; note the id for bootstrap
aws iam get-role --role-name AWSServiceRoleForRDS \
  || aws iam create-service-linked-role --aws-service-name rds.amazonaws.com   # fresh account
cp .env.example .env                  # set SENDER_EMAIL + a real ORIGIN_SECRET
npm install                           # postinstall builds packages/*/dist
npm run build:frontends               # dist/ is gitignored; build before any synth
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1   # AFTER the build — bootstrap synthesizes too
npx cdk deploy --all --require-approval never   # BackOffice then Chatbot (order auto-resolved)
scripts/post-deploy.sh                # DbInit (schema + seed on empty DB) + upload SPAs + config.json
scripts/create-user.sh staff@yourcounty.gov 'Deploy2026temp' admin,checkin_clerk,service_clerk   # zero groups = 403 from every API; password needs min 8 + upper + lower + digit; avoid @example.com (flags sessions as test → hidden in admin)
```

Order matters: `npm install` and `npm run build:frontends` come BEFORE
`cdk bootstrap`, because bootstrap synthesizes the app and a missing frontend
`dist/` trips the synth-time guard in `chatbot-stack.ts`. Both stacks create IAM
roles, so a non-interactive `cdk deploy` needs `--require-approval never` or it
hangs at the approval prompt.

Docker must be running (BackOffice builds container images at deploy). A fresh
account also needs Bedrock model access enabled (Sonnet 4.6 us-east-1, Titan
Embed v2 us-east-1, Haiku 4.5 us-east-2), SES sender verification, and the RDS
service-linked role above — without it RDS Proxy rolls the whole BackOffice
stack back (the `get-role` guard skips the create when the role already exists;
a bare create would exit non-zero on `InvalidInput` and abort a `set -e` run).
See `infra/DEPLOY.md` §0.

Email links are a second pass: set `BASE_URL` in `.env` from the Chatbot
`FrontendUrl` output, then `npx cdk deploy --all` — **both** stacks read it
(BackOffice functions and ChatbotFn), so redeploying BackOffice alone leaves the
chatbot on its first-pass value. See `infra/DEPLOY.md` §7.

CDK pulls from the working tree, not a git ref. Whatever's in `services/*/src/`
at deploy time is what runs. Auth is **Cognito** (staff) + `ORIGIN_SECRET`
(CloudFront→origin); the DB password is CDK-managed (`DatabaseSecret`) and read
at Lambda cold start. There is no separate Secrets-Manager app-auth step in this
architecture (the old SEC-02 `BETA_PASSWORD`/`ADMIN_PASSWORD` scheme is gone).

Frontend-only changes: `scripts/build-frontends.sh` (builds + uploads + CloudFront
invalidation, resolving the live bucket from stack outputs). Frontends are
runtime-config-driven (`config.json`), not `VITE_API_KEY`-baked.

The `aws sso login` token expires every few hours. When you see
`The SSO session associated with this profile has expired`, ask the
user to re-login interactively — don't try to authenticate yourself.

## When you change a tree, fact, or item

Run lint + relevant unit tests:

```bash
npx tsx scripts/lint-decision-trees.ts
npx tsx tests/unit-legacy/trees/new-vehicle-title.test.ts   # or the relevant tree's test in tests/unit-legacy/trees/
```

Then re-read the per-tree `<txn>.review.md` for anything you changed —
many "findings" are intentional and documented there.

## When you add a new transaction

1. Author the tree (`services/chatbot/src/data/decision-trees/<txn>.json`).
2. Add facts to `fact-definitions.json` and items to `item-catalog.json`.
3. Add an `INSERT INTO transaction_types` row to `db/seed.sql`. The
   `description` column is a JSON blob carrying `summary`, `keywords`,
   `commonPhrases`, and `category` (the chatbot parses it for routing). It
   loads on an empty DB via DbInitFn; on a live DB add it through the admin
   config **transactions** tab. There is no DynamoDB and no
   `scripts/seed-data.ts`.
4. Add a routing cluster to
   `services/chatbot/src/tools/suggest-transactions/tools.ts`. If the
   intent could be ambiguous, build it as a disambiguator + children
   (see Conservative routing above).
5. Tree-resolution unit test under `tests/unit-legacy/trees/`. Mirror an
   existing tree's test for the call signature.
6. Playwright e2e under `tests/e2e/` if the routing or flow is novel.
   Use `@example.com` emails. Existing specs are the template.
7. Write a `<txn>.review.md` next to the tree explaining scope and
   rationale.

## What NOT to do

- Don't add CORS-related complexity to make Playwright headers reach the
  Lambda. We tried; Chromium's CORS strips custom headers. Use
  `@example.com` emails instead.
- Don't introduce per-test patches to the SPA's fetch behavior. The SPA
  serves real users; tests must work against it as-is.
- Don't fix tree findings without reading the per-tree review doc
  first. Many findings are intentional (e.g., the
  `certified-weight-slip` baseItem on trailer-registration is genuinely
  always required).
- Don't re-run DbInitFn seeding (`scripts/post-deploy.sh`) against a
  populated DB. The seed SQL (`db/seed.sql` / `seed-docs.sql` /
  `seed-flows.sql`) only loads on an empty DB; confirm contents before
  editing so a careless change doesn't corrupt routing.
