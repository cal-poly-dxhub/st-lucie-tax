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
- Don't add backfill prefixes to `scripts/backfill-test-sessions.ts`
  unless you've created a test-style session with a non-@example.com
  email — that should be the rare exception, not the norm.

The verification you should run after a Playwright spec lands sessions:
log into the admin dashboard, toggle "Show test sessions" on, confirm
your sessions show the gray TEST badge. If they show without the badge
under "Show test sessions" off, your spec didn't use @example.com — fix
the spec, don't patch the backfill.

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

The deployed Lambda lives at:
`https://b4ki4882va.execute-api.us-east-1.amazonaws.com/api/`

Frontend SPA: `https://EXAMPLEDIST0001.cloudfront.net`
Admin SPA: `https://EXAMPLEDIST0002.cloudfront.net`

CDK pulls from the working tree, not from a specific git ref. Whatever's
in `services/chatbot/src/` and `services/admin/src/` at deploy time is
what runs. To deploy:

```bash
cd infra
npm run cdk -- deploy StLucieBackendStack --require-approval never \
  --profile AdministratorAccess-111122223333
```

SEC-02: secrets (BETA_PASSWORD, BETA_AUTH_SECRET, AUTHID_API_KEY_ID/VALUE; admin:
ADMIN_PASSWORD, ADMIN_AUTH_SECRET) are NO LONGER passed as `BETA_PASSWORD=… cdk
deploy` env vars. They live in AWS Secrets Manager (`stlucie/chatbot/app-secrets`,
`stlucie/admin/app-secrets`), fetched at Lambda cold start by
`services/{chatbot,admin}/src/auth/load-secrets.ts`. CDK creates each secret with
a placeholder; populate real values out-of-band via `aws secretsmanager
put-secret-value` + a forced cold start. Full runbook in `infra/DEPLOY.md`
("Secrets (SEC-02)"). The Lambda fails closed (500s) if the secret is empty —
never runs with auth silently disabled.

Frontend changes need a separate `npm run build` in `apps/chatbot-app/`
or `apps/admin-app/` with the right `VITE_API_URL` + `VITE_API_KEY`,
THEN a `cdk deploy StLucieFrontendStack` (or `StLucieAdminStack`).

The `aws sso login` token expires every few hours. When you see
`The SSO session associated with this profile has expired`, ask the
user to re-login interactively — don't try to authenticate yourself.

## When you change a tree, fact, or item

Run lint + relevant unit tests:

```bash
npm run lint:trees
npx tsx tests/unit/trailer-registration-tree.test.ts   # or the relevant tree's test
```

After a meaningful structural change, re-run the audit:

```bash
AWS_PROFILE=AdministratorAccess-111122223333 npx tsx scripts/audit-tree-exhaustiveness.ts
npm run audit:trees:report
```

The audit takes ~10-15 minutes and costs ~$1 in Bedrock Haiku tokens.
Don't run it speculatively.

## When you add a new transaction

1. Author the tree (`services/chatbot/src/data/decision-trees/<txn>.json`).
2. Add facts to `fact-definitions.json` and items to `item-catalog.json`.
3. Add a TXNTYPE entry to `scripts/seed-data/transaction-types.json` with
   `commonPhrases`, `keywords`, `summary`, `category`. Re-seed DDB:
   `DYNAMODB_TABLE_NAME=st-lucie-platform npx tsx scripts/seed-data.ts`.
4. Add a routing cluster to
   `services/chatbot/src/tools/suggest-transactions/tools.ts`. If the
   intent could be ambiguous, build it as a disambiguator + children
   (see Conservative routing above).
5. Tree-resolution unit test under `tests/unit/`. Mirror an existing tree's
   test for the call signature.
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
- Don't fix audit findings without reading the per-tree review doc
  first. Many findings are intentional (e.g., the
  `certified-weight-slip` baseItem on trailer-registration is genuinely
  always required).
- Don't run `npm run seed` against production DDB without confirming the
  source-data file contents. The script overwrites by PK so a careless
  run can corrupt routing.
