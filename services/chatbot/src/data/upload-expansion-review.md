# Upload-expansion review — candidates to confirm with the county

**Goal:** let customers pre-submit documents so the clerk already has them at the
appointment. Today only **2 of 167** catalog items are `optional_upload`
(`military-orders`, `current-registration-or-renewal-notice`), because the April
2026 audit only flagged items where FLHSMV/tcslc policy _explicitly_ says a copy
is accepted.

This doc lists `bring_in` items that are **plausibly copy-acceptable** so the
county can rule on each. Nothing here changes until the county confirms.

**Decision rule (unchanged):** an item becomes `optional_upload` only if a copy
submitted in advance is genuinely useful to the clerk AND policy does not require
the physical original be surrendered/inspected at the counter. Identity documents
are excluded on principle — they must be presented in person (and the DL is
already handled by AuthID).

How to use this: for each Tier 1 / Tier 2 item, ask the county **"can a customer
pre-submit a copy of this so we have it before they arrive?"** Tier 3 is listed
only to show what we deliberately excluded and why (so the county can override if
we're wrong).

---

## ⚡ Fix first (no county input needed — internal inconsistency)

- **`fl-insurance-proof`** — "Proof of current FL PDL & PIP insurance (insurance
  ID card w/ company + policy number)." The code's own audit note in
  `tools/upload-docs/classify.ts` says insurance is uploadable ("no 'original'
  language, electronically verifiable"), but the catalog tags it `bring_in`, so
  it never surfaces. Either the comment or the bucket is wrong. **Recommend
  flipping to `optional_upload`** — this single item appears in many
  registration/title flows, so it would surface uploads far more often than the
  current 2 items. Confirm with county, but this is low-risk.

---

## Tier 1 — strong candidates (informational proof the clerk reads; copy clearly serviceable)

These are documents the office reviews for information; they are not originals
the office retains, and policy language doesn't demand the physical.

| itemId                               | What it is                                                                            | Source                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `proof-oos-sales-tax`                | Proof of sales tax paid in previous state (bill of sale, dealer invoice, tax receipt) | flhsmv.gov/motor-vehicles-tags-titles/titles/             |
| `bill-of-sale-purchase-agreement`    | Bill of sale / purchase agreement (proves OOS tax and/or odometer)                    | flhsmv.gov/motor-vehicles-tags-titles/titles/             |
| `dealer-bill-of-sale-trailer`        | Dealer bill of sale (trailer description, price, tax collected)                       | flhsmv.gov/motor-vehicles-tags-titles/titles/             |
| `parts-receipts-trailer`             | Receipts for homemade-trailer parts (used to calc 6% tax basis)                       | tcslc.com/302/Trailers                                    |
| `oos-registration`                   | Current out-of-state registration (dated within 6 months)                             | flhsmv.gov/motor-vehicles-tags-titles/titles/             |
| `commercial-insurance-limits-proof`  | Commercial-vehicle insurance (ACORD / Certificate of Liability)                       | flhsmv.gov/insurance/                                     |
| `police-report-or-case-number`       | Police report / business card w/ case number (stolen plate/tag)                       | flhsmv.gov/.../license-plates-registration/               |
| `dd214-or-veteran-id`                | DD-214 or VA veteran ID (to add the 'V' designation)                                  | flhsmv.gov/military/                                      |
| `va-summary-of-benefits-letter`      | VA Summary of Benefits letter (disability / DVA vehicle purchase)                     | flhsmv.gov/military/                                      |
| `va-form-letter-27-333`              | VA Form Letter 27-333 (P&T disability, substitutes for medical cert)                  | flhsmv.gov/.../permanent-disabled-person-parking-permits/ |
| `expiring-placard-registration-copy` | "Copy of the registration for your expiring parking permit" (policy says copy)        | flhsmv.gov/pdf/forms/83039.pdf                            |
| `home-country-permit-copy`           | "Copy of your current parking permit from your country" (policy says copy)            | flhsmv.gov/.../florida-visitors/                          |
| `clerk-recorded-documents`           | "Copy of documents recorded with the Clerk" (policy says copy)                        | stlucieclerk.gov/.../recording-department                 |

---

## Tier 2 — likely candidates (supporting paperwork for BTR / trust / DUI-reinstatement; copy usually fine, but county may have a "bring original" rule for some)

### Business Tax Receipt (BTR) supporting docs

| itemId                                                                          | What it is                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------- |
| `nonprofit-501c3-proof`                                                         | Federal 501(c)(3) determination letter            |
| `business-entity-proof`                                                         | FEID / FL sales-tax # / Sunbiz printout           |
| `state-professional-license`                                                    | DBPR/FDACS/DOH professional license               |
| `fdor-sales-tax-registration`                                                   | FL Dept. of Revenue sales-tax registration        |
| `fdacs-pest-control-certification`                                              | FDACS pest-control / lawn certification           |
| `city-btr-fort-pierce` / `city-btr-port-st-lucie` / `city-btr-st-lucie-village` | City BTR / Certificate of Use                     |
| `slc-zoning-approval`                                                           | St. Lucie County zoning approval                  |
| `dealer-license-active`                                                         | Active FL motor-vehicle dealer license (drop-off) |

### Trusts / entities (title)

| itemId                     | What it is                                    |
| -------------------------- | --------------------------------------------- |
| `certification-of-trust`   | Certification of Trust / full Trust Agreement |
| `trust-certification`      | Trust certification showing trustee authority |
| `org-feid-or-fl-sales-tax` | Org FEID or FL sales-tax # (placard orgs)     |

### DUI / reinstatement / medical

| itemId                            | What it is                                             |
| --------------------------------- | ------------------------------------------------------ |
| `adi-course-completion`           | Advanced Driver Improvement course certificate         |
| `licensed-dui-program-completion` | Licensed DUI Program completion certificate            |
| `iid-installation-proof`          | Ignition Interlock Device installation proof           |
| `medical-vision-clearance`        | HSMV 72010 eye exam / Medical Advisory Board clearance |

> **Note — items that LOOK like Tier 2 but are NOT uploadable by the customer:**
> `sr22-filing-from-insurer` (filed electronically by the insurer, never
> hand-carried) and `cdl-medical-cert-uploaded` (uploaded to the _state_ system
> by the physician, per `rejected-corrections.md` CDL-1). Leave both as-is.

---

## Tier 3 — deliberately EXCLUDED (listed so the county can override if we're wrong)

- **Identity & lawful-presence documents** — `photo-id-all-applicants`,
  `parent-id-valid`, `fl-driver-license`, `florida-dl-or-id`, `oos-license`,
  `visitor-acceptable-photo-id`, `primary-id-*`, `lawful-presence-*`. Must be
  presented in person; the DL specifically is handled by AuthID.
- **Address proofs** — `address-proof-1`, `address-proof-2`. FLHSMV REAL ID rules
  generally require these in person; flag to county only if they disagree.
- **Originals / certified docs** (already `bring_in`, not in the candidate list) —
  signed title, certified birth/marriage/divorce/death certificates, original SS
  card, MCO. Copy is not acceptable; original is surrendered or inspected.
- **Payments** — `guaranteed-funds-only`, fees, `all-tangible-taxes-paid`.
  Collected at the counter.
- **Physical / inspection items** — the vehicle itself, VIN verification, the
  physical plate being surrendered, road-test vehicle, `vessel-hull-id-documented`.

---

## What happens after the county rules

For each approved item: change its `bucket` from `bring_in` to `optional_upload`
in `item-catalog.json`, record the county's ruling + date in this file (mirror the
`verified:` convention), and run `npm run lint:trees`. No engine, backend, or
frontend changes are needed — the upload pipeline (presigned S3, `FileUpload`
component, the upload-docs tools, the auto-skip gate) is already built and only
keys off the bucket value. Each newly-flagged item will automatically start
surfacing the upload step in every flow whose tree includes it.
