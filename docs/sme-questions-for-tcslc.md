# Policy Questions for the St. Lucie County Tax Collector's Office

**Prepared:** June 17, 2026
**From:** Chatbot project team
**For:** SLCTC office staff / subject-matter experts

## What this is

As we built the chatbot's decision logic, a handful of situations came up where
we had to either **guess**, quote a rule we **couldn't verify** against your
materials, or **hard-stop** a customer who might actually be serviceable. This
document lists those open questions so a clerk can settle them.

Getting your answers prevents the two failures that cost your counter the most
time:

1. **Sending people home** for paperwork they didn't actually need, and
2. **Falsely reassuring** customers so they show up unprepared (or skip a visit
   they needed to make).

Questions are grouped by area, **highest-impact first**. Most can be answered in
two or three sentences — there's a blank **Answer** line under each. A short list
of lower-priority items we intentionally deferred is at the end, so nothing was
silently dropped.

**12 high-impact** questions are marked ⭐. If time is short, those are the ones.

---

## Quick index

| ID | ⭐ | Area | One-line |
|----|----|------|----------|
| TITLE-1 | ⭐ | Vehicle Titles | Estate documents for a deceased **sole** owner (will vs. no-will) |
| TITLE-2 |   | Vehicle Titles | Surviving co-owner ("or" title) — extra form to drop the deceased name? |
| TITLE-3 |   | Vehicle Titles | Altered / unsigned title — always a hard stop, or is there a fix? |
| TITLE-4 |   | Vehicle Titles | Mobile-home title retirement — required order of steps |
| TITLE-5 |   | Vehicle Titles | FL dealer purchase — does the buyer ever still need to visit? |
| TITLE-6 |   | Vehicle Titles | Power of Attorney — what type/language/signatures make one acceptable? |
| REG-1 | ⭐ | Registration | Homemade trailer with **no parts receipts** — turn away or estimate? |
| REG-2 |   | Registration | Trailer title-vs-registration line — exactly 2,000 lb net? |
| REG-3 |   | Registration | Family-transfer initial-registration-fee exemption — who qualifies? |
| REG-4 |   | Registration | Never-arrived credential — free-replacement window (20 days?) |
| REG-5 |   | Registration | Heavy-vehicle use tax — 55,000 lb threshold + 60-day grace? |
| REG-6 |   | Registration | Specialty plates — which require proof, and what counts? |
| DL-1 | ⭐ | Driver License | SS card substitute (W-2 / pay stub) for REAL ID? |
| DL-2 | ⭐ | Driver License | Address-proof fallback — household member's docs vs. Declaration of Domicile |
| DL-3 | ⭐ | Driver License | Online-renewal eligibility — how to tell it's their online cycle |
| DL-4 | ⭐ | Driver License | New resident, license expired >1yr or unverifiable — re-test required? |
| DL-5 |   | Driver License | Name change — waiting period after the SSA update? |
| DL-6 |   | Driver License | Failed vision test → downgrade to ID card — fee/surrender handling |
| DL-7 |   | Driver License | 100% disabled-veteran no-fee credential — exact proof + scope |
| DL-8 | ⭐ | Driver License | REAL-ID compliant — must they re-present identity docs for replace/renew? |
| DL-9 |   | Driver License | Asylum/immigration applicants — accepted lawful-presence docs + which path? |
| CDL-1 | ⭐ | CDL/Sanctions | Walton Road — still no Hazmat testing machine? |
| CDL-2 |   | CDL/Sanctions | School-employee letter — all CDL applicants or only school-bus? |
| SANCTION-1 | ⭐ | CDL/Sanctions | Hardship-license waiting periods (HTO / drug / DUI) — still accurate? |
| SANCTION-2 | ⭐ | CDL/Sanctions | Child-support / FTA / FTC suspensions — truly never hardship-eligible? |
| TAX-1 | ⭐ | Taxes & Permits | Business Tax Receipt veteran benefit — waived, reduced, or none? |
| TAX-2 |   | Taxes & Permits | Tourist Development Tax — any military exemption? |
| TAX-3 |   | Taxes & Permits | Property-tax partial payments — $100 min / 3 payments / Mar 31? |
| TAX-4 |   | Taxes & Permits | Disabled-placard office hours + physician fax acceptance |
| TAX-5 | ⭐ | Taxes & Permits | Does a property-tax PAYMENT require a photo ID? (bot hard-blocks it) |
| TAX-6 |   | Taxes & Permits | Does a hunting/fishing (FWC) license require a photo ID? |

---

## Vehicle Titles, Dealers & Mobile Homes

### TITLE-1 ⭐ — Estate documents for a deceased sole owner
**Scenario:** A customer wants to put a deceased relative's vehicle into their own
name. The deceased was the **sole** owner on the title (no surviving co-owner).

**Question:** For a deceased sole owner, what exact estate documents do you require
at the counter in each case:
- **(a) there IS a will, or probate is open/done**, and
- **(b) there is NO will and NO probate**?

Specifically: is a certified death certificate **plus an FLHSMV decedent affidavit**
enough for a simple low-value, no-probate case — and when do you instead require
**Letters of Administration / Letters Testamentary**?

**Why it matters:** This is the question that started this effort. Today the bot
collects only the death certificate, then tells the customer to "confirm the exact
estate documents at the counter," and it **hard-stops** the no-will/no-probate
customer entirely. If Florida allows a simpler no-probate affidavit path for
low-value estates, the bot is wrongly turning away a common, emotionally sensitive
customer. The same answer also covers an inherited **trailer** that must be titled.

**Answer:** _______________________________________________

---

### TITLE-2 — Surviving co-owner removing the deceased name
**Scenario:** A surviving spouse comes in; both they and the late spouse were on the
title, names joined by "or." They want the vehicle in the survivor's name only.

**Question:** When a surviving co-owner is already on the title (joined by "or") and
the other owner has died, do you need **only** the certified death certificate and
the title — or is an additional form/affidavit required to remove the deceased
owner's name?

**Why it matters:** The bot treats this as the simple path and adds only the death
certificate. If an extra form is required, the survivor shows up under-prepared.

**Answer:** _______________________________________________

---

### TITLE-3 — Altered or unsigned title: always a hard stop?
**Scenario:** A customer brings a title with whiteout / a crossed-out line /
scratch-out, **or** a title the seller never signed.

**Question:** Is an altered title always a hard stop requiring a brand-new corrected
or duplicate title, with no workaround? And for an unsigned title — will you ever let
the seller come back or mail a signed correction, or must the buyer be turned away
until it's fixed?

**Why it matters:** The bot treats both as absolute hard blocks ("no document can
substitute"). If the counter has a routine fix, the bot is overstating the problem
and may discourage people from coming in at all.

**Answer:** _______________________________________________

---

### TITLE-4 — Mobile-home title retirement: order of steps
**Scenario:** A homeowner who owns both the mobile home **and** the land wants to
retire the title so it becomes part of the real property.

**Question:** Before you process a mobile-home title retirement, must ALL tangible
personal property taxes be paid in full first, and must the Clerk of Circuit Court
recording always be completed **before** the customer comes to you? Or can these
steps happen in a different order, or be waived?

**Why it matters:** The bot hard-blocks the customer if the Clerk recording isn't
done and lists "all tangible taxes paid" as a transaction-stopping requirement. If
the real sequence is more flexible, the bot turns away serviceable customers.

**Answer:** _______________________________________________

---

### TITLE-5 — FL dealer purchase: does the buyer ever still need to visit?
**Scenario:** A customer buys a NEW car from a Florida franchise dealer (or a mobile
home from a Florida dealer) and asks what they need to bring to title it.

**Question:** When a customer buys from a Florida dealer, does the dealer **always**
submit the title and tax so the customer never has to visit you — or are there common
situations where the buyer must still come in (picking up a plate, an RP decal for a
mobile home, owning the land, bringing insurance proof)?

**Why it matters:** The bot tells these customers the dealer "typically handles" it
and they may not need to visit. If that's wrong for St. Lucie, the bot gives falsely
reassuring guidance and the customer skips a visit they needed.

**Answer:** _______________________________________________

---

### TITLE-6 — Power of Attorney: what makes one acceptable for a title transfer?
**Scenario:** Someone is signing the title paperwork on the owner's behalf using a
Power of Attorney (the owner can't be present).

**Question:** What does a POA need to be accepted for a vehicle title transfer?
Specifically: does it have to be a **general or durable** POA (vs. a limited one), must
it contain **specific language authorizing actions related to tangible/personal
property** (or the motor vehicle specifically), and what **signatures** are required —
principal, witnesses, notary? Is the FLHSMV form **HSMV 82053** required, or will you
accept a general/durable POA drafted elsewhere?

**Why it matters:** The bot currently lists a generic "notarized power of attorney
document (or HSMV 82053)." A tax-office tester noted customers often don't know the
POA-type and required-language rules, and an incomplete or wrong-type POA gets them
turned away at the counter. Confirmed specifics let us spell out exactly what makes a
POA acceptable on the checklist. _(Two related wording tweaks are already shipped: the
question now spells out "Power of Attorney (POA)," and the insurance item now reminds
customers the vehicle's VIN must appear on the policy.)_

**Answer:** _______________________________________________

---

## Registration, Plates, Trailers & Vessels

### REG-1 ⭐ — Homemade trailer with no parts receipts
**Scenario:** A customer built a trailer and threw away (or never kept) the receipts
for the steel, axles, lights, and hardware, and wants to register it.

**Question:** When a homemade trailer has **no** parts receipts, do you turn the
customer away until they reconstruct receipts — or can you process the registration
the same day by estimating the value (e.g. market value) and collecting 6% tax on
that estimate?

**Why it matters:** The bot currently treats "no receipts" as a hard stop, but your
own catalog notes hint clerks **may** estimate from market value at their discretion.
If so, the bot is sending people home for paperwork you don't actually require.

**Answer:** _______________________________________________

---

### REG-2 — Trailer title-vs-registration weight line
**Scenario:** A customer is registering a trailer and isn't sure of its weight; the
empty weight is right around the 2,000 lb line (scale slip reads 1,990 or 2,010).

**Question:** Is the title-required vs. registration-only line exactly **2,000 lb of
empty (net) weight** from the scale slip? Right at the line, do you go strictly by the
printed number, or is there any rounding/tolerance?

**Why it matters:** A trailer's entire document list (title application, VIN
verification, signed title/MCO) flips at this number. The bot defaults unknown weight
to under-2,000. A wrong cutoff or basis sends customers in with the wrong documents.

**Answer:** _______________________________________________

---

### REG-3 — Family-transfer initial-registration-fee exemption
**Scenario:** A customer registering a vehicle they got from a relative asks to skip
the big initial registration fee because it "stayed in the family."

**Question:** For the initial-registration-fee exemption on family transfers, which
relatives actually qualify (does it truly include cousins and stepchildren?), and must
the buyer and seller share the **same home address**?

**Why it matters:** This exemption is worth ~$225. The bot lists "blood relative,
spouse, parent, cousin, stepchild" at the same address. If that definition or the
same-address rule is wrong, we either wrongly promise a discount or wrongly deny one.

**Answer:** _______________________________________________

---

### REG-4 — Never-arrived credential: free-replacement window
**Scenario:** A customer renewed online a few weeks ago, the new sticker/plate never
arrived, and they come in for a replacement.

**Question:** When a credential never arrives after an online renewal, is the
free-replacement window exactly **20 days** from renewal? Does "free" apply only to
online/mail renewals (not in-office renewals or other lost-tag reasons)?

**Why it matters:** The bot states it's free within 20 days and charges standard fees
after. A wrong window or condition means we quote the wrong fee or set a false
free-replacement expectation.

**Answer:** _______________________________________________

---

### REG-5 — Heavy-vehicle use tax threshold + grace
**Scenario:** A customer renewing a large commercial truck (~55,000 lb) recently
bought it and hasn't filed the federal heavy-vehicle tax form yet.

**Question:** Does the heavy-vehicle-use-tax requirement start at exactly **55,000 lb
gross weight**, and for a recently purchased truck, will you accept proof of purchase
within the last **60 days** in place of the paid IRS Form 2290?

**Why it matters:** The bot tells these customers to bring IRS Form 2290 or proof of
purchase within 60 days. If the threshold or grace window is off, a commercial
customer shows up missing a required federal document.

**Answer:** _______________________________________________

---

### REG-6 — Specialty plates: which require proof?
**Scenario:** A customer wants a specialty plate (university, professional, or honor
society) and asks what proof they need.

**Question:** Which specialty plates actually require the customer to prove eligibility
before you'll issue them, and what specifically counts as proof for each (alumni
letter, membership card, professional credential)?

**Why it matters:** The bot hard-stops the customer when it thinks proof is missing,
but only gives generic examples. If we block a customer for a plate that needs no
proof — or accept the wrong document — they're turned away or arrive unprepared.

**Answer:** _______________________________________________

---

## Driver License & ID

### DL-1 ⭐ — Social Security card substitute for REAL ID
**Scenario:** A customer doesn't have their original Social Security card (lost it, or
has only a copy) but has a W-2, 1099, or pay stub showing their full SSN.

**Question:** In what situations, if any, will you accept a W-2, 1099, or pay stub
showing the full SSN in place of the original Social Security card for a REAL ID
transaction? Or is the original card always required, with no substitute?

**Why it matters:** Your own catalog note literally says "ask clerk" here. The bot
requires the original and doesn't offer the fallback. If you routinely accept the
fallback, we're sending people home unnecessarily.

**Answer:** _______________________________________________

---

### DL-2 ⭐ — Address-proof fallback when documents aren't in the customer's name
**Scenario:** A customer can't bring two address documents in their own name — common
for a minor, a new resident living with family, an adult child in a parent's home, or
someone whose bills are in a spouse's name.

**Question:** When a customer can't bring two address proofs in their own name, when
can someone else's documents stand in (e.g. a parent's or spouse's documents **plus**
proof of relationship) versus when do you require a recorded Declaration of Domicile?
And must proofs be dated within 60 days / show 30+ days residency, or is that flexible?

**Why it matters:** The bot's only fallback is to send the customer to the Clerk for a
Declaration of Domicile — a paid, notarized, recorded step and a separate trip. If you
accept a household member's documents, we can keep many of these customers in one
visit. _(If you answer this, please also confirm whether a MyAccess Florida / SNAP
benefits letter counts as an address proof for an ID card — see deferred list.)_

**Answer:** _______________________________________________

---

### DL-3 ⭐ — Online-renewal eligibility
**Scenario:** A customer prefers to renew/replace online via MyDMV and has a REAL-ID
license.

**Question:** Florida only allows online renewal every other cycle. When a customer
asks to renew online, how can we tell whether **this** renewal is their eligible online
cycle versus one that forces an in-office visit? Besides "did you renew online last
time," what else disqualifies them (old photo, name/designation change, CDL)?

**Why it matters:** The bot steers customers to MyDMV whenever they say they prefer
online, without checking eligibility. If it's their in-office cycle, they waste time
online, get rejected, and come in anyway — annoyed.

**Answer:** _______________________________________________

---

### DL-4 ⭐ — New resident, license expired >1 year or unverifiable
**Scenario:** A new Florida resident's previous out-of-state/out-of-country license
expired more than a year ago, or it's from a state/country you can't verify
electronically.

**Question:** When a new resident's prior license expired over a year ago and can't be
verified electronically, can you still issue a Florida license once they bring a
certified driving record — or do they have to take the **written knowledge test and/or
road test** again first?

**Why it matters:** The bot only tells these customers to bring a certified driving
record and says nothing about re-testing. If a retest is required, they show up
unprepared and may leave without a license.

**Answer:** _______________________________________________

---

### DL-5 — Name change: waiting period after SSA update
**Scenario:** A customer changed their name (e.g. recently married), updated it with
Social Security a day or two ago, then comes to update their license.

**Question:** After someone updates their name with Social Security, is there a minimum
waiting period before you can successfully process the Florida name change (is it
really about 24–48 hours)?

**Why it matters:** The bot tells name-change customers to update SSA first but states
no waiting period. If your name-match check needs the SSA update to settle, a customer
who updated SSA that morning gets turned away.

**Answer:** _______________________________________________

---

### DL-6 — Failed vision test → downgrade to ID card
**Scenario:** An older driver (often 80+) fails the vision screening at renewal and
wants to downgrade to a state ID card instead of a license.

**Question:** When someone fails the vision test and downgrades to an ID card on the
spot, do you charge a new ID-card fee, is there any credit for the unused license, and
must they surrender the old license that day? Anything specific to seniors?

**Why it matters:** Emotionally sensitive and common. The bot tells them to bring the
current license to surrender but says nothing about cost or process.

**Answer:** _______________________________________________

---

### DL-7 — 100% disabled-veteran no-fee credential
**Scenario:** A 100% total-and-permanent service-connected disabled veteran with a VA
letter comes in for a license, ID, renewal, replacement, REAL ID upgrade, or CDL and
expects no fee.

**Question:** For the no-fee credential for 100% T&P disabled veterans, exactly what VA
documentation do you accept (a specific VA award/benefits letter, or is the VA
disability card enough)? And does the waiver cover **every** transaction type —
original, renewal, replacement, REAL ID upgrade, **and the CDL application fee** — or is
CDL handled differently?

**Why it matters:** The bot promises a no-fee credential on a generic "VA 100% T&P
letter" across all these transactions, including waiving the CDL application fee. If you
require a particular document, or CDL is different, customers are told the wrong thing.

**Answer:** _______________________________________________

---

### DL-8 ⭐ — What does a REAL-ID-compliant customer need for a replacement/renewal?
**Scenario:** A customer who already has the gold star (REAL ID compliant) comes in to
replace or renew their license, or to add a veteran designation. Their identity,
citizenship, and SSN were all verified when the gold star was issued.

**Question:** For a customer who is **already REAL ID compliant**, do they have to
**re-present their identity documents** (passport/birth certificate, Social Security
card, citizenship proof) again for an in-office replacement or renewal — or does the
gold star mean you only need their current credential plus proof of whatever is
**changing** (e.g. a new address proof if their address changed, the VA letter for a
veteran designation)? Put differently: what is the **complete** document list for a
compliant in-office replacement vs. renewal?

**Why it matters:** Today the bot asks every REAL-ID-compliant customer the full
identity gauntlet — citizenship, primary-ID type, Social Security card — and even lists
"bring a passport." A tax-office tester flagged this as obviously redundant ("I'm
already REAL-ID compliant — why are you asking?"). Our records show the full document
set is only needed for **non**-compliant customers, and FLHSMV's manual (CI06C) confirms
a compliant reissue needs "no document scanned" when nothing is changing — but we don't
have the precise compliant-replacement/renewal checklist in writing. Your answer lets us
skip the redundant questions (and stop telling compliant customers to bring documents
they don't need) while still asking for address proof / veteran docs when those apply.
The same fix covers both **dl-replacement** and **dl-renewal** (identical question set).

**Follow-up — temporary-status holders (TPS / visa / EAD):** Does this "compliant means
no re-presenting identity docs" rule apply the **same** way to a customer whose lawful
presence is temporary (e.g. Haiti TPS, a work/student visa)? Or, because their REAL ID
was issued only through their status expiration, must a temporary-status holder still
bring **current** lawful-presence documents (unexpired EAD/I-797/passport) at **every**
renewal even when they're gold-star compliant? This is the one case where re-asking may
be **correct** — we need to know so we don't wrongly skip it for them. (A second tester,
a Haiti TPS holder renewing, hit the same "why ask me?" but for them the answer may
genuinely be "because your status doc has to be current.")

**Answer:** _______________________________________________

---

### DL-9 — Lawful-presence documents for asylum / immigration applicants
**Scenario:** A customer who is in an immigration process (e.g. has an I-589 asylum
application, an I-130 petition, an EAD, an I-94) asks what they need to get a Florida
driver license or ID.

**Question:** For each common immigration situation — **pending asylum (I-589)**,
**family petition (I-130)**, **EAD holder**, **I-94 / visa** — what lawful-presence
documents does Florida actually accept for a driver license or ID, and what are the
expiration / validity-window rules (e.g. is an I-94 with a future expiry enough, is
there a "petition pending" window, is a particular USCIS notice acceptable)? Is a
first-time license for one of these applicants a **transfer**, a **first-time
issuance**, or its own path?

**Why it matters:** Two sessions show the bot struggling here — in one it recited very
specific rules free-form ("I-94 expiry caveats," "3-year petition window," "blue
half-sheet acceptable") that we **cannot verify** against our materials and may be
wrong; in another (I-589 asylum applicant wanting a "new driver license") the bot looped
through driver-license options three times without landing on a path, because there's no
clean first-time-issuance route for an immigration-document holder. Confirmed
document-acceptance rules let us answer accurately instead of improvising, and tell us
which transaction path these applicants belong in. **Important:** immigration
document-acceptance is exactly the area where a wrong answer is most harmful — until
confirmed, the bot should not state specific acceptance rules.

**Answer:** _______________________________________________

---

## CDL, Permits & License Sanctions

### CDL-1 ⭐ — Walton Road Hazmat testing
**Scenario:** A customer wants to add a Hazmat endorsement and is at the Walton Road
office.

**Question:** Is it still true that the Walton Road office has no Hazmat testing
machine, so a Hazmat customer must go to a different office? Which of your offices can
run the Hazmat written test today?

**Why it matters:** The bot sends Hazmat customers at Walton to a different office. This
is local workflow with no verifying source. If it's changed, we send people on a wasted
trip or to the wrong office.

**Answer:** _______________________________________________

---

### CDL-2 — School-employee letter scope
**Scenario:** A school employee who is **not** applying for a school-bus endorsement
(e.g. a teacher renewing a regular CDL) is at the counter.

**Question:** Does every school employee have to bring a school employment ID or
department letter on every CDL original/renewal — or only people applying for the
school-bus (S) endorsement?

**Why it matters:** The bot demands the letter from every CDL customer who says they're
a school employee, but your catalog note scopes it to school-bus applicants only.
Over-requiring it turns away ordinary school staff.

**Answer:** _______________________________________________

---

### SANCTION-1 ⭐ — Hardship-license waiting periods
**Scenario:** Customers ask when they can apply for a hardship license after a DUI, a
Habitual Traffic Offender (HTO) 5-year revocation, or a Chapter 893 drug-offense
suspension.

**Question:** Are these hardship-eligibility waiting periods still accurate?
- **HTO** — apply after 1 year of the 5-year revocation
- **Chapter 893 drug offense** — apply after 6 months of the 1-year suspension
- **DUI** — after the conviction-specific revocation minimum

Have any changed?

**Why it matters:** The bot quotes these specific periods that gate when someone can
even **apply**. A wrong window means a customer applies too early (rejected) or waits
longer than necessary.

**Answer:** _______________________________________________

---

### SANCTION-2 ⭐ — Child-support / FTA / FTC suspensions and hardship
**Scenario:** A customer with a child-support delinquency suspension asks whether they
can get any restricted/hardship license to keep driving to work.

**Question:** Is it still absolutely true that child-support, failure-to-appear (FTA),
and failure-to-comply (FTC) suspensions are **never** eligible for a hardship license,
with no exceptions? And that a child-support suspension stays until cleared through the
Department of Revenue?

**Why it matters:** The bot hard-blocks these customers from any hardship option. If
even a narrow exception exists, we're telling people they have no path to drive when
they might. High-stress, common scenario.

**Answer:** _______________________________________________

---

## Property Tax, Tourist Tax, Business Tax Receipt & Permits

### TAX-1 ⭐ — Business Tax Receipt veteran benefit
**Scenario:** A military veteran applies for a county Business Tax Receipt (BTR) and
asks if their veteran status reduces or waives the fee.

**Question:** For a county BTR, what does the veteran benefit actually do — is the fee
fully waived, partially reduced, or unaffected? What proof do you require (DD-214? VA
disability letter?), and does a 100% disabled veteran get a better deal than other
veterans?

**Why it matters:** The bot currently hedges ("may qualify for a fee reduction") from
general knowledge, not confirmed against any St. Lucie source. If a veteran is told
they get a discount the county BTR doesn't offer (or vice versa), that's a wrong
promise on a fee.

**Answer:** _______________________________________________

---

### TAX-2 — Tourist Development Tax military exemption
**Scenario:** An active-duty servicemember who owns a short-term rental property asks
whether they're exempt from the 5% Tourist Development Tax.

**Question:** Do any military members qualify for a Tourist Development Tax exemption?
If so, who qualifies and what must they show? Or should we simply tell every military
owner that TDT still applies and to contact the office?

**Why it matters:** Your TDT page mentions "certain members of the military" may qualify
but gives no rule, so the bot just punts the customer to the TDT office. A
clerk-confirmed rule (or a clear "no general exemption") lets us answer directly.

**Answer:** _______________________________________________

---

### TAX-3 — Property-tax partial payments
**Scenario:** A homeowner who can't pay their full current-year property tax bill at
once asks to make partial payments.

**Question:** For current-year property-tax partial payments, is the minimum still
**$100** per payment, the cap still **3 payments**, and the final deadline **March 31**?
And is it correct that **no** early-payment discount applies to any partial payment?

**Why it matters:** The bot states these specific numbers. They can be office policy and
can drift. If stale, a customer is told they can split payments they can't, or misses a
discount they were entitled to.

**Answer:** _______________________________________________

---

### TAX-4 — Disabled-placard hours + physician fax
**Scenario:** A customer asks when they can apply for/renew a disabled-parking placard,
or wants their doctor's office to fax the completed form (HSMV 83039) directly to you.

**Question:** Two related checks:
- **(a)** Are the in-person placard hours still **appointment Mon–Fri 9:00am–2:00pm,
  walk-ins after 2:30pm**?
- **(b)** Do you actually accept HSMV 83039 **faxed directly from a physician's (or VA)
  office**, and if so, what fax number should we give the customer?

**Why it matters:** Both are local-workflow details the bot states confidently but that
aren't on any cited FLHSMV authority, and the fax claim has no number attached. Wrong
hours send a disabled customer on a wasted trip.

**Answer:** _______________________________________________

---

### TAX-5 ⭐ — Does a property-tax PAYMENT require a photo ID?
**Scenario:** A customer comes in to pay their property taxes and doesn't have a
government-issued photo ID.

**Question:** Does paying property taxes actually require the customer to present a
government-issued photo ID? Property-tax payments are commonly made online, by mail, or
by a third party — so is a photo-ID a real requirement for a payment, or only for
certain transactions?

**Why it matters:** The bot currently runs a blanket "every in-office service needs a
photo ID" eligibility check and **hard-blocks** a property-tax payer who says they have
no ID ("I won't be able to process your property tax payment today"). If a payment
doesn't actually require ID, the bot is turning away someone who could have just paid —
and a tax payment is exactly the kind of thing people send a relative in to handle. Your
answer tells us whether to exempt tax **payments** from the photo-ID gate.

**Answer:** _______________________________________________

---

### TAX-6 — Does a hunting/fishing (FWC) license require a photo ID?
**Scenario:** A customer wants a recreational hunting or fishing license and doesn't have
a government-issued photo ID.

**Question:** Does Florida actually require a government-issued photo ID to issue a
recreational hunting or fishing (FWC) license — enough to turn the customer away without
one — or can the license be issued with other identifying information?

**Why it matters:** The bot tells these customers "a valid photo ID is required by state
law for all hunting and fishing licenses" and blocks them without one. That blanket
photo-ID rule is correct for driver-credential transactions, but it may be over-applied
to FWC products. If a fishing license doesn't strictly require a photo ID, the block is
wrong and turns away a serviceable customer.

**Answer:** _______________________________________________

---

## Deferred (lower-priority) — not asking now, listed for transparency

We intentionally left these off the priority list to keep it skimmable. None are
silent cuts — flag any you'd like promoted:

- **Mobile home out-of-state use tax** — does the 6-month use-tax / foreign-import rule
  apply identically to mobile homes? (Low traffic; bundle into a future mobile-home tax
  review.)
- **Dealer drop-off, lapsed dealer license** — any closeout/temp-plate paperwork
  accepted from an expired dealer? (Rare; conservative hard block is low-harm.)
- **Dealer drop-off, out-of-state business entity proof** — FEID vs. home-state
  registration? (Niche B2B path.)
- **Foreign-imported vehicle customs documents** — exact EPA/DOT/CBP forms. (Rare;
  current FLHSMV document set is defensible.)
- **MyAccess Florida / SNAP letter as address proof for an ID card** — narrower instance
  of DL-2; please confirm alongside DL-2.
- **CDL paper medical card not yet uploaded** — can you accept it before the doctor
  uploads? (Conservative hard block, clear customer fix.)
- **CDL General Knowledge exam older than 12 months** — must all written + skills tests
  be retaken? (Small slice of applicants.)
- **CDL CLP 14-day wait before skills test** — is 14 days exact? (Federal rule, low
  local-variance risk.)
- **FL CDL expired >12 months** — exact cutoff forcing a fresh original? (Narrow timing
  edge.)
- **3-day wait after online TLSAE before the Class E knowledge exam** — single
  unverified vendor claim; not currently in the bot.
- **15-year-old Florida sanction waiver (Administrative Reviews)** — is the ops-manual
  policy current? (Rare out-of-state-record scenario.)
- **Points-based suspension durations** — exact point-suspension schedule. (The bot
  already avoids quoting concrete durations here.)
- **TDT property-manager Owner-Agent Agreement** — who initiates/submits the form?
  (Operational nicety.)
- **BTR modifications email-only vs. counter/online** — must changes go through the Tax
  Specialist team? (Low-harm; email reaches the right team.)
- **Hunting/fishing homestead exemption scope** — full landowner-family freshwater
  exemption vs. minor-child-only? (Modest fee, seasonal/low volume.)

---

## How the answers get used

Each answer lets us replace a guess/placeholder/hard-block in the chatbot with your
confirmed policy. We'll cite your office as the source (as we already do for the
deceased-owner death-certificate requirement, tagged `tcslc-sme`). High-impact answers
(⭐) translate directly into fewer wasted trips and fewer under-prepared arrivals.
