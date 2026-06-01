# Scheduling Engine Design

## Overview

The scheduling engine dynamically allocates appointment time slots across multiple office locations for county citizens requesting tax/DMV services. It handles variable transaction durations, clerk skill availability, office capacity, and customer preferences.

## Key Concepts

- **Multi-transaction appointments**: A single appointment can bundle multiple services (e.g., renewal + registration) with combined duration.
- **Skill-based routing**: Clerks have specific skills; the engine only considers clerks who possess ALL skills required by the appointment.
- **Dual-constraint capacity**: Both per-skill supply and total desk occupancy must have availability for a slot to be valid.

## Design Decisions

### Change-Point Capacity Sweep

Rather than discretized fixed time blocks, the engine identifies "change-points" — moments where supply or demand shifts (lunch starts/ends, existing appointment starts/ends). Capacity is validated at every change-point within the proposed slot window. This avoids wasted gaps between fixed blocks and enables tight packing.

### Dual-Constraint Model

Two independent checks must both pass:

1. **Skill supply**: Active clerks with required skills (not on lunch, not absent) minus concurrent skill-overlapping demand >= 1
2. **Desk occupancy**: `MIN(effective_desks, clerks_on_floor)` minus total concurrent appointments >= 1
   - `effective_desks = FLOOR(total_desks * run_rate_pct / 100)` — reserves remaining desks for walk-ins

The more restrictive constraint wins.

### Optimistic Find + Pessimistic Book

- `find_appointment()` (TypeScript) generates and ranks candidates against current state.
- `book_appointment()` (PL/pgSQL) acquires a `FOR UPDATE` lock on clerk schedules for (office, date), rechecks capacity, then inserts atomically.

This prevents race condition oversells while keeping reads fast.

### Candidate Generation & Preference Ranking

Candidate start times are generated from: office open, transaction availability windows, lunch shift ends, and existing appointment ends (tight packing). Candidates are ranked by:

- **ASAP mode**: earliest date, then time, then office
- **Preference mode**: preferred office > preferred day > morning/afternoon > earliest

## Inputs & Outputs

**Input**: County ID, required skills (transaction types), ASAP flag, optional preferences (office, day of week, morning/afternoon), search window (start date + days).

**Output**: Office ID, slot date, slot time, and available capacity at that slot — or null if no slot exists in the window.

## Constraints & Invariants

- No overbooking: if demand for any required skill exceeds supply, the slot is rejected
- Desk cap enforced: concurrent appointments never exceed effective desks or clerks on floor
- Lunch transparency: clerks on lunch are excluded from supply
- Clerk absences reduce supply for the day
- Appointments must fit entirely within office hours and transaction availability windows
- Slots in the past are rejected
- Booking is atomic: succeeds fully or fails, no partial state
- Tenant isolation via RLS (county-id scoping)
