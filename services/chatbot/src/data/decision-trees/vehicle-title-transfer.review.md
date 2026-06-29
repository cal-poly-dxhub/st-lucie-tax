# vehicle-title-transfer — review notes

This tree serves **all** transfer types: private sale, gift, family transfer,
dealer-adjacent, and deceased-owner / inheritance. Because one tree covers every
path, path-specific behavior is **gated** — on the FL-title facts for the
redundancy fixes, and on `transfer_reason` for the inheritance fixes — so it can
never change the document list for the other paths.

Source: three beta sessions where St. Lucie tax-office employees (`tax423`,
`tax424` on `tcslc.com`) role-played deceased-owner transfers — 9e238934,
19d716d3, ae0b2879. The testers are treated as SMEs.

## Inheritance / deceased-owner path

The tree previously had **zero** inheritance handling: it asked purchase-framed
questions (sales tax, odometer bill of sale, "how long have YOU owned it") and a
POA question, and never determined who could legally take title.

- **`transfer_reason`** (`standard-sale-or-gift` | `inheritance-deceased-owner`),
  asked FIRST so the death scenario is recognized up front.
- **Two heirship questions, asked next** — these are the exact two an SME
  (`tax423`) said the bot failed to ask ("at no point was I asked if there were
  any additional owners on the title. also was not asked if there is a will"):
  - **`inheritance_additional_owners`** — is the deceased the sole owner, or is a
    surviving co-owner (e.g. spouse) already on the title? A surviving co-owner
    resolves heirship directly (vehicle passes to them), and auto-skips the will
    question via implication.
  - **`inheritance_has_will`** — is there a will or probate? Only asked when the
    deceased was the sole owner.
- **Eligibility gates (structured hard-blocks, fire before logistics):**
  - `inheritance_additional_owners = unknown` → `heirship-not-established`.
  - sole owner + `no-will-no-probate` → `heirship-needs-estate-process`.
    This implements the testers' core ask: "determine if they can even do the
    transfer first."
- **`death-certificate-inheritance`** item added for the inheritance path
  (SME-confirmed required).
- **Odometer suppression** — the seller-signed `odometer-disclosure-bill-of-sale`
  is removed for inheritance (SME `tax423`: "having a bill of sale or odometer
  would be unlikely"; the deceased can't sign).
- **`transfer_reason = inheritance-deceased-owner` ⇒ `ownership_duration =
6-months-or-more`** implication → cascades to sales-tax na, so the heir is never
  asked the purchase-framed tax questions.

### Still to finalize with the office (narrow, not a blocker)

The death certificate is confirmed. The **additional** estate documents beyond it
— will, Letters of Administration, any FLHSMV decedent affidavit — and exactly
which apply per path (surviving co-owner vs. will/probate vs. no-will estate) are
confirmed **at the counter** today. When the office provides the per-path
checklist, encode it as inheritance-gated `addItems`. Do NOT assert specific FL
form numbers (e.g. "82152") that no tester stated and the corpus doesn't contain.
The two heirship hard-block `nextSteps` already tell the customer to bring the
death certificate + title and confirm estate documents with the office.

## Missing / electronic title (sessions 19d716d3, ae0b2879)

Both sessions broke when the customer said up front they didn't have the title:
the bot looped `title_condition` / `title_is_original_paper` / POA questions
(19d716d3 re-asked ~8 times; ae0b2879 ended in "unable to complete conversation").
Root cause: no fact represented "do you have the title," so those facts stayed
unresolved and `list_unresolved_facts` kept surfacing them.

- **`title_possession`** (`paper-in-hand` | `electronic-held` | `lost-or-none`),
  asked early.
- `electronic-held` and `lost-or-none` ⇒ `{title_condition: na-no-title,
title_is_original_paper: na-no-title}` (no physical title to inspect → stop
  asking).
- `electronic-held` branch → `mydmv-portal-referral` (convert electronic title).
- `lost-or-none` branch → `hsmv-82101` (duplicate-title application needed first).

## Florida-title redundancy suppression (C3/C5/C6)

Not gated on inheritance — these help every FL-title transfer:

- `title_is_oos = no-florida` ⇒ `{title_is_original_paper: na-fl-title,
vehicle_origin: within-florida, vehicle_physically_present: na-fl-title,
ownership_duration: 6-months-or-more}`.
- `vehicle_origin = within-florida` ⇒ `sales_tax_paid_out_of_state: na-owned-6mo-plus`.

All implied values fire **zero** branches, so the resolved document list is
byte-identical — only the redundant questions are suppressed.

## Question ordering (C8)

`factsRequired` front-loads transfer_reason → heirship → eligibility
(purchaser_age) → title_possession → title condition → vehicle identity, ahead of
logistics. Ask order is purely `factsRequired` array order, so this is config-only
with no effect on the resolved document list.

## Existing hard-blocks (now first-class)

The 5 pre-existing `note: "BLOCKED:"` branches were already promoted to
`severity: hard` at load time by `synthesizeBranchBlocking` (they DID halt the
flow) but lacked curated `nextSteps`. Each was given an explicit structured
`blocking` object with customer-facing next-steps.

## Tests

`tests/unit/trees/vehicle-title-transfer-inheritance.test.ts` — 10 cases covering
the heirship gates, surviving-co-owner auto-skip, death-cert + odometer
suppression, missing/electronic title handling, FL-title redundancy, and
sale/OOS regressions.
