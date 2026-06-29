# Unverified Vendor Claims — Dropped from Decision Trees

This log captures vendor-spreadsheet claims (from the 11 `.xlsx` files in
`/home/mason/DxHub/st-lucie-newfiles/`) that were **dropped from the published
decision trees** because no official government source — FLHSMV page, FLHSMV
form PDF, Florida Statute, or tcslc.com policy page — substantiated them.

This is the safety log for "Better an incomplete tree than a wrong one." When
the vendor delivers additional review data or we find authoritative confirmation
later, the claim can be re-evaluated and added to the relevant tree.

## Format

Every entry should include:

| Field           | Description                                         |
| --------------- | --------------------------------------------------- |
| `tree`          | The `txnTypeId` this claim would have affected      |
| `vendor-source` | xlsx filename and row number                        |
| `claim`         | The claim (verbatim or paraphrased) the vendor made |
| `why-dropped`   | Why we couldn't substantiate it                     |
| `date`          | ISO date we made the decision                       |

## Entries

### learner-permit

| Field         | Value                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tree          | `learner-permit`                                                                                                                                                                                                         |
| vendor-source | `Driver License - Learners License.xlsx`, row 7                                                                                                                                                                          |
| claim         | "The person did not wait the appropriate time (3 days) prior to coming to office" after completing an online TLSAE course                                                                                                |
| why-dropped   | Searched FLHSMV `class-e-knowledge-exam-driving-skills-test/` page and TLSAE provider docs — no 3-day waiting-period rule found. May be a local operational quirk (provider-to-FLHSMV reporting delay). Not in the tree. |
| date          | 2026-04-23                                                                                                                                                                                                               |

### id-card

| Field         | Value                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tree          | `id-card`                                                                                                                                                                                                                                       |
| vendor-source | `Driver License - ID Cards.xlsx`, rows 8–9                                                                                                                                                                                                      |
| claim         | "MyAccess Florida letter with current dates can be used as proof of residence" (for SNAP-benefit customers applying for or replacing an ID card)                                                                                                |
| why-dropped   | Not listed on FLHSMV `/driver-licenses-id-cards/what-to-bring/u-s-citizen/` residential-address document list. Also not on tcslc.com /163 page. May be a local operational accommodation for SNAP customers, but no authoritative confirmation. |
| date          | 2026-04-23                                                                                                                                                                                                                                      |
