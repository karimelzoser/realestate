# Modularization Foundation

## Purpose

PRENEURA grew through rapid additive revisions in one large standalone HTML file. That file remains the stable demo baseline, but new work should no longer be appended to it.

The repository now has two runtime paths:

- `app/index.html` — stable standalone baseline (Rev 6.1.6)
- `index.html` — modular development entry. It loads the stable application shell, removes the extracted active inline blocks at runtime, and replaces them with source modules under `src/`.

This gives us a safe migration path: the known-good standalone build stays recoverable while active development moves into maintainable source files.

## Extracted now

### `src/core/product-model.js`

Canonical metadata and policy contract for:
- six user roles and their responsibilities
- How It Works stage/page routing
- one-shared-queue policy
- #233 Offline / #234 Online demonstration
- Human Allocator vs AI Allocation Advisor responsibility
- OPEN preview vs ROLE-restricted navigation semantics
- irreversible-action confirmation boundaries

This is deliberately a product/domain contract rather than another UI revision. Extracted features can now consume the same definitions instead of hard-coding them independently.

### `src/features/live-allocation/`
Owns the shared-queue / Live Allocation Day example, including:
- #233 Offline / Sales Center
- #234 Online
- one ordered queue
- one priority engine
- parallel service capacity
- allocator-seat visualization

### `src/core/flow-navigation.*`
Owns navigation semantics:
- **OPEN** = direct page preview for demo inspection
- **ROLE** = real role workflow with permissions, login, eligibility, queue, and transaction restrictions
- **How It Works** = stable return path to the system overview

### `src/features/buyer-experience/`
Owns the current Buyer-facing active enhancement layer:
- professional bilingual English + Egyptian-Arabic AI Allocation Advisor
- voice / typed guidance and safe navigation actions
- screen highlighting and decision assistance
- functional My Property portfolio
- property details
- installment schedule
- contract / documents / receipts
- updates and support
- buyer-facing flow examples

### `src/features/how-it-works/`
Owns:
- Metro-style How PRENEURA Works view
- flow route audit examples
- role/system/rule/outcome map semantics
- direct page destinations from the flow

## Still in the stable shell for now

The older core page implementations, shared state, router, and role workspaces remain in `app/index.html`. They will be extracted incrementally only after the active experience layers are parity-tested.

## Migration rule

Do not rewrite the 2 MB legacy core in one step. Extract one stable domain at a time behind the same page IDs / public globals, verify parity, then delete the superseded legacy implementation.

Recommended next extraction order:

1. Shared app state and demo data
2. Router implementation (using the new product contract)
3. Role permission enforcement
3. Buyer core pages
4. Queue Receptionist
5. Allocator
6. Transaction Operator
7. Broker
8. Manager
9. Shared UI components
10. Remove obsolete historical revision blocks

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
