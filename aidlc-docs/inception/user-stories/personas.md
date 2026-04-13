# User Personas

## Persona 1: Customer

**Name**: Maria (representative)
**Role**: Public user of the conversational AI chatbot
**Context**: Florida resident needing tax collector services — driver license, vehicle registration, title transfer, etc. Interacts with the system through a web-based chatbot that replaces the traditional county website.

**Goals**:
- Complete as much paperwork as possible before visiting the office
- Get an appointment quickly with minimal scheduling friction
- Spend the least possible time at the counter

**Frustrations**:
- Long wait times at the office
- Not knowing what documents to bring
- Confusing government websites with too many options
- Having to repeat information to multiple people

**Technical Comfort**: Varies widely — from smartphone-native millennials to seniors who need simple, guided flows

**Journey Variants**:
- **Prepared Path**: Enters through chatbot, completes identity verification, uploads documents, answers pre-screening questions, books appointment, arrives with QR code
- **Walk-In Path**: Arrives at office without appointment, uses kiosk QR code or front desk check-in, completes pre-screening via SMS in lobby, enters queue

---

## Persona 2: Clerk

**Name**: Angela (representative)
**Role**: County tax collector office employee who rotates between check-in and service functions
**Context**: Works at one of St. Lucie County's 3 offices (~24 clerks per office). Frequently moved between desks and locations by management. Selects office and station at daily login.

**Goals**:
- Process customers efficiently with all information ready before they sit down
- Avoid wasting counter time on paperwork that could have been done beforehand
- Handle the queue fairly without cherry-picking

**Frustrations**:
- Customers arriving unprepared (missing documents, unanswered questions)
- Manually entering information that the customer already provided somewhere else
- Dealing with the state system (Orion) for document uploads

**Two Operational Modes**:
- **Check-In Mode**: Scans QR codes or looks up customers by name, reviews pre-screening completeness, assigns queue type (regular/priority/assigned-to-clerk), sends incomplete pre-screening questions via SMS, uploads documents if customer brought physical copies
- **Service Mode**: Receives auto-assigned customers from queue, reviews documents and pre-screening answers, processes transaction, checks vision, takes photo, collects payment, completes appointment, summons next customer

---

## Persona 3: Admin

**Name**: County Tax Collector (Admin persona)
**Role**: County tax collector administrator managing offices, clerks, transaction types, and system configuration
**Context**: Oversees all offices within their county. Needs visibility into operational metrics, ability to configure the system, and tools to manage staff.

**Goals**:
- Keep all offices running efficiently with balanced workloads
- Ensure transaction duration estimates stay accurate
- Onboard new clerks quickly and assign appropriate skills
- Configure the chatbot experience (hot buttons, pre-screening questions, transaction types)

**Frustrations**:
- Duration estimates drifting from reality without anyone noticing
- Manual processes for clerk onboarding and skill assignment
- Lack of visibility into cross-office performance

**Scope**: Tenant-scoped — sees only their county's data

---

## Persona 4: Super Admin

**Name**: Service Corporation COO/CTO (Super Admin persona)
**Role**: Platform administrator managing the multi-tenant system across all Florida counties
**Context**: Future role — manages global configuration (transaction type templates, state-mandated questions), onboards new county tenants, monitors platform health across all 67 counties.

**Goals**:
- Maintain consistent baseline configuration across all counties
- Onboard new counties efficiently
- Monitor platform-wide health and usage

**Scope**: Cross-tenant — sees all county data, manages global templates

**Note**: Super Admin stories are defined for architectural completeness but are low priority for MVP (St. Lucie only deployment).
