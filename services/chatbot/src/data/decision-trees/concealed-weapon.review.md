# Author Review — concealed-weapon

- [x] Every statute cited (§790.06, §790.0655) ingested via scrape-kb-fdacs-fwc.ts.
- [x] FDACS external allowlist covers fdacs.gov (authoritative licensing source).
- [x] Every BLOCKED branch grounded in official FDACS eligibility list or §790.06.
- [x] No unsubstantiated vendor claims (no vendor xlsx for CCW).
- [x] `tcslcVerified` cites `/331/Concealed-Weapon-Permits` (local policy).

## Notes

- FDACS pages for Apply-Online / Apply-in-Person / Apply-Through-a-Tax-Collector / Apply-by-Mail are empty menu nodes — the actual content lives on the parent `Applying-for-a-Concealed-Weapon-License` page. Scraper now skips empty bodies.
- Fee PDF (Concealed-Weapons-License-Fees.pdf) was ingested but specific amounts weren't inlined in the tree — they change yearly and belong in the fee-schedule PDF the bot can cite via KB retrieval.
- Disqualifying-history branch is **advisory only** — we cannot determine final eligibility ourselves; branch routes the customer to the official Application Instructions and FDACS contact.

## Authority source

- FDACS is the state licensing authority for concealed weapons in Florida. Tax collectors are an optional convenience channel authorized by FDACS.
