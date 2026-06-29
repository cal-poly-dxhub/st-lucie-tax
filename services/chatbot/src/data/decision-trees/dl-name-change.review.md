# Author Review — dl-name-change

- [x] Every form number cited is a live FLHSMV PDF (none — no PDFs cited).
- [x] Every statutory cite resolves (§322.19 change of name/address — in MANUAL_STATUTES).
- [x] Fee handling: combined with renewal or replacement fee per FLHSMV. No standalone name-change fee.
- [x] BLOCKED branches backed by FLHSMV rule: SSA-not-updated (name-match verification), missing-certified-docs (acceptable-documents list).
- [x] No unsubstantiated vendor claims merged.
- [x] `sources.tcslcVerified` includes DL/ID pages.

## Notes

- Name change is typically combined with a renewal or replacement; this tree models the isolated-intent case.
- `ssa_record_updated` is a transaction-specific fact — SSA name-match check is only relevant when the customer is changing name. The cascade of implications in future versions could fire `ssa_record_updated = n/a` when the customer asserts no recent name change.
- Default name-change document is marriage-cert in baseItems; branches swap for divorce-decree or court-order as needed.
