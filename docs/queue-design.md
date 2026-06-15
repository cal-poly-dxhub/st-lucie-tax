# Check In System Design

## Basic Flow

1. User books appointment
2. QR Code UUID is generated and stored in DB
3. Email is sent to user confirming their appointment + QR Code
4. QR code gets scanned at check-in
5. Documents / pre-screen questions checked
  - If missing documents then scan them in at check-in (allow check-in to defer this to service desk)
  - If not pre-screen questions then send to phone to complete
6. Once the above are completed - assign to queue
7. Pull from queue

## Design Decisions

### Queue Priority

If customer is priority simply serve them before the normal customers. 
Customers are served in the order in which they check-in within their respective priority level.

### Clerk Assignment

We simply pull from the end of the queue when a clerk hits "summon next"
the system finds the next waiting customer whose txn types are all within that clerk's skill set. 
FIFO by check-in time, with 

Skill rarity should not be an issue due to cross-training and the skill capacity calculated by scheduling.

### Document Upload

Document upload ideally happens on the frontend, but for less technical users, docs can be added at check-in, or in a worst case, at the service desk.
Allow the check-in clerk to defer this process in the case of difficulties with a button.
