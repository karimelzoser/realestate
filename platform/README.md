# PRENEURA Production Platform

`platform/` is the server-authoritative production implementation of PRENEURA. The legacy/demo application at repository root remains separate while production capabilities are moved behind typed APIs, PostgreSQL invariants, worker processes, explicit authorization, immutable financial/document evidence, and executable release gates.

## Current production stack

- pnpm + Turborepo TypeScript workspace
- Next.js web application
- NestJS + Fastify API
- PostgreSQL 18 domain database through Kysely
- dedicated background worker
- dedicated notification gateway
- passwordless phone / National ID + OTP authentication
- Google OIDC through Keycloak
- HttpOnly server sessions with token digests stored in PostgreSQL
- tenant/project/broker RBAC and ownership-scoped buyer permissions
- project catalog, hierarchy, pricing versions, anonymous saleable capacity and atomic locks
- buyer profiles, EOI/refunds, queues, reservations and transactions
- S3-compatible document storage, trust scanning, templates, signatures and immutable contract execution evidence
- immutable payment/ledger events, payment allocations and cheque replacement history
- broker commission plans, eligibility, due-state automation and countdowns
- durable transactional outbox
- durable realtime replay log + PostgreSQL `LISTEN/NOTIFY` wakeups
- user notification inbox + provider-neutral external delivery jobs
- milestone/installment reminder scheduling
- authenticated role-aware web workspace backed only by authorized API snapshots
- PRENEURA Super Admin control plane with explicit audited support access
- optional deterministic/third-party AI recommendation layer with no business-state authority

## Runtime boundaries

The API is stateless request/SSE infrastructure. It does **not** own recurring timers and never auto-runs schema migrations.

The worker owns:

- outbox publication into the durable realtime replay stream
- notification claiming, retries and stale-claim recovery
- in-app notification materialization
- external notification gateway delivery
- transaction milestone reminder scheduling/reconciliation
- installment-due reminder scheduling
- commission due-state refreshes
- durable inventory-lock expiry reconciliation

The notification gateway owns provider-facing WhatsApp/SMS/email delivery and contact decryption. Provider outages therefore do not block the API or worker scheduling loops.

API process liveness and traffic readiness are separate:

```text
GET /v1/health/live
GET /v1/health/ready
```

`/v1/health/live` proves only that the HTTP process is alive. `/v1/health/ready` verifies PostgreSQL connectivity plus the runtime/schema compatibility contract. Reverse proxies and process supervisors should only route production API traffic to instances whose readiness endpoint returns HTTP 200.

The worker validates production configuration and the same database/runtime contract before starting any job loop. It exits non-zero when configuration or schema compatibility is unsafe.

Detailed deployment, migration, backup and rollback rules are in:

```text
docs/runtime-readiness.md
docs/production-deployment-runbook.md
docs/gate7-go-no-go.md
```

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

That response is derived from active platform, tenant, project and broker-company role assignments plus time-effective broker-project access. A locally remembered project ID is accepted only if it still exists in the current authoritative workspace response.

Core snapshots include:

```text
GET /v1/tenants/:tenantId/projects/:projectId/catalog
GET /v1/tenants/:tenantId/projects/:projectId/queue
GET /v1/tenants/:tenantId/projects/:projectId/transactions
```

Transaction and downstream finance/document/commission reads are server-filtered for internal project scope, broker-company scope, exact broker-agent attribution, or buyer-self scope. Browser filtering is never relied on for confidentiality.

## Local bootstrap

```bash
cd platform
cp .env.example .env
# Replace all placeholder secrets and configure local S3-compatible storage.

docker compose -f docker-compose.dev.yml up -d
pnpm install --frozen-lockfile
pnpm --filter @preneura/database migrate
```

`@preneura/database migrate` is the supported migration path. It serializes concurrent migrators with a PostgreSQL advisory lock and verifies immutable SHA-256 migration history before applying pending migrations.

Run all development applications:

```bash
pnpm dev
```

Or build/run production applications independently:

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

Project reminder policy APIs are exposed under the authenticated project scope. All actual recipient resolution and provider delivery remains server-authoritative.

## Notification delivery

`IN_APP` jobs are delivered entirely inside PostgreSQL and are unique per notification job.

`WHATSAPP`, `SMS`, and `EMAIL` jobs are sent to the configured `NOTIFICATION_GATEWAY_URL` with an `Idempotency-Key` header. The gateway preserves that idempotency contract with downstream providers.

Worker delivery behavior:

- PostgreSQL row claiming uses `FOR UPDATE SKIP LOCKED`
- stale processing claims are recoverable
- failures use bounded exponential backoff
- delivery attempts are auditable
- terminal failures stop after the configured retry ceiling
- reminder jobs are policy-versioned and stale pending jobs are cancelled when milestones, recipients, broker access, payment state or policy changes

## Document and contract trust

Documents, templates and signature objects are never stored as file bytes in PostgreSQL. The API generates server-scoped S3-compatible object keys and presigned uploads, then verifies byte size, MIME type, SHA-256, binary file signature and malware-scanner verdict before trusted business use.

Contract execution captures immutable evidence linking:

- executed document hash
- template version/hash
- certified pricing snapshot
- signer evidence
- executing actor
- execution time

## Financial authority

Payment schedule statuses are projections, not accounting truth.

Authoritative financial evidence is append-only through:

- payment events
- balanced ledger postings
- schedule allocations
- provider-ingress idempotency records
- immutable cheque events and replacement chains

Reversals/refunds use compensating entries rather than rewriting original evidence. Direct mutation paths that could manufacture PAID state are blocked at the database boundary.

## Authentication

Supported login methods:

- phone + OTP
- National ID + OTP after identity matching
- Google through Keycloak/OIDC

Phone/National-ID login identifiers are lookup HMACs, not reversible delivery contacts. Verified delivery contacts are stored separately and encrypted.

A first-time Google identity remains `PENDING`; authentication never grants tenant/project/broker authority by itself.

## Production validation

The repository contains independent executable gates for:

- frozen dependency reproducibility
- production TypeScript/build/migration foundation
- catalog/pricing certification
- durable inventory-lock expiry
- document/contract trust
- immutable finance/ledger reconciliation
- product/role parity
- runtime readiness / migration safety
- configuration and HTTP security
- backup/restore and non-functional recovery
- browser/product regression
- Gate 7 deployment/go-no-go structure

## Production release sequence

Use this order for every database-affecting release:

1. build one immutable application revision from the committed lockfile;
2. verify PostgreSQL and object-storage backups;
3. run exactly one migration process with the production `DATABASE_URL`:

   ```bash
   MIGRATION_ACTOR=<release-id> pnpm --filter @preneura/database migrate
   ```

4. stop immediately if migration fails;
5. restart/roll API processes and route traffic only after `/v1/health/ready` returns `200`;
6. restart notification gateway and require preflight success;
7. restart workers and require startup readiness success;
8. restart web processes and verify `/api/health`;
9. run smoke checks for login, catalog, transaction, finance, notifications, lock expiry and provider callbacks.

API, worker and gateway processes must never auto-migrate on startup.

## Self-hosted production layout

PRENEURA does not depend on a specific hosting vendor.

A normal self-hosted installation can use Linux services or containers behind Nginx/HAProxy:

```text
Internet
   |
Nginx / HAProxy / TLS
   |-- web
   |-- api
   `-- notification gateway callback route when required

Private network / host services
   |-- worker
   |-- PostgreSQL 18
   |-- Redis
   |-- object storage
   |-- Keycloak
   `-- migration process (one-shot during releases)
```

The worker, database, Redis, migration process and object-storage administration interface must not be publicly exposed.

### Production build

```bash
cd platform
pnpm install --frozen-lockfile
pnpm --filter @preneura/web build
pnpm --filter @preneura/api build
pnpm --filter @preneura/worker build
pnpm --filter @preneura/notification-gateway build
```

### Production start commands

```bash
pnpm --filter @preneura/web start
pnpm --filter @preneura/api start
pnpm --filter @preneura/worker start
pnpm --filter @preneura/notification-gateway start
```

Use systemd, Docker Compose, Nomad, Kubernetes or another process/orchestration layer if desired; the application architecture does not require any one of them.

For systemd/Docker deployments, restart failed worker/gateway processes automatically but never bypass their configuration/schema preflight.

## Reproducible dependency installs

The production workspace commits `platform/pnpm-lock.yaml`, generated with Node 24 and pnpm 12.9.1 to match CI. All production builds use:

```bash
pnpm install --frozen-lockfile
```

A package manifest therefore cannot silently resolve a different production dependency graph.

When a dependency changes, regenerate the lockfile with the pinned workspace package manager, review the lock diff, commit it with the manifest change, and require **Release Dependency Reproducibility** to pass before merge.
