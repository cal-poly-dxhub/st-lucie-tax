# Author Review — mobile-home-retire

- [x] No HSMV form PDFs (title retirement uses a tcslc-issued application, DocumentCenter/View/147).
- [x] Statute cited (§319.23 title application — retirement is a sub-case).
- [x] Fees: $0 at Tax Collector (per tcslc /193); Clerk of Circuit Court has separate fees.
- [x] BLOCKED: no-land-ownership, clerk-recording-incomplete, already-retired.
- [x] No unsubstantiated vendor claims.
- [x] `tcslcVerified` cites /193 + /192.
- [x] External authority: stlucieclerk.gov (allowlist).

## Notes

- §319.261 (mobile home title retirement) NOT in MANUAL_STATUTES — intentionally cited §319.23 (title application, which covers retirement procedurally) rather than citing an unscraped statute. A future scraper pass should add §319.261 and this tree's sources should be updated.
- Two-step process is central: Clerk first, then Tax Collector. The `clerk_recording_completed` fact gates this and is enforced as a BLOCK.
