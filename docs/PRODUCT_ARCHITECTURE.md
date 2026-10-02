# PRENEURA Product Architecture

## Roles

1. Buyer
2. Queue Receptionist
3. Allocator
4. Transaction Operator
5. Broker
6. Manager

## Channel and allocation model

### Entry channels

- Buyer Direct
- Broker
- Sales Center

All entry channels resolve to one authoritative Buyer Record + EOI.

### Attendance

- Online
- Sales Center / Offline

Attendance changes the service channel, not queue priority.

### Shared queue

Online and offline buyers participate in one shared queue and use one priority engine.

Example demo:
- #233 — Offline / Sales Center
- #234 — Online

Both are part of the same ordered queue.

### Allocation assistance

- Online buyer: PRENEURA AI Allocation Advisor
- Offline buyer: Human Allocator

Both use the same live inventory, unit hierarchy, exact-unit selection state, and lock engine.

### Exact-unit journey

Master Plan -> Building -> Floor -> Exact Unit -> Unit Lock

### Completion

Unit Lock -> Transaction Operator -> Payment / Documents / Finance -> Contract & Sign -> My Property

## Manager control

Manager governs:
- Rules
- Pricing
- Capacity
- Permissions
- Integrations
- Live monitoring
- Exceptions / audit

## Interaction rules

### Flowchart OPEN

A direct system-map preview should open the specific page immediately for demo inspection.

### ROLE

Entering through a role must preserve real role permissions, login state, eligibility gates, queue state, and transactional restrictions.

## AI advisor

The online AI advisor should:
- support English and Egyptian Arabic
- detect language automatically
- be low-latency and conversational
- explain current state and next action
- highlight relevant controls
- navigate between buyer pages
- compare units and help the buyer decide
- invoke safe reversible actions

It must not silently:
- lock a unit
- confirm payment
- sign a legal contract
- override price / permissions / queue priority
