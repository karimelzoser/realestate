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

## Local bootstrap

```bash
cd platform
cp .env.example .env
# Replace all placeholder secrets and configure local S3-compatible storage.

docker compose -f docker-compose.dev.yml up -d
pnpm install
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

Or run the production API/worker processes independently after building:

```bash
pnpm --filter @preneura/api build
pnpm --filter @preneura/api start

pnpm --filter @preneura/worker build
pnpm --filter @preneura/worker start
```

Default local endpoints:

- web: `http://localhost:3000`
- API: `http://localhost:4100/v1`
- Keycloak: `http://localhost:8080`

## Important API surfaces in the current slice

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
- emitted API and worker builds
- PostgreSQL 18 migrations from an empty database
- critical uniqueness/index constraints across catalog, sales, documents, finance, commissions and notification runtime
- commission creation/refresh triggers
- realtime and user-notification `LISTEN/NOTIFY` triggers
- durable replay and notification tables/indexes

## Railway service layout

Use separate Railway services against the same repository/database:

### API service

Working/root directory:

```text
platform
```

Build command:

```bash
pnpm install --no-frozen-lockfile && pnpm --filter @preneura/api build
```

Start command:

```bash
pnpm --filter @preneura/api start
```

Expose the API service publicly and set `PORT`, `WEB_ORIGIN`, `DATABASE_URL`, authentication variables and object-storage variables.

### Worker service

Working/root directory:

```text
platform
```

Build command:

```bash
pnpm install --no-frozen-lockfile && pnpm --filter @preneura/worker build
```

Start command:

```bash
pnpm --filter @preneura/worker start
```

The worker does not need a public domain or HTTP port. Set `DATABASE_URL`, worker polling variables and notification-gateway variables.

## Release-hardening item still open

The workspace does not yet contain a committed `pnpm-lock.yaml`, so CI and Railway must currently use `--no-frozen-lockfile`. Before the production release branch is cut, generate and commit the workspace lockfile and switch CI/deploy installs to `--frozen-lockfile` so dependency resolution is fully reproducible.
