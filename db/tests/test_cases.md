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
