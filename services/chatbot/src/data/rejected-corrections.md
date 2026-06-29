# Rejected GPT Corrections

Catalog of `[CHANGE]` / `[FILL-IN]` claims from vendor-supplied
`… - GPT Responses.docx` / `… - GPT Comparisons.docx` files that we have
**refused** to integrate because they could not be substantiated against
FLHSMV, tcslc.com, or the Florida Statutes. Entries here must **not** be
re-proposed in future review rounds without new authoritative evidence.

Format:

- **Claim** — what the GPT doc asserts.
- **Source doc** — which vendor file it came from.
- **Why rejected** — what official source contradicts or fails to support it.
- **Decision date** — YYYY-MM-DD.

---

## CDL

### CDL-1. "Passing the Class E knowledge exam waives the CDL late-renewal fee"

- **Claim.** The vendor GPT doc suggests that a customer who recently passed the Class E (standard) General Knowledge exam is exempt from the CDL late-renewal fee when renewing an expired-<1yr CDL.
- **Source doc.** `Driver License - CDL - GPT Responses.docx` (section on late renewals).
- **Why rejected.** FLHSMV fee schedule (https://www.flhsmv.gov/fees/) and §322.21, F.S. specify the CDL late fee independently of any knowledge-exam status. No FLHSMV page, tcslc.com page, or statute was found that creates such a waiver. The Class E exam covers non-commercial rules and does not substitute for CDL renewal obligations.
- **Decision date.** 2026-04-20.

### CDL-2. "Paper medical examiner's certificates are always rejected at the counter"

- **Claim.** GPT doc says all paper DOT medical cards are rejected outright.
- **Source doc.** `Driver License - CDL - GPT Responses.docx`.
- **Why rejected.** Overstated. What FLHSMV actually requires is that the medical examiner's certificate be **uploaded to the state system** by the physician's office (see https://www.flhsmv.gov/driver-licenses-id-cards/commercial-driver-license/medical-certification/). The paper card itself is still a valid document — just not sufficient at our counter without the state-system record. Our canonical phrasing lives on `cdl-medical-cert-uploaded` in `item-catalog.json`; the tree asks for the system-upload state, not a blanket paper rejection.
- **Decision date.** 2026-04-20.

### CDL-3. "Hazmat written test results remain valid for 90 days"

- **Claim.** GPT doc asserts 90-day validity window on the hazmat written test.
- **Source doc.** `Driver License - CDL - GPT Responses.docx`.
- **Why rejected.** The vendor's source spreadsheet (`Driver License - CDL.xlsx`, row: "The Hazmat test is only valid for 60 Days") states 60 days, as does operational guidance from the St. Lucie office. No FLHSMV or TSA page supports 90. Used 60 days in `item-catalog.json` (`hazmat-written-test.notes`).
- **Decision date.** 2026-04-20.

---

## Vehicle Title Transfer

### TITLE-1. "DR-534 (Request for Installment Payment of Property Taxes) applies to vehicle title transfers"

- **Claim.** GPT doc mentions DR-534 as a form customers may need for title work.
- **Source doc.** `FL Titles- MVI - GPT Responses.docx`.
- **Why rejected.** DR-534 is a Department of Revenue property-tax form (see https://floridarevenue.com/property/Pages/Forms.aspx), not a motor-vehicle form. It has no connection to HSMV title transfer workflows. Excluded from `item-catalog.json`.
- **Decision date.** 2026-04-20.

### TITLE-2. "Out-of-state electronic titles can be transferred on the spot by calling the prior state's DMV"

- **Claim.** GPT doc implies clerk can phone the prior state's DMV to release an electronic title during the visit.
- **Source doc.** `FL Titles- MVI - GPT Responses.docx`.
- **Why rejected.** No FLHSMV procedure or tcslc.com page supports a same-visit release. Official workflow (confirmed by https://cartitles.com/title-holding-vs-non-title-holding-states/ and vendor spreadsheet) is the OOS Writing Packet: customer completes packet, we write to the lienholder, paper title arrives by mail, customer returns. Represented that way in the `vehicle-title-transfer` tree under `title_is_original_paper = electronic-title-holding-state`.
- **Decision date.** 2026-04-20.

### TITLE-3. "Odometer 'NOT ACTUAL' designation can be corrected by a bill of sale"

- **Claim.** GPT doc says a bill of sale showing a different reading overrides a lower odometer entry on the title.
- **Source doc.** `FL Titles- MVI - GPT Responses.docx`.
- **Why rejected.** Federal odometer disclosure law (49 CFR Part 580) and FLHSMV procedures require the lower-than-previously-recorded reading to stand as-is with the title flagged "NOT ACTUAL". Bill of sale cannot override. Represented correctly in the tree (odometer branches do not allow re-labeling).
- **Decision date.** 2026-04-20.

---

## Driver License Transfer / Immigration

### DL-1. "Church-issued marriage certificates are acceptable if the church is state-registered"

- **Claim.** GPT doc suggests church-issued marriage certificates count when the issuing religious institution is on a state registry.
- **Source doc.** `Driver License - Immigration - GPT Reviewed.xlsx` and paired GPT review notes.
- **Why rejected.** FLHSMV explicitly excludes church-issued marriage certificates for name-change purposes (https://www.flhsmv.gov/driver-licenses-id-cards/change-name/). No carve-out for "state-registered" churches exists in FLHSMV policy or in §322, F.S. Required document is a county-clerk certified marriage certificate, divorce decree, or court order.
- **Decision date.** 2026-04-20.

### DL-2. "Temporary lawful-presence applicants receive a full-term Florida CDL"

- **Claim.** GPT doc implies CDL applicants on temporary lawful presence receive the same CDL term as LPR applicants.
- **Source doc.** `Driver License - Immigration - GPT Reviewed.xlsx`.
- **Why rejected.** FLHSMV (https://www.flhsmv.gov/driver-licenses-id-cards/non-us-citizens/) limits CDL issuance to US citizens and lawful permanent residents. Temporary lawful presence does not qualify for CDL issuance at all. The `cdl.json` tree blocks this case (`is_us_citizen = temporary-lawful-presence` branch).
- **Decision date.** 2026-04-20.

---

## General / process

### GEN-1. "Address Certification Form is accepted for all DL transactions"

- **Claim.** GPT doc generalizes the Address Certification shortcut across DL, ID, and CDL.
- **Source doc.** Multiple (`Driver License - Class E - GPT Responses.docx`, `Driver License - CDL - GPT Responses.docx`).
- **Why rejected.** Vendor spreadsheet (`Driver License - CDL.xlsx`) explicitly says "CDL Customer cannot use Address Certification Form." The shortcut exists for Class E only. Represented in `cdl.json` as a note on the `address_proof_count = zero` branch.
- **Decision date.** 2026-04-20.
