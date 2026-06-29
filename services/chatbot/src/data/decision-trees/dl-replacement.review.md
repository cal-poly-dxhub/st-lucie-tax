# Author Review — dl-replacement

Vendor source: `Driver License - Class E .xlsx` (replacement flow embedded in the renewal/reissuance row set).

- [x] Every form number cited is a live FLHSMV PDF (no form PDFs cited — replacement flow is informational).
- [x] Every statutory cite resolves (§322.17 duplicate/replacement, §322.21 fees — both in MANUAL_STATUTES).
- [x] Every fee reference matches `flhsmv.gov/fees/` (only `$2 online processing fee` quoted, verbatim from renew-or-replace page).
- [x] Every BLOCKED branch has a statute or named FLHSMV rule behind it (name-change-missing-docs blocked by FLHSMV certified-documents-plus-SSA rule).
- [x] No unsubstantiated vendor claims merged.
- [x] `sources.tcslcVerified` includes `/163/Driver-Licenses-Identification-Cards` and `/315/Driver-License-IDs`.

## Dropped vendor claims

None.

## Notes

- Shares most facts with dl-renewal — intentional reuse; the differences are (a) the first-credential fact `dl_replacement_reason` was considered but not needed, since FLHSMV's rules are the same regardless of whether the credential was lost, stolen, or damaged and (b) the credential-already-held path is implicit (the customer is physically not bringing the credential, so it's dropped from baseItems on the online path).
