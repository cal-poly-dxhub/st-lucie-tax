# User Stories — Index

## Story Files
- [Personas](personas.md) — 4 personas (Customer, Clerk, Admin, Super Admin)
- [Customer Journey Stories](stories-customer.md) — 7 epics, 14 stories
- [Clerk Journey Stories](stories-clerk.md) — 6 epics, 16 stories
- [Admin, Display & Cross-Cutting Stories](stories-admin-and-cross-cutting.md) — 10 epics, 14 stories

## Summary

| Category | Epics | Stories |
|----------|-------|---------|
| Customer Journey (B1-B7) | 7 | 14 |
| Clerk Journey (C1-C6) | 6 | 16 |
| Admin Journey (E1-E6) | 6 | 8 |
| Public Display (F1) | 1 | 1 |
| Cross-Cutting (G1-G4) | 4 | 7 |
| **Total** | **24** | **46** |

## Persona Coverage

| Persona | Primary Stories | Secondary Stories |
|---------|----------------|-------------------|
| Customer | B1-B7, G3, G4 | F1 |
| Clerk (Check-In Mode) | C1-C3 | — |
| Clerk (Service Mode) | C4-C6 | — |
| Admin | E1-E6 | — |
| Super Admin | — (future) | G2 (architecture) |

## Requirements Traceability

All 68+ functional requirements from requirements.md are covered:
- FR-CHAT-01 through FR-CHAT-14 → Epics B1-B7
- FR-ADMIN-01 through FR-ADMIN-10 → Epics E1-E6
- FR-CLERK-01 through FR-CLERK-16 → Epics C1-C6
- FR-SCHED-01 through FR-SCHED-09 → Epics B4, B6, C2
- FR-DISPLAY-01 through FR-DISPLAY-02 → Epic F1
- FR-NOTIF-01 through FR-NOTIF-03 → Epic G3
- FR-AUTH-01 through FR-AUTH-06 → Epic G1
- NFR-TENANT-01 through NFR-TENANT-04 → Epic G2
