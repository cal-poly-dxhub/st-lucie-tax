# Upload validity (expiry / recency) rules — per-document audit

**What this is:** the grounded record of which uploadable documents get a `validity` rule
(the Phase 2 engine that rejects an expired/too-old upload) and, for every item, the exact
source. Companion to `upload-expansion-review.md`.

**The bar (from the design spec §5 + `rejected-corrections.md`):** a rule ships ONLY if grounded
in **(a) official policy** with a quotable statement (flhsmv.gov, tcslc.com, Florida Statutes, or
the ingested FLHSMV ops-manual KB) OR **(b) a specific St. Lucie staff statement** (the returned
`tcslc-policy-questions.xlsx` / `tcslc-document-upload-review-EXCEL.xlsx`). **Catalog prose alone
is not sufficient** — a prose-only recency hint is recorded as `NEEDS SME CONFIRMATION`, not
shipped. No number is invented. Risk is asymmetric: a missing rule = plausibility-only screening
(fail-open, safe); a wrong rule = a real resident wrongly blocked.

**How this was produced (2026-07-29):** 5 parallel research agents examined all 45 uploadable
items against a pre-extracted grounding set (both returned staff spreadsheets, the KB `keyFacts`,
catalog prose, and the governance guardrails); every *proposed* rule was then handed to an
independent adversarial verifier prompted to refute it (re-reading the actual source, WebFetching
official URLs — not trusting the researcher's paraphrase). Only rules the verifier CONFIRMED
against the source ship.

## Summary

| Outcome | Count | Items |
|---|---|---|
| **Date rule shipped** (hard-reject, official-tier) | 4 | `hsmv-83039`, `va-form-letter-27-333`, `address-proof-1`, `address-proof-2` |
| **Content advisory shipped** (soft warning, never blocks) | 12 | see "Content advisories" below |
| **No rule** — genuinely no expiry/recency dimension | 26 | see below |
| **No date rule — NEEDS SME CONFIRMATION** | 15 | see below |

Note: several items appear in BOTH a shipped-content-advisory AND the no-date-rule lists — they
have no groundable *date* rule but do have a groundable *content/status* attribute (e.g.
`sunbiz-registration` → no expiry window, but an advisory that the printout shows "Active").

### Two rule kinds (engine)
- **Date rule** (`validity.rule` = `max-age`/`unexpired`): deterministic, can **hard-reject** an
  expired/too-old upload. High bar (official or staff, over-block screened).
- **Content advisory** (`validity.contentChecks[]`): the doc must SHOW an attribute (status
  "Active", "100% permanent", "Honorable"). **Advisory only — never blocks**; the vision model
  judges presence and a clear concern surfaces a soft warning so the resident can self-correct.
  Because it never rejects, the grounding bar is lower — but each was still limited to attributes
  whose absence genuinely predicts a counter rejection (avoiding advisory fatigue). A separate
  "shows VIN / name legible / has letterhead" tier (18 candidates) was **deliberately NOT shipped**
  as noise.

`hsmv-83039` + `va-form-letter-27-333` both come from one FLHSMV page and key on a 12-month
(365-day) window that appears verbatim in official policy AND on the form itself.

`address-proof-1/2` were added in a **second confirmation pass** (2026-07-29): the 60-day window
is grounded (KB IR01 + staff D-5/DL-2) but the slot mixes transient proofs (60-day) with permanent
ones (deed/lease). Shipped safely via a new **`appliesWhen`** engine feature that scopes the rule
to the transient subtypes only (see below) — a years-old deed uploaded to the slot is never
date-screened.

### Confirmation pass (2026-07-29) — 7 deferred candidates re-examined, 0 additional shipped
A focused pass deep-fetched official sources for the 7 most-plausible deferred items. **None
cleared the bar**, and the reasons are instructive (recorded in the deferred table below):
- `existing-ccw-license`: a real statute quote exists (§790.06(11), "180 days or more after
  expiration") BUT a military-tolling provision means deployed servicemembers hold validly-
  renewable CWLs expired >180 days — an unavoidable over-block on a veteran-heavy population.
- `commercial-insurance-limits-proof`, `fl-insurance-proof-for-test-vehicle`: FLHSMV states only a
  "continuous coverage" *maintenance* duty, no document-recency window; a renewed customer holding
  the prior-period card image would be wrongly rejected (and FMCSA self-insurance prints no expiry).
- `oos-registration`: "6 months" is prose-only + a false-recency trap (the real 6-month figure is
  vehicle-ownership for tax basis); multi-year out-of-state registrations are valid.
- `dealer-license-active`: staff scenario (D-2) left unanswered; source PDF unreadable.
- `business-entity-proof`, `existing-mobile-home-registration-and-decal`: the real requirement is a
  status check (active vs. inactive), not a date — the date engine is the wrong mechanism.

### The `appliesWhen` mechanism (mixed-bucket scoping)
`DocumentValidity` gained an optional `appliesWhen: string[]`. When present, `checkValidity` only
enforces the rule if the vision screen's `observedDocument` description matches one of the keywords
(case-insensitive substring); otherwise it fails open. This lets a single mixed slot (address
proof) apply a 60-day window to a utility bill / bank statement / official mail while never
date-screening a permanent deed / lease / mortgage / voter card. Fail-open is preserved: if the
model can't classify the subtype, the rule does not fire.

---

## Rules SHIPPED (live in `item-catalog.json`)

### `hsmv-83039` — Application for Disabled Person Parking Permit (medical certification)
```json
{ "rule": "max-age", "anchor": "signed", "days": 365,
  "source": "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/permanent-disabled-person-parking-permits/" }
```
- **Source (official):** FLHSMV permanent-disabled-person-parking-permits page, verbatim: *"The
  certifying authority must sign within 12 months prior to submitting the application."*
- **Corroboration:** the form's own instruction, in the catalog label + upload-review row
  (`https://www.flhsmv.gov/pdf/forms/83039.pdf`): *"Signature must be dated within the last 12 months."*
- **Anchor:** `signed` — the physician's certification signature date is printed on the form (the
  vision model can read it). 12 months → 365 days.
- **Verifier:** CONFIRMED — WebFetched the URL and found the exact quote; two independent official
  sources agree; no conflict with `rejected-corrections.md`.

### `va-form-letter-27-333` — VA Form Letter 27-333 (substitutes for the 83039 medical cert)
```json
{ "rule": "max-age", "anchor": "issued", "days": 365,
  "source": "https://www.flhsmv.gov/motor-vehicles-tags-titles/disabled-person-parking-permits/permanent-disabled-person-parking-permits/" }
```
- **Source (official):** same FLHSMV page, verbatim: a qualifying veteran *"may provide a Form
  Letter 27-333, or its equivalent, issued within the last 12 months in lieu of a certificate of
  disability."*
- **Corroboration:** catalog label: *"VA Form Letter 27-333 (or equivalent), issued in the last 12 months…"*
- **Anchor:** `issued` — VA letters print an issue date. 12 months → 365 days.
- **Verifier:** CONFIRMED — WebFetched; exact phrase present; official-tier.

### `address-proof-1`, `address-proof-2` — Florida residential address proof (transient subtypes)
```json
{ "rule": "max-age", "anchor": "dated", "days": 60,
  "appliesWhen": ["utility bill", "bank statement", "official mail", "government document"],
  "source": "FLHSMV ops-manual IR01 + tcslc-sme policy-questions D-5/DL-2" }
```
- **Source:** KB IR01 (official, ingested), verbatim: *"Utility bills, bank statements, and
  government documents must be dated within the last 60 days to be acceptable as address proof."*
  **+ St. Lucie staff:** D-5 (*"Snap letter can be used for proof of address as long as it's within
  60 days"*) and DL-2 (*"Must be within 60 days"*). Both official-tier AND staff-confirmed.
- **Why scoped (`appliesWhen`):** the slot also accepts a deed / mortgage / lease / voter card,
  which FLHSMV accepts even when years old. IR01's 60-day window applies ONLY to utility bills,
  bank statements, and government documents. The `appliesWhen` keywords fire the 60-day rule for
  exactly those subtypes and leave permanent proofs un-screened (verified: stale utility bill →
  reject; years-old deed/lease → accept).
- **Anchor:** `dated` — the statement/issue date printed on a bill/statement.
- **Verifier:** the plain (unscoped) rule was REJECTED in Phase 3 for over-block; this scoped
  version resolves that. Staff explicitly requested the 60-day rule (D-5/DL-2).

---

## Content advisories SHIPPED (soft warning, never blocks)

Each has `validity.contentChecks[]`. The vision model checks the attribute and, only on a clear
concern, surfaces a non-blocking notice. Grounding + attribute per item:

| itemId | Required attribute (advisory) | Source |
|---|---|---|
| `sunbiz-registration` | Sunbiz printout shows status **Active** + lists registered agent | catalog label + search.sunbiz.org |
| `business-entity-proof` | If Sunbiz variant: shows **Active** (n/a to FEID / sales-tax-number) | catalog label + search.sunbiz.org |
| `va-100-percent-disability-letter` | States **100% total AND permanent** (not temporary) | **staff DL-7** + §322.21 |
| `va-summary-of-benefits-letter` | States 100% s-c / compensated at 100% / DVA-financed (permanent) | **staff DL-7** + flhsmv/military |
| `dd214-or-veteran-id` | DD-214 shows **Honorable** character of service (or VA ID) | **staff TAX-1** + flhsmv/military |
| `dd214-or-military-orders` | DD-214 Honorable, or orders show current active-duty | catalog label + flhsmv/military |
| `licensed-dui-program-completion` | Shows **COMPLETION** (not enrollment) of an FLHSMV-approved program | catalog + flhsmv dui-and-iid |
| `military-orders` | **Active-duty** orders (not discharge/reserve) w/ name + period | catalog label + flhsmv/military |
| `death-certificate` | **Certified** copy (registrar seal/statement), not a plain photocopy | catalog + staff TITLE-1/2 |
| `death-certificate-inheritance` | **Certified** copy, not a plain photocopy | catalog (testers tax423/424) + staff TITLE-1/2 |
| `clerk-recorded-documents` | Bears the Clerk **recording stamp / instrument #** (recording complete) | catalog + stlucieclerk.gov |
| `disabled-person-hunt-fish-certification` | States **totally and permanently disabled** | catalog + myfwc |

**Deliberately NOT shipped as advisories (advisory-fatigue guard):** ~18 lower-signal "shows
VIN / name legible / has a price / letterhead present" checks (`lien-letter`, `bill-of-sale-*`,
`current-registration-or-renewal-notice`, `commercial-insurance-limits-proof`,
`lease-agreement-with-lessor-letter`, `ccw-firearms-training-document`, `hvut-2290-proof`,
`fl-insurance-proof-for-test-vehicle`, `org-feid-or-fl-sales-tax`, `existing-physical-plate-or-number`,
`iid-installation-proof`, `adi-course-completion`, `prior-owner-bill-of-sale-trailer`,
`dealer-bill-of-sale-trailer`, `dealer-license-active`, `existing-mobile-home-registration-and-decal`,
`certification-of-trust`, `school-employee-letter-or-id`). These fire on nearly every upload and
warn about things a clerk reads anyway; shipping them would train residents to ignore warnings.

---

## No rule — NEEDS SME CONFIRMATION (do not ship until a human confirms)

Each below has a *plausible* recency/expiry window but is blocked from shipping because the only
evidence is catalog prose, or the item's scope makes a blanket rule unsafe. Recorded so St. Lucie
staff can rule on them. **The hypothesis is NOT active.**

| itemId | Hypothesis (unshipped) | Why deferred |
|---|---|---|
| `existing-ccw-license` | `max-age` / `expires` / ~179 | **Confirmation pass:** statute §790.06(11) is real ("180 days or more after expiration → permanently expired"), BUT the same subsection tolls expiration for deployed servicemembers — they can validly renew a CWL printed-expired >180 days. An automated rule on the printed date over-blocks that (veteran-heavy) population. The model can't see deployment status. **Rejected — needs staff ruling on how to handle the military-tolling exception.** |
| `commercial-insurance-limits-proof` | `unexpired` / `expires` | **Confirmation pass:** FLHSMV states only a "maintain continuous coverage" duty (a maintenance obligation, not a document-recency window); commercial sub-pages 404'd. A renewed operator holding the prior-period ACORD image would be wrongly rejected, and FMCSA self-insurance proof prints no expiry. Rejected. |
| `fl-insurance-proof-for-test-vehicle` | `unexpired` / `expires` | **Confirmation pass:** road-test page says only "proof of insurance" (= "current", prose); insurance page gives no document-recency window. Same false-reject risk as commercial insurance (printed policy-period end ≠ lapsed coverage). Rejected. |
| `oos-registration` | `max-age` / `dated` / ~180 | **Confirmation pass:** 3 FLHSMV pages fetched — no recency window stated; "6 months" is prose-only AND a false-recency trap (the real 6-month figure is vehicle-ownership for tax basis). Multi-year out-of-state registrations are valid; a rule would block new residents. Rejected. |
| `dealer-license-active` | `unexpired` / `expires` | **Confirmation pass:** FLHSMV dealers page has only general prose; tcslc PDF unreadable; staff scenario D-2 (lapsed dealer license) left **unanswered**. Prose-only. |
| `business-entity-proof` | (status-check, not a date) | **Confirmation pass:** real requirement is entity **status = active** + a valid FEID/sales-tax number — a content/status check, not a date-recency window. The date engine is the wrong mechanism. Rejected. |
| `existing-mobile-home-registration-and-decal` | `unexpired`/`max-age` | **Confirmation pass:** tcslc page says only "current registration and decal number" (prose); functions largely as a decal NUMBER for transfer, not a dated credential. No official/staff window. |
| `sunbiz-registration` | (status-check, not a date) | Requirement is entity **status = active**, not printout age. A status check is a different mechanism (out of scope for `validity`). |
| `trust-certification` | `max-age` (recency of trustee authority) | Trusts can be amended, so recency is plausible, but no FLHSMV/statute/staff window exists. |
| `adi-course-completion` | `max-age` (course lapse?) | Many state courses lapse, but the cited FLHSMV page states no window and no staff number exists. |
| `dd214-or-military-orders` | (partial) | DD-214 never expires; "current" applies only to the active-duty-orders alternative. An OR-item can't take one rule. |
| `ccw-firearms-training-document` | none found | FDACS source is outside the approved grounding domains; training docs not known to expire. |
| `disabled-person-hunt-fish-certification` | none | "totally and permanently disabled" implies permanent; myFWC source not an approved domain. |
| `home-country-permit-copy` | (foreign expiry) | "current" is prose-only; a foreign permit may not print a machine-readable date. |
| `lease-agreement-with-lessor-letter` | `unexpired` / lease-term-end | Plausible (lease must still be active to authorize Registration-Only), but no source states it. |

---

## No rule — no expiry/recency dimension (correct, permanent)

These are permanent records, tax-basis/historical documents, identifier numbers, physical items,
or forms — nothing to expire. Confirmed against sources; several are **false-recency traps** worth
noting so no future pass re-adds them.

| itemId | Why no rule |
|---|---|
| `bill-of-sale-purchase-agreement` | "owned less than 6 months" is a **tax-basis** condition on the vehicle, not doc age. |
| `proof-oos-sales-tax` | Same tax-basis "less than 6 months" false-recency trap. |
| `builder-receipts` | Tax-basis (cost of materials); inherently historical. |
| `parts-receipts-trailer` | Staff (REG-1) confirm receipts aren't even mandatory; historical tax-basis. |
| `prior-owner-bill-of-sale-trailer` | Historical sale record; date = sale date, not a window. |
| `dealer-bill-of-sale-trailer` | Records a completed purchase; historical. |
| `death-certificate` | Permanent vital record; never expires. |
| `death-certificate-inheritance` | Staff (TITLE-1/2) confirm it's required; a death certificate doesn't expire. |
| `certification-of-trust` | Legal instrument; no expiry (recency deferred separately above via `trust-certification`). |
| `clerk-recorded-documents` | Permanent public records. |
| `licensed-dui-program-completion` | Completion certificate = permanent record. |
| `dd214-or-veteran-id` | DD-214 is a permanent discharge record. |
| `va-100-percent-disability-letter` | Staff (DL-7) gate on **permanence** of rating, not letter age. |
| `va-summary-of-benefits-letter` | Same — gated on permanent rating, not issue date; retained for future use. |
| `school-employee-letter-or-id` | Staff (CDL-2) state when it's required but give no recency window. |
| `military-orders` | No standardized printed expiry; no policy/staff window. |
| `military-gold-sportsman-application` | "current" refers to the **military ID shown in person**, not the uploaded form. |
| `lien-letter` | Content-based requirement (letterhead + VIN/make/year), not date-based. |
| `current-registration-or-renewal-notice` | Explicitly accepts "most-recent" reg AND a renewal notice — an `unexpired` rule would reject the intended input. |
| `expiring-placard-registration-copy` | **False-recency trap** — submitted *because* the permit is expiring; blocking expired ones defeats the purpose. |
| `hvut-2290-proof` | Staff (REG-5) "60 days" is a purchase-date **exemption alternative** ("in lieu of" a paid 2290), not a rejection window on the 2290. |
| `iid-installation-proof` | Statute periods (6mo/1yr) are how long the IID stays installed, not doc recency. |
| `existing-physical-plate-or-number` | Physical plate / typed number; no dated document. |
| `existing-placard-number` | Just a number for renewal tracking; no date. |
| `recipient-plate-or-license-info` | Identifiers (name + plate/DL number); not a dated document. |
| `org-feid-or-fl-sales-tax` | Identifier number; not dated. |

---

## Maintenance

- To activate a deferred rule after SME confirmation: add the `validity` object to the item in
  `services/chatbot/src/data/item-catalog.json`, record the confirming source here, and run
  `npm run lint:trees` (validates rule/anchor/days/source shape; enforces `unexpired ⟹ expires`).
- The `address-proof-*` 60-day rule is the highest-value pending item — it requires an item-split
  (transient vs. permanent proof subtypes) first, which is a catalog/tree change beyond a data edit.
- Engine behavior for any item without a `validity` rule is unchanged (plausibility-only screening).
