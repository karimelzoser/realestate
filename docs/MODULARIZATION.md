# Modularization Foundation

## Purpose

PRENEURA grew through rapid additive revisions in one large standalone HTML file. That file remains the stable demo baseline, but new work should no longer be appended to it.

The repository now has two runtime paths:

- `app/index.html` — stable standalone baseline (Rev 6.1.6)
- `index.html` — modular development entry. It loads the stable application shell, removes the currently-active inline Rev 6.0.7–6.1.6 overlay blocks at runtime, and replaces them with source modules under `src/`.

This lets us continue improving the product without rewriting the proven legacy core all at once.

## Active modules

### `src/features/live-allocation/`
Owns the shared-queue / live Allocation Day demo, #233 Offline + #234 Online example, allocator-seat visualization, and horizontal-flow support.

### `src/core/flow-navigation.*`
Owns navigation semantics:
- **OPEN** = direct page preview for demo inspection
- **ROLE** = real role workflow with permissions, login, eligibility, queue, and transaction restrictions

### `src/features/buyer-experience/`
Owns the current online AI allocation advisor, bilingual English/Egyptian-Arabic experience, My Property post-sale experience, examples, and buyer-facing enhancements.

### `src/features/how-it-works/`
Owns the route audit and current Metro-style How PRENEURA Works experience.

## Migration rule

Do not rewrite the 2 MB legacy core in one step. Extract one stable domain at a time behind the same page IDs / public globals, verify parity, then delete the superseded legacy implementation.

Recommended extraction order:

1. Shared state and demo data
2. Router and role permissions
3. Buyer pages
4. Queue Receptionist
5. Allocator
6. Transaction Operator
7. Broker
8. Manager
9. Shared UI components
10. Remove obsolete revision blocks

## Non-regression contracts

- Online and offline buyers use one shared queue and one priority engine.
- #233 Offline and #234 Online are a standard demo example of that shared queue.
- Online buyer assistance = bilingual AI Allocation Advisor.
- Offline buyer assistance = Human Allocator.
- Both assistance paths converge on the same live inventory, exact-unit selection, and unit-lock engine.
- Unit Lock is the authoritative inventory reservation boundary.
- Transaction Operator owns payment, documents, finance, and contract readiness.
- My Property remains functional: property details, installments, contract, documents, receipts, updates, and support.
- AI may explain, compare, navigate, highlight, and take safe/reversible actions, but must not silently commit final unit lock, payment confirmation, or legal signing.
