# Inventory lock durability

Inventory locks are authoritative database state. Browser timers are presentation only and never decide whether saleable capacity is available.

## State machine

A new lock begins in `ACTIVE` and may transition exactly once to one terminal state:

- `RELEASED` — explicit operational release;
- `EXPIRED` — TTL reached;
- `CONVERTED` — atomically consumed by reservation creation.

Terminal states cannot be reopened or rewritten. PostgreSQL enforces this independently of API code.

## Durable expiry authority

`preneura_expire_inventory_locks(limit, now)` is the canonical expiry command. It:

1. selects overdue `ACTIVE` locks by `expires_at`;
2. uses `FOR UPDATE SKIP LOCKED` so multiple workers may sweep concurrently;
3. transitions only rows that are still `ACTIVE` and overdue;
4. records canonical `TTL_EXPIRED` release evidence;
5. returns the number of transitions performed.

The dedicated worker calls this function continuously in bounded batches. Expiry therefore continues when no buyer, manager, or allocator has the site open and resumes after worker/process restarts.

The commercial API's lazy expiry remains a defensive fallback. Database triggers make its transition semantics and emitted evidence identical to worker expiry.

## Realtime and audit evidence

Every `ACTIVE -> EXPIRED` transition emits exactly one transactional outbox event:

`inventory.lock.expired`

The event includes the lock, unit type, internal inventory slot, buyer when assigned, original expiry time, actual expiry time, locking actor, and canonical reason. Realtime delivery remains signal-only: clients receive the normal project event signal and refetch the authorized catalog snapshot.

## Reservation race behavior

Reservation conversion and expiry both row-lock the same inventory lock.

- If reservation conversion wins first, it changes the lock to `CONVERTED`; the expiry sweep cannot touch it.
- If expiry wins first, reservation conversion sees a non-active lock and rejects the reservation.

There is no interval in which one physical capacity slot can be both expired/reallocated and successfully converted by a second transaction.

## Worker configuration

- `INVENTORY_LOCK_EXPIRY_SCAN_MS` — delay between sweeps. Production validator accepts 100–60000 ms; default is 1000 ms.
- `INVENTORY_LOCK_EXPIRY_BATCH_SIZE` — maximum rows claimed per sweep, 1–5000; default is 500.

The worker polling sleep is interruptible. SIGTERM/SIGINT wakes sleeping loops immediately, lets any in-flight database call finish, destroys the database client, and exits without waiting for long reminder intervals.

## Certification

`Gate 2 Inventory Lock Durability Certification` proves:

- bounded expiry is idempotent;
- future locks remain active;
- converted locks are never expired;
- terminal states cannot be rewritten;
- exactly one outbox event is emitted per expiry;
- two concurrent sweepers expire each overdue lock once;
- a worker expires overdue locks without API/browser traffic;
- expiry resumes correctly after the worker is killed and restarted;
- schema/runtime readiness advances with the durability migration.
