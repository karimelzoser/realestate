# PRENEURA Production Platform

`platform/` is the server-authoritative production implementation of PRENEURA. The legacy/demo application at repository root remains separate while production capabilities are moved behind typed APIs, PostgreSQL invariants, worker processes, and explicit authorization.

## Current production stack

- pnpm + Turborepo TypeScript workspace
- Next.js web application
- NestJS + Fastify API
- PostgreSQL 18 domain database through Kysely
- dedicated background worker process
- passwordless phone / National ID + OTP authentication
- Google OIDC through Keycloak
- HttpOnly server sessions with token digests stored in PostgreSQL
- tenant/project/broker RBAC and ownership-scoped buyer permissions
- project catalog, pricing versions, inventory slots and atomic unit locks
- buyer profiles, EOI/refunds, queues, reservations and transactions
- S3-compatible document storage, verification, templates, signatures and contract stamping
- payment schedules and physical cheque lifecycle
- broker commission plans, cases, eligibility and due-state automation
- durable transactional outbox
- durable realtime replay log + PostgreSQL `LISTEN/NOTIFY` wakeups
- user notification inbox + provider-neutral external delivery jobs
- project milestone SLA scheduling and reminder delivery
- authenticated role-aware web workspace backed only by authorized API snapshots

## Runtime boundaries

The API is stateless request/SSE infrastructure. It does **not** own recurring timers or run schema migrations on startup.

The dedicated worker owns:

- outbox publication into the durable realtime replay stream
- notification claiming, retries and stale-claim recovery
- in-app notification materialization
- external notification gateway delivery
- transaction milestone SLA scheduling/reconciliation
- commission due-time refreshes

This separation is required so horizontally scaled API instances do not create duplicate timer execution.

API process liveness and traffic readiness are separate:

```text
GET /v1/health/live
GET /v1/health/ready
```

`/v1/health/live` proves only that the HTTP process is alive. `/v1/health/ready` also verifies PostgreSQL connectivity and the database/runtime compatibility contract. Production load balancers and Railway health checks must use `/v1/health/ready`.

The worker validates production configuration and the same database/runtime contract before starting any job loop. It exits non-zero when configuration or schema compatibility is unsafe. Rolling deployment, migration, adoption, and rollback rules are documented in `docs/runtime-readiness.md`.

## Realtime model

Realtime transport is intentionally signal-only. Browser streams never receive raw transactional outbox payloads.

Project streams emit only:

- monotonic sequence cursor
- topic
- source event type
- occurrence timestamp

Clients refetch the authorized REST snapshot after receiving a signal. Reconnects use the durable PostgreSQL sequence to replay missed signals. Large replay gaps emit `resync_required` so the client performs a full authorized refresh instead of receiving an unbounded backlog.

Broker commission streams are broker-company scoped. `BROKER_AGENT` streams are further restricted to commission cases attributed to that agent and do not receive commission-plan publication signals.

User notification streams are always scoped to the authenticated session user.

## Web workspace authorization

The browser does not construct its own project or broker scope. After session validation it loads:

```text
GET /v1/me/workspace
```

That response is derived from active platform, tenant, project and broker-company role assignments plus time-effective broker-project access. The selected project ID can be remembered locally, but it is accepted only if it still exists in the current authoritative workspace response.

Current live web snapshots include:

```text
GET /v1/tenants/:tenantId/projects/:projectId/catalog
GET /v1/tenants/:tenantId/projects/:projectId/queue
GET /v1/tenants/:tenantId/projects/:projectId/transactions
```

The transaction list is server-filtered for internal project scope, broker-company scope, exact broker-agent attribution, or buyer-self scope. Browser filtering is never relied on for confidentiality.

## Local bootstrap

```bash
cd platform
cp .env.example .env
# Replace all placeholder secrets and configure local S3-compatible storage.

docker compose -f docker-compose.dev.yml up -d
pnpm install --frozen-lockfile
pnpm --filter @preneura/database migrate
```

`@preneura/database migrate` is the supported migration path. It serializes concurrent migrators with a PostgreSQL advisory lock and verifies immutable SHA-256 history before applying pending migrations.

Run all development applications:

```bash
pnpm dev
```

Or run production applications independently after building:

```bash
pnpm --filter @preneura/web build
pnpm --filter @preneura/web start

pnpm --filter @preneura/api build
pnpm --filter @preneura/api start

pnpm --filter @preneura/worker build
pnpm --filter @preneura/worker start

pnpm --filter @preneura/notification-gateway build
pnpm --filter @preneura/notification-gateway start
```

Each deployable application's `build` script compiles the shared workspace packages it needs at Node runtime before building the leaf application.

Default local endpoints:

- web: `http://localhost:3000`
- API: `http://localhost:4100/v1`
- Keycloak: `http://localhost:8080`

## Important API surfaces

Realtime project signals:

```text
GET /v1/tenants/:tenantId/projects/:projectId/events
```

Broker commission signals:

```text
GET /v1/tenants/:tenantId/projects/:projectId/brokers/:brokerCompanyId/events
```

Both SSE endpoints accept either the `Last-Event-ID` header or an `after` query cursor.

Authenticated notification inbox and stream:

```text
GET  /v1/me/notifications
GET  /v1/me/notifications/events
POST /v1/me/notifications/:notificationId/read
```

Project milestone SLA policy:

```text
GET  /v1/tenants/:tenantId/projects/:projectId/notification-slas
POST /v1/tenants/:tenantId/projects/:projectId/notification-slas
```

## Notification delivery

`IN_APP` jobs are delivered entirely inside PostgreSQL and are unique per notification job.

`WHATSAPP`, `SMS`, and `EMAIL` jobs are sent to the configured `NOTIFICATION_GATEWAY_URL` with an `Idempotency-Key` header. The gateway is expected to preserve that idempotency contract with its downstream provider.

Worker delivery behavior:

- PostgreSQL row claiming uses `FOR UPDATE SKIP LOCKED`
- processing claims older than five minutes are recoverable
- failures use bounded exponential backoff
- delivery attempts are auditable
- terminal failures stop after five attempts
- SLA jobs are policy-versioned and stale pending jobs are cancelled when milestones, recipients, broker access or SLA policy changes

## Document storage

Documents, templates and signature objects are never stored as file bytes in PostgreSQL. The API generates server-scoped S3-compatible object keys and presigned uploads, then verifies byte size, MIME type, SHA-256, file signature, and malware-scanner verdict before trusted business use.

Required storage/scanner configuration is documented in `.env.example`.

## Keycloak setup for Google

Create realm `preneura`, configure confidential OIDC client `preneura-web`, use the callback URL from `OIDC_REDIRECT_URI`, and add Google as an Identity Provider. Google client secrets and production Keycloak secrets belong in a secrets manager, never in Git.

A first-time Google identity is `PENDING`; identity verification alone never grants tenant, project or operational roles.

## Production validation

`.github/workflows/platform-foundation.yml` validates:

- frozen dependency install
- strict TypeScript for production workspace packages
- emitted API/worker/notification-gateway/web builds
- PostgreSQL 18 migrations from an empty database
- critical uniqueness/index constraints across catalog, sales, documents, finance, commissions and notification runtime
- commission creation/refresh triggers
- realtime and user-notification `LISTEN/NOTIFY` triggers
- durable replay and notification tables/indexes

`.github/workflows/runtime-readiness-certification.yml` additionally boots emitted API/worker processes against real PostgreSQL databases and certifies:

- current, stale, future-compatible and future-incompatible schema states
- production configuration fail-closed behavior
- fresh/idempotent migrations
- one-time legacy schema adoption
- checksum-tamper rejection
- concurrent migrator serialization

## Production release sequence

Use this order for every database-affecting release:

1. build the immutable release from the committed lockfile;
2. run exactly one migration/release job with the same `DATABASE_URL`:

   ```bash
   pnpm --filter @preneura/database migrate
   ```

3. require the migration job to succeed before API/worker rollout;
4. roll API instances and admit traffic only after `/v1/health/ready` returns `200`;
5. roll workers after the same runtime/schema contract is compatible.

Do not configure API or worker replicas to auto-migrate on startup.

For the one-time transition of a pre-runner database, follow the adoption procedure in `docs/runtime-readiness.md`; do not permanently set `MIGRATION_ADOPT_EXISTING=true`.

## Railway service layout

Use separate Railway services against the same repository/database.

### Migration/release job

Working/root directory:

```text
platform
```

Install/build preparation:

```bash
pnpm install --frozen-lockfile
```

One-shot release command:

```bash
MIGRATION_ACTOR=railway-release pnpm --filter @preneura/database migrate
```

Run this as a dedicated one-shot release service/job (or the platform's equivalent pre-deploy hook) before rolling API and worker services. It must use the production `DATABASE_URL` and must complete successfully before traffic rollout.

### Web service

Working/root directory:

```text
platform
```

Build command:

```bash
pnpm install --frozen-lockfile && pnpm --filter @preneura/web build
```

Start command:

```bash
pnpm --filter @preneura/web start
```

Expose the service publicly. `NEXT_PUBLIC_API_URL` must be set to the public API origin **during the build**, because Next.js embeds public environment variables into the browser bundle. Railway should also provide `PORT` at runtime.

### API service

Working/root directory:

```text
platform
```

Build command:

```bash
pnpm install --frozen-lockfile && pnpm --filter @preneura/api build
```

Start command:

```bash
pnpm --filter @preneura/api start
```

Expose the API service publicly and set `PORT`, `WEB_ORIGIN`, `DATABASE_URL`, authentication/OIDC variables, OTP/contact gateway variables, object-storage variables, and document-scanner variables. Production startup validates this configuration before Nest begins serving requests.

Configure the Railway health check to:

```text
/v1/health/ready
```

Do not use the liveness-only endpoint for traffic readiness.

### Worker service

Working/root directory:

```text
platform
```

Build command:

```bash
pnpm install --frozen-lockfile && pnpm --filter @preneura/worker build
```

Start command:

```bash
pnpm --filter @preneura/worker start
```

The worker does not need a public domain or HTTP port. Set `DATABASE_URL`, bounded worker polling variables, `NOTIFICATION_GATEWAY_URL`, and `NOTIFICATION_GATEWAY_TOKEN`. Production startup validates configuration and database/runtime compatibility before starting loops; Railway should restart the service when it exits non-zero.

### Notification gateway service

Working/root directory:

```text
platform
```

Build command:

```bash
pnpm install --frozen-lockfile && pnpm --filter @preneura/notification-gateway build
```

Start command:

```bash
pnpm --filter @preneura/notification-gateway start
```

Set `DATABASE_URL` and the provider/gateway variables documented in `.env.example`. Keep this service independently deployable from the worker so provider delivery failures cannot block the worker's durable scheduling and claiming loops.

## Reproducible dependency installs

The production workspace commits `platform/pnpm-lock.yaml`, generated with Node 24 and pnpm 12.9.1 to match CI. Production CI and Railway install with `pnpm install --frozen-lockfile`, so a package manifest cannot silently resolve a different dependency graph.

When a dependency changes, regenerate the lockfile with the pinned workspace package manager, review the lock diff, commit it with the manifest change, and require **Release Dependency Reproducibility** to pass before merge.
