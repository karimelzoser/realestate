# PRENEURA 6.7 — Professional Customer Presentation Runbook

## Positioning

Present PRENEURA as a **high-fidelity operational product demo**. The workflow, role responsibilities, interfaces, decision surfaces and end-to-end buyer journey are demonstrated now; production database, identity, payment, document storage, ERP and realtime integrations are the implementation layer.

Preferred wording:

> This is the interactive product prototype. It demonstrates the target operating model and user experience. Production infrastructure and integrations are connected during implementation.

Do not repeatedly describe the product as “only a demo.”

## Before the meeting

1. Open `https://karimelzoser.github.io/realestate/`.
2. Enter **Manager**.
3. Press **Reset Demo**.
4. Confirm the Manager home shows **Presentation Control** and the **Management Decision Room**.
5. If the private 6.7 local voice runtime is available, start it before the meeting. The active conversation is **English-only** for this release.
6. When the private runtime is connected, the advisor shows **LOCAL AI • CONNECTED**. Without it, the product continues with **BROWSER VOICE • READY** and typed guidance.
7. Keep the browser at 100% zoom and use a desktop viewport of at least 1366×768.

## Recommended presentation sequence

### 1. How PRENEURA Works

Explain the operating model left to right:

Buyer Direct / Broker / Sales Center → One Buyer Record + EOI → Eligibility → Online / Sales Center attendance → One Shared Queue → AI or Human assistance → Master Plan → Building → Floor → Exact Unit → Unit Lock → Transaction Operator → Contract & Sign → My Property.

Key message:

> Attendance changes the service channel. It does not create another priority truth.

### 2. Manager Overview

Show the **Management Decision Room** first. It should answer two executive questions quickly:

- What is happening in the project right now?
- Where does management need to act?

Use the drill-down KPIs to open Live Allocation, Buyer 360°, Brokers and collection attention.

### 3. Normal Allocation Day

Choose **Normal Day**.

Explain the balanced Online + Sales Center operating model and the shared queue / shared priority truth.

### 4. High Queue Pressure

Choose **Queue Pressure**.

Show:

- complete active queue depth;
- Online vs Sales Center split;
- average and longest wait;
- Human Allocator seat utilization;
- exact buyer rows and queue states;
- selected / locked unit where applicable;
- last role / user;
- latest event;
- live exceptions.

Key message:

> Management can identify pressure while the allocation event is running instead of discovering the problem in an end-of-day report.

### 5. Unit Lock Conflict

Choose **Unit Conflict**.

Show the held physical unit and the successful lock plus rejected second attempt in the audit/event history.

Key message:

> Queue position never reserves inventory. The exact-unit lock is the authoritative inventory commitment boundary.

### 6. Buyer Journey Audit

Open **Buyer Journey Audit**.

Use the presentation terminology:

- **Recorded Event** — historical action captured by PRENEURA.
- **Current State Snapshot** — current operational truth reconstructed from Buyer, EOI, queue, transaction, documents, contract and property records.

For each journey line, point out the step, timestamp, operational role, actual staff/system actor, buyer, reference and full detail.

### 7. Online AI Allocation — English-only in 6.7

Open the Online Allocation journey.

The active advisor should:

- introduce itself in English;
- guide Allocation Day → Master Plan → Building → Floor → Exact Unit;
- rank currently available units from PRENEURA inventory;
- use buyer eligibility and decision preferences;
- compare practical trade-offs such as price, area, floor and view;
- scroll and highlight the interface it is discussing;
- stop before the authoritative unit lock and require explicit buyer confirmation.

When connected, show **LOCAL AI • CONNECTED**. When the private runtime is unavailable, show **BROWSER VOICE • READY** and continue the same guided journey.

Key message:

> The AI may explain, compare, recommend, navigate and highlight. It does not silently lock inventory, confirm payment, change price, change queue priority or sign a legal contract.

### 8. Exact-unit lock grace

After an exact unit is locked, show the two-stage protection explicitly.

#### Short Handoff Grace

- starts immediately after the successful exact-unit lock;
- applies to **Online and Sales Center** buyers;
- demo default: **15 minutes**;
- protects the exact unit while Allocation hands responsibility to Transaction Operations;
- closes normally when the initial transaction handoff is completed.

#### 24h Extended Grace

It never starts automatically.

**Online buyer:**

1. Buyer requests 24h Extended Grace and gives a reason.
2. The request appears in the Transaction Operator **Grace Decision Inbox**.
3. Transaction Operator approves or rejects it.
4. If approved, a fresh 24-hour countdown begins from the approval time.

**Sales Center / Offline buyer:**

1. If approved physical paperwork cannot be finished during Short Handoff Grace, Transaction Operations may grant a **24h Paperwork Exception**.
2. Transaction Operator enters the reason.
3. A fresh 24-hour countdown begins from approval.

Key message:

> The AI cannot grant an extension, release a lock or alter queue priority. Transaction Operations owns the exception decision.

### 9. Offline Human Allocator

Open the Allocator role.

Show that PRENEURA exposes the next eligible Sales Center buyer according to the shared queue. The Allocator does not manually choose whom to serve.

Continue that assigned buyer through Master Plan → Building → Floor → Exact Unit → Lock & Handoff, then show the Short Handoff Grace.

### 10. Transaction Operator + Contract

Show:

- the shared Grace Decision Inbox;
- Online 24h request approval/rejection;
- Offline paperwork exception action;
- payment/document requirements;
- exact contract generation;
- print exact contract;
- upload returned signed/fingerprinted contract;
- biometric/fingerprint verification receipt;
- verify and complete the transaction.

### 11. My Property

Show:

- total contract value;
- amount paid;
- paid percentage;
- remaining balance;
- missed / overdue installments;
- overdue amount;
- next installment;
- per-installment amount, paid amount, amount left and status;
- contract, documents, receipts, updates and support.

### 12. Overdue Collections

Choose **Overdue Collections** from the Manager Presentation Control.

Show that collection attention appears at management level instead of being hidden inside one customer's property record.

### 13. Broker Performance

Choose **Broker Performance**.

Show company → agent → attributed buyers → EOI → sale → commission metrics.

Key message:

> Management can compare partner quality and conversion rather than evaluating brokers only by lead volume.

### 14. Buyer 360°

Search for a buyer and show the complete operational picture: identity/source, EOI, eligibility, queue state, current stage, selected/locked unit, transaction, payment/documents, contract and latest handler.

Key message:

> Management can answer “Where exactly is this buyer now?” without contacting several departments.

### 15. Phase Builder + Project Data

Show both phase-selection methods:

- Master Plan / building-oriented selection;
- searchable exact-unit table.

Show phase-specific prices and exact physical units included in the phase.

Then open **Project Data & Uploads** and explain it as the ingestion workspace for master plan, buildings, floors, units, pricing, BIM/floor plans, buyers, brokers, payment schedules and project documents.

For production implementation, explain the intended controlled import pipeline:

Upload → Map Columns → Validate → Preview Errors → Approve → Version → Publish.

## Prepared presentation scenarios

| Scenario | Purpose | Opens |
| --- | --- | --- |
| Normal Day | Balanced operating state | Manager Overview |
| Queue Pressure | Queue/capacity decision support | Live Allocation |
| Unit Conflict | Exact-unit concurrency protection | Live Allocation |
| Overdue Collections | Financial attention / installment visibility | Manager Overview |
| Broker Performance | Partner/agent performance | Brokers |
| Reset Demo | Restore clean initial in-memory state | Manager Overview |

## What is live in this prototype

Within the browser demo, the UI and operational state are functional and interactive. The Manager Live Allocation page reads the current application state, and its countdowns / queue changes update during the session.

For a production deployment, authoritative cross-device realtime state would move to the backend and be pushed to clients through server-side realtime events.

## Closing message

> PRENEURA is designed as the operating layer connecting Buyer, EOI, allocation, exact physical inventory, transaction, contract, property, installments and management intelligence. The demo shows the target operating model and user experience. Production implementation connects these interfaces to the developer's server-side identity, inventory, payment, document, ERP and realtime infrastructure.
