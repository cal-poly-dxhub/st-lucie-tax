# Author Review — business-tax-receipt

Vendor source: None (not in the 11 xlsx files). Authored from tcslc /227 Local Business Tax page.

- [x] Every form PDF cited is live and ingested (BTR-257 exemption form — tcslc DocumentCenter).
- [x] Statutes cited (§205.192 nonprofit, §205.191 religious, §205.064 agricultural) are referenced in branch NOTES only, not in `sources.statutes` — these aren't in our ingested flhsmv-statutes set, and this tree's legal authority is the county ordinance (07-016), not state statutes. We don't scrape local ordinances.
- [x] Fee handling: tree refers customers to the online calculator at stlucie.county-taxes.com/btexpress — fees vary by business classification.
- [x] BLOCKED branches:
  - Unincorporated + no zoning (county zoning required before BTR).
  - Regulated profession + no state license (state license is a prerequisite).
- [x] No unsubstantiated vendor claims (no vendor xlsx).
- [x] `tcslcVerified` cites /227 + DocumentCenter/View/257. (Initial draft also cited View/535 "Cancel BTR PDF" and View/563 "BTR FAQ" — both now 404; tcslc has migrated BTR closure to an online JotForm linked from /227. Removed from sources; branch note points customer at /227 where the current JotForm is referenced.)
- [x] External-authority URLs (SunBiz, FDACS, paslc) covered by existing linter allowlist.

## Dropped vendor claims

None.

## Notes

- City-within-county businesses need BOTH city and county BTR — enforced via 3 jurisdiction branches (port-st-lucie, fort-pierce, st-lucie-village).
- Pest-control and lawn/landscape businesses both require FDACS certification; single `fdacs-pest-control-certification` item covers both.
- Nonprofit / religious / agricultural exemptions all route through the same BTR-257 exemption form; only nonprofit requires 501(c)(3) proof.
