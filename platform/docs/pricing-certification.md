# PRENEURA Gate 2 Pricing Certification

This document defines the production pricing invariants required by Release Gate 2.

## Authoritative formula

A unit-type price is the sum of exactly three priced components:

```text
INDOOR = indoor area snapshot × indoor rate per m²
ROOF   = roof / terrace area snapshot × roof rate per m²
GARDEN = garden area snapshot × garden rate per m²
TOTAL  = round(INDOOR + ROOF + GARDEN, 2)
```

PostgreSQL function:

`calculate_unit_type_price(pricing_version_id, unit_type_id)`

returns the canonical total only when all three components exist exactly once.

Zero-area components are still represented explicitly. This keeps every certified quote structurally identical and prevents a missing rate from being mistaken for a zero-area component.

## Pricing-version area snapshots

`pricing_rates.area_sqm` snapshots the unit-type area associated with each component when a draft rate is created.

For a DRAFT version, changing the unit-type indoor/roof/garden area refreshes the matching draft rate snapshots. Once any pricing version using that unit type leaves DRAFT, priced geometry is protected from in-place mutation so published historical pricing cannot be rewritten indirectly.

Published/scheduled pricing version identity and effective terms are immutable. Rates belonging to a non-DRAFT pricing version cannot be inserted, updated or deleted.

A commercial change therefore requires a new pricing version rather than editing historical rates.

## Reservation quote certification

Every new reservation must have:

- a pricing version;
- a quoted total;
- project currency;
- a pricing version that was published and effective at `reserved_at`;
- a quoted total equal to the canonical PostgreSQL pricing function.

The database rejects the reservation if any condition is false, even if application code attempts to insert it.

After insertion, PostgreSQL automatically creates exactly three immutable rows in `reservation_price_components`:

- component;
- area snapshot;
- rate per m²;
- component amount.

The sum of the three component amounts reconciles to `reservations.quoted_total`.

Reservation pricing version, unit type, quoted total and currency cannot be edited after creation. Component rows cannot be updated or deleted.

## Later price publications

Publishing a later price version does not change an existing reservation.

The historical reservation retains:

- original `pricing_version_id`;
- original `quoted_total`;
- original area snapshot per component;
- original rate per component;
- original component amount.

This is the commercial evidence used by transaction, contract and finance flows.

## Authenticated quote projection

Authorized transaction readers can retrieve:

`GET /v1/tenants/:tenantId/projects/:projectId/transactions/:transactionId/price-snapshot`

The endpoint reuses the existing transaction-read authorization boundary, including:

- buyer self-scope;
- project staff permissions;
- broker company scope;
- broker-agent own-buyer scope.

The response contains the immutable unit type, pricing version, effective timestamp, reservation timestamp, total and three line items.

The production transaction page renders this as **Reservation price breakdown** before operational finance setup.

## Executable certification

`platform/packages/database/tests/gate2_pricing_certification.sql` is not a fixture-only smoke test. It certifies production behavior inside a transaction and rolls its test data back.

It proves:

1. a fixed known pricing case returns the exact expected total;
2. 25 varied area/rate cases match the mathematical formula;
3. pricing rates snapshot the correct component areas;
4. a real reservation chain produces exactly three price-component rows;
5. component amounts reconcile exactly to the reservation total;
6. a later pricing version changes live pricing without changing the old reservation;
7. a mismatched reservation quote is rejected;
8. a locked reservation total cannot be edited;
9. a published pricing rate cannot be edited;
10. priced geometry used by published pricing cannot be edited in place;
11. frozen reservation price components cannot be edited.

## CI

`.github/workflows/pricing-certification.yml`:

- starts PostgreSQL 18;
- applies every production migration from zero;
- verifies pricing functions/tables/triggers exist;
- executes the Gate 2 certification SQL.

The workflow is triggered by changes to:

- database migrations;
- the pricing certification test;
- the quote contract;
- catalog API code;
- sales/transaction API code;
- transaction workspace UI;
- the certification workflow itself.

This runs in addition to the normal production foundation build and full Chromium regression workflow.

## Gate 2 result

With this certification slice plus the preceding project hierarchy/import and atomic allocation work, Gate 2 has executable evidence for:

- deterministic pricing;
- complete price components;
- published pricing immutability;
- reservation quote immutability after later publication;
- atomic inventory locking;
- internal physical-unit integrity;
- controlled project/import publication.

The next launch-critical certification boundary is Gate 3: transaction/document/contract and financial consistency.
