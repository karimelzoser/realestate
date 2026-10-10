# Runtime readiness and migration contract

PRENEURA separates **process liveness**, **traffic readiness**, and **schema migration authority**.

## API probes

- `GET /v1/health` — compatibility liveness endpoint.
- `GET /v1/health/live` — process liveness only.
- `GET /v1/health/ready` — production readiness.

`/v1/health/ready` returns HTTP 200 only when:

1. PostgreSQL is reachable; and
2. `platform_runtime_contract` exactly matches the application runtime contract.

Current contract:

- schema version: `33`
- migration marker: `0033_runtime_readiness_contract`

If PostgreSQL is unavailable, the contract table is missing, or the contract is stale, readiness returns HTTP 503. Liveness remains separate so orchestration can distinguish a live process from a safe traffic target.

## Worker startup

The worker executes the same readiness probe **before starting any background loop**. A stale or unavailable database is a fatal startup error, so a new worker binary cannot process outbox, notification, reminder, or commission jobs against an older schema.

A healthy worker emits the structured event:

```json
{"event":"worker.ready","schemaVersion":33,"migrationMarker":"0033_runtime_readiness_contract"}
```

## Production migration runner

The production migration authority is:

```bash
pnpm --filter @preneura/database build
pnpm --filter @preneura/database migrate
```

The runner:

- takes a PostgreSQL advisory lock so only one release migration process can run;
- discovers migrations in lexical/version order;
- requires a contiguous migration sequence;
- validates that the latest file matches the application runtime contract;
- computes SHA-256 for every migration;
- stores immutable migration history in `platform_schema_migrations`;
- rejects edited already-applied migrations;
- applies each pending migration in its own transaction;
- verifies the final runtime contract before success.

### Check mode

```bash
pnpm --filter @preneura/database migrate:check
```

`migrate:check` performs no schema mutation. It fails if migrations are pending, history checksums drift, or the runtime contract is incompatible.

### Existing pre-runner environments

For an environment that was previously migrated manually and is already proven to match the complete runtime contract, migration history can be adopted once with:

```bash
pnpm --filter @preneura/database migrate:baseline
```

This command is deliberately strict:

- migration history must be empty;
- the current database must already satisfy the exact runtime contract;
- the command records repository checksums without re-executing migrations.

Do not use baseline as a way to skip failed or partial migrations.

## Deployment order

1. Create and verify a pre-deploy database backup / PITR checkpoint.
2. Run the migration job exactly once for the release.
3. Run `migrate:check` against the target database.
4. Deploy API instances.
5. Route traffic only after `/v1/health/ready` returns HTTP 200.
6. Deploy/start workers only after migration success.
7. Deploy web and notification gateway services.
8. Run post-deploy smoke checks and business probes.

Normal API/worker startup **never runs migrations implicitly**.

## Rollback policy

Database rollback is not automatic. Once a migration has reached production, prefer a forward-fix migration.

Application rollback is allowed only when the older binary is compatible with the current database. An incompatible older API/worker must fail its readiness/startup contract instead of serving traffic.

## Railway

Use `/v1/health/ready` as the API service health/readiness path. Do not route traffic using `/v1/health/live`.

Run migrations as a release/pre-deploy job, not independently in every API replica. A migration command must complete successfully before API/worker rollout proceeds.
