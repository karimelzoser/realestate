# PRENEURA High-Contention Concurrency Certification

This document defines the Release Gate 6 concurrency contract for operations where duplicate ownership, overselling or duplicated money would be unacceptable.

The certification is correctness-first. GitHub-hosted runner timing is noisy, so CI does not treat raw throughput as a production capacity SLA. Production/staging load tests must separately measure latency and sustainable throughput on the chosen infrastructure.

## Certified authorities

### Inventory lock

Buyer-facing inventory is sold by unit type while PRENEURA atomically chooses one internal available slot.

The production lock transaction selects one candidate with:

- `FOR UPDATE SKIP LOCKED`;
- `state='AVAILABLE'`;
- no existing active lock;
- deterministic slot ordering.

Certification issues 500 overlapping lock attempts against exactly one available slot through a 100-connection pool.

Required result:

- exactly one attempt creates an active lock;
- 499 attempts return no candidate rather than duplicating the slot;
- one active lock exists for exactly one internal slot.

### Queue call-next

Reception/allocation dispatch uses row locking and `SKIP LOCKED` in the production priority order:

1. VIP;
2. Recovery;
3. Standard;
4. priority score descending;
5. check-in time ascending;
6. stable ID tie-break.

Certification creates 50 waiting buyers and issues 100 overlapping call-next attempts.

Required result:

- exactly 50 rows are claimed;
- all returned IDs are unique;
- every certification queue row ends `CALLED` once;
- no buyer is dispatched to two operators.

### Payment allocation

Payment schedule items are ledger projections. The allocation guard locks the schedule item row before computing available capacity.

Certification submits 54 overlapping 2,500 EGP receipts to one 132,500 EGP installment.

Required result:

- 53 receipts commit;
- one over-allocation is rejected;
- paid amount is exactly 132,500 EGP;
- the item ends `PAID`;
- every committed payment event has exactly two balanced ledger postings.

### Payment compensation/reversal

Compensating events lock the original receipt and original allocation before evaluating remaining reversible capacity.

Certification races 20 reversals of 10,000 EGP against one original 100,000 EGP receipt.

Required result:

- exactly 10 reversals commit;
- the other 10 are rejected;
- aggregate compensation is exactly 100,000 EGP;
- paid projection never becomes negative;
- original payment evidence remains immutable.

### Provider replay/idempotency storm

Provider ingress owns a unique `(provider, provider_event_id)` inbox identity. The inbox row is locked before processing; a processed replay returns the original internal payment event.

Certification sends 100 overlapping copies of the same normalized provider event.

Required result:

- every caller resolves successfully;
- all callers receive the same internal payment event ID;
- exactly one provider inbox row exists;
- exactly one finance payment event exists;
- only one balanced ledger pair is created for the provider event.

### Multi-worker notification claiming

The compiled production worker function `dispatchNotifications()` claims due jobs in a transaction using `FOR UPDATE SKIP LOCKED` and changes them to `PROCESSING` before delivery.

Certification inserts 100 due `IN_APP` jobs and invokes eight compiled worker dispatchers concurrently.

Required result:

- all 100 jobs become `SENT`;
- every job has `attempts=1`;
- exactly 100 user-notification rows exist;
- exactly 100 delivery-attempt rows exist;
- maximum attempt number is 1;
- no row remains claimed/processing.

## CI execution model

`.github/workflows/concurrency-certification.yml` uses:

- PostgreSQL 18;
- the committed pnpm lockfile and frozen install;
- all 33 migrations through the production migration runner;
- the already-certified persistent commercial/legal/finance seed;
- up to 100 PostgreSQL pool connections and hundreds of overlapping promises;
- the compiled worker implementation for notification claiming.

Each contention batch is bounded by a 60-second deadlock timeout. Timeout is treated as certification failure.

## What this proves

The gate is designed to prove safety under contention:

- no double allocation of one slot;
- no duplicate queue dispatch;
- no overpayment allocation;
- no over-reversal/refund;
- no duplicate provider money event;
- no duplicate worker claim/delivery attempt.

These invariants are database-backed and do not rely on browser timing or a single API instance.

## What this does not prove

This certification is not the final capacity benchmark. It does not establish:

- production requests/second;
- final p95/p99 latency;
- maximum SSE connections;
- maximum concurrent buyer sessions;
- database sizing;
- provider-network capacity.

Those values depend on deployed compute/database/network topology and must be measured in the staging performance rehearsal before Gate 7.

## Gate 7 staging performance rehearsal

Before go/no-go, run the same safety assertions while measuring the deployed system under representative traffic, including:

- concurrent catalog readers;
- launch-day unit-type lock bursts;
- queue receptionist/allocator activity;
- transaction document/finance reads;
- provider webhook replay storms;
- notification worker backlog drain;
- authenticated SSE connections.

Record p50/p95/p99 latency, error rate, PostgreSQL CPU/IO/connections/lock waits, application CPU/memory, worker backlog, and provider latency. Capacity thresholds must be based on expected project launch traffic plus agreed safety margin.
