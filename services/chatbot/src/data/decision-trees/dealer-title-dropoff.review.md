# Author Review — dealer-title-dropoff

Vendor source: None. Authored from tcslc /216 Dealers Corner + 7 FLHSMV dealer-related forms (all already ingested).

- [x] Every form PDF cited is ingested: HSMV 82091, 82012, 82993, 83090, 83091, 86060 (all flhsmv-forms/ prefix). Note: initially cited HSMV 86030 (Out-of-Business Affidavit) but FLHSMV has deprecated that form — replaced with 86060 (Statement of Intent to Relinquish a Dealer License) which is the current equivalent per the official forms index.
- [x] Statutes cited (§319.23 title application, §319.14 odometer disclosure, §320.27 dealer licensing) are all in MANUAL_STATUTES.
- [x] Fee handling: dealer transaction fees vary; not itemized in tree.
- [x] BLOCKED: expired dealer license (must renew with FLHSMV before drop-off).
- [x] No unsubstantiated vendor claims.
- [x] `tcslcVerified` cites /216 + DocumentCenter/View/1492 (New Dealer Packet) and /168 (Dealer Training School).

## Dropped vendor claims

None.

## Notes

- Dealer drop-off is a distinct workflow from customer-initiated title transactions — different trust model, different forms.
- Reassignment supplement (HSMV 82091) is used when a title's on-face reassignment lines are exhausted. Tree surfaces this; details come from the tcslc "Correct Use of Reassignments for Conforming Titles" PDF.
- Statement of Intent to Relinquish a Dealer License (HSMV 86060) closes the dealer license and triggers temp-plate inventory recovery.
- Towing/storage certification of destruction (HSMV 82012) is a separate dealer workflow — storage-operators applying for certificates of destruction on unclaimed towed vehicles.
- Odometer-disclosure rule (§319.14) applies to 2011-model-year-and-newer vehicles; tree's `dealer_has_odometer_disclosure` branch adds HSMV 82993 when disclosure isn't already on the title.
