# Runtime readiness, migrations, and schema compatibility

PRENEURA separates **process liveness** from **traffic readiness** so orchestration never sends production traffic or background work to a process that cannot safely use PostgreSQL.

## Release order

```text
build immutable release
        ↓
run one migration/release job
        ↓
wait for migration success
        ↓
roll API instances
        ↓
/v1/health/ready = 200
        ↓
admit traffic
        ↓
roll gateway + workers + web
```

API/worker/gateway processes do not auto-run schema migrations. The supported release command is:

```bash
pnpm --filter @preneura/database migrate
```

## Migration authority

The migration runner:

- loads sequential `NNNN_name.sql` files;
- hashes migration source with SHA-256;
- takes a PostgreSQL advisory lock so concurrent release jobs serialize;
- records immutable migration identity in `platform_schema_migrations`;
- rejects changed historical migration SQL;
- applies migration body + history record atomically;
- is idempotent after a successful release.

Applied migration files are append-only artifacts. Repair a production defect with a new forward migration.

### Existing database adoption

A database created before `platform_schema_migrations` may be baselined exactly once only after it has independently reached the **exact runtime contract expected by the current application build**.

```bash
MIGRATION_ADOPT_EXISTING=true \
MIGRATION_ACTOR=legacy-baseline \
pnpm --filter @preneura/database migrate
```

Adoption validates the runtime schema version/marker before recording existing migrations as `ADOPTED`. Remove the flag immediately afterward.

## API probes

```text
GET /v1/health
GET /v1/health/live
GET /v1/health/ready
```

`/health` and `/health/live` are liveness only.

`/health/ready` checks PostgreSQL connectivity and the runtime/schema compatibility contract. It returns 200 only when the running binary can safely use the database; otherwise it returns 503 with a bounded failure code.

Use `/v1/health/ready` as the API load-balancer/Railway readiness path.

## Runtime contract

`platform_runtime_contract` records:

- `schema_version` — current database schema generation;
- `minimum_runtime_version` — oldest compatible application runtime;
- `migration_marker` — migration that advanced the contract.

Migration `0034_inventory_lock_expiry_durability.sql` advances the current database schema to **34** while retaining minimum runtime **33** for rolling compatibility. The application code that depends on durable lock expiry identifies itself as runtime schema **34**.

Readiness succeeds when:

```text
database schema version >= application runtime schema version
AND
minimum compatible runtime version <= application runtime schema version
```

At equal schema/runtime version the migration marker must match exactly.

PostgreSQL prevents deleting the contract, decreasing either compatibility version, or changing a marker without increasing the schema version.

## Rolling deployments

An additive migration may advance `schema_version` while leaving `minimum_runtime_version` at the oldest still-compatible binary. Old and new processes may then overlap during a rolling deployment.

For a breaking migration, use expand/contract deployment: deploy dual-compatible code, migrate/backfill, drain old processes, then raise `minimum_runtime_version`. Raising the minimum version is the explicit point where older workers/APIs become not-ready.

Database down-migrations are not a supported rollback mechanism. Roll application images back only while the previous runtime is still compatible, and repair schema problems with a forward migration.

## Worker startup

The worker has no public HTTP port. It validates production configuration and executes the same runtime/schema probe before starting any outbox, lock-expiry, notification, reminder, or commission loop.

A stale/incompatible schema causes non-zero process exit before operational work is claimed.

## Production configuration

With `NODE_ENV=production`, startup fails closed on incomplete or placeholder configuration.

API validation covers database, browser origin, auth/session/HMAC/encryption secrets, OTP gateway, OIDC, object storage, malware scanning and finance-provider ingress.

Worker validation covers database, notification gateway and bounded poll/scan settings, including durable inventory-lock expiry cadence/batch size.

Gateway validation covers encrypted contact storage plus downstream WhatsApp/SMS/email provider configuration.

## Failure codes

- `DATABASE_UNAVAILABLE`
- `SCHEMA_CONTRACT_MISSING`
- `SCHEMA_TOO_OLD`
- `RUNTIME_VERSION_TOO_OLD`
- `SCHEMA_CONTRACT_MISMATCH`

## Certification

`platform/scripts/certify-runtime-readiness.sh` derives the current schema version and marker directly from `runtime-readiness.ts`; future migrations do not require literal version edits throughout the script.

The runtime gate proves:

1. current schema is accepted;
2. the immediately stale schema is rejected;
3. an additive future schema remains compatible;
4. a future schema that raises its minimum runtime rejects the old binary;
5. runtime-contract downgrade/delete/same-version-marker mutation are rejected;
6. the worker fails before loops on stale schema and runs on current schema;
7. fresh/idempotent/concurrent migration execution remains safe.

Feature-specific gates then prove behavior that depends on the new schema generation. For schema 34, `Gate 2 Inventory Lock Durability Certification` proves the worker's expiry and restart behavior.
