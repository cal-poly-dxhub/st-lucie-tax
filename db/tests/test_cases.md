# Scheduling Test/Edge Cases

## Skill-Filtered Demand

### Case 1: Rare skill with busy office (the motivating bug)

**Setup:** 10 clerks at Fort Pierce. 8 generalists have {id_card}. Maria and Angela have {road_test, id_card}. 8 concurrent id_card appointments running.

**Book:** road_test appointment

**Expected:** available = 2. The 8 id_card appointments don't compete for road_test supply because `{id_card} && {road_test}` is false.

**Before fix:** available = 2 - 8 = -6, clamped to 0. Incorrectly says "full."

---

### Case 2: Same-skill demand correctly counted

**Setup:** Same 10-clerk office. Maria and Angela have {road_test}. 1 existing road_test appointment running.

**Book:** road_test appointment

**Expected:** available = 2 - 1 = 1. The existing road_test appointment DOES compete because `{road_test} && {road_test}` is true.

---

### Case 3: Multi-skill appointment competing on partial overlap

**Setup:** Maria and Angela have {road_test}. Existing appointment requires {road_test, id_card}.

**Book:** road_test appointment

**Expected:** The existing appointment counts as demand because `{road_test, id_card} && {road_test}` is true (at least one element overlaps). Available = 2 - 1 = 1.

---

### Case 4: Multi-skill booking against partial overlap

**Setup:** Maria and Angela have {road_test, id_card}. 1 existing id_card appointment running.

**Book:** {road_test, id_card} appointment

**Expected:** The existing id_card appointment counts as demand because `{id_card} && {road_test, id_card}` is true. Available = 2 - 1 = 1.

---

### Case 5: Completely disjoint skills, zero demand

**Setup:** 10 clerks. 2 have {road_test}. 8 have {id_card}. 8 concurrent {id_card} appointments. 0 road_test appointments.

**Book:** road_test appointment

**Expected:** available = 2 - 0 = 2. Perfect isolation.

---

## Optimistic Edge Case (accepted tradeoff)

### Case 6: Shared clerk at full utilization

**Setup:** 9 clerks have {id_card}. Maria has {road_test, id_card} (she's one of the 9). 9 concurrent id_card appointments (all 9 id_card clerks consumed, including Maria).

**Book:** road_test appointment

**Expected (system):** available = 1 (Maria). Demand for road_test = 0 (none of the existing appointments need road_test, so `{id_card} && {road_test}` is false).

**Reality:** Maria is actually busy with an id_card appointment. Only Angela (if she exists) is truly free.

**Why this is acceptable:** Reaching 9/9 id_card utilization is prevented by run_rate_pct. At 80% run rate, effective capacity is floor(9 * 0.8) = 7, so max concurrent id_card demand is 7, leaving 2 id_card clerks (potentially including Maria) idle. Maria will be available in practice.

---

## Change-Point Interactions

### Case 7: Competing appointment starts mid-slot

**Setup:** Maria and Angela have {road_test}. Proposed slot is 10:00-10:30. An existing road_test appointment starts at 10:15.

**Expected:** Change-point at 10:15 shows demand = 1. Supply = 2 throughout. Min available across [10:00, 10:15, ...] = 2 - 1 = 1. Bookable.

---

### Case 8: Non-competing appointment starting mid-slot is NOT a change-point

**Setup:** Maria and Angela have {road_test}. Proposed slot is 10:00-10:30. An existing id_card appointment starts at 10:15.

**Expected:** The id_card appointment is excluded from the change-points CTE entirely (fails the `&& p_target_skills` filter). No change-point at 10:15. Only change-point is 10:00. Available = 2 - 0 = 2.

---

### Case 9: Lunch shift reduces supply mid-slot

**Setup:** Maria (lunch shift 12:00-12:30) and Angela (lunch shift 12:30-13:00) have {road_test}. Proposed slot is 11:45-12:15.

**Expected:** Change-point at 12:00 (Maria's lunch starts). Supply drops from 2 to 1 at 12:00. Min available = 1 - 0 = 1. Bookable, but tight.

---

## Absence Handling

### Case 10: Absent specialist reduces supply

**Setup:** Maria has {road_test} but is on vacation. Angela has {road_test}. 0 competing road_test appointments.

**Book:** road_test appointment

**Expected:** Supply = 1 (Angela only, Maria excluded by clerk_absences). Available = 1 - 0 = 1.

---

### Case 11: All specialists absent

**Setup:** Maria and Angela both have {road_test}, both absent. 0 competing appointments.

**Book:** road_test appointment

**Expected:** Supply = 0. Available = 0. Slot rejected.

---

## Aggregate Capacity vs. Per-Clerk Continuity

These cases demonstrate the tradeoff documented in design decision #11: `validate_slot` checks aggregate capacity at each change-point, not whether a single clerk is free for the full duration.

### Case 12: Handoff illusion — lunch stagger creates false availability

**Setup:** Maria has {road_test}, lunch 10:00-10:30. Angela has {road_test}, lunch 10:30-11:00. No existing appointments. Proposed slot is 10:00-11:00.

**Expected (system):** Change-points at 10:00 and 10:30. At 10:00: supply = 1 (Angela free, Maria on lunch). At 10:30: supply = 1 (Maria free, Angela on lunch). Min available = 1. Slot appears bookable.

**Reality:** No single clerk is free for the full hour. Angela covers 10:00-10:30, Maria covers 10:30-11:00, but the customer would need to be handed off mid-appointment.

**Why this is acceptable:** This requires lunch shifts to tile exactly across the full appointment window with no overlap. Typical lunch staggering and the fact that most appointments are shorter than lunch gaps make this extremely unlikely in practice.

---

### Case 13: Handoff illusion — absence boundary mid-slot

**Setup:** Maria has {road_test}, absent June 1-3 (returns June 4). Angela has {road_test}, absent June 4-6. Proposed slot spans midnight boundary (not realistic for this system, but illustrates the principle). More realistically: a multi-hour block where one clerk's schedule ends and another's begins.

**Expected (system):** At each change-point, at least one clerk shows as available. Min available >= 1.

**Reality:** If the slot is long enough that one clerk's availability ends and the other's begins within it, no single clerk covers the full window.

**Why this is acceptable:** Appointments are typically 15-60 minutes. Schedule boundaries within a single appointment's duration are rare given standard 8-hour shifts.

---

### Case 14: No handoff — staggered lunches with overlap

**Setup:** Maria has {road_test}, lunch 10:00-10:30. Angela has {road_test}, lunch 10:15-10:45. Proposed slot is 9:45-10:15.

**Expected (system):** Change-points at 9:45 and 10:00. At 9:45: supply = 2. At 10:00: supply = 1 (Maria on lunch, Angela still free). Min available = 1. Bookable.

**Reality:** Angela is genuinely free 9:45-10:15. Single-clerk continuity holds. The aggregate check gives the correct answer here.

---

### Case 15: True capacity exhaustion masks handoff concern

**Setup:** Maria has {road_test}, lunch 10:00-10:30. Angela has {road_test}, lunch 10:30-11:00. 1 existing road_test appointment 10:00-11:00. Proposed slot is 10:00-11:00.

**Expected (system):** At 10:00: supply = 1 (Angela), demand = 1. Available = 0. Slot rejected.

**Note:** The aggregate check correctly rejects this even though the handoff issue also applies. When demand is nonzero, the aggregate check is more conservative than it might otherwise be.

---

## Total Concurrent Cap (run_rate_pct + lunch)

These cases test the desk-level cap that prevents more scheduled appointments than clerks can physically serve, regardless of skill distribution.

### Case 16: run_rate_pct caps total concurrent (diverse skills)

**Setup:** 4 clerks, all with different skills: A={1}, B={2}, C={3}, D={1,2,3}. run_rate_pct=50. 2 existing appointments: one for skill 1, one for skill 2.

**Book:** skill 3 appointment at the same time

**Expected:** effective_desks = floor(4 * 50 / 100) = 2. Total concurrent at this moment = 2. Cap reached. Rejected.

**Before fix:** Per-skill check passed (supply for skill 3 = 2 clerks C+D, demand = 0, avail = 2). Desk cap used raw desk count (4), so deskAvail = 4-2 = 2. Booked. Walk-in arrives, no desk available.

---

### Case 17: Lunch reduces effective cap below effective_desks

**Setup:** 3 clerks, all skills. Lunch shift 1: clerk A (11:30-12:15). Lunch shift 2: clerks B, C (12:15-13:00). run_rate_pct=100. 1 existing appointment at 12:20-12:45 (skill 1).

**Book:** skill 2 appointment at 12:20-12:35

**Expected:** At 12:20: clerks on floor = 1 (only clerk A, B+C on lunch). effective_desks = 3. Cap = min(3, 1) = 1. Total concurrent = 1 (existing appointment). deskAvail = 1-1 = 0. Rejected.

**Before fix:** Cap was just effective_desks=3. deskAvail = 3-1 = 2. Skill check: supply=1 (only A on floor with skill 2), demand=0. avail = min(1, 2) = 1. Booked. But now 2 appointments running with only 1 clerk on floor.

---

### Case 18: Appointment spanning into lunch rejected when it would exceed on-floor count

**Setup:** 3 clerks. Lunch shift 1: clerks A, B (11:30-12:15). run_rate_pct=100. 1 existing appointment at 11:15-11:45 (skill 1). Proposed slot: 11:20-11:45 (skill 2).

**Book:** skill 2 appointment at 11:20-11:45

**Expected:** Change-points: 11:20, 11:30 (lunch starts). At 11:20: clerks on floor = 3, total concurrent = 1, cap = min(3,3) = 3, deskAvail = 2. OK. At 11:30: clerks on floor = 1 (A+B on lunch), total concurrent = 2 (existing + proposed would make 2 but we check existing only = 1), cap = min(3,1) = 1, deskAvail = 1-1 = 0. Rejected.

**Note:** The lunch start at 11:30 is correctly added as a change-point because it falls inside [11:20, 11:45). Without this change-point, the check at 11:20 alone would pass.

---

### Case 19: Appointment starting after lunch ends — full capacity restored

**Setup:** 3 clerks. Lunch shift 1: clerks A, B (11:30-12:15). run_rate_pct=100. 0 existing appointments.

**Book:** skill 1 appointment at 12:15-12:30

**Expected:** At 12:15: clerks on floor = 3 (lunch ended). Cap = min(3, 3) = 3. deskAvail = 3. Bookable.

---

### Case 20: run_rate_pct + lunch compound — walk-in headroom maintained

**Setup:** 6 clerks. run_rate_pct=50. Lunch shift 1: clerks A, B, C (11:30-12:15). 0 existing appointments.

**Book:** appointment at 11:30-11:45

**Expected:** effective_desks = floor(6 * 50 / 100) = 3. Clerks on floor at 11:30 = 3 (D, E, F). Cap = min(3, 3) = 3. deskAvail = 3. Bookable. But only 3 total slots available — matching the 3 clerks present, with 0 extra headroom since run_rate already halved the cap to match the on-floor count.

---

### Case 21: Multi-skill appointment spanning lunch — duration summed correctly

**Setup:** 3 clerks, all skills. Lunch shift 1: clerks A, B (11:30-12:15). Proposed: {road_test, id_card} at 11:00. Duration = 30+15 = 45 min (11:00-11:45).

**Book:** multi-skill appointment at 11:00-11:45

**Expected:** Change-points: 11:00, 11:30 (lunch starts inside [11:00, 11:45)). At 11:00: 3 on floor, cap=3, concurrent=0, avail=3. At 11:30: 1 on floor, cap=1, concurrent=0 (only this proposed one, which isn't yet booked), avail=1. Bookable (it's the first appointment). A second booking at the same time would be rejected at 11:30 (cap=1, concurrent=1).
