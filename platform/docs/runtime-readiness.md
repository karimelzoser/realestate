# Runtime readiness and schema compatibility

PRENEURA separates **process liveness** from **traffic readiness** so orchestration does not send production traffic to a process that is alive but cannot safely use PostgreSQL.

## API probes

The API exposes:

```text
GET /v1/health
GET /v1/health/live
GET /v1/health/ready
```

`/v1/health` and `/v1/health/live` are liveness probes. They prove only that the API process is running and able to answer HTTP.

`/v1/health/ready` is the production traffic gate. It performs a PostgreSQL connectivity check and validates the database runtime contract. It returns HTTP `200` only when the running application version is compatible with the database schema. Otherwise it returns HTTP `503` with a bounded machine-readable failure code; raw database errors are not exposed.

Railway or any reverse proxy/load balancer should use:

```text
/v1/health/ready
```

as the API health/readiness path.

## Database runtime contract

Migration `0033_runtime_readiness_contract.sql` creates the singleton `platform_runtime_contract` record with:

- `schema_version` — current database schema generation;
- `minimum_runtime_version` — oldest application runtime that is still compatible with this schema;
- `migration_marker` — human/audit marker for the migration that advanced the contract.

The application currently identifies itself as runtime schema version `33`.

Readiness succeeds when:

```text
database schema version >= application runtime schema version
AND
minimum compatible runtime version <= application runtime schema version
```

When the database schema version equals the runtime schema version, the migration marker must also match the runtime's expected marker.

The database prevents deleting the runtime contract, decreasing `schema_version`, decreasing `minimum_runtime_version`, or changing a migration marker without advancing the schema version.

## Rolling deployment rule

For an additive/backward-compatible migration, advance `schema_version` but leave `minimum_runtime_version` at the oldest runtime that can still safely operate. This lets old and new API/worker instances overlap during a rolling deployment.

Example for an additive schema 34 migration while runtime 33 remains compatible:

```sql
UPDATE platform_runtime_contract
SET schema_version = 34,
    minimum_runtime_version = 33,
    migration_marker = '0034_additive_change',
    updated_at = now()
WHERE singleton_key = 'production';
```

Runtime 33 remains ready while runtime 34 instances roll out.

For a breaking migration, use an **expand/contract** deployment. First deploy code that can operate against both representations, migrate/backfill data, drain old runtime instances, and only then advance `minimum_runtime_version`. Raising the minimum runtime is the explicit switch that makes older processes fail readiness and prevents them from processing background work.

## Worker startup

The worker has no public HTTP port. Before starting any outbox, notification, reminder, or commission loop it executes the same database/runtime compatibility probe used by API readiness.

A stale or incompatible database therefore causes the worker process to exit non-zero before it can claim jobs or mutate operational projections.

## Rollback behavior

Application rollback is allowed only when the rollback runtime version is still greater than or equal to `minimum_runtime_version`.

Database schema downgrades are intentionally not part of the production rollback procedure. If a migration is incorrect, create a forward repair migration. This avoids destructive down-migrations against live transactional, document, finance, and audit data.

A breaking migration must not raise `minimum_runtime_version` until the previous runtime is intentionally no longer a supported rollback target.

## Failure codes

The readiness layer uses bounded failure codes:

- `DATABASE_UNAVAILABLE` — PostgreSQL cannot be reached;
- `SCHEMA_CONTRACT_MISSING` — the runtime contract table/row is absent;
- `SCHEMA_TOO_OLD` — the database has not been migrated far enough for this runtime;
- `RUNTIME_VERSION_TOO_OLD` — the database has advanced beyond compatibility with this runtime;
- `SCHEMA_CONTRACT_MISMATCH` — same-version migration identity does not match the application expectation.

## Executable certification

The reusable executable is:

```text
platform/scripts/certify-runtime-readiness.sh
```

It is called by `.github/workflows/runtime-readiness-certification.yml` after a frozen dependency install and deployable API/worker build.

The certification proves:

1. current schema returns API readiness `200`;
2. pre-contract/stale schema keeps liveness `200` but readiness `503`;
3. worker exits before loops on stale schema;
4. worker starts on current schema;
5. additive future schema remains compatible with the current runtime;
6. a future schema that raises `minimum_runtime_version` rejects the old runtime;
7. the runtime contract cannot be deleted or moved backwards;
8. strict TypeScript and the complete deployable API/worker dependency graph build successfully;
9. the emitted API process reaches Nest startup and resolves its runtime module/dependency graph before readiness is accepted.

The script can also be run against an isolated PostgreSQL 18 instance outside GitHub Actions after the production workspace is built. It creates and destroys only its named certification databases and does not target a production database.
