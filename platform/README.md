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

The API is stateless request/SSE infrastructure. It does **not** own recurring timers.

The dedicated worker owns:

- outbox publication into the durable realtime replay stream
- notification claiming, retries and stale-claim recovery
- in-app notification materialization
- external notification gateway delivery
- transaction milestone SLA scheduling/reconciliation
- commission due-time refreshes

This separation is required so horizontally scaled API instances do not create duplicate timer execution.

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
```

Apply every migration in order:

```bash
for migration in packages/database/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

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
```

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

Documents, templates and signature objects are never stored as file bytes in PostgreSQL. The API generates server-scoped S3-compatible object keys and presigned uploads, then verifies byte size, MIME type and SHA-256 before accepting the business record.

Required storage configuration is documented in `.env.example`.

## Keycloak setup for Google

Create realm `preneura`, configure confidential OIDC client `preneura-web`, use the callback URL from `OIDC_REDIRECT_URI`, and add Google as an Identity Provider. Google client secrets and production Keycloak secrets belong in a secrets manager, never in Git.

A first-time Google identity is `PENDING`; identity verification alone never grants tenant, project or operational roles.

## Production validation

`.github/workflows/platform-foundation.yml` currently validates:

- strict TypeScript for API, worker, web, contracts and database packages
- emitted API build
- emitted worker build
- production Next.js web build
- PostgreSQL 18 migrations from an empty database
- critical uniqueness/index constraints across catalog, sales, documents, finance, commissions and notification runtime
- commission creation/refresh triggers
- realtime and user-notification `LISTEN/NOTIFY` triggers
- durable replay and notification tables/indexes

## Railway service layout

Use separate Railway services against the same repository/database.

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

Expose the API service publicly and set `PORT`, `WEB_ORIGIN`, `DATABASE_URL`, authentication variables and object-storage variables. `WEB_ORIGIN` must include the deployed web origin so credentialed browser requests and SSE can use the HttpOnly session cookie.

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

The worker does not need a public domain or HTTP port. Set `DATABASE_URL`, worker polling variables and notification-gateway variables.

## Reproducible dependency installs

The production workspace commits `platform/pnpm-lock.yaml`, generated with Node 24 and pnpm 12.9.1 to match CI. Production CI and Railway install with `pnpm install --frozen-lockfile`, so a package manifest cannot silently resolve a different dependency graph.

When a dependency changes, regenerate the lockfile with the pinned workspace package manager, review the lock diff, commit it with the manifest change, and require **Release Dependency Reproducibility** to pass before merge.
