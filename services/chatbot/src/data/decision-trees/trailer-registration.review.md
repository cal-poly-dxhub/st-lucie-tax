# Author Review — trailer-registration

**Last reviewed:** 2026-05-29
**Sources:** HSMV TL-10 (Rev. 12/25), tcslc.com/302/Trailers, FLHSMV fee schedule, F.S. §319.14

- [x] Form PDFs cited (HSMV 82040, 82042, 84490) — all in `flhsmv-forms/`.
- [x] Statute cited (§319.14) — in MANUAL_STATUTES.
- [x] Fees: no amounts stated in tree notes; customer directed to FLHSMV fees page.
- [x] BLOCKED: homemade-with-no-receipts (sales tax basis cannot be calculated).
- [x] No unsubstantiated vendor claims.
- [x] `tcslcVerified` cites /302.

## Why a separate transaction

Trailers under 2,000 lb are statutorily prohibited from titling in Florida (F.S. §319.14, HSMV TL-10). Their doc set diverges fundamentally from titled-vehicle scenarios — no 82040, no 82042, no MCO. Bolting trailer logic onto `vehicle-registration` would require ~6 conditional branches that strip car-bound items, each a regression risk. Trailer branches were therefore removed from `vehicle-registration` and `new-vehicle-title` (Task 4) and routing rerouted in `suggest-transactions` (Task 6).

## The 2,000-lb cutoff

Determined by a public-scale weight slip the customer brings to the visit. The bot asks the customer for their best estimate; if "unknown," it treats as <2,000 lb for the doc list AND notes that the slip will determine final classification at the counter. `certified-weight-slip` is therefore an unconditional baseItem — flagged by the audit but intentional (no policy carve-out exists; every trailer registration needs the slip).

## What's intentionally out of scope

- Trailer roadworthiness inspection (lighting, brake controllers, hitch ratings) — governed by F.S. §316 traffic-equipment rules, not at the title counter.
- Specialty trailer plates (antique trailer, etc.) — handled by the standard plate-choice flow in registration; this tree uses the standard plate by default.
- Boat trailers paired with vessel registration — the trailer carries the boat to FWC under a separate vessel path; this tree owns the trailer leg only.
- Re-titling a "rebuilt" or "salvaged" manufactured trailer — separate path; not duplicated from `vehicle_construction_type`.

## Known gaps to revisit

- Inherited ≥2,000-lb trailer with probate-only documentation: tree currently adds `prior-fl-title-signed-by-seller`, but probate cases may lack a signed title. Office workflow accepts probate paperwork; tree note covers this.
- Out-of-state homemade trailer: covered by combining `out-of-state-transfer` + `homemade` branches, but parts receipts may not exist for older builds — clerk falls back to market-value estimate.
- Audit re-baseline (2026-05-29) flagged 3 generic missing-fact suggestions (`trailer_title_status`, `trailer_applicant_role`, `registration_channel`). All three are non-actionable for this tree: title status is a deterministic function of `trailer_weight_class` (≥2,000 lb is always titled, <2,000 lb never), applicant role is captured in the cross-tree person-vs-business handling, and trailer registration is in-office only at SLCTC.

## Citations

- TL-10: https://www.flhsmv.gov/pdf/proc/tl/tl-10.pdf
- tcslc.com/302/Trailers: https://www.tcslc.com/302/Trailers
- F.S. §319.14: https://www.flsenate.gov/Laws/Statutes/2024/319.14
- Fee schedule: https://www.flhsmv.gov/fees/
