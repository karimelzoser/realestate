# PRENEURA Real Estate OS

Persistent source repository for the PRENEURA Real Estate Operating System prototype.

## Current baseline

- Product: PRENEURA Real Estate OS
- Current prototype baseline: Rev 6.1.6
- Main experience: Metro-style "How PRENEURA Works" system overview
- Core operating model:
  - Buyer Direct / Broker / Sales Center entry
  - One Buyer Record + EOI
  - Eligibility gate
  - Online / Sales Center attendance split
  - One Shared Queue
  - Parallel allocation capacity
  - Online buyer -> AI Allocation Advisor
  - Offline buyer -> Human Allocator
  - Exact Unit Selection
  - Unit Lock
  - Transaction Operator
  - Contract & Sign
  - My Property / installments / documents / support

## Repository strategy

`main` is the stable demo baseline.

Future changes should be made in focused branches / pull requests so the current working demo remains recoverable.

## Structure

- `app/index.html` — current integrated demo
- `docs/PRODUCT_ARCHITECTURE.md` — product and role model
- `docs/WORKING_RULES.md` — implementation rules for future changes
- `archive/` — milestone snapshots when needed

## Important product boundaries

- PRENEURA is authoritative for queue, exact-unit inventory, locks, payment state, contract state, and audit.
- AI can explain, recommend, navigate, highlight, and perform safe actions.
- AI must not silently commit legal/financial actions such as unit lock or final contract signature.
- Direct preview from the system map may bypass demo prerequisites.
- Entering via a real role must preserve that role's permissions and workflow restrictions.
