# Phase 3 — Document-upload expiry: author the validity rules (policy audit)

## Context

Phases 1–2 (commits `887116d`, `38064c6`) built and shipped the expiry engine **dormant**:
the vision screen observes dates, `checkValidity()` decides expired/too-old, but **no catalog
item has a `validity` rule yet**, so nothing is screened. Phase 3 is the policy audit that
flips the engine on, one item at a time, by authoring `validity` rules in `item-catalog.json`.

The bar (from the design doc §5 governance rule and `rejected-corrections.md`): **every rule
must be grounded** in either (a) official policy — flhsmv.gov, tcslc.com, Florida Statutes, or
our ingested KB ops-manual — OR (b) a specific St. Lucie staff statement (the returned
spreadsheets, admin feedback we recorded). **No rule is invented or guessed.** An item with no
groundable recency/expiry semantics gets **no rule** (plausibility-only screening, unchanged).

This plan fans out subagents to research each item independently, adversarially verifies every
proposed number against its source, then a single author applies the survivors + writes the
audit doc. Wrong numbers are the entire risk, so verification is heavier than authoring.

## The 45 uploadable items (worklist)

All 45 `optional_upload` items in `services/chatbot/src/data/item-catalog.json`. Most will
correctly get NO rule (a bill of sale, DD-214, trust cert, plate number, receipts have no
expiry). The audit must still examine each and record WHY it got no rule.

## Sources (grounded — already located, in priority order)

1. **Returned staff spreadsheets (HIGHEST authority — staff's own words).** Two files staff
   filled in, in `~/Downloads` (newer than the repo copies):
   - `/mnt/c/Users/mason/Downloads/tcslc-policy-questions.xlsx` — the `TCSLC ANSWER` column has
     direct staff statements. Load-bearing recency findings already spotted:
     - **D-5**: "Snap letter can be used for proof of address as long as it's within 60 days" →
       staff-confirms the 60-day address-proof window.
     - **D-7 / D-9 / CDL-2 / DL-4**: CDL exam/expiry and new-resident license statements.
     - **TAX-4(B)**: placard fax copy accepted.
   - `/mnt/c/Users/mason/Downloads/tcslc-document-upload-review-EXCEL (1).xlsx` — per-item rows:
     label, "Accept upload?", `Source / policy` URL, and `Notes` (recency windows in prose, plus
     staff `N/A - ...` clarifications that some "uploadable" items aren't actually processed in
     person — e.g. BTR, Tourist Tax).
   - Read with `openpyxl` (installed). The plan's research agents get the relevant rows pre-extracted
     (see Phase 3.0) so they don't each re-parse xlsx.
2. **Ingested KB ops-manual** — `services/chatbot/src/data/flhsmv-ops-manual-index.json` `keyFacts`.
   Confirmed relevant: **IR01** "dated within the last 60 days" (address proof), **CI13** clearance
   letter "within the last 30 days", **EO03** CLP ≤365 days, **MP08** delinquent renewal <1yr. These
   are Claude-generated leads — must be re-confirmed against the actual source, per governance.
3. **Live official sites** — flhsmv.gov (incl. HSMV form PDFs like 83039), tcslc.com, flsenate.gov
   statutes. Fetched via WebFetch for confirmation of a specific number/window.
4. **Existing catalog prose** — the current `label`/`notes` already state windows for several items
   ("dated within the last 6 months", "issued in the last 12 months", "Signature ... within the last
   12 months"). These are the starting hypotheses, NOT accepted as-is — each must trace to source.
5. **Governance guardrails** — `rejected-corrections.md` (e.g. HazMat = 60 not 90 days) and
   `unverified-vendor-claims.md` set the "authoritative source required" bar; a proposed rule that
   matches a REJECTED claim is discarded.

## Rule shape (from Phase 2, already shipped)

```ts
validity?: { rule: 'max-age' | 'unexpired'; anchor: 'issued'|'dated'|'signed'|'expires'; days?: number; source: string }
```
- `max-age` + `days` + anchor (issued/dated/signed) — a recency window (e.g. address proof 60d dated).
- `unexpired` + anchor MUST be `expires` (lint-enforced) — a printed expiry must be today-or-later.
- `source` REQUIRED — a short citation string (URL or "tcslc-sme: <sheet> <ID>"). Lint checks shape;
  the human-readable citation + reasoning lives in the audit doc.
- Anchor must match a date the vision model can actually READ off the document (Phase 1 observes
  issued/dated/signed/expires). A rule whose anchor date is never printed on the doc is useless —
  the research agent must confirm the anchor date physically appears on that document type.

## Execution

### Phase 3.0 — Pre-extract sources (inline, before fan-out)
Do NOT make every agent re-parse xlsx. First, one deterministic step:
- Parse both returned spreadsheets → a compact JSON map: for each of the 45 itemIds, the matching
  upload-review row (label, source URL, notes, staff N/A flags) keyed by fuzzy label match, plus the
  full policy-questions Q&A list (16+23+19 rows) as staff-statement evidence.
- Extract the KB `keyFacts` recency lines (already filtered above) keyed by ops-manual code.
- Write this to a scratch file (e.g. `.cache/phase3-sources.json`) the agents read. This makes every
  agent's grounding identical and cheap.

### Phase 3.1 — Research fan-out (subagents, ~8–10 items each)
Partition the 45 items into batches and run one research agent per batch (batch, not per-item, to
stay within the workflow size guideline — ~5 agents of ~9 items). Each agent, per item, returns a
structured proposal:
```
{ itemId, decision: 'rule' | 'no-rule',
  rule?: { rule, anchor, days?, source },
  anchorDatePrintedOnDoc: boolean,   // is the anchor date actually visible on this doc?
  citation: string,                  // exact source: URL + quote, or "tcslc-sme: policy-questions D-5 '...'"
  sourceTier: 'official' | 'staff-statement' | 'catalog-prose-only' | 'none',
  reasoning: string,                 // why this rule (or why no rule)
  confidence: 'high'|'medium'|'low',
  needsSmeConfirmation: boolean }     // true if only catalog-prose or ambiguous
```
Rules for the agent:
- Prefer a **staff statement** or **official source**; `catalog-prose-only` is NOT sufficient to
  ship a rule — mark `needsSmeConfirmation: true` and `decision: 'no-rule'` (defer), OR propose the
  rule but flag it. Never fabricate a number.
- If staff marked the item `N/A - not processed in person` (BTR, Tourist Tax family), note it — the
  item may not even belong uploadable; flag but do not change the bucket (out of scope).
- `unexpired` only when a printed expiry date exists AND the doc genuinely expires (licenses,
  insurance cards). Anchor MUST be `expires`.
- Default to **no-rule** when unsure. A missing rule = plausibility-only = safe (fail-open). A wrong
  rule = wrongly-rejected resident. Asymmetric risk → conservative.

### Phase 3.2 — Adversarial verification (subagents, per proposed rule)
Every item that got `decision: 'rule'` goes to an independent verifier (pipeline stage, so each
verifies as soon as its research returns). The verifier is prompted to REFUTE:
- Does the cited source actually state this number/window? (WebFetch the URL / re-read the KB
  keyFact / re-read the staff quote — do not trust the researcher's paraphrase.)
- Is the anchor correct and physically present on the document?
- Does it contradict `rejected-corrections.md` / `unverified-vendor-claims.md`?
- Would this rule reject a legitimately-valid document? (fail-open sanity)
Verdict: CONFIRMED (source supports it exactly) | REVISE (right idea, wrong number/anchor — return
the correction) | REJECT (unsupported → downgrade to no-rule + record as needs-SME).
Only CONFIRMED (or verifier-corrected → re-CONFIRMED) rules ship.

### Phase 3.3 — Author + document (inline, single writer)
- Apply the CONFIRMED `validity` rules to `services/chatbot/src/data/item-catalog.json` (edit the
  SOURCE file; the loader is cold-start cached; CDK bundles from working tree).
- Write **`docs/upload-validity-rules.md`** — the required deliverable. One section per item (all 45),
  each showing: itemId + label, the rule (or "no rule — why"), the exact citation(s) with source tier,
  and any `needs-SME-confirmation` flag. Mirrors the `upload-expansion-review.md` convention.
- Deferred/uncertain items get a clearly-marked "NEEDS SME CONFIRMATION" subsection (like the policy
  sheet's own deferred page) — listed, not guessed.

### Phase 3.4 — Verify
1. `npm run lint:trees` — the Phase-2 validity schema check must pass (valid rule/anchor/days/source;
   unexpired⟹expires). This is the structural gate.
2. `npm run test:unit` — no regression (the 3 pre-existing transaction-types failures remain).
3. Spot-check with the live harness on a real dated doc for 2–3 newly-ruled items
   (`scripts/try-doc-validation.ts <file> <itemId>`) — confirm stale→reject, fresh→accept.
4. Re-confirm `checkValidity`'s anchor is one the model actually reports for that doc (the harness
   prints `observedDates` — verify the anchor field is populated).

## Likely outcomes (hypotheses to verify, NOT decisions)
Grounded starting points the fan-out must confirm or reject:
- `address-proof-1`, `address-proof-2` → `max-age`, `dated`, **60** — IR01 (KB) + staff D-5. HIGH.
- `oos-registration` → `max-age`, `dated`, **~183** ("within the last 6 months") — flhsmv titles +
  catalog prose. Confirm the exact window + anchor.
- `hsmv-83039` → `max-age`, `signed`, **365** ("signature within the last 12 months") — HSMV 83039
  instructions. Confirm.
- `va-form-letter-27-333` → `max-age`, `issued`, **365** ("issued in the last 12 months") — confirm.
- `existing-ccw-license`, `commercial-insurance-limits-proof`, `fl-insurance-proof-for-test-vehicle`,
  `dealer-license-active` → possibly `unexpired`/`expires` — confirm the doc prints an expiry AND that
  staff/policy require it current.
- **Most others** (bill of sale, DD-214, trust cert, receipts, plate numbers, death certificate,
  military orders, lien letter, recipient info) → **no rule** — no expiry semantics. Record why.
- Watch: `proof-oos-sales-tax` ("owned less than 6 months") is a TAX-BASIS condition, not a document
  recency window — likely **no rule** (the 6-month test is about the vehicle, not the doc's age).

## Constraints
- Edit the SOURCE `item-catalog.json`; re-run `lint:trees` after. Do NOT hand-edit `cdk.out`.
- Stage explicitly at commit (the flip agent's concurrent `item-catalog.json`/tree edits are still
  uncommitted in the working tree — Phase 3 also edits `item-catalog.json`, so a clean `git add -p`
  or per-item staging is required to avoid entangling their bucket flips).
- No engine/type/infra change — Phase 3 is pure data + docs. If a rule needs a shape the Phase-2
  engine can't express, STOP and flag it, don't hack the data.
- Scale: ~5 research agents + per-rule verifiers (only the ~8–12 items that get rules), well within
  the workflow guideline. Not per-item agents.
