# Gate 6 performance and resilience certification

This Gate 6 slice certifies bounded algorithmic performance and recovery behavior in disposable GitHub Actions infrastructure. It deliberately does **not** claim deployed production capacity, final requests/second, p95/p99 API latency, maximum SSE connections, or final database sizing. Those values depend on the real staging/production topology and belong to Gate 7 load/go-live evidence.

## Why this gate exists

PRENEURA already has correctness certification for its highest-risk contention paths. Gate 6 adds two additional release properties:

1. a severe performance regression in those algorithms must fail CI instead of remaining merely "correct but unusably slow";
2. durable workers must recover from representative crash/provider-failure states without duplicate delivery, stuck claims, or infinite retry.

## Migration freshness

The concurrency workflow no longer hard-codes a migration count.

After the production migration runner completes it derives the expected migration set from `packages/database/migrations`, then proves that the append-only `platform_schema_migrations` ledger has:

- the same number of migrations;
- the same latest migration filename;
- the same latest numeric version.

This keeps the non-functional gate valid as the schema evolves.

## CI performance guardrails

The existing high-contention scenarios still have their hard 60-second deadlock timeout. Gate 6 additionally applies deliberately generous per-batch regression budgets:

- database contention batch: `GATE6_DB_BATCH_BUDGET_MS=45000`;
- compiled worker 100-job contention batch: `GATE6_WORKER_BATCH_BUDGET_MS=30000`;
- worker recovery/provider-failure drill: `GATE6_RESILIENCE_BUDGET_MS=15000`.

These numbers are **CI guardrails**, not service-level objectives. A batch exceeding them indicates a major regression or deadlock-risk change that requires investigation before merge.

The database contention batches remain:

- 500 overlapping inventory lock attempts against one slot;
- 100 queue dispatch attempts against 50 buyers;
- concurrent finance allocation to exact contractual capacity;
- concurrent reversal/compensation to exact original-receipt capacity;
- 100 replays of one provider payment event.

The worker contention batch remains 100 due notification jobs processed by eight compiled worker dispatchers, with exactly-once materialization assertions.

## Worker resilience drill

`apps/worker/scripts/resilience-certification.mjs` runs the compiled production notification worker functions against PostgreSQL 18.

### Simulated worker crash / stale claim

The fixture inserts one job already in `PROCESSING`, with a claim timestamp older than the production five-minute stale threshold and a dead worker ID.

Required result:

- the stale claim is reclaimed;
- the job is delivered once;
- exactly one user notification is materialized;
- the new recovery attempt is recorded;
- claim fields are cleared after success.

### Transient external provider outage

A local deterministic HTTP server returns `503` for a WhatsApp job on attempt one.

Required result:

- the job returns to `PENDING`;
- attempt count increments once;
- `scheduled_for` moves into the future according to production exponential backoff;
- provider failure evidence is retained;
- the worker claim is released.

### Terminal external provider outage

A second job starts at attempt four and receives the same deterministic provider `503`.

Required result:

- attempt five is recorded once;
- job state becomes terminal `FAILED`;
- no processing claim remains;
- the provider error remains auditable.

## What Gate 7 still must measure

Before go-live, the deployed staging topology must separately measure and approve:

- API throughput and p50/p95/p99 latency under expected and burst traffic;
- exact-unit lock latency during realistic launch contention;
- SSE connection capacity/reconnect behavior;
- PostgreSQL CPU, IOPS, connection pool and lock-wait behavior;
- worker/outbox/notification drain rate at expected peaks;
- object storage and scanner latency;
- WhatsApp/SMS/email and payment-provider real-network behavior;
- WAF/rate-limit behavior;
- managed PITR and object-version recovery timings.

No GitHub-hosted runner result should be represented as evidence for those infrastructure-specific production capacities.
