# Author Review — id-card

Vendor source: `Driver License - ID Cards.xlsx`.

- [x] Every form PDF cited is live (none directly cited — all procedure pages).
- [x] Statutory cite resolves (§322.21 for 100% T&P disabled veteran no-fee provision).
- [x] Fees: free for 100% disabled veterans per §322.21, standard per FLHSMV fees page otherwise.
- [x] BLOCKED branches: name-change-missing-docs.
- [x] No unsubstantiated vendor claims.
- [x] `tcslcVerified` covers DL/ID pages.

## Dropped vendor claims

- **SNAP benefits / MyAccess Florida letter as proof of residence** (row 8–9): the vendor claim that a "MyAccess Letter with current dates" can substitute as a residence document isn't in the FLHSMV acceptable-docs list on `/what-to-bring/u-s-citizen/`. Could be a local policy, but I couldn't substantiate on either authority page. Logged to unverified-vendor-claims.md; not in the tree.
- **Age 80+ vision-failure downgrade path**: captured structurally via `id_card_intent: downgrade-from-dl` but no age-floor gating — FLHSMV doesn't condition downgrade on age.

## Notes

- FL ID cards are issued to any resident; process is the same REAL ID doc set as a driver license minus driving tests.
- `id_card_intent` differentiates the four scenarios vendor distinguishes (original, downgrade, replacement, REAL ID upgrade).
