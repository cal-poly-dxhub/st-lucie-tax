# Production-Transition & Partner-Handoff Readiness

_Last updated: 2026-06-25. Produced from a grounded 8-dimension audit (each finding
adversarially re-checked against the repo). Companion to `HANDOFF.md` (which covers
"what's deployed + cutover mechanics"); this doc is the prioritized "what's left + who
owns it"._

## Bottom line

Roughly **70% to a defensible government-prod cutover.** Foundations are strong:
single-table DynamoDB with PITR + RETAIN, S3 block-all-public, scoped IAM, SEC-02
secrets in Secrets Manager, PII log redaction, real architecture docs. **The cutover
is blocked on identity** (no real per-user auth) plus a cluster of silent foot-guns and
missing decision/cost/legal artifacts. Nothing in the blocking set is a surprise — it's
a known, scoped, not-yet-executed list.

The work splits cleanly into **WE-DO-NOW** (code/IaC + docs, no prod-AWS access needed —
pre-handoff) and **PARTNER-OWNED** (their AWS account + county-policy authority).

---

## P0 — blocks a safe government-prod cutover

### WE-DO-NOW (pre-handoff hardening) — see `docs/superpowers/plans/2026-06-25-prod-handoff-phase0-hardening.md`
| Item | Evidence | Fix | Effort |
|---|---|---|---|
| **Session-ownership IDOR** — owner check only on rehydrate; ~12 other `/sessions/:id/*` routes unprotected; sessionId is in the `?s=` URL | `local-server-app.ts:359` is the only guard; `:200` sets `req.betaEmail` but no per-route check | One `assertSessionOwner` helper applied to all session routes + 403 regression test | M |
| **Unit suite RED + zero CI** — CDK bundles the working tree, so a broken edit can deploy ungated | `npm run test:unit` exits 1 (3 files: `transaction-types.json` path × 2, hardcoded `31` vs 32 trees); no `.github/` anywhere | Fix the 3 fixtures → green; add a GitHub Actions gate (typecheck + unit + tree-lint + cdk synth) | M |
| **WAF silently dropped** if `BETA_WAF_ARN` unset on a redeploy; admin distro has no WAF at all | `frontend-stack.ts:48,60` reads env var; `admin-stack.ts:179` no WAF; ARN already at SSM `/stlucie/beta-web-acl-arn` | Read ARN from SSM, attach unconditionally to both distributions | S |
| **SPA build foot-gun** — already shipped admin built with chatbot's URL/key | Each app bakes distinct `VITE_API_URL`+`VITE_API_KEY`; no `.env.example`, no per-app deploy script | Committed per-app `.env.production` + `deploy-frontend.sh` that pulls each app's own SSM config and greps the bundle for foreign-URL leak | M |
| **SES transcript double-silent no-op** — skips on sandbox AND unset `SES_FROM_ADDRESS`, but only sandbox documented | `transcript-sender.ts:41-45`; `SES_FROM_ADDRESS` set nowhere in `backend-stack.ts` lambdaEnv | Add env passthrough (blank-safe) + correct HANDOFF §4 | S |
| **Dead-end scheduling widget** (investigate) — terminal schedule state may show a booking UI that can't book | `SCHEDULING_API_URL` blank in prod; `SchedulePanel.tsx` has an `unavailable` phase | Confirm graceful degradation; gate the booking entry if it flashes a dead end | S |

### PARTNER-OWNED (their account / authority)
| Item | Why it's a blocker | Owner action |
|---|---|---|
| **SEC-04 / real identity (Cognito + RBAC)** — THE headline gate | Citizen + admin both auth on one shared password → HMAC over self-asserted email. No accountability, no RBAC, no access audit on a gov PII system. Until built, the IDOR fix above is "best-effort" not fully enforcing. | Build Cognito (citizen + staff pools, staff→admin/clerk/read-only roles), OR county accepts-as-risk in writing + forbids binding non-self-supplied PII |
| **Rotate compromised UAT AuthID keys + vault plaintext secrets** | UAT AuthID keys embedded in dev transcripts (HANDOFF §2); `infra/.env.deploy` holds plaintext values | Day-one runbook: disable UAT key in portal, gen prod keys, rotate BETA/ADMIN/API-GW into Secrets Manager, vault/delete `.env.deploy` |
| **Alarm recipient is a departing `@calpoly.edu` inbox** (sole SNS subscriber) | `security-stack.ts:134` | Swap to partner on-call distribution list; confirm subscription |
| **No cost model** | Sonnet tool-loop (≤10 rounds) + autoGreet double-loops + KB RAG + AuthID per-Proof all unquantified; alarms are UAT-sized $25/$50 | We instrument a real session; partner supplies AuthID pricing + approves county budget |

---

## P1 — should do before / shortly after launch
- One-page operational/incident **runbook** (AuthID 409, Bedrock throttle, KB 403, fail-closed-secret 500s, 29s timeout).
- **Resource-coverage alarms**: API-GW 5xx/latency, DDB throttles, admin Lambda errors, CloudFront 5xx, + an AuthID-failure custom metric. Today only the chatbot Lambda + Bedrock are watched.
- **Parameterize CDK** (account/region/stage/KB-id/alarm-email) so prod is an isolated stack set, not UAT mutated in place.
- **CloudWatch Logs retention** (set per county policy — none today) + route `redactPii()` over the `console.error` path (raw stack traces with citizen input currently go to logs unredacted).
- **Reconcile retention story** (`ttl.ts` says "30-day PII" but free-text PII lives ~3yr in HISTORY rows) + build a **data-subject deletion** path (none exists; admin is read-only).
- **Threshold gates + committed baselines** for the tree-audit regression check (`baseline-counts.json` doesn't exist) and the LLM/KB evals (they only fail on crash, never on a low score) — this is the concrete "how does the partner know a prompt change is safe" answer.
- **Automated accessibility** (axe/pa11y) in the e2e suite — Section 508/ADA obligation for a gov site; only hand-authored ARIA today.
- **Load/cold-start/concurrency test** + request Bedrock TPM/RPM + API-GW timeout (29s→60s) quota increases in the prod account.
- Define **secret-rotation policy + named owner**; make the committed SEC-02/hardening real on the first partner deploy (the repo, not the deployed env, currently carries it).

## P2 — nice-to-have
CloudWatch dashboard · synthetic canary / uptime check · Lambda duration-approaching-120s alarm · X-Ray + correlation IDs · CloudFront `PriceClass_100` · S3 `enforceSSL` + upload versioning/Object-Lock · Bedrock prompt caching (`cachePoint`) · migrate off deprecated Sonnet 4 → 4.6 · coverage tooling + the ~4 trees lacking a resolution test · SPA↔API contract validation (Zod/shared-types) · gate/501 the partial walk-in/SMS routes · Dependabot/Renovate or a CI `npm audit` gate.

---

## Handoff artifacts to produce (pre-handoff, no prod access — high partner value)
1. **`CONTACTS.md`** — ownership/escalation matrix (AWS owner, AuthID vendor + tenant admin, scheduling-service team, tax-office SME, DxHub handoff owner, sev→who).
2. **`docs/runbook.md`** — per-dependency symptom→look→mitigate→escalate.
3. **`docs/cost-model.md`** — per-session unit cost + monthly projections at volume tiers.
4. **ADR set** (`docs/adr/`) — constrained-LLM/state-machine, AuthID-over-OCR, single-table, scheduling-as-stub, SEC-04 deferral; + "SUPERSEDED" banner on the legacy doc still describing the abandoned OCR design.
5. **Data dictionary + written retention schedule** — the single-table PK/SK/GSI contract + per-row TTL (anchors the DPPA/Ch.119 legal decision).
6. **`kb-refresh.md` + `authoring-decision-trees.md`** — the two core ongoing-maintenance guides.
7. **Third-party-licenses / SBOM + root LICENSE/NOTICE** — standard gov pre-acceptance requirement (includes the vendored scheduling-service).
8. **`.env.deploy.example` + cdk-bootstrap note + seed runbook** + a corrected cutover checklist (HANDOFF's lists only Playwright, omits the unit suite + audit + evals).

---

## Open questions only the partner / county can answer
1. Separate prod AWS account from UAT (`522814693903`), or shared? (drives PII blast-radius isolation + parameterize-vs-mutate-in-place)
2. Is "call the office to book" accepted v1 scope, or will you fund hosting the scheduling-service (RDS + Fargate/App Runner)?
3. Which legal regimes apply — DPPA (DL data), GLBA, FL Public Records Ch.119 retention, HIPAA? (gates retention schedule, KMS-CMK, deletion path)
4. AuthID prod-tenant per-Proof/per-Verified price, contracted volume, overage, concurrency cap?
5. Who owns on-call, KB content, and secret rotation after handoff?
6. Is shared-password read-only admin acceptable for v1 until Cognito/RBAC lands — and will the county sign the SEC-04 accept-as-risk in writing?
7. What CloudWatch Logs / records retention period does the county mandate?
8. Will you commission a third-party pen test / authenticated vuln scan as a go-live gate (re-run after Cognito changes the auth surface)?

---

## Sequenced path to cutover
- **Phase 0 (now, no prod access):** Stabilize what we control — green suite + CI gate, IDOR, WAF-from-SSM, SPA build guard, SES wiring, scheduling widget. _(See the Phase-0 plan.)_
- **Phase 1 (now):** Produce the 8 handoff artifacts above.
- **Phase 2 (partner — decisions):** Legal regime determination → retention/KMS; v1 scheduling decision; SEC-04 commit-or-accept; AuthID pricing + budget; name owners; VPC-isolation decision.
- **Phase 3 (partner — build/provision):** Cognito/RBAC + admin WAF + access audit; parameterized isolated prod stacks; Bedrock/API-GW quota raises; provisioned concurrency; resource alarms + log retention + dashboard + canary; Sonnet 4.6 + prompt caching; un-sandbox SES; a11y + load tests; eval/audit threshold gates.
- **Phase 4 (partner — cutover):** Day-one secret rotation; deploy hardened build + populate Secrets Manager; re-verify every control in-cloud; swap alarm recipient; pen test as go-live gate; end-to-end smoke (booking/identity/transcript).
