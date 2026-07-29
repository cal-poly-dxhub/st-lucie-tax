# Document-upload validation: expiry & disqualification screening

_Design spec — 2026-07-28. Companion to the existing AI pass/reject screen
(`services/chatbot/src/upload/validate-document.ts`, shipped in commit `b0636fa`)._

## 1. Problem & goal

The document-upload screen today is **plausibility-only and fail-open**: it asks the
vision model "could this image plausibly BE the expected document?" and blocks only an
obvious wrong-kind upload (a selfie sent for military orders). It reads **no dates**, is
never told today's date, and screens **only jpeg/png/gif/webp** — PDF and HEIC upload
successfully but pass through completely un-screened.

**Goal:** catch documents that are *disqualified in the moment* — an expired credential,
a proof-of-address bill older than 60 days — so the resident can upload a fresh one right
away instead of discovering the problem at the counter. This must work **across all
document types** (the catalog just expanded from 2 to **45 uploadable items**) and across
the formats residents actually use (PDF, HEIC), not just raster images.

**Non-goals (this pass):**
- No human-in-the-loop "review" tier (AuthID has one; the doc screen deliberately does
  not — see §3). Expiry is a reject or nothing.
- No admin-dashboard document-review surface (the "Docs" tab is a separate, pre-existing
  gap — see §9).
- No async/Textract/S3-event OCR pipeline. Screening stays synchronous.
- No `DocumentSource.s3Location` large-PDF path (noted as a future escape hatch only).

## 2. Guiding principles (inherited, non-negotiable)

1. **Fail-open is load-bearing.** "A wrongly-rejected real resident is far worse than one
   junk document reaching a clerk." Every error, timeout, unreadable date, missing rule,
   or ambiguous case must resolve to **accept**. Expiry rejection is added *only* for the
   confident, rule-backed, unambiguous case.
2. **Not a freeze — advisory, per-slot.** A reject (today's junk-reject *or* a new expiry
   reject) marks that one upload slot incomplete, shows a friendly reason, and lets the
   resident re-upload **or simply continue** — the whole upload-docs step is optional and
   skippable. Current behavior confirmed in `apps/chatbot-app/src/components/FileUpload.tsx`:
   a reject does not call `onUploaded`, relabels the button "Try another file," and never
   blocks the flow. Expiry rejection reuses this exact path — **no new UX, no new freeze.**
3. **Model observes, code decides.** The vision model *reports the dates it reads*; a pure,
   unit-testable function decides expired-or-not by comparing against the server clock.
   This mirrors `services/chatbot/src/authid/decision.ts` — the only existing date-based
   rejection in the codebase — and is what makes expiry safe to add to a fail-open system:
   **the reject is a date comparison you can test, not a model opinion.**
4. **Trees + item-catalog are the source of truth.** Validity rules live as structured,
   source-cited data on catalog items — never as prompt prose the LLM improvises from
   (honors `NO_DOC_LIST_FROM_MEMORY` / `assertNoRogueChecklist`).
5. **Governance bar.** Every recency/expiry number must be backed by an FLHSMV / tcslc /
   statute source, per `services/chatbot/src/data/rejected-corrections.md` (which refused a
   wrong "90-day" HazMat claim and pinned it to 60). This is enforced structurally: a
   `validity` rule cannot be authored without a `source` field.

## 3. The AuthID precedent (what we mirror)

`authid/decision.ts` `decide()` is a pure function that reads a `DateOfExpiry` key, parses
it as `new Date(`${value}T23:59:59Z`)` (**end-of-day UTC = whole-day grace**), guards with
`Number.isFinite(getTime())`, and pushes a stable machine-slug reason (`document-expired`)
only when the date is finite AND past. A missing/unparseable date produces **no** rejection
(fail-open). We replicate all three nuances: end-of-day grace, finite-guard, fail-open-on-absent.

Divergences we keep intentional:
- AuthID uses a 3-tier `pass|review|reject`; the doc screen stays **2-tier** (`accept|reject`)
  — no review queue exists to route to. Decision approved: expiry is a hard per-slot reject
  (which, per principle 2, is still non-blocking to the overall flow).
- AuthID is signal/boolean-driven; the doc screen's *plausibility* verdict is confidence-driven
  (0.85 threshold). **Expiry is neither** — it is a deterministic date compare and runs on a
  **parallel path**, NOT through the 0.85 confidence gate.

## 4. Data model — `validity` on `CatalogItem`

Add one optional field to `CatalogItem` in `packages/shared-types/src/session.ts`, populated
in `services/chatbot/src/data/item-catalog.json`:

```ts
export interface DocumentValidity {
  /** 'max-age'   = a date on the doc must be within `days` of today.
   *  'unexpired' = a printed expiry date must be today or later. */
  rule: 'max-age' | 'unexpired';
  /** Which printed date the model should read + we compare against. */
  anchor: 'issued' | 'dated' | 'signed' | 'expires';
  /** Required for rule:'max-age'; omitted/ignored for 'unexpired'. */
  days?: number;
  /** Official source substantiating THIS window (FLHSMV/tcslc/statute).
   *  Required — mirrors the sourceRefs / verified governance convention. */
  source: string;
}

export interface CatalogItem {
  itemId: string;
  label: string;
  bucket: ItemBucket;
  source?: string;
  verified?: string;
  notes?: string;
  validity?: DocumentValidity;   // ← NEW, optional
}
```

Worked examples (final numbers set in Phase 3, §8):
- `address-proof-1` → `{ rule:'max-age', anchor:'dated', days:60, source:'flhsmv IR01 / REAL ID' }`
- `oos-registration` → `{ rule:'max-age', anchor:'dated', days:183, source:'flhsmv titles' }`
- `hsmv-83039` → `{ rule:'max-age', anchor:'signed', days:365, source:'flhsmv 83039' }`
- `existing-ccw-license` → `{ rule:'unexpired', anchor:'expires', source:'FDACS CWL §790.06' }`

Items with no recency semantics (bill of sale, DD-214, trust cert, parts/builder receipts,
death certificate) **omit the field** and get plausibility-only screening, exactly as today.

**Lint:** extend `scripts/lint-decision-trees.ts` (`npm run lint:trees`) to validate `validity`:
require `days` when `rule:'max-age'`, require a non-empty `source`, enum-check `anchor` and
`rule`. A malformed rule fails CI rather than silently mis-screening.

## 5. Phase 1 — vision model OBSERVES dates (no judgment)

Extend the forced `record_document_verdict` tool schema in `validate-document.ts` with
optional, observation-only fields (the existing `verdict`/`observedDocument`/`confidence`/
`reason` plausibility fields are unchanged):

```ts
observedDates?: {
  issued?:  string;  // ISO 'YYYY-MM-DD' — clearly printed issue/print date
  dated?:   string;  // the document's own effective date, if distinct from issued
  signed?:  string;  // signature / certification date
  expires?: string;  // printed expiration / valid-through date
}
datesLegible?: boolean;  // false if dates are cropped, blurred, or absent
```

System-prompt additions (append to `SYSTEM_POLICY_PROMPT`, and thread an `asOf` date into
`buildExpectedDocText`):
1. **Inject today's date** from the server clock (`new Date()` at call time) — the model
   currently receives no date context at all.
2. Instruct the model to **transcribe** any clearly-printed dates into ISO and report
   legibility, and **explicitly not to judge expiry** — leave a field absent rather than
   guess. Emphasize the existing default-to-accept plausibility posture is unchanged.

Date extraction rides in the **same single forced tool call** — no extra model round, no
added latency. The plausibility verdict is untouched.

`buildExpectedDocText` also gains: when the item has a `validity` rule, tell the model which
anchor date matters (e.g. "report the effective/billing date of this document") so it looks
for the right one.

## 6. Phase 2 — the pure decision engine

New file `services/chatbot/src/upload/check-validity.ts`, modeled on `authid/decision.ts`:

```ts
export type ValidityOutcome = { status: 'ok' | 'expired'; reason?: string };

export function checkValidity(
  validity: DocumentValidity | undefined,
  observed: ObservedDates | undefined,
  datesLegible: boolean | undefined,
  asOf: Date,
): ValidityOutcome {
  if (!validity)               return { status: 'ok' };  // no rule        → fail-open
  if (datesLegible === false)  return { status: 'ok' };  // can't read     → fail-open
  const raw = observed?.[validity.anchor];
  if (!raw)                    return { status: 'ok' };  // anchor absent  → fail-open
  const t = new Date(`${raw}T23:59:59Z`).getTime();      // end-of-day UTC grace
  if (!Number.isFinite(t))     return { status: 'ok' };  // unparseable    → fail-open

  if (validity.rule === 'unexpired') {
    return t < asOf.getTime()
      ? { status: 'expired', reason: 'document-expired' }
      : { status: 'ok' };
  }
  // max-age: the anchor date must be within `days` of today
  const ageDays = (asOf.getTime() - t) / 86_400_000;
  return ageDays > validity.days!
    ? { status: 'expired', reason: 'document-too-old' }
    : { status: 'ok' };
}
```

Pure, no I/O, never throws. Every branch that cannot make a confident, rule-backed call
returns `ok`.

**Customer-facing reason is built server-side, deterministically** (a small pure helper,
NOT a model sentence), keyed on `(rule, anchor, days)`:
- `document-too-old` → e.g. *"This proof of address is dated more than 60 days ago. Please
  upload one from the last 60 days, or bring it to your appointment."*
- `document-expired` → e.g. *"This document appears to have expired. Please upload a current
  one, or bring it to your appointment."*

The machine slug (`document-too-old` / `document-expired`) is stored in the stringified
`validationResult` for admin/debug; the friendly sentence is what the SPA renders.

### Wiring into `validateDocument()`

After the existing plausibility mapping:
- If plausibility says **hard-reject** → return `reject` as today (unchanged).
- If plausibility says **accept** → run `checkValidity(item.validity, observedDates,
  datesLegible, asOf)`. If `expired`, return a **`reject`** verdict with the server-built
  reason, reusing the **exact same return shape** as a plausibility reject.

Net verdict = `reject` if (plausibility hard-reject) **OR** (validity expired); else `accept`.
The reject return shape is identical, so `FileUpload.tsx` and the SPA need **zero changes**.

**Route persistence DOES need one change** (found in Phase 2 review): the `/validate-document`
route previously decided `failed` vs `validated` by re-running `mapVerdictToAction(result)` — the
0.85 plausibility gate. That was only correct while `verdict==='reject'` implied a ≥0.85 reject.
An expiry reject carries `verdict:'reject'` with a *sub-0.85 accept-level confidence*, so the
gate would mislabel it `validated` and reference its S3 object (reaching the clerk). The route
must branch on **`result.verdict === 'reject'`** instead — the load-bearing signal.

`mapVerdictToAction` keeps its current `'accept' | 'hard-reject'` plausibility contract and
its unit tests stay green — expiry is deliberately a **separate** decision, not routed
through the 0.85 threshold.

## 7. Phase 1 (cont.) — format broadening: PDF + HEIC

`detectFormat()` already sniffs `%PDF` and the HEIC `ftyp` box via magic bytes — no detection
work needed. Change `routeFormat()`:

```
jpeg | png | gif | webp → 'image'        (unchanged — Bedrock ImageBlock)
pdf                     → 'document'      (NEW — Bedrock DocumentBlock, inline bytes)
heic                    → 'transcode'     (NEW — HEIC→JPEG, then the image path)
unknown                 → 'passthrough'   (unchanged — fail-open accept)
```

**PDF → Bedrock `DocumentBlock`** (verified against `@aws-sdk/client-bedrock-runtime`:
`DocumentSource.BytesMember` accepts a `Uint8Array`; SDK base64-encodes). Same Haiku model,
same region, same Converse call — one content block becomes
`{ document: { format: 'pdf', name: <fixed safe literal>, source: { bytes: buf } } }`.
**No new IAM, no new model, no new region.** Guards:
- Size: PDFs share the existing ~3.75 MB `MAX_BYTES` inline ceiling → over it, fail-open
  accept (`pdf-too-large`). (`DocumentSource.s3Location` is the documented future escape
  hatch for large multi-page PDFs — out of scope here.)
- `name` must be a fixed safe literal, never the caller-controlled filename.

**HEIC → transcode with `heic-convert`** (pure-JS libheif; no native binary, bundles cleanly
into the Lambda — `sharp`'s prebuilt HEIC support is unreliable). Decode HEIC → JPEG buffer →
feed the existing image path. Guards:
- Runs inside the existing 9 s abort budget; a decode that would blow the budget → fail-open.
- Any decode throw → fail-open accept (`heic-transcode-failed`). Strictly better than today,
  where HEIC is never screened at all.

**New dependency:** `heic-convert` added to `services/chatbot/package.json`. Confirm it bundles
into the CDK Lambda asset (pure-JS, expected fine).

## 8. Phase 3 — policy audit (author the per-item rules)

For each of the **45 `optional_upload` items** (confirmed in `item-catalog.json`; none carry a
`validity` field yet), classify into three outcomes. **Only source-backed rules are authored.**

**Method per item:** read the catalog `label`/`notes` prose → cross-check the KB
(`flhsmv-ops-manual-index.json` `keyFacts`, e.g. IR01 = 60-day address proof; IR07 = 60-day
HazMat) → **confirm against live FLHSMV / tcslc / statute** (WebFetch) before committing a
number. Run as a parallel per-item workflow (research → adversarial source-verification →
author), since a wrong number is the primary risk and 45 lookups are independent.

1. **Has recency/expiry semantics + citable source → author a `validity` rule.**
   Clear candidates: `address-proof-1`, `address-proof-2` (60d, dated); `oos-registration`
   (~183d, dated); `hsmv-83039` (365d, signed); `va-form-letter-27-333` (365d, issued);
   `expiring-placard-registration-copy`; `existing-ccw-license`, `commercial-insurance-limits-proof`,
   `dealer-license-active`, `fl-insurance-proof-for-test-vehicle` (unexpired).
2. **No date semantics → no rule** (plausibility-only): `bill-of-sale-purchase-agreement`,
   `dd214-or-veteran-id`, `certification-of-trust`, `trust-certification`, `parts-receipts-trailer`,
   `builder-receipts`, `death-certificate`, `sunbiz-registration`, `recipient-plate-or-license-info`,
   `existing-physical-plate-or-number`, `business-entity-proof`, `org-feid-or-fl-sales-tax`, etc.
3. **Ambiguous / uncited → do NOT guess.** Record in a new `docs/upload-validity-rules.md` as
   "needs SME confirmation" with the open question, mirroring `upload-expansion-review.md`'s
   county-sign-off convention.

**Deliverable:** populated `validity` fields in `item-catalog.json` + `docs/upload-validity-rules.md`
(every authored rule with its citation; every deferral with its open question). Re-run
`npm run lint:trees` after edits.

## 9. Infra & config

`infra/backend-stack.ts` — small, no IAM changes:
- Promote `DOC_VALIDATION_REJECT_THRESHOLD` into `lambdaEnv` (today only a code default,
  despite the comment claiming it is prod-tunable).
- Add `DOC_VALIDATION_EXPIRY_ENABLED` (default `'true'`) so ops can disable expiry rejection
  at runtime without a redeploy if a rule misfires. `checkValidity` is bypassed when off.

No new Bedrock model, region, or IAM statement — PDF uses the existing Haiku DocumentBlock
grant; HEIC transcode is in-process. `s3:GetObject` on the doc bucket is already granted.

**Known adjacent gap (out of scope, flagged):** the admin "Docs" tab reads `DOC#` rows that
nothing writes, and `validationResult`/`failOpen` are not surfaced in the admin UI. An expiry
reject is only visible in the raw Context JSON, same as today's junk-reject. Surfacing this is
deferred to a separate admin-visibility effort.

## 10. Testing

Zero-dependency `tsx` harness (`tests/unit/assert.ts`; each file ends `void run();`; discovered
by `run-all.ts`). Pure functions get real coverage; the async orchestrator stays factored so its
logic is testable without an S3/Bedrock mock (none exists in this repo).

- **`tests/unit/document-validity-check.test.ts`** (NEW — the core, mirrors `authid-decision.test.ts`):
  - `max-age`: within window → `ok`; older → `expired`; **exact boundary/today → `ok`** (grace);
    anchor absent → `ok`.
  - `unexpired`: future → `ok`; past → `expired`; today → `ok`.
  - fail-open sweep: no rule / `datesLegible:false` / unparseable / empty observed → **all `ok`**.
  - reason slugs present exactly when expired.
- **`document-magic-bytes.test.ts`** (EXTEND): `routeFormat` → `'document'` for pdf, `'transcode'`
  for heic, `'passthrough'` for unknown.
- **`document-validation-decision.test.ts`** (KEEP GREEN): 0.85 plausibility invariant unchanged —
  proves expiry did not leak into the confidence gate.
- **`document-catalog-description.test.ts`** (EXTEND): `buildExpectedDocText` emits today's date +
  the anchor instruction when an item has `validity`.
- **Reason-builder unit test** (NEW): deterministic customer sentence per `(rule, anchor, days)`.
- **`scripts/try-doc-validation.ts`** (EXTEND): accept a PDF and a HEIC; print observed dates +
  validity outcome for real-Bedrock spot-checks.
- **`lint:trees`**: `validity` schema validation (see §4).
- No Playwright/e2e in this pass (upload e2e has no fixtures today) — noted as follow-up.

## 11. Files touched (summary)

**Phase 1 — observe + formats**
- `services/chatbot/src/upload/validate-document.ts` — tool schema (`observedDates`,
  `datesLegible`), `SYSTEM_POLICY_PROMPT` + `asOf` date injection, `routeFormat` (pdf→document,
  heic→transcode), PDF DocumentBlock path, HEIC transcode path, new fail-open reason codes.
- `services/chatbot/package.json` — add `heic-convert`.

**Phase 2 — engine**
- `packages/shared-types/src/session.ts` — `DocumentValidity` + `CatalogItem.validity`.
- `services/chatbot/src/upload/check-validity.ts` — NEW pure decision fn + server-side reason builder.
- `services/chatbot/src/upload/validate-document.ts` — wire `checkValidity` after plausibility accept.
- `infra/backend-stack.ts` — `DOC_VALIDATION_REJECT_THRESHOLD` + `DOC_VALIDATION_EXPIRY_ENABLED` env.
- `scripts/lint-decision-trees.ts` — `validity` schema lint.
- Tests as in §10.

**Phase 3 — policy**
- `services/chatbot/src/data/item-catalog.json` — populate `validity` on qualifying items.
- `docs/upload-validity-rules.md` — NEW audit record (citations + deferrals).

## 12. Rollout & risk

- **Fail-open everywhere** means the worst-case of a bad rule/misread is a *wrongly-accepted*
  stale doc (status quo today), never a wrongly-blocked resident — except the intended
  confident-expiry case. `DOC_VALIDATION_EXPIRY_ENABLED=false` is the instant kill-switch.
- **Latency unchanged** — dates ride in the existing single Converse call; no second round.
- **CDK deploys from the working tree** — Phases 1–2 code + the `validity` data land together
  on the next `cdk deploy StLucieBackendStack`. Re-run `npm run lint:trees` + `npm run test:unit`
  before deploy (per `CLAUDE.md`).
- **Ordering:** Phase 1 → Phase 2 → Phase 3, per the requested sequencing. Phases 1–2 can ship
  with zero `validity` rules populated (engine dormant, behavior identical to today); Phase 3
  progressively activates screening as rules are authored and confirmed.

### License disclosure (HEIC dependency — MUST reach the SBOM)
Phase 1 adds `heic-convert` → `heic-decode` → **`libheif-js` (LGPL-3.0)** to screen HEIC
uploads. `libheif-js/wasm-bundle` inlines its WASM as base64 into the JS, so esbuild bundles it
into the Lambda artifact with no sidecar file (verified: the synthesized asset contains the
`\x00asm` module and `transcodeHeicToJpeg`). Consequences to record for the government handoff:
- **This copyleft dependency is compiled into the distributed Lambda bundle.** It must be listed
  in the third-party-license / SBOM deliverable named in `docs/PROD-READINESS.md` (P1), with the
  LGPL-3.0 notice preserved.
- It is isolated behind `services/chatbot/src/upload/transcode-heic.ts` (one seam, one import), so
  it can be swapped for a permissively-licensed transcoder if the county objects at acceptance —
  no other file imports it.

### Phase 1 status (implemented 2026-07-28)
Landed: date observation (`observedDates`/`datesLegible` — reported + persisted, not yet acted
on), PDF screening via Bedrock `DocumentBlock`, HEIC screening via `transcode-heic.ts`, and the
signed-`Content-Type` removal in `generate-url.ts` (fixes HEIC PUT 403s). Verified: full unit
suite (the 4 doc-validation test files green; 3 unrelated pre-existing `transaction-types.json`
path failures remain, documented in PROD-READINESS), `tsc --noEmit` clean, and `cdk synth`
bundles the inlined-wasm dependency with no error. No infra IAM/env change was needed.
