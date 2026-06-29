# Author Review — learner-permit

Vendor source: `Driver License - Learners License.xlsx`.

- [x] Every form PDF cited is live (HSMV 71142, 71144 — both ingested under `flhsmv-forms/`).
- [x] Statutory cite resolves (§322.21 fees).
- [x] Fees: standard $30 Class E application fee per FLHSMV fees page.
- [x] BLOCKED branches: TLSAE-not-completed, parent-guardian-absent for under-18 applicants — both FLHSMV-documented on the Class-E-exam page.
- [x] No unsubstantiated vendor claims.
- [x] `tcslcVerified` covers teen corner.

## Notes

- Parent proctoring form (71144) only required for online exam under 18. In-office exam for under-18 does NOT require the proctoring form (FLHSMV distinguishes these).
- `tlsae_completed` can resolve automatically via the previously-licensed path — if the customer has any prior DL record, TLSAE is waived.
- Skills exam is NOT part of this tree — that belongs to the Class E driver license issuance flow (separate transaction), not the learner permit issuance. Vendor rows about "driving skills exam" are out of scope here.

## Deferred for vendor input

- Vendor row 11 ("3-day wait after online TLSAE") — searched FLHSMV page, can't verify. Logging as unverified claim; not in tree.
