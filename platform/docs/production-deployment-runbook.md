# PRENEURA production deployment runbook

This runbook is the operational contract for deploying the production platform. It assumes the release has already passed the production foundation, pricing, document/contract, finance, reproducibility, and runtime-readiness gates.

## Service topology

Deploy the production workspace as independent services sharing the same certified PostgreSQL schema:

1. migration/release job;
2. API;
3. background worker;
4. notification gateway;
5. web application.

API/worker/gateway application processes never auto-run schema migrations.

## Required release order

1. Build one immutable release from the committed `platform/pnpm-lock.yaml` with Node 24 / pnpm 12.9.1.
2. Run the one-shot migration job:

   ```bash
   MIGRATION_ACTOR=<release-id> pnpm --filter @preneura/database migrate
   ```

3. Stop the rollout if the migration job fails.
4. Roll API instances.
5. Admit API traffic only after `GET /v1/health/ready` returns HTTP 200.
6. Roll notification-gateway instances. Their package `start` command runs the production configuration/database preflight before opening the HTTP listener.
7. Roll worker instances. A worker exits non-zero before any processing loop when configuration or schema compatibility is invalid.
8. Roll the web service and check `GET /api/health`.
9. Verify provider endpoints and dashboards before declaring the deployment complete.

## Health contracts

### API

- `/v1/health` — process liveness only.
- `/v1/health/live` — process liveness only.
- `/v1/health/ready` — PostgreSQL connectivity + runtime/schema compatibility; use this as the API load-balancer/Railway health check.

A stale/incompatible schema returns 503 while liveness remains 200.

### Worker

The worker has no public HTTP listener. Startup is the readiness gate. It validates production configuration and the runtime/schema contract before starting outbox, notification, reminder, or commission loops. Configure the platform to restart on non-zero exit.

### Notification gateway

Use the package `start` command, not `node dist/main.js` directly. `start` first executes `dist/preflight.js`, which validates production gateway secrets/provider configuration and checks the runtime/schema contract. Only a successful preflight starts the gateway HTTP service.

`GET /health` is a liveness endpoint after successful startup.

### Web

`GET /api/health` is the web process liveness endpoint. It intentionally does not proxy API readiness; API traffic readiness remains owned by `/v1/health/ready` so a temporary API outage does not create web restart loops.

## Production configuration rules

Production startup rejects placeholder or incomplete configuration. In particular, long strings such as `replace-with-...` are treated as placeholders and cannot satisfy secret-length validation.

The API requires production authentication/session secrets, OIDC, storage/scanner configuration, notification-gateway integration, and the finance-provider ingress token.

The worker requires the database URL, notification gateway URL/token, and bounded polling intervals.

The notification gateway requires the database URL, contact encryption key, internal gateway token, Meta WhatsApp credentials, and a valid WhatsApp template-binding map. SMS/email provider pairs are validated when configured.

Secrets belong in the deployment secret store; never copy `.env.example` placeholder values into production.

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

## Failure handling

### Migration failure

Do not start new API/worker/gateway instances. Inspect the failed migration and create a forward repair. Do not edit a migration that may already have been applied elsewhere.

### API readiness failure

Keep the instance out of traffic. Use the bounded readiness code to distinguish PostgreSQL connectivity, missing/stale schema contract, old database, old runtime, or same-version marker mismatch.

### Worker startup failure

Do not bypass the readiness check. Correct configuration or schema compatibility, then restart. A worker that cannot prove readiness must not claim outbox/notification/financial operational work.

### Notification gateway startup failure

Do not bypass `preflight`. Correct the database/schema or provider/secret configuration and restart through the package start command.

## Rollback procedure

1. Stop rollout of the new application revision.
2. Confirm the previous runtime version remains compatible with the database `minimum_runtime_version`.
3. Roll API/worker/gateway/web services back to the previous immutable build.
4. Do not run down-migrations.
5. Verify API readiness, worker startup, notification-gateway preflight, and web liveness.
6. Create a forward migration/code fix for the failed release.

## Release evidence

The runtime-readiness certification must prove the complete branch only after implementation is finished. It covers:

- frozen dependency installation and production builds;
- incomplete production configuration rejection;
- current, stale, forward-compatible, and breaking-future schema states;
- API liveness/readiness behavior;
- worker fail-closed startup;
- notification-gateway fail-closed preflight;
- web liveness route;
- fresh/idempotent migration execution;
- historical checksum drift rejection;
- concurrent migration serialization;
- one-time legacy migration-ledger adoption.
