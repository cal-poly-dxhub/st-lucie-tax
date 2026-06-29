# Author Review — new-vehicle-title

- [x] Form PDFs cited (HSMV 82040, 82042, 82050, 82053, 82002) — all ingested.
- [x] Statutes cited (§319.23, §319.14, §320.072, §627.733) — all in MANUAL_STATUTES.
- [x] Fees: no amounts stated; customer directed to FLHSMV fees page.
- [x] BLOCKED: no-insurance, minor-no-co-purchaser.
- [x] No unsubstantiated vendor claims.
- [x] `tcslcVerified` cites /199 + /194.

## Notes

- This tree handles the "new" case — distinct from `vehicle-title-transfer` (used-vehicle transfer). Dealer-processed titles usually don't require the customer to visit, but the tree handles the edge cases where they do.
- `has_lien_or_lease` branch adds the appropriate document but doesn't block — Florida allows titling a vehicle with a lien (the title is issued to the lienholder).
