# Scheduling Engine Design

## Overview

The scheduling engine dynamically allocates appointment time slots across multiple office locations for county citizens requesting tax/DMV services. It is a first available, constraint meeting scheduling system that ensures the office has capacity for the requested transactions.

## The Core Flow

- User inputs preferences (initial constraints) including:
  - Transactions needed
  - Time of day
  - Office location
  - Day of week
  - ASAP Option - first appointment without preferences
- We search for possible slot start times (start of the day, end of another appointment, transaction availability windows, or after lunch) meeting those preferences
- We suggest a slot meeting those constraints
  - If no slot meets preferences, we ask user to relax one or many of them
  - If there is a slot, we return that to the user, and recheck at time of booking to ensure it'ss still available

## Design Decisions

### Appointment Packing

Appointments are packed back to back as efficiently as possible. Initially we took a grid based approach of 15 minute blocks.
However, the customer saw this as too inefficient for their use case, and wanted them to start and end on whatever time boundary
was created by the appointment durations. In the case this overloads offices, we can turn down `run_rate_pct` in order to 
reduce the amount of traffic/bookable appointments. Tuning `run_rate_pct` effectively reduces the amount of clerks capacity that is bookable. 

### Change Point Identification Instead of Grid

A grid allows us to calculate capacity in buckets, however, without one we must ensure that a clerk has capacity for every minute
of a scheduled appointment. We do this by looking for any change points (where capacity can decrease such as an appointment starts or lunch starts), and ensure that capacity is at least one at all of these points within a new potential appointments time range. We only look for decreases as these are moments which potentially no clerks are available to handle a given txn.

### First Available

We return the first available appointment meeting booking constraints in order to efficiently pack appointments and also to reduce load on the database.
This serves the dinner reservation analogy the customer mentioned, so that users are given an appointment, and don't have to choose from a list.

### Multi-transaction Appointments

If a customer needs to get multiple transactions done, say a drivers license renewal and road test, we validate capacity for a single clerk possessing all required skills. This ensures that one clerk can more efficiently serve both txns as they have customer context, reducing the need for handoff to another clerk. Enforcing this constraint also is better for the customer experience, as they do not have to try and find two separate appointment times, and can get what they need done in one visit.

### No Clerk Assignment at Booking time

Originally, appointments were assigned to an individual clerk.
Pros: 
- We guarantee that the customer has a clerk that is able to do the txn available at time of appointment.
- Easier for exact capacity forecasting.
Cons:
- No flexibility if a clerk does not show up, if an appointment runs long, or other circumstances arise
- Must rebook all appointments if a clerk calls out sick
- Complicates walk-ins without appointments

Based off customer feedback, we take a hybrid approach, where we calculate capacity on a per skill and per desk basis
in order to ensure that we have the right amount of clerks to serve requested appointments. This gives more flexibility
in the booking and scheduling process. Instead of assigning clerks at booking time, the appointments are just used for capacity, with actual assignments done in office at check-in.

The trade-off of not knowing which clerk will handle which appointment could cause issues where a clerk with
a rare skill is busy doing txns that other clerks sitting idle could do, so that rare skill may never get done. 
This is unlikely to be a problem due to cross-training at st-lucie. According to research by [Taskiran and Zhang (2017)](https://doi.org/10.1016/j.cor.2016.07.001), cross-training offers a "great advantage to balance un-even demand across service categories", with even partial cross-training (as little as 10–30% of staff cross-trained with 2-3 out of 9 total skills) resulting in considerable time and cost savings. It is highly unlikely a rare skill will go unserved due to staff cross-training, which gives sufficient coverage to skills needed.


### Clerk Capacity Calculation

The minimum of desk capacity and clerks skills is taken to see whether we can serve an appointment. 
For example: 
- Clerk A has skills [1, 2], Clerk B has skills [3, 4]
- Existing appointment 1 needs skill [1] (Clerk A is busy)
- Existing appointment 2 needs skill [3] (Clerk B is busy)
- New appointment needs skill [2]
The desk check ensures we have enough physical clerks, while the skill checks is there to ensure that
we can actually handle the given transaction type. The reason we don't simply reduce skill capacity
and need number of desks, is that we are then effectively assigning a clerk to an appointment, and lose
the flexibility described above.


### Transaction Availability Windows

Some transactions can only be performed during specific hours. Road tests, for example, might only be available 9:00–15:00. When a customer books multiple transactions, the appointment must fit within the intersection of all their windows, the latest start and the earliest end. This prevents booking a road test at 4pm even if there's desk capacity.

### Clerk Absences

Clerks can be marked absent for date ranges. An absent clerk is excluded from supply calculations the same way a clerk on lunch is.

### Office Hours

An appointment must fit entirely within the office's open and close times. A 45-minute appointment at an office that closes at 5:00 cannot start at 4:30. This is validated at booking time and rejected if violated.

### Optimistic Appointment Finding, Pessimistic Booking

Finding an appointment checks the current state and returns the first valid slot. Booking that slot acquires a row-level lock on all clerk schedules for that office and day, then rechecks capacity before inserting. If two customers find the same slot simultaneously, one wins the lock and books it, the other's recheck fails and they're told to search again. This keeps search fast while preventing double-booking.
