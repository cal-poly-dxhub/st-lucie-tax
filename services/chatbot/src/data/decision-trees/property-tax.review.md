# Author Review — property-tax

- [x] No form PDFs directly cited from FLHSMV (property tax is tax-collector, not DMV).
- [x] Statutes cited (§197.222 installment/partial payment; §197.252 homestead deferral) — both in MANUAL_STATUTES.
- [x] Fees: standard Florida property-tax discounts (4% Nov, 3% Dec, 2% Jan, 1% Feb) per tcslc /203 page.
- [x] BLOCKED: none (tree routes customer rather than blocking — delinquent path only restricts payment methods).
- [x] No unsubstantiated vendor claims.
- [x] `tcslcVerified` cites /165, /202, /203, /213.
- [x] External-authority: paslc.gov (Property Appraiser) — in allowlist.

## Notes

- Partial-payment and installment-plan both have specific April/March deadlines per §197.222. Tree doesn't enforce calendar checks; that belongs in front-end or fact-implication logic.
- §197.333 is referenced in vendor row 4 for "no personal checks on past-due" — tree note cites §197.252 instead which also covers delinquency interest; both are authoritative, and §197.252 is in our ingested statute set.
- Address-change is a two-form dance (Appraiser first, then Collector). Explicit in the branch note.
