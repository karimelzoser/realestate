# Runtime readiness, migrations, and schema compatibility

PRENEURA separates **process liveness** from **traffic readiness** so orchestration does not send production traffic to a process that is alive but cannot safely use PostgreSQL.

## Supported production release order

Production uses one explicit sequence:

```text
build immutable release
        ↓
run one migration/release job
        ↓
wait for migration success
        ↓
start/roll API instances
        ↓
/v1/health/ready = 200
        ↓
admit traffic
        ↓
start/roll workers
```

The API and worker do **not** auto-run migrations. This avoids horizontally scaled processes racing to change schema at process startup.

The supported migration command is:

```bash
pnpm --filter @preneura/database migrate
```

It uses the same `DATABASE_URL` as the runtime.

## Migration authority

`@preneura/database migrate` is an advisory-locked, checksum-verifying migration runner.

It:

- loads only sequential `NNNN_name.sql` files;
- requires migration versions to be contiguous;
- hashes the original migration file with SHA-256;
- acquires one PostgreSQL advisory lock so concurrent release jobs serialize;
- records immutable migration identity in `platform_schema_migrations`;
- makes recorded migration history append-only in PostgreSQL; UPDATE/DELETE are rejected;
- executes each migration body and its migration-history row in the same migrator-owned transaction;
- rejects a historical migration whose filename or checksum no longer matches the applied record;
- is idempotent when rerun against a fully migrated database.

Historical migration files are append-only release artifacts. Fix a production defect with a new forward migration; do not edit an applied SQL file.

### Existing database adoption

Databases created before the migration runner was introduced do not have `platform_schema_migrations` history. There is one controlled transition path:

1. bring the legacy database to the exact current certified schema, including every migration present in the immutable release artifact;
2. verify `/v1/health/ready` against that schema;
3. run once:

```bash
MIGRATION_ADOPT_EXISTING=true \
MIGRATION_ACTOR=legacy-baseline \
pnpm --filter @preneura/database migrate
```

Adoption is refused unless the runtime contract exactly matches the latest migration version and marker. It records the current migration set as `ADOPTED` with checksums; it does not rerun the SQL.

`MIGRATION_ADOPT_EXISTING=true` must **not** remain configured after this one-time baseline. Every later release uses normal `migrate` mode.

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

Migration `0033_runtime_readiness_contract.sql` introduced the singleton `platform_runtime_contract` record. Later migrations advance that same monotonic contract.

The current canonical candidate is runtime schema version **41** with marker:

```text
0041_inventory_lock_expiry_durability
```

The contract contains:

- `schema_version` — current database schema generation;
- `minimum_runtime_version` — oldest application runtime that is still compatible with this schema;
- `migration_marker` — human/audit marker for the migration that advanced the contract.

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

For example, if schema 42 is additive while runtime 41 remains compatible:

```sql
UPDATE platform_runtime_contract
SET schema_version = 42,
    minimum_runtime_version = 41,
    migration_marker = '0042_additive_change',
    updated_at = now()
WHERE singleton_key = 'production';
```

Runtime 41 remains ready while runtime 42 instances roll out.

For a breaking migration, use an **expand/contract** deployment. First deploy code that can operate against both representations, migrate/backfill data, drain old runtime instances, and only then advance `minimum_runtime_version`. Raising the minimum runtime is the explicit switch that makes older processes fail readiness and prevents them from processing background work.

## Worker startup

The worker has no public HTTP port. Before starting any outbox, notification, reminder, commission, or inventory-lock-expiry loop it validates production configuration and executes the same database/runtime compatibility probe used by API readiness.

A stale or incompatible database therefore causes the worker process to exit non-zero before it can claim jobs or mutate operational projections.

Inventory-lock expiry is a required durable worker responsibility. The database function `preneura_expire_inventory_locks` owns the transition; worker polling only determines how quickly an already-expired hold is reconciled. See `inventory-lock-durability.md`.

## Production configuration fail-closed rule

When `NODE_ENV=production`, startup validates required security/runtime configuration before serving or processing work.

The API validates, among other requirements:

- PostgreSQL URL;
- HTTPS browser origin;
- authentication/session/HMAC/encryption secrets;
- gateway OTP mode and verification gateway URLs;
- Google OIDC issuer/client/redirect configuration;
- object-storage bucket/endpoint shape;
- malware-scanner URL/token.

Provider ingress endpoints such as finance and settlement outcomes additionally fail closed when their dedicated bearer token is not configured. Approval/submission state therefore cannot be converted into paid/settled state without authenticated provider evidence.

The worker validates:

- PostgreSQL URL;
- notification gateway URL/token;
- inventory-lock expiry cadence and batch size;
- bounded integer poll/scan intervals for all loops.

Development and CI test mode remain flexible, but production does not silently fall back to console OTP, placeholder keys, missing delivery integrations, or a disabled durability loop.

## Rollback behavior

Application rollback is allowed only when the rollback runtime version is still greater than or equal to `minimum_runtime_version`.

Database schema downgrades are intentionally not part of the production rollback procedure. If a migration is incorrect, create a forward repair migration. This avoids destructive down-migrations against live transactional, document, finance, settlement, queue, inventory and audit data.

A breaking migration must not raise `minimum_runtime_version` until the previous runtime is intentionally no longer a supported rollback target.

## Failure codes

The readiness layer uses bounded failure codes:

- `DATABASE_UNAVAILABLE` — PostgreSQL cannot be reached;
- `SCHEMA_CONTRACT_MISSING` — the runtime contract table/row is absent;
- `SCHEMA_TOO_OLD` — the database has not been migrated far enough for this runtime;
- `RUNTIME_VERSION_TOO_OLD` — the database has advanced beyond compatibility with this runtime;
- `SCHEMA_CONTRACT_MISMATCH` — same-version migration identity does not match the application expectation.

## Executable certification

The reusable runtime executable is:

```text
platform/scripts/certify-runtime-readiness.sh
```

It is called by `.github/workflows/runtime-readiness-certification.yml` after a frozen dependency install and deployable API/worker build.

The script derives the current schema version and migration marker directly from `runtime-readiness.ts`; future canonical migrations therefore do not require a duplicated hardcoded version in the test harness.

The certification proves:

1. the current canonical schema returns API readiness `200`;
2. pre-contract/stale schema keeps liveness `200` but readiness `503`;
3. worker exits before loops on stale schema;
4. worker starts on current schema;
5. an additive future schema with `minimum_runtime_version` equal to the current runtime remains compatible;
6. a future schema that raises `minimum_runtime_version` rejects the older runtime;
7. the runtime contract cannot be deleted or moved backwards;
8. incomplete production configuration causes API and worker startup to fail closed;
9. complete production-shaped configuration can boot API/worker against the current schema;
10. a fresh database is migrated from zero and a rerun is idempotent;
11. an eligible pre-runner database can be adopted exactly once into checksum history;
12. modifying historical migration SQL is rejected by checksum verification;
13. concurrent migrators serialize under the PostgreSQL advisory lock and converge on one complete history;
14. strict TypeScript and the complete deployable API/worker dependency graph build successfully.

Inventory expiry has an additional executable certification:

```text
platform/scripts/certify-inventory-lock-durability.sh
```

It proves bounded/idempotent expiry, concurrent sweepers, exact outbox evidence, terminal-state immutability, worker restart durability and clean shutdown without surviving PostgreSQL sessions.
