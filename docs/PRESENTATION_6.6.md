# PRENEURA 6.6 — Professional Customer Presentation Runbook

## Positioning

Present PRENEURA as a high-fidelity operational product demo. The workflow, role responsibilities, interfaces, decision surfaces and end-to-end buyer journey are demonstrated now; production database, identity, payment, document storage and realtime integrations are the implementation layer.

Avoid saying “this is only a demo.” Prefer:

> This is the interactive product prototype. It demonstrates the target operating model and user experience. Production infrastructure and integrations are connected during implementation.

## Before the meeting

1. Open the public demo.
2. Enter Manager.
3. Press **Reset Demo**.
4. Confirm the Manager home shows the Presentation Control and Management Decision Room.
5. If the private Egyptian voice runtime is available, start it before the meeting. If it is not available, the browser voice fallback remains presentation-safe.
6. Keep the browser at 100% zoom and use a desktop viewport of at least 1366×768.

## Recommended presentation sequence

### 1. How PRENEURA Works

Explain the operating model from left to right:

Buyer Direct / Broker / Sales Center → One Buyer Record + EOI → Eligibility → Online / Sales Center attendance → One Shared Queue → AI or Human assistance → Master Plan → Building → Floor → Exact Unit → Unit Lock → Transaction Operator → Contract & Sign → My Property.

Key message:

> Attendance changes the service channel. It does not create another priority truth.

### 2. Manager Overview

Show the **Management Decision Room** first. The objective is to answer:

- What is happening right now?
- Where does management need to act?

Use the drill-down KPIs to open Live Allocation, Buyer 360°, Brokers and collections-related scenarios.

### 3. Normal Allocation Day

Choose **Normal Day**.

Use it to explain the normal Online + Sales Center operating model and shared priority truth.

### 4. High Queue Pressure

Choose **Queue Pressure**.

The demo prepares a larger active queue with progressively longer waits. Show:

- active queue depth;
- Online vs Sales Center split;
- average / longest wait;
- human Allocator seat utilization;
- exact buyer rows;
- latest event / last actor;
- live exceptions.

Key message:

> Management can identify pressure while the allocation event is still running instead of discovering the problem in an end-of-day report.

### 5. Unit Lock Conflict

Choose **Unit Conflict**.

Show the held physical unit and the two relevant audit events: successful lock and rejected second attempt.

Key message:

> Queue position never reserves inventory. The exact-unit lock is the authoritative inventory commitment boundary.

### 6. Buyer Journey Audit

Open **Buyer Journey Audit**.

The presentation terminology is:

- **Recorded Event** — historical action captured by PRENEURA.
- **Current State Snapshot** — current operational truth reconstructed from buyer, queue, transaction, documents, contract and property records.

Point out the role, actual staff/system actor, buyer, reference, timestamp and full details on each journey line.

### 7. Online AI Allocation

Open the Online Allocation journey.

The advisor should introduce itself, guide Master Plan → Building → Floor → Exact Unit, rank currently available units, scroll/highlight the UI and explain alternatives.

If the local private inference runtime is connected, show **LOCAL AI • متصل**. If not, the UI shows the professional browser-voice fallback and the allocation journey still works.

Key message:

> The AI may explain, compare, recommend, navigate and highlight. Final unit lock and legal signing remain explicit buyer decisions.

### 8. Offline Human Allocator

Open Allocator role.

Show that PRENEURA exposes the next eligible Sales Center buyer according to the shared queue. The Allocator does not manually choose who to serve.

### 9. Transaction Operator + Contract

Show:

- payment/document requirements;
- exact contract generation;
- print exact contract;
- upload returned signed/fingerprinted contract;
- biometric/fingerprint verification receipt;
- verify and complete.

### 10. My Property

Show:

- contract value;
- amount paid;
- paid percentage;
- remaining amount;
- missed installments;
- next installment;
- per-installment paid and remaining amount;
- contract, documents, receipts, updates and support.

### 11. Overdue Collections

Choose **Overdue Collections** from the Manager presentation control.

Use the Management Decision Room to show that outstanding collections are visible as a management attention item rather than hidden inside the customer account.

### 12. Broker Performance

Choose **Broker Performance**.

Show company → agent → attributed buyers → EOI → sale → commission. The scenario prepares enough records to make the executive partner page meaningful in a meeting.

### 13. Phase Builder + Project Data

Show both phase-selection methods:

- Master Plan / building-oriented selection;
- searchable exact-unit table.

Then show Project Data & Uploads as the project-ingestion workspace.

Explain that production implementation evolves this into:

Upload → Map Columns → Validate → Preview Errors → Approve → Version → Publish.

## Prepared presentation scenarios

| Scenario | Purpose | Opens |
| --- | --- | --- |
| Normal Day | Balanced operating state | Manager Overview |
| Queue Pressure | Demonstrate queue/capacity decision support | Live Allocation |
| Unit Conflict | Demonstrate exact-unit concurrency protection | Live Allocation |
| Overdue Collections | Demonstrate financial attention / installment visibility | Manager Overview |
| Broker Performance | Demonstrate partner/agent performance | Brokers |
| Reset Demo | Restore clean initial in-memory state | Manager Overview |

## Closing message

> PRENEURA is designed as the operating layer connecting Buyer, EOI, allocation, exact physical inventory, transaction, contract, property, installments and management intelligence. The demo shows the target operating model and user experience. Production implementation then connects these interfaces to the developer’s server-side identity, inventory, payment, document, ERP and realtime infrastructure.
