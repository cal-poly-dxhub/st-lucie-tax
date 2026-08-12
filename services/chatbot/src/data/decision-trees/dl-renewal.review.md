# Author Review — dl-renewal

Author: Claude (from official FLHSMV sources — 2026-04-23)
Vendor source: `Driver License - Class E .xlsx` (rows 4–23, 31–34 covering renewal paths)

## Checklist

- [x] **Every form number cited is a live FLHSMV PDF.** Only `HSMV 72010` (Report of Eye Exam) is cited via a form PDF; verified present at `s3://st-lucie-kb-data-<ACCOUNT_ID>/flhsmv-forms/72010.pdf`.
- [x] **Every statutory cite resolves in `flhsmv-statutes/`.** Cites §322.18 (renewals) and §322.21 (fees) — both in `scripts/scrape-kb-flhsmv.ts:MANUAL_STATUTES` and present in S3.
- [x] **Every fee amount matches `flhsmv.gov/fees/`.** The only fee amount stated in branch notes is the $2 MyDMV online processing fee, verbatim from the FLHSMV renew-or-replace page.
- [x] **Every BLOCKED branch has a statute OR a named FLHSMV rule behind it.** One BLOCKED branch (`recent_name_change: yes-missing-docs`) — backed directly by the FLHSMV renew-or-replace page language requiring certified name-change documentation AND SSA update before credential change.
- [x] **No branch references a vendor "REASON" that isn't independently substantiated.** Column H entries skipped per sprint scope.
- [x] **`sources.tcslcVerified` includes at least one tcslc page.** Cites `/163/Driver-Licenses-Identification-Cards` and `/315/Driver-License-IDs` — both ingested.

## Dropped vendor claims

None.

## Notes

- Vendor row 6–11 (OOS license reciprocation) applies to new-to-FL transfers, not renewals of existing FL credentials. Intentionally omitted from `dl-renewal`; that logic lives in `dl-transfer`.
- Vendor row 22–23 ("had FL license before, moved OOS, can I get it back") is also a transfer/re-issuance scenario, not a renewal. Not included here.
- `dl_renewal_channel` (online vs in-office) was added as a transaction-specific fact to route the customer off the in-office path early when MyDMV is viable. Online path shells out to an external-authority link (mydmvportal.flhsmv.gov) — lint allowlist updated.
- REAL ID handling shared with dl-replacement, dl-name-change, dl-address-change, real-id-upgrade, id-card. The `real_id_status` fact is global.
