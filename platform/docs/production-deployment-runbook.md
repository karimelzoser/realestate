# PRENEURA production deployment runbook

This runbook is the operational contract for deploying the production platform on self-hosted Linux infrastructure or any generic container host. It assumes the release has already passed the production foundation, pricing, document/contract, finance, product-parity, security, recovery, reproducibility and runtime-readiness gates.

## Service topology

Deploy the production workspace as independent processes or containers sharing the same certified PostgreSQL schema:

1. one-shot migration/release process;
2. API;
3. background worker;
4. notification gateway;
5. web application;
6. PostgreSQL;
7. Redis/object storage/Keycloak and other configured infrastructure dependencies.

API/worker/gateway application processes never auto-run schema migrations.

A recommended self-hosted edge is Nginx or HAProxy terminating TLS and routing public traffic to the web/API/gateway processes. Worker and migration processes do not require public exposure.

## Required release order

1. Build one immutable release from the committed `platform/pnpm-lock.yaml` with Node 24 / pnpm 12.9.1.
2. Verify PostgreSQL and object-storage backup freshness.
3. Run the one-shot migration process:

   ```bash
   MIGRATION_ACTOR=<release-id> pnpm --filter @preneura/database migrate
   ```

4. Stop the rollout if the migration process fails.
5. Restart/roll API instances.
6. Admit API traffic only after `GET /v1/health/ready` returns HTTP 200.
7. Restart notification-gateway instances. Their package `start` command runs production configuration/database preflight before opening the HTTP listener.
8. Restart worker instances. A worker exits non-zero before any processing loop when configuration or schema compatibility is invalid.
9. Restart the web process and check `GET /api/health`.
10. Verify provider endpoints, dashboards, realtime events, inventory expiry, notifications and transaction flows before declaring the deployment complete.

## Health contracts

### API

- `/v1/health` — process liveness only.
- `/v1/health/live` — process liveness only.
- `/v1/health/ready` — PostgreSQL connectivity + runtime/schema compatibility; use this as the reverse-proxy/orchestrator readiness check.

A stale/incompatible schema returns 503 while liveness remains 200.

### Worker

The worker has no public HTTP listener. Startup is the readiness gate. It validates production configuration and the runtime/schema contract before starting outbox, notification, reminder, commission or inventory-lock-expiry loops. Use systemd, Docker restart policy, or your process supervisor to restart on non-zero exit.

### Notification gateway

Use the package `start` command, not `node dist/main.js` directly. `start` first executes production preflight, validating gateway secrets/provider configuration and the runtime/schema contract. Only a successful preflight starts the gateway HTTP service.

`GET /health` is a liveness endpoint after successful startup.

### Web

`GET /api/health` is the web process liveness endpoint. It intentionally does not proxy API readiness; API traffic readiness remains owned by `/v1/health/ready` so a temporary API outage does not create web restart loops.

## Production configuration rules

Production startup rejects placeholder or incomplete configuration. Placeholder values such as `replace-with-...`, `change-me`, `dummy`, or local-only production endpoints are invalid.

The API requires production authentication/session secrets, OIDC, storage/scanner configuration, notification-gateway integration, finance/settlement ingress secrets and trusted proxy/body-limit configuration.

The worker requires the database URL, notification gateway URL/token and bounded polling intervals, including durable inventory lock expiry settings.

The notification gateway requires the database URL, contact encryption key, internal gateway token, Meta WhatsApp credentials and a valid WhatsApp template-binding map. Optional SMS/email provider pairs are validated when configured.

Secrets belong in protected environment files or a server-side secret manager readable only by the required service account. Never copy `.env.example` placeholder values into production.

## Self-hosted process layout

A single Linux host may run the first production deployment, provided PostgreSQL/object storage/backups have adequate isolation and capacity. Keep the services logically separate even on one machine.

Suggested processes:

```text
preneura-web
preneura-api
preneura-worker
preneura-notification-gateway
keycloak
postgresql
redis
object-storage
nginx
```

The application processes should run as non-root users with separate writable directories only where required.

### Build

From `platform/`:

```bash
pnpm install --frozen-lockfile
pnpm --filter @preneura/web build
pnpm --filter @preneura/api build
pnpm --filter @preneura/worker build
pnpm --filter @preneura/notification-gateway build
```

### Start commands

```bash
pnpm --filter @preneura/web start
pnpm --filter @preneura/api start
pnpm --filter @preneura/worker start
pnpm --filter @preneura/notification-gateway start
```

Run the migration process separately before restarting application processes:

```bash
MIGRATION_ACTOR=<release-id> pnpm --filter @preneura/database migrate
```

## Reverse proxy

Terminate HTTPS at Nginx/HAProxy and route only the public surfaces:

```text
https://app.example.com      -> web
https://api.example.com      -> API
https://gateway.example.com  -> notification gateway only when provider callbacks require it
```

Do not publicly expose PostgreSQL, Redis, worker ports, object-storage administration ports, or internal Keycloak administration endpoints.

Preserve forwarded protocol/IP headers from the trusted proxy only. Enforce TLS, request/body limits and timeouts appropriate to uploads and SSE.

## Schema compatibility and rolling releases

The runtime identifies itself with a schema compatibility version. The singleton `platform_runtime_contract` records:

- database schema version;
- minimum compatible runtime version;
- migration marker.

An additive migration may advance the database schema while leaving the previous runtime compatible. A breaking migration must use expand/contract deployment and must not raise the minimum runtime version until old processes are drained.

Do not roll back database schemas. Repair an incorrect migration with a new forward migration. Application rollback is allowed only while the target runtime is still at or above the database's minimum compatible runtime version.

## Migration safety

The production migration runner:

- acquires a PostgreSQL advisory lock;
- applies sequential numbered migrations;
- records immutable SHA-256 migration checksums;
- rejects modified historical migration SQL;
- serializes concurrent release jobs;
- is idempotent on rerun.

For databases created before the migration ledger existed, `MIGRATION_ADOPT_EXISTING=true` is allowed only as a one-time baseline and only when the runtime contract proves the database is already at the exact current schema. Remove that flag immediately after adoption.

## Backup and recovery

Before each database-affecting production release:

1. verify the last PostgreSQL backup completed successfully;
2. verify point-in-time recovery/WAL retention when enabled;
3. take or verify an object-storage backup/versioning checkpoint for business documents;
4. record the application release SHA and migration ledger state;
5. periodically perform a restore drill into an isolated database rather than assuming backups are usable.

A backup that has never been restored in a test is not considered sufficient release evidence.

## Failure handling

### Migration failure

Do not start new API/worker/gateway instances. Inspect the failed migration and create a forward repair. Do not edit a migration that may already have been applied elsewhere.

### API readiness failure

Keep the instance out of traffic. Use the bounded readiness code to distinguish PostgreSQL connectivity, missing/stale schema contract, old database, old runtime, or same-version marker mismatch.

### Worker startup failure

Do not bypass the readiness check. Correct configuration or schema compatibility, then restart. A worker that cannot prove readiness must not claim outbox/notification/financial/inventory operational work.

### Notification gateway startup failure

Do not bypass preflight. Correct the database/schema or provider/secret configuration and restart through the package start command.

## Rollback procedure

1. Stop rollout of the new application revision.
2. Confirm the previous runtime version remains compatible with the database `minimum_runtime_version`.
3. Restart API/worker/gateway/web using the previous immutable build.
4. Do not run down-migrations.
5. Verify API readiness, worker startup, notification-gateway preflight, and web liveness.
6. Create a forward migration/code fix for the failed release.

## Gate 7 final evidence

A final production GO additionally requires:

- exact deployed runtime SHA equals the certified candidate;
- TLS and reverse-proxy topology verified;
- provider/OIDC/scanner/finance/settlement credentials verified;
- monitoring dashboards and alerts live;
- backup/restore evidence reviewed;
- migration rehearsal complete;
- rollback/cutover rehearsal complete;
- named operational/on-call owner;
- no open P0/P1 launch defect;
- manual `Gate 7 Production Go-No-Go` workflow passes against the live deployment.
