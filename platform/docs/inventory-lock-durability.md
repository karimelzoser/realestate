# Inventory lock durability

Inventory locks are authoritative PostgreSQL state. Browser timers are presentation only and never decide whether saleable capacity is available.

## State machine

A lock begins in `ACTIVE` and may transition exactly once to one terminal state:

- `RELEASED` — explicit operational release;
- `EXPIRED` — TTL reached;
- `CONVERTED` — atomically consumed by reservation creation.

Terminal states cannot be reopened or rewritten. PostgreSQL enforces this independently of API code.

## Canonical schema integration

Durable expiry is canonical migration `0041_inventory_lock_expiry_durability`, layered after the Gate 5 allocator authority introduced by migration `0040`.

This ordering matters. Migration 40 already owns allocator queue reconciliation: if the assigned allocator's lock changes from `ACTIVE` to `RELEASED` or `EXPIRED`, the queue entry returns from `LOCKED` to `CALLED` and its `allocation_lock_id` is cleared. The background expiry sweep therefore releases capacity and restores the allocator workflow through the same database transition used by explicit release.

## Durable expiry authority

`preneura_expire_inventory_locks(limit, now)` is the canonical expiry command. It:

1. selects overdue `ACTIVE` locks by `expires_at`;
2. uses `FOR UPDATE SKIP LOCKED` so multiple workers may sweep concurrently;
3. transitions only rows that are still `ACTIVE` and overdue;
4. records canonical `TTL_EXPIRED` release evidence;
5. returns the number of transitions performed.

The dedicated worker calls this function continuously in bounded batches. Expiry therefore continues when no buyer, manager, or allocator has the site open and resumes after worker/process restarts.

Request-time cleanup may still discover an overdue lock defensively, but availability no longer depends on a request arriving.

## Capacity model

An inventory slot remains internally `AVAILABLE` while it is merely being held; the active lock is the exclusivity authority. Saleable capacity therefore means an available slot with no active lock. Once an overdue lock becomes `EXPIRED`, the slot is immediately eligible for a later lock without rewriting physical inventory history.

A reservation converts the lock and moves the internal capacity into the reservation/sale path. Buyers continue to choose unit types; exact physical capacity remains internal.

## Realtime and audit evidence

Every `ACTIVE -> EXPIRED` transition emits exactly one transactional outbox event:

`inventory.lock.expired`

The event records the lock, unit type, internal inventory slot, assigned buyer when present, original expiry time, actual expiry time, locking actor and canonical reason. Realtime delivery remains signal-only: clients receive the normal project event signal and refetch the authorized catalog snapshot.

## Reservation race behavior

Reservation conversion and expiry both serialize on PostgreSQL row locks.

- If reservation conversion wins first, it changes the lock to `CONVERTED`; the expiry sweep cannot touch it.
- If expiry wins first, reservation conversion sees a non-active lock and rejects the reservation.

There is no interval in which one physical capacity slot can be both expired/reallocated and successfully converted by a second transaction.

## Worker configuration

- `INVENTORY_LOCK_EXPIRY_SCAN_MS` — delay between sweeps. Production validator accepts 100–60000 ms; default is 1000 ms.
- `INVENTORY_LOCK_EXPIRY_BATCH_SIZE` — maximum rows claimed per sweep, 1–5000; default is 500.

The expiry loop is wrapped by the same OpenTelemetry span/worker-loop metrics as other production jobs.

Worker polling sleeps are interruptible. SIGTERM/SIGINT wakes sleeping loops immediately, lets an in-flight database call finish, destroys the database client and exits without waiting for long reminder intervals.

## Certification

`Gate 2 Inventory Lock Durability Certification` proves:

- bounded expiry is idempotent;
- future locks remain active;
- converted locks are never expired;
- terminal states cannot be rewritten;
- exactly one outbox event is emitted per expiry;
- two concurrent sweepers expire each overdue lock once;
- a worker expires overdue locks without API/browser traffic;
- expiry resumes correctly after worker restart;
- worker shutdown leaves no PostgreSQL sessions behind;
- schema/runtime readiness advances with canonical migration 41.
