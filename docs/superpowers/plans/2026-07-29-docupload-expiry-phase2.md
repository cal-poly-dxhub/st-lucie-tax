# Phase 2 — Document-upload expiry: the pure decision engine

## Context

Phase 1 (committed `887116d`) made the vision model **report** the dates it reads
(`observedDates` + `datesLegible` on `ValidationVerdict`) and broadened screening to PDF +
HEIC. **Nothing acts on those dates yet.** Phase 2 adds the deterministic decision layer: a
pure function that, given a document's structured validity rule and the model's observed
dates, decides `ok | expired` against the server clock — and wires an `expired` outcome into
`validateDocument` as a reject, on a path **parallel to** (not through) the 0.85 plausibility
confidence gate.

Design source: `docs/superpowers/specs/2026-07-28-docupload-expiry-design.md` (§4, §6).
Precedent to mirror: `services/chatbot/src/authid/decision.ts` — the only existing date-based
rejection, a pure function with end-of-day-UTC grace, `Number.isFinite` guard, and fail-open
on a missing/unparseable date.

**Phase 2 ships the engine, not the rules.** Per the user's sequencing, the `validity` data
authoring (all 45 uploadable items) is **Phase 3**. Phase 2 lands with **zero `validity` rules
populated** → the engine is dormant and behavior is byte-identical to today. It activates
per-item as Phase 3 authors rules. (One or two rules may be seeded in Phase 2 solely as
integration fixtures — see Testing.)

## Guiding invariants (unchanged from Phase 1)

- **Fail-open.** No rule, no legible date, missing anchor date, unparseable date, or
  `datesLegible === false` → `ok` (accept). Only a confident, rule-backed, in-the-past date rejects.
- **Model observes, code decides.** `checkValidity` is pure, no I/O, never throws. It consumes
  the Phase-1 `observedDates`/`datesLegible` already parsed in `validateDocument`.
- **Expiry is NOT the plausibility gate.** `mapVerdictToAction` (0.85) is untouched and its
  tests stay green. Expiry is a separate deterministic compare; final verdict = reject if
  (plausibility hard-reject) OR (validity expired).
- **Per-slot advisory, not a freeze.** An expiry reject reuses the existing reject return shape
  → `FileUpload.tsx` shows the reason and lets the resident re-upload or continue. Zero client
  or route changes (validationResult is opaque JSON; the response passes new fields verbatim —
  confirmed in Phase 1).

## Key facts confirmed during research

- `CatalogItem` (`packages/shared-types/src/session.ts:135`) now also has `uploadSides?` (a
  concurrent agent's flip work). The new `validity?` field appends cleanly beside it.
- Wiring point is `validate-document.ts` **the accept return path** (~L470, post-Phase-1): it
  runs only when `mapVerdictToAction` did NOT hard-reject, so `checkValidity` is the right gate
  to insert there. The hard-reject path (~L457) already blocks and needs no expiry check.
- `observedDates`/`datesLegible` are already parsed into locals in that scope (Phase 1) — the
  decision has everything it needs without touching the Bedrock call.
- Linter: extend the local `CatalogItem` interface (`scripts/lint-decision-trees.ts:83`) and add
  a `validity` validation block inside `lintCatalogItems` (L347, beside rules 7–8).
- `authid/decision.ts` date parse to mirror EXACTLY: `new Date(`${value}T23:59:59Z`)`,
  `Number.isFinite(getTime())` guard, compare `< Date.now()`; absent field → no reject.
- `backend-stack.ts` `lambdaEnv` is where `DOC_VALIDATION_REJECT_THRESHOLD` (currently only a
  code default) + a new `DOC_VALIDATION_EXPIRY_ENABLED` toggle should be injected.
- Test harness: `authid-decision.test.ts` `baseResult()` factory + one-assertion-per-row is the
  template. Tests are plain tsx, import with `.js`, end `void run();`.

## Changes (TDD — pure logic first)

### A. Data model
`packages/shared-types/src/session.ts` — add beside `uploadSides`:
```ts
export interface DocumentValidity {
  rule: 'max-age' | 'unexpired';        // max-age: an anchor date within `days` of today.
  anchor: 'issued' | 'dated' | 'signed' | 'expires';  // which observed date to read.
  days?: number;                        // required for max-age; ignored for unexpired.
  source: string;                       // FLHSMV/tcslc/statute citation. REQUIRED (governance).
}
// on CatalogItem:
validity?: DocumentValidity;
```
`ObservedDates` (from Phase 1, in `validate-document.ts`) already keys by the same anchor names
(`issued|dated|signed|expires`) — `anchor` indexes it directly. Consider moving `ObservedDates`
into shared-types so both modules share one definition; acceptable to keep it in
validate-document.ts and import the type into check-validity.ts. Decide at implementation.

### B. The pure engine — NEW `services/chatbot/src/upload/check-validity.ts`
Mirrors `authid/decision.ts` (pure, no I/O, never throws).
```ts
export type ValidityStatus = 'ok' | 'expired';
export interface ValidityOutcome { status: ValidityStatus; reason?: string } // reason = machine slug

export function checkValidity(
  validity: DocumentValidity | undefined,
  observed: ObservedDates | undefined,
  datesLegible: boolean | undefined,
  asOf: Date,
): ValidityOutcome {
  if (!validity) return { status: 'ok' };              // no rule       → fail-open
  if (datesLegible === false) return { status: 'ok' }; // illegible     → fail-open
  const raw = observed?.[validity.anchor];
  if (!raw) return { status: 'ok' };                   // anchor absent → fail-open
  const t = new Date(`${raw}T23:59:59Z`).getTime();    // end-of-day UTC grace (authid parity)
  if (!Number.isFinite(t)) return { status: 'ok' };    // unparseable   → fail-open
  if (validity.rule === 'unexpired') {
    return t < asOf.getTime() ? { status: 'expired', reason: 'document-expired' } : { status: 'ok' };
  }
  const ageDays = (asOf.getTime() - t) / 86_400_000;
  return ageDays > (validity.days ?? Infinity)
    ? { status: 'expired', reason: 'document-too-old' } : { status: 'ok' };
}
```
Plus a pure server-side reason builder (deterministic customer sentence, NOT model text):
```ts
export function buildExpiryReason(validity: DocumentValidity): string
// document-too-old → "This <label-ish> looks older than N days. Please upload one from the
//   last N days, or bring it to your appointment."
// document-expired → "This document appears to have expired. Please upload a current one, or
//   bring it to your appointment."
```
Keep wording generic (no per-item label plumbing needed); pass the catalog label in only if
cheap. Both functions are exported and unit-tested.

### C. Wire into `validateDocument` (the accept path only)
In `validate-document.ts`, at the accept return (~L470), before returning accept:
- Read the item's rule: `const validity = getCatalogItem(documentType)?.validity;`
- `const expiry = DOC_VALIDATION_EXPIRY_ENABLED ? checkValidity(validity, observedDates, datesLegible, new Date()) : { status: 'ok' };`
- If `expiry.status === 'expired'` → return a **reject** verdict reusing the existing reject
  shape: `{ verdict: 'reject', observedDocument, confidence, reason: buildExpiryReason(validity!),
  observedDates, datesLegible }`, and include the machine slug so it lands in `validationResult`
  (e.g. an internal `expiryReason: expiry.reason` field on ValidationVerdict, or fold into reason
  metadata — pick one and type it).
- Otherwise return accept exactly as today.
The hard-reject path is untouched. A below-threshold plausibility reject that we currently let
through as fail-open accept STILL gets the expiry check (correct — expiry is independent).

### D. Config / infra — `infra/backend-stack.ts`
Add to `lambdaEnv`:
- `DOC_VALIDATION_REJECT_THRESHOLD: '0.85'` (promote the existing code default so it's tunable).
- `DOC_VALIDATION_EXPIRY_ENABLED: 'true'` (runtime kill-switch; validate-document reads it as
  `process.env.DOC_VALIDATION_EXPIRY_ENABLED !== 'false'`).
No IAM change. (This is the ONLY file here that overlaps Phase-1's committed backend-stack edit —
append to the same `lambdaEnv` object.)

### E. Lint — `scripts/lint-decision-trees.ts`
- Extend the local `CatalogItem` interface (L83) with the `validity?` shape.
- In `lintCatalogItems` (L347): if `item.validity` present, assert `rule ∈ {max-age,unexpired}`,
  `anchor ∈ {issued,dated,signed,expires}`, `days` is a positive number when `rule==='max-age'`
  (and absent/ignored otherwise), and `source` is a non-empty string. Push a Violation per breach.

### F. Tests (TDD; pure logic gets real coverage)
- NEW `tests/unit/document-validity-check.test.ts` — mirror `authid-decision.test.ts`. A
  `baseObserved()` factory + one assertion per row:
  - max-age: within window → ok; older than window → expired(`document-too-old`); **exact
    boundary / today → ok** (end-of-day grace); anchor date absent → ok.
  - unexpired: future expires → ok; past → expired(`document-expired`); today → ok.
  - fail-open sweep: no validity / `datesLegible:false` / unparseable / empty observed → ok.
  - `days` missing on a max-age rule → ok (defensive; lint prevents authoring it).
- NEW reason-builder test: deterministic sentence per (rule, days) — assert substring/shape.
- `document-validation-decision.test.ts` — keep green, unchanged (proves expiry didn't leak
  into the 0.85 gate).
- Extend the linter's own coverage if a lint test exists; else rely on `npm run lint:trees`.

### G. Update the design doc
Flip §12's "Phase 1 status" companion to add a "Phase 2 status" note once landed.

## Explicitly NOT in Phase 2 (Phase 3)
- Authoring `validity` rules across the 45 items + `docs/upload-validity-rules.md` audit.
- Any live-policy WebFetch confirmation of thresholds.

## Verification
1. `npm run test:unit` — new validity-check + reason-builder tests green; the 3 pre-existing
   `transaction-types.json` failures remain (unrelated).
2. `npm run build:types && npx tsc -p services/chatbot/tsconfig.json --noEmit` — clean.
3. `npm run lint:trees` — passes with zero `validity` rules; add one malformed rule to a scratch
   copy to confirm the new lint check fires, then revert.
4. Dormant-behavior check: with no `validity` populated, `scripts/try-doc-validation.ts` on a
   dated JPEG still ACCEPTS (engine present but inert).
5. Activation check (integration fixture): temporarily add a `validity` rule to ONE item (e.g.
   `address-proof-1` max-age 60 dated) + run the harness on a document with an old printed date
   → expect a `document-too-old` reject; on a recent date → accept. Revert the fixture (Phase 3
   authors the real rules with citations).
6. `cd infra && npx cdk synth StLucieBackendStack` — env vars present, no error. No deploy.

## Commit boundary
Phase 2 files are disjoint from the other agent's flip work EXCEPT `backend-stack.ts` and
`session.ts` (both also touched by the flip work). Stage explicitly, as in Phase 1. Do not
commit the flip work.
