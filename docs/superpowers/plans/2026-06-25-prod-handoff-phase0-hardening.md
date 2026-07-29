# Prod-Handoff Phase-0 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the production-cutover foot-guns we control without prod-AWS access — green the unit suite, add a CI gate, kill the session-ownership IDOR hole, make the CloudFront WAF non-optional, guard the per-app SPA build, and stop two silent no-ops (SES transcript, dead-end scheduling widget) — so the partner inherits an auditable, gated baseline instead of a laptop-deploy with hidden traps.

**Architecture:** Express-on-Lambda monorepo (npm workspaces), CDK infra (Foundation/Backend/Frontend/Security/Admin stacks), two Vite SPAs. Routes live inline in `services/chatbot/src/local-server-app.ts`. Tests are plain `tsx`-run files under `tests/unit/` driven by `tests/unit/run-all.ts` (no test runner). Git root is **`/home/mason/DxHub/st-lucie-tax`** (this project is the `chatbot-prototype/` subdir); remote is `cal-poly-dxhub/st-lucie-tax`; current branch `chatbot-prototype`.

**Tech Stack:** TypeScript, Node 22, Express 4, AWS CDK v2, Vite/React 19, DynamoDB, GitHub Actions (new).

**Scope note:** This plan is Phase-0 ONLY (things we can do pre-handoff, no prod AWS account, no county-policy authority). It explicitly does NOT include the partner-owned P0s: SEC-04/Cognito identity+RBAC, prod AuthID key rotation, DPPA/Ch.119 legal sign-off, cost-model procurement inputs, SES un-sandboxing, or the pen test. Those are tracked separately in the readiness doc.

**Working-dir convention:** All commands below assume CWD = `/home/mason/DxHub/st-lucie-tax/chatbot-prototype` (the project dir) UNLESS the step says "from git root". File paths are relative to the project dir except `.github/workflows/*`, which lives at the **git root** (`../.github/...` from here).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `tests/unit/fee-schedule.test.ts` | fee-schedule schema test | Modify — fix `transaction-types.json` path |
| `tests/unit/ops-manual-index.test.ts` | ops-manual index test | Modify — fix `transaction-types.json` path |
| `tests/unit/audit-load-corpus.test.ts` | corpus loader test | Modify — derive tree count, don't hardcode 31 |
| `services/chatbot/src/auth/session-ownership.ts` | **NEW** — single ownership-assertion helper | Create |
| `services/chatbot/src/local-server-app.ts` | inline routes | Modify — apply ownership guard to all `/sessions/:id/*` mutating/reading routes; refactor existing `:359` guard to use the helper |
| `tests/unit/session-ownership.test.ts` | **NEW** — IDOR regression test | Create |
| `infra/frontend-stack.ts` | chatbot SPA CloudFront | Modify — read WAF ARN from SSM, fail-closed |
| `infra/admin-stack.ts` | admin SPA CloudFront | Modify — attach WAF from SSM |
| `apps/chatbot-app/.env.production` | **NEW** — non-secret chatbot SPA config | Create |
| `apps/admin-app/.env.production` | **NEW** — non-secret admin SPA config | Create |
| `scripts/deploy-frontend.sh` | **NEW** — per-app build+verify+deploy | Create |
| `infra/backend-stack.ts` | Lambda env | Modify — add `SES_FROM_ADDRESS` passthrough |
| `apps/chatbot-app/src/components/SchedulePanel.tsx` | scheduling widget | Modify — only relevant if widget auto-opens with no slot; see Task 7 |
| `.github/workflows/ci.yml` (at git root) | **NEW** — CI gate | Create |
| `CLAUDE.md`, `HANDOFF.md` | docs | Modify — record the new CI gate + deploy script + WAF/SES behavior |

---

## Task 1: Green the unit suite — fix the two `transaction-types.json` paths

**Root cause (verified):** `tests/unit/fee-schedule.test.ts:44` and `tests/unit/ops-manual-index.test.ts:57` both call `resolve('src/data/transaction-types.json')`. `resolve()` is relative to `process.cwd()`, and no `src/data/` dir exists at the repo root — the file actually lives at `scripts/seed-data/transaction-types.json` (confirmed: `find . -name transaction-types.json` → `./scripts/seed-data/transaction-types.json`). Both tests throw `ENOENT` and the file exits 1.

**Files:**
- Modify: `tests/unit/fee-schedule.test.ts:42-44`
- Modify: `tests/unit/ops-manual-index.test.ts:56-58`
- Test: the files ARE the tests; re-run them

- [ ] **Step 1: Confirm the failure first**

Run (from project dir):
```bash
npx tsx tests/unit/fee-schedule.test.ts; echo "exit=$?"
```
Expected: prints `Error: ENOENT: no such file or directory, open '.../src/data/transaction-types.json'` and `exit=1`.

- [ ] **Step 2: Fix the path in fee-schedule.test.ts**

In `tests/unit/fee-schedule.test.ts`, change the txnTypes load (currently lines 42-45):
```typescript
const txnTypes = JSON.parse(
  readFileSync(resolve('src/data/transaction-types.json'), 'utf-8'),
) as Array<{ txnTypeId: string }>;
```
to resolve relative to the test file, not CWD:
```typescript
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// ...near the other imports
const HERE = dirname(fileURLToPath(import.meta.url));
// ...replace the txnTypes load:
const txnTypes = JSON.parse(
  readFileSync(resolve(HERE, '../../scripts/seed-data/transaction-types.json'), 'utf-8'),
) as Array<{ txnTypeId: string }>;
```
(`tests/unit/` → `../../scripts/seed-data/` = `<root>/scripts/seed-data/`. Add the two new imports alongside the existing `import { readFileSync } from 'node:fs'` / `import { resolve } from 'node:path'`.)

- [ ] **Step 3: Apply the identical fix to ops-manual-index.test.ts**

In `tests/unit/ops-manual-index.test.ts`, add the same `HERE` constant (it already imports `readFileSync` and `resolve`), then change line 56-58:
```typescript
const txnTypes = JSON.parse(
  readFileSync(resolve('src/data/transaction-types.json'), 'utf-8'),
) as Array<{ txnTypeId: string }>;
```
to:
```typescript
const txnTypes = JSON.parse(
  readFileSync(resolve(HERE, '../../scripts/seed-data/transaction-types.json'), 'utf-8'),
) as Array<{ txnTypeId: string }>;
```
NOTE: this file ALSO reads `services/chatbot/src/data/flhsmv-ops-manual-index.json` and `fact-definitions.json` via `resolve(...)` (lines 49-63) — those are relative to CWD and work today only because the suite runs from the project dir. Leave them for now (the suite always runs from project root); only the missing-file path needs fixing. Do NOT rewrite the working paths.

- [ ] **Step 4: Re-run both files**

Run:
```bash
npx tsx tests/unit/fee-schedule.test.ts && npx tsx tests/unit/ops-manual-index.test.ts; echo "exit=$?"
```
Expected: both print `N passed, 0 failed.` and `exit=0`. If `fee-schedule` now fails an *assertion* (e.g. a fee amount mismatch) rather than ENOENT, STOP — that is a real data drift, not a path bug; report it, do not edit the expected amounts to force-pass.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/fee-schedule.test.ts tests/unit/ops-manual-index.test.ts
git commit -m "test: fix transaction-types.json path in fee-schedule + ops-manual tests

Both resolved 'src/data/transaction-types.json' relative to CWD, which does
not exist; the file lives at scripts/seed-data/. Resolve relative to the test
file instead. Unblocks the unit suite exiting 0.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Green the unit suite — derive the corpus tree count

**Root cause (verified):** `tests/unit/audit-load-corpus.test.ts:6` asserts `Object.keys(corpus.trees).length === 31`, but `services/chatbot/src/data/decision-trees/` contains **32** trees (confirmed: `ls .../decision-trees/*.json | wc -l` → 32). The corpus loader (`scripts/audit/load-corpus.ts:21-26`) already builds `trees` dynamically by reading the dir, so the hardcoded 31 is a stale magic number, not a real regression.

**Files:**
- Modify: `tests/unit/audit-load-corpus.test.ts:6`

- [ ] **Step 1: Confirm the failure**

Run:
```bash
npx tsx tests/unit/audit-load-corpus.test.ts; echo "exit=$?"
```
Expected: `AssertionError ... expected 31 trees, got 32` and `exit=1`.

- [ ] **Step 2: Replace the hardcoded count with a lower-bound + cross-check against the dir**

In `tests/unit/audit-load-corpus.test.ts`, change line 6:
```typescript
ok(Object.keys(corpus.trees).length === 31, `expected 31 trees, got ${Object.keys(corpus.trees).length}`);
```
to assert the loader picked up every tree file on disk (self-maintaining — never goes stale when a tree is added/removed), with a sanity floor:
```typescript
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// ...near the top, after the existing imports
const TREES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../services/chatbot/src/data/decision-trees',
);
const treeFileCount = readdirSync(TREES_DIR).filter(f => f.endsWith('.json')).length;
// ...replace line 6:
ok(treeFileCount >= 20, `sanity: expected ≥20 tree files on disk, got ${treeFileCount}`);
ok(
  Object.keys(corpus.trees).length === treeFileCount,
  `loader should index every tree file: got ${Object.keys(corpus.trees).length} indexed vs ${treeFileCount} files`,
);
```
RATIONALE: a bare `>= 1` would let a broken loader silently pass; tying the count to the actual file count catches a loader that drops trees, while never needing a manual bump. The `>= 20` floor catches a wrong-directory regression.

- [ ] **Step 3: Re-run**

Run:
```bash
npx tsx tests/unit/audit-load-corpus.test.ts; echo "exit=$?"
```
Expected: `... passed, 0 failed.` and `exit=0`.

- [ ] **Step 4: Run the WHOLE suite — this is the green-gate checkpoint**

Run:
```bash
npm run test:unit; echo "exit=$?"
```
Expected: final line `All unit test files passed.` and `exit=0`. If any *other* file fails (the audit found only these 3; a 4th would be new), STOP and report it before continuing — do not mask it.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/audit-load-corpus.test.ts
git commit -m "test: derive corpus tree count from disk instead of hardcoding 31

Corpus has 32 trees; the loader already reads the dir dynamically. Assert the
indexed count matches the file count so the test never goes stale on add/remove.
Unit suite now exits 0 on a clean checkout.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Close the session-ownership IDOR — extract one guard, apply to all routes

**Root cause (verified):** The auth middleware (`local-server-app.ts:185-210`) sets `req.betaEmail` from the bearer token but does NOT check session ownership. The ONLY ownership check is inline at `:359` on the rehydrate route:
```typescript
if (req.betaEmail && session.betaTesterEmail && session.betaTesterEmail !== req.betaEmail) {
  // 403 session-belongs-to-another-tester
}
```
Every other `/chatbot/sessions/:sessionId/*` route — `messages` (251), `unresolved-facts` (545), `upload-url` (583), `confirm-identity` (596), `authid-result` (630), `skip-verify` (731), `scheduling/slot` (766), `scheduling/book` (784), `edit-facts` (837), `confirm-facts` (938), `message-feedback` (987), `feedback` (1017) — has NO owner check. `sessionId` is exposed in the page URL (`?s=`), so it's harvestable. Any authenticated caller can read or drive another citizen's session.

**Design decisions (locked):**
- **Null-owner case:** `betaTesterEmail` is set lazily — on `createSession` (235) from the bearer, and backfilled on first `messages` turn (273-278). A session with NO `betaTesterEmail` AND no captured email is "pre-auth/unclaimed" → allow (mirrors the existing `:359` semantics and the "Pre-auth sessions are unlocked" comment). The guard ONLY 403s on a positive mismatch. This preserves the QR/anonymous-session future direction and avoids breaking pre-backfill rows.
- **Auth-disabled (dev) case:** when `!isAuthEnabled()`, `req.betaEmail` is undefined → guard is a no-op. Matches existing behavior.
- **Helper, not middleware:** routes load the session at different points and with different not-found handling, so a reusable assert-helper called after the session load is lower-risk than a param-level middleware that would double-read every session. (A future refactor could hoist it; out of scope here.)

**Files:**
- Create: `services/chatbot/src/auth/session-ownership.ts`
- Modify: `services/chatbot/src/local-server-app.ts` (refactor `:359`; add calls to the ~12 routes above that load a session)
- Test: `tests/unit/session-ownership.test.ts`

- [ ] **Step 1: Write the failing test for the helper**

Create `tests/unit/session-ownership.test.ts`:
```typescript
/**
 * Unit tests for the session-ownership guard (IDOR fix).
 *
 * Rule: a session is owned by its betaTesterEmail. A request carrying a
 * DIFFERENT verified email is rejected. A request with no email (auth off),
 * or a session with no owner yet (pre-auth/unclaimed), is allowed.
 */
import { test, assert, assertEqual, run } from './assert.js';
import { assertSessionOwner } from '../../services/chatbot/src/auth/session-ownership.js';

// helper returns { ok: true } or { ok: false, status, error }
test('matching owner is allowed', () => {
  const r = assertSessionOwner('a@x.com', { betaTesterEmail: 'a@x.com' });
  assertEqual(r.ok, true);
});

test('mismatched owner is rejected 403', () => {
  const r = assertSessionOwner('attacker@x.com', { betaTesterEmail: 'victim@x.com' });
  assertEqual(r.ok, false);
  assert(!r.ok && r.status === 403, 'should be 403');
  assert(!r.ok && r.error === 'session-belongs-to-another-tester', 'stable error code');
});

test('unowned (null betaTesterEmail) session is allowed — pre-auth/unclaimed', () => {
  assertEqual(assertSessionOwner('a@x.com', { betaTesterEmail: undefined }).ok, true);
  assertEqual(assertSessionOwner('a@x.com', {}).ok, true);
});

test('no caller email (auth disabled / dev) is allowed', () => {
  assertEqual(assertSessionOwner(undefined, { betaTesterEmail: 'a@x.com' }).ok, true);
});

test('email comparison is case-insensitive', () => {
  assertEqual(assertSessionOwner('A@X.com', { betaTesterEmail: 'a@x.COM' }).ok, true);
});

run();
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx tsx tests/unit/session-ownership.test.ts; echo "exit=$?"
```
Expected: FAIL — `Cannot find module '.../auth/session-ownership.js'` (helper not written yet).

- [ ] **Step 3: Write the helper**

Create `services/chatbot/src/auth/session-ownership.ts`:
```typescript
/**
 * Session-ownership guard (IDOR fix).
 *
 * A session is "owned" by its betaTesterEmail (stamped at create time from the
 * bearer, backfilled on first turn). A request carrying a DIFFERENT verified
 * email must be rejected — sessionIds travel in the ?s= URL and are harvestable,
 * so without this any authed caller could read/drive another citizen's session.
 *
 * Allow (return ok) when:
 *  - the caller has no email (auth disabled / dev mode) — nothing to compare, OR
 *  - the session has no owner yet (pre-auth/unclaimed) — mirrors the rehydrate
 *    "pre-auth sessions are unlocked" semantics and preserves anonymous sessions.
 * Reject (403) ONLY on a positive owner mismatch.
 *
 * NOTE: this is an authorization check on top of self-asserted-email auth. It is
 * only fully enforcing once SEC-04 (real per-user identity) lands; until then it
 * still closes the accidental/curious-tester IDOR and is the right call site for
 * the eventual Cognito identity. See docs prod-readiness for SEC-04.
 */
export interface OwnershipResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export function assertSessionOwner(
  callerEmail: string | undefined,
  session: { betaTesterEmail?: string | undefined },
): OwnershipResult {
  if (!callerEmail) return { ok: true };                 // auth off / no identity
  const owner = session.betaTesterEmail;
  if (!owner) return { ok: true };                       // unclaimed / pre-auth
  if (owner.toLowerCase() === callerEmail.toLowerCase()) return { ok: true };
  return { ok: false, status: 403, error: 'session-belongs-to-another-tester' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx tsx tests/unit/session-ownership.test.ts; echo "exit=$?"
```
Expected: `5 passed, 0 failed.` and `exit=0`.

- [ ] **Step 5: Refactor the existing :359 rehydrate guard to use the helper**

In `services/chatbot/src/local-server-app.ts`, add the import near the other auth imports (find the existing `import { verifyToken, issueToken } from './auth/...`):
```typescript
import { assertSessionOwner } from './auth/session-ownership.js';
```
Then replace the inline check at ~`:359`:
```typescript
    if (req.betaEmail && session.betaTesterEmail && session.betaTesterEmail !== req.betaEmail) {
      // (existing 403 body)
    }
```
with:
```typescript
    const own = assertSessionOwner(req.betaEmail, session);
    if (!own.ok) {
      res.status(own.status!).json({ error: own.error });
      return;
    }
```
Preserve the existing response body shape (the current 403 returns `{ error: 'session-belongs-to-another-tester' }` — confirm and keep any extra fields it sent).

- [ ] **Step 6: Apply the guard to every session-scoped route that loads a session**

For EACH route below, immediately AFTER the session is loaded (the `getSession(...)` / equivalent call) and AFTER its existing not-found (404) check, insert:
```typescript
    const own = assertSessionOwner(req.betaEmail, session);
    if (!own.ok) { res.status(own.status!).json({ error: own.error }); return; }
```
Routes to patch (line numbers approximate — match by route string):
- `POST /chatbot/sessions/:sessionId/messages` (~251) — guard the loaded session. The handler calls `processMessage` first and only `getSession` for backfill at 274; **load the session up-front** for the guard (one read; reuse it for the backfill check to avoid a second read).
- `GET /chatbot/sessions/:sessionId/unresolved-facts` (~545)
- `POST /chatbot/sessions/:sessionId/upload-url` (~583)
- `POST /chatbot/sessions/:sessionId/confirm-identity` (~596)
- `POST /chatbot/sessions/:sessionId/authid-result` (~630)
- `POST /chatbot/sessions/:sessionId/skip-verify` (~731)
- `GET /chatbot/sessions/:sessionId/scheduling/slot` (~766)
- `POST /chatbot/sessions/:sessionId/scheduling/book` (~784)
- `POST /chatbot/sessions/:sessionId/edit-facts` (~837)
- `POST /chatbot/sessions/:sessionId/confirm-facts` (~938)
- `POST /chatbot/sessions/:sessionId/message-feedback` (~987)
- `POST /chatbot/sessions/:sessionId/feedback` (~1017)

IMPORTANT for the `messages` route: today it does NOT load the session before `processMessage`. To guard it without a second read, restructure to:
```typescript
    const sessionId = String(req.params.sessionId);
    const { message } = req.body;
    if (!message?.trim()) { res.status(400).json({ error: 'Message is required' }); return; }

    // IDOR guard: load + verify ownership before driving anyone's session.
    const owned = await getSession(TENANT_ID, sessionId);
    if (owned) {
      const own = assertSessionOwner(req.betaEmail, owned);
      if (!own.ok) { res.status(own.status!).json({ error: own.error }); return; }
    }
    const result = await processMessage(TENANT_ID, sessionId, message);
    // ...backfill: reuse `owned` instead of re-reading
    if (req.betaEmail && owned && !owned.betaTesterEmail) {
      owned.betaTesterEmail = req.betaEmail;
      await updateSession(owned);
    }
```
(If `owned` is null — session not found — let `processMessage` handle the not-found as it does today; the guard simply doesn't fire on a missing session.)

For any route that does NOT currently call `getSession` at all (e.g. a thin proxy that only uses `req.params.sessionId`), add a `getSession(TENANT_ID, sessionId)` load + the guard; if the session is genuinely not loaded anywhere and the route is purely a stateless passthrough, note it in the commit and skip — do not invent a load that changes behavior. Verify each route by reading it; do not blind-insert.

- [ ] **Step 7: Typecheck the chatbot service**

Run:
```bash
npx tsc -p services/chatbot/tsconfig.json --noEmit; echo "exit=$?"
```
Expected: `exit=0`. Fix any type errors (e.g. `own.status!` non-null assertion, or `session` possibly-undefined narrowing) before proceeding.

- [ ] **Step 8: Run the full unit suite**

Run:
```bash
npm run test:unit; echo "exit=$?"
```
Expected: `All unit test files passed.` `exit=0` (now includes `session-ownership.test.ts`).

- [ ] **Step 9: Commit**

```bash
git add services/chatbot/src/auth/session-ownership.ts services/chatbot/src/local-server-app.ts tests/unit/session-ownership.test.ts
git commit -m "fix(sec): close session-ownership IDOR across all session routes

The betaTesterEmail===req.betaEmail owner check existed only on rehydrate.
Extract assertSessionOwner() and apply it to every /sessions/:id/* route that
reads or mutates a session (messages, edit/confirm-facts, authid-result,
upload-url, scheduling, feedback, ...). Unowned (pre-auth) and auth-off requests
stay allowed; only positive owner mismatches 403. Regression test included.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Make the CloudFront WAF non-optional (read from SSM, fail-closed)

**Root cause (verified):** `infra/frontend-stack.ts:48` reads `const wafArn = process.env.BETA_WAF_ARN;` and `:60` attaches the WebACL only `...(wafArn ? { webAclId: wafArn } : {})`. A redeploy where the operator forgets to export `BETA_WAF_ARN` silently strips DDoS/rate-limit protection from the public citizen endpoint (this is a known prior incident). The WebACL ARN is already published to SSM at `/stlucie/beta-web-acl-arn` by `infra/security-stack.ts:118-120`. The admin distribution (`admin-stack.ts:179`) has NO WAF at all.

**Decision (locked):** Read the ARN from SSM so it can never be omitted. The deploy-order concern in the old comment (first-deploy ordering) is handled because SecurityStack publishes the param before Frontend deploys in the standard order; if a truly-first bootstrap deploy happens before SecurityStack, document that Frontend must deploy after Security (already the documented order in DEPLOY.md). Attach the same WAF to the admin distribution too (recommended — admin serves the full PII corpus).

**Files:**
- Modify: `infra/frontend-stack.ts:41-60`
- Modify: `infra/admin-stack.ts` (imports + distribution)

- [ ] **Step 1: Read the WAF ARN from SSM in FrontendStack**

In `infra/frontend-stack.ts`, replace lines 41-48 (the comment block + `const wafArn = process.env.BETA_WAF_ARN;`) with:
```typescript
    // Attach the rate-limit WAF WebACL provisioned by SecurityStack. Read the
    // ARN from SSM (published at /stlucie/beta-web-acl-arn) rather than an env
    // var so a redeploy can NEVER silently ship the public endpoint without a
    // WAF. Requires SecurityStack to have deployed first (standard order; see
    // infra/DEPLOY.md). valueForStringParameter resolves at deploy time.
    const wafArn = ssm.StringParameter.valueForStringParameter(
      this,
      '/stlucie/beta-web-acl-arn',
    );
```
Then change line 60 from the conditional spread to an unconditional attach:
```typescript
      webAclId: wafArn,
```
(`ssm` is already imported at `frontend-stack.ts:15`.)

- [ ] **Step 2: Attach the WAF to the admin distribution**

In `infra/admin-stack.ts`, before the `const distribution = new cloudfront.Distribution(this, 'AdminDistribution', {` (~179), add:
```typescript
    const wafArn = ssm.StringParameter.valueForStringParameter(
      this,
      '/stlucie/beta-web-acl-arn',
    );
```
and inside the distribution props (after `defaultRootObject: 'index.html',`) add:
```typescript
      webAclId: wafArn,
```
(`ssm` is already imported at `admin-stack.ts:32`. NOTE: the WebACL is `CLOUDFRONT` scope / us-east-1, so it can be shared across both distributions — confirm in `security-stack.ts:80` it's `scope: 'CLOUDFRONT'`.)

- [ ] **Step 3: Synth-check both stacks (no deploy)**

Run (from project dir):
```bash
cd infra && npm run cdk -- synth StLucieFrontendStack StLucieAdminStack \
  --profile AdministratorAccess-111122223333 > /tmp/synth-waf.txt 2>&1; echo "exit=$?"; cd ..
```
Expected: `exit=0`. If SSO is expired (`The SSO session ... has expired`), STOP and ask the user to re-login — do not self-authenticate. Then:
```bash
grep -c "WebACLId" /tmp/synth-waf.txt
```
Expected: ≥2 (both distributions now reference a WebACLId). If 0, the attach didn't take — re-check.

- [ ] **Step 4: Commit (DO NOT deploy — deploy is a separate, user-authorized step)**

```bash
git add infra/frontend-stack.ts infra/admin-stack.ts
git commit -m "fix(infra): read CloudFront WAF ARN from SSM, attach to both SPAs

FrontendStack read BETA_WAF_ARN from env and attached the WebACL only if set,
so a redeploy that forgot the export silently stripped the WAF from the public
endpoint (a known prior incident). Read /stlucie/beta-web-acl-arn from SSM so it
can never be omitted, and attach the same CLOUDFRONT-scope WebACL to the admin
distribution (which serves the full PII corpus and previously had no WAF).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

NOTE: This change becomes real only on the next `cdk deploy` of Frontend + Admin stacks. That deploy is intentionally NOT part of this plan (needs SSO + the user's go-ahead). Flag it to the user when Phase-0 code is merged.

---

## Task 5: Guard the per-app SPA build (committed env + bundle-grep deploy script)

**Root cause (verified):** Each SPA bakes `VITE_API_URL` + `VITE_API_KEY` at build time (`apps/chatbot-app/src/api.ts:8,72`; `apps/admin-app/src/api.ts:7,37`), and the two apps point at DIFFERENT API URLs + keys. A hand-export mistake already shipped the admin app built with the chatbot's URL/key. There is no `.env.example`, no per-app deploy script, and no post-build check. SSM params for each app's config: chatbot API at `/stlucie/api-gateway-url`; admin API at `/stlucie/admin-api-url`; api-key IDs at `/stlucie/beta-api-key-id` and `/stlucie/admin-api-key-id` (values fetched via `aws apigateway get-api-key --include-value`).

**Decision (locked):** Commit non-secret `.env.production` with the URL only (NOT the key — keys are fetched at deploy time and injected via env). A wrapper script derives each app's own URL+key from its own SSM params, builds, then greps the built bundle to assert the OTHER app's URL did not leak in before upload.

**Files:**
- Create: `apps/chatbot-app/.env.production`
- Create: `apps/admin-app/.env.production`
- Create: `scripts/deploy-frontend.sh`

- [ ] **Step 1: Commit the non-secret production URLs**

Create `apps/chatbot-app/.env.production`:
```
# Non-secret build-time config for the CUSTOMER chatbot SPA.
# VITE_API_KEY is NOT here — it is injected at build time by scripts/deploy-frontend.sh
# from SSM /stlucie/beta-api-key-id (value via `aws apigateway get-api-key`).
# This file exists so a build can never silently pick up the admin app's URL.
VITE_API_URL=https://b4ki4882va.execute-api.us-east-1.amazonaws.com/api
VITE_BETA_BANNER=1
```
Create `apps/admin-app/.env.production`:
```
# Non-secret build-time config for the ADMIN SPA. Distinct API (stage /admin)
# and a distinct key (injected by scripts/deploy-frontend.sh from SSM
# /stlucie/admin-api-key-id). Keeping this committed prevents the cross-app
# URL mix-up that previously shipped admin built with the chatbot's API.
VITE_API_URL=https://b4ki4882va.execute-api.us-east-1.amazonaws.com/admin
```
VERIFY the admin URL/stage against `infra/admin-stack.ts` `AdminApiUrlParam` (`/stlucie/admin-api-url`) before committing — read the actual value:
```bash
aws ssm get-parameter --name /stlucie/admin-api-url --query Parameter.Value --output text --profile AdministratorAccess-111122223333
aws ssm get-parameter --name /stlucie/api-gateway-url --query Parameter.Value --output text --profile AdministratorAccess-111122223333
```
Replace the literals above with whatever these return. If SSO is expired, ask the user to re-login.

- [ ] **Step 2: Write the deploy script with a cross-app leak check**

Create `scripts/deploy-frontend.sh` (mode 755):
```bash
#!/usr/bin/env bash
# Build + verify + deploy ONE SPA, deriving its API URL + key from ITS OWN SSM
# params, and refusing to upload a bundle that contains the other app's API URL.
# Usage: scripts/deploy-frontend.sh chatbot|admin
set -euo pipefail

APP="${1:?usage: deploy-frontend.sh chatbot|admin}"
PROFILE="${AWS_PROFILE:-AdministratorAccess-111122223333}"

case "$APP" in
  chatbot)
    APP_DIR="apps/chatbot-app"; STACK="StLucieFrontendStack"
    URL_PARAM="/stlucie/api-gateway-url"; KEY_PARAM="/stlucie/beta-api-key-id"
    FOREIGN_PARAM="/stlucie/admin-api-url" ;;
  admin)
    APP_DIR="apps/admin-app"; STACK="StLucieAdminStack"
    URL_PARAM="/stlucie/admin-api-url"; KEY_PARAM="/stlucie/admin-api-key-id"
    FOREIGN_PARAM="/stlucie/api-gateway-url" ;;
  *) echo "unknown app: $APP" >&2; exit 2 ;;
esac

ssm() { aws ssm get-parameter --name "$1" --query Parameter.Value --output text --profile "$PROFILE"; }

API_URL="$(ssm "$URL_PARAM")"
FOREIGN_URL="$(ssm "$FOREIGN_PARAM")"
KEY_ID="$(ssm "$KEY_PARAM")"
API_KEY="$(aws apigateway get-api-key --api-key "$KEY_ID" --include-value \
  --query value --output text --profile "$PROFILE")"

echo ">> building $APP with VITE_API_URL=$API_URL"
( cd "$APP_DIR" && VITE_API_URL="$API_URL" VITE_API_KEY="$API_KEY" npm run build )

# Cross-app leak guard: the built bundle must NOT contain the OTHER app's URL.
if grep -rq -- "$FOREIGN_URL" "$APP_DIR/dist"; then
  echo "!! ABORT: $APP bundle contains the foreign API URL ($FOREIGN_URL)." >&2
  echo "!! This is the cross-app misconfig. Not deploying." >&2
  exit 1
fi
echo ">> bundle clean (no foreign URL). Deploying $STACK ..."
( cd infra && npm run cdk -- deploy "$STACK" --require-approval never --profile "$PROFILE" )
```
Make executable:
```bash
chmod +x scripts/deploy-frontend.sh
```

- [ ] **Step 3: Smoke-test the build half WITHOUT deploying**

Run just the build + leak-check by temporarily stopping before deploy — verify the chatbot build produces a `dist/` and the grep guard does not false-positive. Simplest: run the script's build+grep lines manually for the chatbot app, OR add a `DRY_RUN` early-exit. Minimal manual check:
```bash
( cd apps/chatbot-app && VITE_API_URL=https://example.invalid/api VITE_API_KEY=x npm run build ) \
  && grep -rq -- "admin" apps/chatbot-app/dist && echo "grep mechanism works" || echo "no admin string (ok)"
```
Expected: build succeeds (`dist/` written), grep mechanism runs without erroring. (This is a mechanism check; the real foreign-URL guard runs against live SSM values at deploy time.)

- [ ] **Step 4: Commit**

```bash
git add apps/chatbot-app/.env.production apps/admin-app/.env.production scripts/deploy-frontend.sh
git commit -m "build: per-app .env.production + deploy script with cross-app leak guard

Each SPA bakes a DIFFERENT API URL/key at build time; a hand-export once shipped
admin built with the chatbot's API. Commit non-secret per-app URLs and add
scripts/deploy-frontend.sh which derives each app's URL+key from its OWN SSM
params, then refuses to upload a bundle containing the other app's URL.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Fix the SES transcript silent no-op disclosure + wire the from-address env

**Root cause (verified):** `services/chatbot/src/email/transcript-sender.ts` returns `{ status: 'skipped', reason: 'no-from-address' }` whenever `process.env.SES_FROM_ADDRESS` is unset, and that var is set NOWHERE in `infra/backend-stack.ts` `lambdaEnv` (70-91). So "email me a copy" no-ops for TWO reasons (SES sandbox AND missing from-address), but HANDOFF.md §4 only documents the sandbox. The customer-facing button is already gated on `VITE_SES_ENABLED === '1'` (`ConfirmFacts.tsx:277`), so it's hidden today — meaning this is primarily a correctness/wiring + disclosure fix, not a live user-facing bug.

**Decision (locked):** This is the WE-DO-NOW half (wire the env passthrough + correct the docs). The PARTNER half (verify an SES identity, un-sandbox) stays in the readiness doc. Add the env passthrough so that once the partner sets `SES_FROM_ADDRESS` + un-sandboxes, it works with no code change.

**Files:**
- Modify: `infra/backend-stack.ts:70-91` (lambdaEnv)
- Modify: `HANDOFF.md` §4 (correct the two-reason disclosure)

- [ ] **Step 1: Add the SES_FROM_ADDRESS passthrough to lambdaEnv**

In `infra/backend-stack.ts`, inside the `lambdaEnv` object (after `SCHEDULING_COUNTY_ID` ~90), add:
```typescript
      // SES sender for transcript emails. Empty until the partner verifies an
      // SES identity AND moves the account out of the SES sandbox (see
      // HANDOFF.md §4). transcript-sender.ts returns status:'skipped' while
      // unset, so leaving it blank is safe — the feature is also gated client-
      // side on VITE_SES_ENABLED. Set this to the verified from-address to enable.
      SES_FROM_ADDRESS: process.env.SES_FROM_ADDRESS ?? '',
```

- [ ] **Step 2: Synth-check the backend stack**

Run:
```bash
cd infra && npm run cdk -- synth StLucieBackendStack --profile AdministratorAccess-111122223333 > /tmp/synth-ses.txt 2>&1; echo "exit=$?"; cd ..
grep -c "SES_FROM_ADDRESS" /tmp/synth-ses.txt
```
Expected: `exit=0`, grep ≥1.

- [ ] **Step 3: Correct the HANDOFF.md disclosure**

In `HANDOFF.md` §4 "Email transcripts", update the paragraph to state BOTH conditions: the transcript send is skipped if EITHER (a) `SES_FROM_ADDRESS` is unset (now a CDK env passthrough, blank by default) OR (b) the account is in SES sandbox. To go live: set `SES_FROM_ADDRESS` to a verified identity AND move the account out of sandbox. (Keep it factual; don't overclaim it's "done".)

- [ ] **Step 4: Commit**

```bash
git add infra/backend-stack.ts HANDOFF.md
git commit -m "fix(infra): wire SES_FROM_ADDRESS passthrough + correct transcript disclosure

transcript-sender skips on unset SES_FROM_ADDRESS, but it was set nowhere in
CDK, so transcripts no-op for two reasons while HANDOFF documented only the
sandbox. Add the env passthrough (blank-safe) so enabling is config-only, and
correct HANDOFF §4 to state both conditions.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Neutralize the dead-end scheduling widget (INVESTIGATE FIRST)

**Context (verified):** `SCHEDULING_API_URL` is blank in prod (`infra/.env.deploy:49`, and `backend-stack.ts:89` defaults to `''`). `SchedulePanel.tsx` already has an `'unavailable'` phase that renders "Online scheduling isn't available for your transaction yet. Please call the office to book your visit." (`:56`). The open question the audit raised: does the panel AUTO-OPEN and show a booking UI that then fails, or does it gracefully land on the `unavailable` copy?

**This task is INVESTIGATE-THEN-DECIDE, not a blind edit.** The fix depends on what the investigation finds.

**Files:**
- Read: `apps/chatbot-app/src/components/SchedulePanel.tsx` (full), `apps/chatbot-app/src/App.tsx:~490-530` (where the panel mounts), `services/chatbot/src/state-machine/transitions.ts` (schedule state), the `scheduling/slot` route (`local-server-app.ts:766`)
- Modify: TBD based on findings (likely `SchedulePanel.tsx` initial phase, OR the autoGreet/state copy)

- [ ] **Step 1: Trace the schedule entry path**

Read `SchedulePanel.tsx` end-to-end and find: (a) what `Phase` it initializes to, (b) what `loadSlot()` does when `fetchSchedulingSlot` returns the "unavailable"/error path, (c) where in `App.tsx` the panel is rendered and on what condition. Determine empirically: when `SCHEDULING_API_URL` is blank, does the backend `scheduling/slot` route return a clean "unavailable" signal, and does the panel land on the `unavailable` phase WITHOUT first flashing a booking offer?

Run the backend route check:
```bash
sed -n '760,800p' services/chatbot/src/local-server-app.ts
```
and read the slot handler's blank-URL behavior.

- [ ] **Step 2: Decide based on findings**

- **If** the panel already lands cleanly on `unavailable` ("call the office") with no misleading booking UI → there is NO dead-end; the fix is documentation only. Add a line to HANDOFF/readiness that scheduling gracefully degrades, mark this task done, and SKIP the code edit.
- **If** the panel flashes a booking offer / spinner that resolves to a dead end, OR auto-opens unbidden → make the minimal change so that when scheduling is not configured, the booking affordance is not shown at all (e.g. initialize to `unavailable` when a "scheduling enabled" signal is absent, mirroring the `VITE_SES_ENABLED` gating pattern). Do NOT rip out the booking code — it's wanted once the service is hosted; just gate the entry.

- [ ] **Step 3: If a code change was made, verify locally**

Run the chatbot-app dev server on a NON-5173 port (per the port-isolation rule — pick e.g. 5181) and confirm the schedule terminal state shows "call the office" without a broken booking flash. If Playwright MCP is available, snapshot it. If no code change was made, skip.

- [ ] **Step 4: Commit (only if a change was made)**

```bash
git add apps/chatbot-app/src/components/SchedulePanel.tsx
git commit -m "fix(ux): don't show a booking widget when scheduling is unconfigured

When SCHEDULING_API_URL is blank (prod today), the terminal schedule state
[showed a booking affordance that dead-ended / now lands directly on the
call-the-office copy]. Gate the booking entry on scheduling being configured,
mirroring the VITE_SES_ENABLED pattern.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Add the GitHub Actions CI gate

**Context (verified):** No `.github/` exists anywhere (git root or project). Git root is `/home/mason/DxHub/st-lucie-tax`; the project is the `chatbot-prototype/` subdir; remote `cal-poly-dxhub/st-lucie-tax`. CDK bundles the working tree, so a broken edit can deploy with zero gate. Root `package.json` has `test:unit`, `lint:trees`, `build` (build:types + build:data-access). Node 22. There IS no root `typecheck` script — typecheck is per-package `tsc -p <pkg>/tsconfig.json --noEmit`.

**Decision (locked):** A PR-triggered gate that runs install + per-package typecheck + unit tests + tree lint + `cdk synth` (cheap, no AWS creds needed for synth of a self-contained app — but our CDK reads SSM `valueForStringParameter`, which resolves at deploy not synth, so synth works without creds; CONFIRM in Step 3). Deploy-on-tag via OIDC is documented as a follow-up, NOT built here (needs the partner's AWS account + an OIDC role — out of Phase-0 scope). The workflow lives at the git-root `.github/workflows/` and scopes all steps to the `chatbot-prototype/` working-directory.

**Files:**
- Create: `/home/mason/DxHub/st-lucie-tax/.github/workflows/ci.yml`
- Modify: `CLAUDE.md` (document the gate)

- [ ] **Step 1: Confirm what runs green locally first (the CI must mirror this)**

Run from project dir:
```bash
npm run test:unit && npm run lint:trees && echo "ROOT GATES PASS"
npx tsc -p services/chatbot/tsconfig.json --noEmit && \
npx tsc -p services/admin/tsconfig.json --noEmit && \
npx tsc -p infra/tsconfig.json --noEmit && echo "TYPECHECK PASS"
```
Expected: both print their PASS line. If `lint:trees` or a typecheck fails, FIX or note it — CI must reflect reality. (If a package's tsconfig needs the workspace built first, run `npm run build` before typecheck and add that to CI.)

- [ ] **Step 2: Write the workflow**

Create `/home/mason/DxHub/st-lucie-tax/.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [chatbot-prototype, main]

defaults:
  run:
    working-directory: chatbot-prototype

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: chatbot-prototype/package-lock.json
      - name: Install (root workspace)
        run: npm ci
      - name: Install (infra)
        working-directory: chatbot-prototype/infra
        run: npm ci
      - name: Build workspace packages
        run: npm run build
      - name: Typecheck services + infra
        run: |
          npx tsc -p services/chatbot/tsconfig.json --noEmit
          npx tsc -p services/admin/tsconfig.json --noEmit
          npx tsc -p infra/tsconfig.json --noEmit
      - name: Unit tests
        run: npm run test:unit
      - name: Lint decision trees
        run: npm run lint:trees
      - name: CDK synth (no AWS creds — SSM lookups resolve at deploy)
        working-directory: chatbot-prototype/infra
        run: npx cdk synth --all
```
NOTE: do NOT add `lint:trees:urls` (it hits the network) or the Bedrock audit/evals (they cost money + need AWS creds) — those stay as documented post-deploy gates against UAT, not per-PR.

- [ ] **Step 3: Validate the workflow locally as far as possible**

CI can't be fully run locally, but validate the two riskiest assumptions:
```bash
# (a) cdk synth works with NO AWS creds (SSM valueForStringParameter resolves at deploy):
cd infra && AWS_PROFILE= npx cdk synth --all > /tmp/synth-all.txt 2>&1; echo "exit=$?"; cd ..
```
Expected: `exit=0`. If synth FAILS without creds (e.g. a `fromLookup` context query), then synth needs creds — in that case change the CI step to `npx cdk synth StLucieBackendStack` for only the no-lookup stacks, or document that synth is skipped in CI and rely on `cdk diff` at deploy. Adjust the yaml to match reality; do not ship a CI step you know will fail.
```bash
# (b) the yaml is well-formed:
python3 -c "import yaml,sys; yaml.safe_load(open('/home/mason/DxHub/st-lucie-tax/.github/workflows/ci.yml')); print('yaml ok')"
```
Expected: `yaml ok`.

- [ ] **Step 4: Document the gate in CLAUDE.md**

In `CLAUDE.md`, under "Deploys and AWS state" (or a new "## CI" section), add a short paragraph: PRs and pushes to `chatbot-prototype`/`main` run `.github/workflows/ci.yml` (typecheck + unit + tree-lint + cdk synth); the Bedrock tree-audit + LLM/KB evals are NOT in CI (cost/creds) and run as post-deploy gates against UAT; deploys remain manual (`cdk deploy`) until the partner wires OIDC deploy-on-tag in their account.

- [ ] **Step 5: Commit (from git root, since the workflow is above the project dir)**

```bash
cd /home/mason/DxHub/st-lucie-tax
git add .github/workflows/ci.yml chatbot-prototype/CLAUDE.md
git commit -m "ci: add GitHub Actions gate (typecheck + unit + tree-lint + cdk synth)

No CI existed; CDK bundles the working tree, so a broken edit could deploy
ungated. Add a PR/push gate scoped to chatbot-prototype/. Bedrock audit + evals
stay out of CI (cost/creds) as post-deploy UAT gates; deploy-on-tag via OIDC is
a partner follow-up.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
cd chatbot-prototype
```

---

## Task 9: Final verification + push

- [ ] **Step 1: Full green check**

Run from project dir:
```bash
npm run test:unit && npm run lint:trees && \
npx tsc -p services/chatbot/tsconfig.json --noEmit && \
npx tsc -p services/admin/tsconfig.json --noEmit && \
echo "ALL PHASE-0 GATES GREEN"
```
Expected: `ALL PHASE-0 GATES GREEN`.

- [ ] **Step 2: Review the commit series**

```bash
git log --oneline -12
git status
```
Expected: the Phase-0 commits present, working tree clean (except any intentionally-uncommitted item the user knows about, e.g. the input-box height tweak — confirm with the user before including it).

- [ ] **Step 3: Push — ONLY after the user explicitly authorizes it**

Per repo convention, push only when asked. When authorized:
```bash
git push origin chatbot-prototype
```

- [ ] **Step 4: Hand back the deploy-gated items**

Remind the user that two changes are committed but NOT yet live (they need a user-authorized `cdk deploy` with SSO + BETA_WAF_ARN no longer needed): the WAF-from-SSM (Frontend + Admin stacks) and the SES_FROM_ADDRESS passthrough (Backend stack). The IDOR fix + test greening + CI are code/repo changes that take effect on the next deploy / immediately in CI. Do NOT deploy as part of this plan.

---

## Self-Review

**Spec coverage** (against the chosen "Phase-0 hardening sprint"):
- Green the suite → Tasks 1, 2 ✓
- CI gate → Task 8 ✓
- IDOR → Task 3 ✓
- WAF non-optional → Task 4 ✓
- SPA build guard → Task 5 ✓
- SES silent no-op → Task 6 ✓
- Dead-end scheduling widget → Task 7 (investigate-first) ✓

**Placeholder scan:** Task 7 is deliberately investigate-then-decide (the fix genuinely depends on runtime behavior I could not fully trace statically) — it has concrete read targets and a decision rule, not a TODO. Task 5 Step 1 and Task 4 Step 3 require live SSM/SSO values; both say to verify against the real param and what to do if SSO is expired (ask the user). No "add error handling"-style placeholders.

**Type consistency:** `assertSessionOwner(callerEmail, session)` → `OwnershipResult {ok, status?, error?}` is used identically in the helper, the test, and all route call sites (`if (!own.ok) { res.status(own.status!)... }`). Error code `session-belongs-to-another-tester` matches the existing `:359` string so the SPA's handling is unchanged.

**Known risks called out inline:** cdk synth-without-creds (Task 8 Step 3 has a fallback), the `messages` route needing an up-front session load (Task 3 Step 6), and the deploy-gated nature of Tasks 4 & 6.
