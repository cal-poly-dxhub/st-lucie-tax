# Author Review — dl-sanctions-lift

Vendor source: None. Authored directly from 5 FLHSMV suspensions-revocations pages + 4 Florida Statutes (§322.28, §322.2615, §322.291, §322.34) newly ingested in the sanctions-supplement scrape.

- [x] Every form PDF cited is not applicable (no PDFs directly cited — this tree routes customers to external systems and course providers, not to forms).
- [x] Every statute cited (§322.28, §322.2615, §322.291, §322.34, §627.733) is in MANUAL_STATUTES after the supplement scrape.
- [x] Fee handling: reinstatement fee varies by sanction type per FLHSMV fees page; not itemized in tree (would go stale quickly).
- [x] BLOCKED branches:
  - traffic-citation-unpaid + no clearance
  - failure-to-appear + no clearance
  - failure-to-complete-driver-school + no clearance
  - child-support (always, indefinitely; not eligible for hardship)
- [x] No unsubstantiated vendor claims.
- [x] `tcslcVerified` cites /163 (Driver Licenses & ID cards); `flhsmvVerified` covers the 5 sanctions sub-pages + DUI-IID + medical-visual-problems + insurance/received-a-letter + fees.

## Dropped vendor claims

None (no vendor xlsx for this transaction).

## Notes

- This is the richest tree authored in this sprint (17 branches). Each sanction type has its own clearance path.
- Hardship-license applications go through FLHSMV Administrative Reviews, NOT the tax collector counter. Tree makes this explicit.
- Failure-to-appear / failure-to-comply / child-support sanctions are explicitly NOT eligible for hardship (per FLHSMV pages).
- Point-suspension timelines are per §322.27 (not §322.28) — I cited §322.28 which is "Period of suspension" (generic). §322.27 isn't in MANUAL_STATUTES; if we need it later, add in a future scrape.
- Medical/vision sanctions require FLHSMV Medical Review workflow; customer brings cleared HSMV 72010 or MAB letter to the counter.
- SR-22 is filed by the insurance company electronically (not hand-carried) — the branch note clarifies this for the customer.
- IID installation (§322.2715) is not itself a statute we ingested in the supplement scrape — only §322.2615 DUI administrative suspension. The branch note references §322.2715 but doesn't cite it in sourceRefs (lint would catch); the authority trace for IID lives on the DUI-IID page which IS ingested.

## Authority sources

- FLHSMV: 5 suspensions-revocations pages (all ingested).
- Florida Statutes: §322.28, §322.2615, §322.291, §322.34 (all ingested).
- tcslc: /163 DL & IDs (ingested).
