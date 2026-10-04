# PRENEURA Real Estate OS — Production Master Plan

Status: **authoritative production blueprint**  
Target repository: `karimelzoser/realestate`  
Baseline: PRENEURA 6.7.1 high-fidelity demo  
Launch rule: **all workstreams in this document are launch scope unless explicitly marked post-launch**.

---

## 1. Executive decision

PRENEURA should move from a browser-authoritative demo into a **multi-tenant, server-authoritative Real Estate Operating System** while preserving the current operating model and the working 6.7 demo as a reference implementation.

The correct production architecture is a **modular monolith with durable workflow workers**, not a premature microservice fleet.

Why:

- unit locking, payment, contract, commission and refund rules require strong transactional consistency;
- one deployable backend is materially easier to test, operate and secure than many small services;
- module boundaries still let us split domains later if scale or organizational ownership requires it;
- Temporal workers provide durable long-running process execution without putting business state in browser timers or cron jobs;
- all authoritative business state remains in PostgreSQL.

The existing `app/index.html` / modular 6.7 application remains frozen as the **demo/reference path** during migration. Production screens are rebuilt against the new API one bounded context at a time and parity-tested before legacy code is retired.

---

## 2. Non-negotiable product invariants

These are contractual rules and must have automated tests.

1. Buyer Direct, Broker and Sales Center resolve to one canonical Buyer + EOI record.
2. Online and Sales Center buyers use one shared allocation priority truth.
3. Queue position never reserves inventory.
4. Exact physical unit lock is the authoritative inventory commitment boundary.
5. Only one active lock may exist for a physical unit at any instant.
6. AI may recommend/explain/navigate but may not silently lock a unit, confirm payment, modify price, override priority, approve financial exceptions or execute a legal signature.
7. Transaction Operations owns post-lock completion requirements.
8. Documents can remain pending and be completed later without recreating the transaction.
9. Commission eligibility is policy-driven and auditable; it is never a manually inferred number.
10. Broker Agent must not receive confidential developer-broker commission percentages or rates.
11. Financial changes use immutable ledger/reversal concepts; destructive history edits are forbidden.
12. Price versions, contract versions, refund policies and commission policies are versioned. Historical transactions retain the exact version used.
13. Every authoritative command is tenant/project scoped and server-authorized.
14. Every material business action generates an immutable audit event.
15. PRENEURA Super Admin access to tenant data is explicit, time-bounded where appropriate, and audited.

---

## 3. Target system topology

```text
Buyer Web / Broker Portal / Staff Portal / PRENEURA Control Plane
                         |
                  HTTPS / WSS
                         |
                 API Gateway / WAF
                         |
              PRENEURA API (NestJS)
                         |
     +-------------------+-------------------+
     |                   |                   |
 PostgreSQL          Redis             Object Storage
 source of truth   cache/realtime       S3-compatible
     |
 Transactional Outbox
     |
 Domain Event Publisher ----> WebSocket/SSE clients
     |
 Temporal Workflows / Activities
     |
 Notifications | Documents | AI | Payments | E-sign | ERP/CRM adapters
```

### Production processes

- `web`: authenticated customer/staff/broker application.
- `admin`: separate PRENEURA Control Plane application.
- `api`: synchronous command/query API and authorization boundary.
- `worker`: Temporal workflows and activities.
- `realtime`: websocket/SSE gateway; can initially live in `api`, separable later.
- `migration/cli`: imports, repair tools and controlled operator commands; never exposed publicly.

---

## 4. Recommended technology baseline

### Application

- Language: **TypeScript** in strict mode.
- Runtime: **Node.js active LTS**. For the October 2026 bootstrap, use Node 24 LTS until Node 26 has completed LTS qualification for our dependencies.
- Frontend: **Next.js Active LTS + React 19**, TypeScript.
- Backend: **NestJS**, TypeScript, Fastify adapter.
- Package manager: **pnpm workspaces**.
- Monorepo task orchestration: **Turborepo**.

### Frontend libraries

- Server state: TanStack Query.
- Tables: TanStack Table + virtualization where required.
- Forms: React Hook Form + Zod.
- UI primitives: Radix-based accessible primitives / source-owned component library.
- Styling: design tokens + Tailwind CSS or equivalent utility layer; no page-specific uncontrolled CSS sprawl.
- Local UI state: Zustand only where React/local state is insufficient. Do not mirror server records in a global client store.
- E2E: Playwright.

### Backend/data

- Database: **PostgreSQL 18** production major.
- SQL/data access: **Kysely + node-postgres**; critical transaction/locking code uses explicit SQL and PostgreSQL locking semantics.
- Cache/rate limit/realtime fanout: Redis.
- Durable orchestration: **Temporal**.
- API contract: REST/JSON + OpenAPI for external/public APIs; WebSocket/SSE for live events.
- Validation: Zod/shared generated contracts at application boundaries.
- Search initially: PostgreSQL `pg_trgm` + full-text search; do not add OpenSearch until measured need.
- AI retrieval/semantic search where needed: PostgreSQL `pgvector`.

### Storage/documents

- Managed S3-compatible object storage.
- SHA-256 content hash.
- MIME sniffing and allow-lists.
- malware scanning before a file becomes trusted/available.
- signed URLs; private objects by default.
- immutable executed-contract object versions.

### Observability

- OpenTelemetry traces + metrics.
- structured JSON logs using Pino.
- OTel Collector.
- Prometheus/Grafana for metrics.
- Tempo or equivalent trace backend.
- Loki or equivalent log backend.
- Sentry can be used for browser/runtime exception triage, but is not the system of record for audit.

### Infrastructure

- Docker for every deployable process.
- Docker Compose for local development.
- Terraform for production infrastructure.
- Reference production cloud: AWS Middle East region where customer/data-residency needs fit: RDS PostgreSQL, ElastiCache Redis, S3, ECS/Fargate, ALB, WAF, CloudFront, KMS, Secrets Manager.
- Staging/demo may run on Railway if operational requirements are satisfied.
- Temporal: managed Temporal Cloud where compliance permits; otherwise HA self-hosted Temporal.

### CI/CD and supply-chain

- GitHub Actions.
- Renovate or Dependabot.
- ESLint + Prettier.
- TypeScript `tsc --noEmit`.
- unit/integration/e2e/concurrency/security jobs.
- Semgrep/CodeQL where suitable.
- Trivy container/dependency scan.
- SBOM generation for release images.
- signed/traceable build artifacts.

---

## 5. Monorepo target structure

```text
/
├─ apps/
│  ├─ web/                       # Buyer + staff + broker product
│  ├─ admin/                     # PRENEURA Super Admin control plane
│  ├─ api/                       # NestJS modular monolith
│  └─ worker/                    # Temporal workers
│
├─ packages/
│  ├─ contracts/                 # API/event schemas, shared enums, Zod contracts
│  ├─ db/                        # migrations, typed SQL, fixtures
│  ├─ domain/                    # pure domain types/rules with no framework dependency
│  ├─ ui/                        # design system
│  ├─ auth/                      # shared auth helpers, permission identifiers
│  ├─ observability/             # OTel/logging packages
│  ├─ config/                    # typed environment config
│  ├─ testkit/                   # builders, fixtures, test containers helpers
│  └─ sdk/                       # generated/typed API client
│
├─ services/
│  └─ local-ai/                  # optional private inference runtime; isolated from core API
│
├─ legacy/
│  └─ demo-6.7/                  # preserved reference/demo artifact after migration
│
├─ docs/
│  ├─ PRODUCTION_MASTER_PLAN.md
│  ├─ PRODUCTION_DOMAIN_MODEL.md
│  ├─ PRODUCTION_DELIVERY_GATES.md
│  ├─ adr/                       # architecture decision records
│  └─ runbooks/                  # backup, restore, incident, tenant support
│
├─ infra/
│  ├─ terraform/
│  ├─ docker/
│  └─ compose/
│
└─ .github/workflows/
```

No new production domain should be implemented by appending global JavaScript to the 6.7 legacy shell.

---

## 6. Bounded contexts / backend modules

Each module owns its tables, commands, queries, policies and emitted domain events. Cross-module writes happen through explicit application services, never by arbitrary table access from another module.

### 6.1 Identity & Tenancy

Owns:
- tenant/developer organizations;
- user identities and tenant memberships;
- project memberships;
- broker-company memberships;
- role/capability assignment;
- support-access sessions;
- tenant features and configuration.

Identity provider: Keycloak/OIDC. Application authorization remains server-side and scope-aware.

### 6.2 Project Catalog

Owns:
- projects;
- phases;
- buildings/clusters;
- floors;
- unit types;
- physical units;
- master-plan coordinates/assets;
- payment-plan definitions;
- sales windows.

### 6.3 Pricing

Owns:
- rate cards;
- price per internal/BUA m²;
- garden rate;
- roof/terrace rate;
- type/building/floor/view/corner premiums;
- discounts and approval limits;
- pricing versions;
- quote calculation and line-item explanation;
- locked transaction price snapshot.

Pricing functions are deterministic and property-tested.

### 6.4 Buyer / CRM

Owns:
- buyer/customer record;
- identity/profile/contact methods;
- consent/preferences;
- duplicate-resolution links;
- source and campaign;
- broker attribution;
- buyer notes/tasks.

### 6.5 EOI

Owns:
- EOI application/payment;
- eligibility;
- project/phase eligibility;
- policy acknowledgement;
- refund policy version;
- refund cases.

### 6.6 Allocation Queue

Owns:
- attendance mode;
- check-in;
- queue tokens;
- priority score/ordering;
- call/no-show/recall state;
- online capacity;
- allocator seat capacity;
- queue SLA metrics.

Queue ordering is deterministic, explainable and immutable except through explicit authorized policy events.

### 6.7 Allocation Session & Unit Lock

Owns:
- buyer allocation session;
- exact-unit selection;
- authoritative unit lock;
- lock TTL;
- handoff grace;
- extension requests/decisions;
- release reason;
- conflicts.

Lock acquisition transaction must validate:

1. buyer eligibility;
2. unit availability;
3. pricing version/quote validity;
4. no active lock exists;
5. idempotency key;
6. project/tenant scope;
7. create lock + unit status transition + event/outbox atomically.

### 6.8 Transaction Completion

Owns:
- transaction case;
- requirement checklist;
- responsibility/owner;
- due date;
- requirement status;
- payment readiness;
- cheque readiness;
- document readiness;
- signed/stamped contract readiness;
- pending completion queues.

Required operator work queues:
- Needs Documents
- Needs Payment
- Needs Cheques
- Needs Buyer Signature
- Needs Company Signature/Stamp
- Verification Needed
- Ready to Complete
- SLA Breached

### 6.9 Payments, Cheques & Installments

Owns:
- payment intents/evidence;
- gateway/webhook events;
- manual/bank transfer verification;
- immutable ledger entries;
- payment allocation;
- down payment;
- cheque register;
- installment schedule;
- collections/overdue status;
- reversals/refunds.

Cheque states at minimum:
`EXPECTED -> RECEIVED -> DEPOSITED -> CLEARED`, with `BOUNCED`, `REPLACED`, `CANCELLED` exception paths.

Never update money history by overwriting an old record. Use ledger entries and reversals.

### 6.10 Documents & Signatures

Owns:
- document metadata;
- object versions;
- required document category;
- verification;
- contract template/version;
- generated contract snapshot/hash;
- signature envelope;
- signer sequence;
- signature evidence/provider receipt;
- executed signed/stamped contract.

Supported signing UX:
- typed acknowledgment/signature where policy allows;
- drawn signature;
- uploaded signature only where explicitly allowed;
- external licensed e-sign provider adapter;
- physical print/sign/fingerprint/stamp/upload.

A pasted image alone must never be represented as stronger legal evidence than it is.

### 6.11 Broker Operations

Owns:
- broker companies;
- broker users;
- Broker Manager / Finance / Agent roles;
- assigned buyers;
- broker sales pipeline;
- agent performance;
- completion progress.

Broker Agent sees buyer progress and commission-state milestones but **not commission percentage/rate or confidential agreement economics**.

### 6.12 Commission Engine

Owns:
- commission agreements;
- versioned commission policies;
- eligibility milestones;
- entitlement calculation;
- commission cases;
- invoices;
- due-date countdown;
- payment/reconciliation.

Example policy conditions:
- minimum down payment cleared;
- all required cheques received or cleared according to agreement;
- buyer contract signed;
- company signature completed;
- company stamp/executed contract uploaded;
- mandatory buyer documents verified;
- cancellation/refund hold window completed.

On transition to `ELIGIBLE`, persist:
- eligibility timestamp;
- policy version;
- computed base;
- rate/amount;
- due-date rule;
- due timestamp.

Agent-facing DTOs omit confidential rate/amount fields unless a tenant explicitly grants a separate permission.

### 6.13 Notifications, Tasks & SLA

Owns:
- task templates;
- task instances;
- recipient/responsible actor;
- notification templates;
- schedules;
- channel routing;
- delivery/retry status;
- escalation policies;
- deduplication.

Channels:
- in-app;
- WhatsApp Cloud API;
- email;
- SMS optional;
- web push optional.

Use approved WhatsApp templates whenever platform rules require them. Do not put business logic inside the WhatsApp adapter.

Installment reminder policies are tenant-configurable, e.g. T-7, T-3, T-1, due date, overdue +1/+3/+7.

### 6.14 AI Gateway

Owns:
- provider configuration;
- PRENEURA private/local AI;
- third-party provider adapters;
- model/prompt version registry;
- tool/action allow-list;
- recommendation schema;
- cost/latency/error telemetry;
- evaluations.

Critical design rule:

**Structured deterministic engines decide eligibility, availability, pricing, lock state, payment state and commission state. LLMs explain/recommend; they do not become the source of truth.**

Buyer AI is optional. Manager AI is optional and uses read-only tools by default. Mutating tools require confirmation and existing server permissions.

### 6.15 Import / Export

Imports:
`Template -> Upload -> Column Mapping -> Validate -> Error Preview -> Approval -> Version -> Publish`

Templates:
- projects/phases/buildings/floors/units;
- pricing;
- payment plans;
- buyers;
- brokers/agents;
- installment/cheque schedules;
- contract/document templates.

Exports:
- every list/grid;
- filtered scope only;
- permission-aware field projection;
- large exports run asynchronously and produce an expiring signed object URL;
- export action is audited.

### 6.16 Audit & Compliance

Append-only application audit event fields:
- event ID;
- server timestamp;
- tenant/project/phase;
- buyer/EOI/token/unit/lock/transaction/contract/commission/refund IDs where relevant;
- actor user ID;
- actor role/capability;
- source/integration;
- command/action;
- before/after summary where appropriate;
- reason/override reason;
- correlation/request ID;
- idempotency key;
- result.

Audit is not a mutable CRM note table.

### 6.17 Reporting & Analytics

Initial architecture:
- transactional PostgreSQL;
- explicit read models/materialized views for operational dashboards;
- event-derived KPI tables for expensive aggregations;
- external BI read-only connection for deeper analysis.

Do not introduce ClickHouse/OpenSearch/Kafka until transaction/event volume demonstrates that PostgreSQL + outbox + Redis is insufficient.

### 6.18 PRENEURA Control Plane

Separate internal application for PRENEURA operators.

Capabilities:
- tenants and projects;
- plan/features;
- users/roles overview;
- integration health;
- AI provider health/cost;
- notification delivery health;
- workflow backlog;
- failed jobs/dead-letter cases;
- storage usage;
- system/version health;
- support access;
- audit search.

Support/break-glass access requires reason, MFA, expiry and immutable audit.

---

## 7. Role and permission model

Do not encode authorization as page names. Use capabilities + scopes.

Default role templates:

| Role | Scope | Key powers |
|---|---|---|
| PRENEURA Super Admin | platform | tenant/platform administration, audited support |
| Operations Director | tenant | highest developer-side governance across projects |
| Manager | project(s) | project operations, pricing, rules, approvals, reporting |
| Sales | assigned project/buyers | CRM/EOI/follow-up; no privileged finance governance |
| Queue Receptionist | project/allocation day | check-in/token operations |
| Allocator | assigned session/project | assisted unit selection + lock/handoff |
| Transaction Operator | project/transactions | payments, cheques, docs, signatures, completion |
| Broker Manager | broker company | agents/buyers/performance/commission visibility |
| Broker Finance | broker company | entitlements/invoices/due/paid/reconciliation |
| Broker Agent | broker + assigned buyers | buyer progress/tasks; no confidential rate |
| Buyer | self | own journey/property/payments/docs |

Implementation:
- Keycloak provides identity/session/MFA/SSO.
- PostgreSQL stores tenant/project/broker memberships and permission bundles.
- Nest guards resolve capability + resource scope for every command/query.
- API response serializers perform field-level projection for sensitive economics.
- database tenant IDs exist on every tenant-owned table.
- automated cross-tenant leakage tests are mandatory.

---

## 8. Core workflow state machines

### Buyer transaction

`LEAD -> EOI_PENDING -> EOI_ELIGIBLE -> QUEUED -> ALLOCATING -> UNIT_LOCKED -> TRANSACTION_PENDING -> READY_FOR_CONTRACT -> CONTRACT_EXECUTING -> COMPLETED`

Exception states/events do not destroy the main history:
`CANCELLED`, `EXPIRED`, `REFUND_PENDING`, `REFUNDED`, `LOCK_RELEASED`.

### Commission

`TRACKING -> REQUIREMENTS_PENDING -> ELIGIBLE -> DUE -> INVOICED -> PAYMENT_PROCESSING -> PAID`

Exceptions:
`ON_HOLD`, `DISPUTED`, `REVERSED`, `CANCELLED`.

### EOI refund

`REQUESTED -> POLICY_EVALUATED -> REVIEW_REQUIRED/AUTO_APPROVED -> APPROVED -> PROCESSING -> REFUNDED`

or `REJECTED` with reason.

### Document

`EXPECTED -> UPLOADED -> SCANNING -> REVIEW_REQUIRED -> VERIFIED`

Exceptions:
`REJECTED`, `EXPIRED`, `SUPERSEDED`.

---

## 9. Durable workflows in Temporal

Core workflow examples:

1. `AllocationLockWorkflow`
   - lock TTL;
   - short handoff grace;
   - extension decision timeout;
   - controlled release.

2. `TransactionCompletionWorkflow`
   - tracks outstanding requirements;
   - schedules reminders;
   - resumes after documents arrive days later;
   - closes when completion rules are satisfied.

3. `InstallmentReminderWorkflow`
   - schedules configured pre-due reminders;
   - checks actual ledger state before each send;
   - escalates overdue cases.

4. `CommissionCaseWorkflow`
   - waits for milestone events;
   - calculates eligibility once policy is satisfied;
   - starts due-date countdown;
   - reminders/escalation;
   - reconciles payment.

5. `EOIRefundWorkflow`
   - policy evaluation;
   - approval if required;
   - payment reversal/refund adapter;
   - completion/audit.

6. `ContractExecutionWorkflow`
   - generate immutable snapshot;
   - signature steps;
   - company signature/stamp;
   - final executed copy;
   - completion signal.

Temporal stores workflow execution history, but **PostgreSQL remains the business source of truth**. Activities use idempotency keys and persist authoritative results before workflow progression.

n8n may be used for optional non-critical integrations/marketing automations, but never as the sole owner of inventory locks, payment truth, contract state, queue priority or commission entitlement.

---

## 10. API and event conventions

### Commands

Use action endpoints for state transitions rather than generic table CRUD when rules matter.

Examples:
- `POST /v1/units/{unitId}/locks`
- `POST /v1/locks/{lockId}/release`
- `POST /v1/transactions/{id}/requirements/{reqId}/verify`
- `POST /v1/commissions/{id}/invoice`
- `POST /v1/eoi/{id}/refund-requests`

Every mutation supports:
- authenticated actor;
- authorization scope;
- `Idempotency-Key` where duplicate submission is possible;
- correlation/request ID;
- optimistic version if applicable;
- explicit error codes.

### Domain events

Persist an outbox row in the same database transaction as the state change.

Representative events:
- `BuyerRegistered`
- `EOIEligible`
- `QueueTokenIssued`
- `AllocationStarted`
- `UnitLockAcquired`
- `UnitLockExpired`
- `PaymentConfirmed`
- `ChequeCleared`
- `DocumentVerified`
- `ContractSignedByBuyer`
- `ContractExecuted`
- `TransactionCompleted`
- `CommissionEligible`
- `CommissionDue`
- `CommissionPaid`
- `InstallmentDueSoon`
- `InstallmentOverdue`
- `EOIRefunded`

Consumers must be idempotent.

---

## 11. Database rules

1. UUID identifiers; external human-readable references are separate immutable fields.
2. `tenant_id` on every tenant-owned aggregate; `project_id` wherever project scoped.
3. `timestamptz` for timestamps.
4. Monetary values use `numeric` or integer minor units; never floating-point.
5. Percent/rates use fixed precision numeric.
6. JSONB only for truly flexible metadata, not core relationship/state fields.
7. database check constraints for finite state values where appropriate.
8. foreign keys for all authoritative relationships.
9. composite unique constraints include tenant/project boundaries where needed.
10. critical aggregates have `version` for optimistic concurrency.
11. unit active-lock uniqueness is enforced by database constraints/transaction rules, not application memory.
12. outbox/audit entries are written transactionally with state changes.
13. migrations are forward-reviewed and tested against production-like snapshots.

---

## 12. Security baseline

Target: OWASP ASVS Level 2 controls as the application-security baseline.

Mandatory:
- TLS everywhere;
- Keycloak OIDC;
- MFA for privileged staff/broker finance/admin;
- optional enterprise SSO;
- short-lived access tokens / secure refresh-session design;
- secure cookies where BFF session is used;
- CSRF protection for cookie-authenticated mutations;
- CSP and hardened headers;
- rate limits by identity/IP/action;
- brute-force controls;
- KMS-backed secrets/encryption keys;
- secrets only in Secrets Manager/Vault/environment injection, never Git;
- encryption at rest;
- field-level encryption for high-risk identifiers when warranted;
- malware scanning for uploads;
- private object storage;
- immutable audit;
- dependency/container scanning;
- least-privilege cloud IAM;
- database user separation for app/migrations/analytics;
- production data never copied to dev unredacted.

National IDs, passports, signatures and financial documents are sensitive PII. Logging must redact them.

---

## 13. Reliability, backup and SLOs

Initial production objectives:
- API monthly availability target: 99.9% minimum;
- higher event-day capacity profile for allocation launches;
- database PITR enabled;
- encrypted daily backup + continuous WAL/PITR;
- routine restore verification;
- object versioning/retention for contracts;
- Redis is disposable/rebuildable; no unique business truth only in Redis;
- RPO target <= 5 minutes for transactional DB under the selected infrastructure;
- RTO target <= 60 minutes for core application, validated by drills.

Allocation launch readiness requires load testing at significantly above expected concurrent buyer count.

---

## 14. Observability and operational KPIs

Technical:
- API latency/error rate;
- database pool saturation/slow queries;
- lock conflict rate;
- websocket connection count;
- Temporal workflow failures/retries/stuck executions;
- notification send/delivery/failure;
- file-scan backlog;
- AI latency/fallback/cost;
- external provider availability.

Business:
- EOI -> eligible conversion;
- eligible -> queue attendance;
- queue wait p50/p95;
- allocation duration;
- unit lock conversion;
- lock expiry/release reasons;
- payment completion;
- transaction requirement backlog;
- contract completion time;
- installment due/overdue aging;
- broker conversion;
- commission eligibility-to-payment cycle time;
- refund volume/reasons.

Each alert must point to a runbook.

---

## 15. Testing strategy

### Unit/domain
- pricing calculation;
- commission policies;
- refund policy;
- queue priority;
- installment allocation;
- permission projection.

### Property-based
Use generated cases for pricing/commission/refund invariants and money arithmetic.

### Integration
Use disposable PostgreSQL/Redis/Temporal dependencies in CI where practical. Validate migrations and real transaction semantics.

### Concurrency
Mandatory race tests:
- 50-500 simultaneous joins;
- many clients attempt same unit;
- lock expires while payment starts;
- duplicate webhook;
- duplicate file callback;
- repeated commission event;
- simultaneous price publish and allocation quote;
- two operators verify the same requirement.

### Contract/API
OpenAPI contract compatibility tests and provider webhook fixtures.

### E2E
Playwright by role, including field-level restrictions.

### Security
- authorization matrix tests;
- cross-tenant isolation tests;
- OWASP ZAP automated baseline on staging;
- static/dependency/container scans.

### Resilience
- Temporal worker restart during workflow;
- DB failover/reconnect;
- notification provider timeout;
- AI unavailable;
- payment provider timeout;
- object storage transient error;
- browser refresh/reconnect during allocation.

No release is production-ready while the authoritative flow only passes happy-path browser tests.

---

## 16. Delivery workstreams — all required for launch

These are parallel workstreams with dependency ordering, **not optional product phases**.

### WS-A Platform foundation
- monorepo/bootstrap;
- environments;
- typed config;
- DB migration framework;
- auth/tenancy;
- observability;
- CI/CD.

### WS-B Project/inventory/pricing
- project hierarchy;
- imports;
- pricing engine;
- published price versions;
- master plan/unit data.

### WS-C Buyer/EOI/queue/allocation
- canonical buyer;
- EOI;
- shared queue;
- attendance;
- exact-unit allocation;
- atomic lock/grace.

### WS-D Transaction/finance/documents
- requirement cases;
- payments;
- cheques;
- installments;
- documents;
- signatures/contracts.

### WS-E Broker/commission
- broker org/roles;
- buyer attribution;
- completion timeline;
- commission rule engine;
- invoice/due/paid reconciliation.

### WS-F Notifications/SLA/refunds
- tasks;
- WhatsApp/email routing;
- installment reminders;
- missing-step reminders;
- escalation;
- EOI refund workflow.

### WS-G AI
- deterministic recommendation engine;
- provider gateway;
- optional Buyer AI;
- Manager AI;
- local/private inference adapter;
- evaluation and guardrails.

### WS-H Manager/admin/analytics
- Manager operational workspaces;
- Operations Director governance;
- reports/export;
- PRENEURA Control Plane;
- tenant health/support.

### WS-I Hardening/release
- migration/parity;
- concurrency/load/security;
- backup/restore;
- runbooks;
- DR rehearsal;
- production launch rehearsal.

---

## 17. Dependency order

The safest implementation order is:

1. foundation + tenancy/auth + database conventions;
2. catalog/inventory/pricing;
3. buyer/EOI;
4. queue + atomic lock;
5. transaction requirements + documents;
6. payments/cheques/installments;
7. contract/signature execution;
8. broker org + commission engine;
9. task/notification/SLA + refunds;
10. AI gateway + optional agents;
11. Manager/Operations Director/Control Plane dashboards over real APIs;
12. imports/exports and external integration hardening;
13. full legacy parity migration;
14. load/security/DR certification;
15. production cutover.

No customer production launch should occur before the complete launch scope passes the release gates in `PRODUCTION_DELIVERY_GATES.md`.

---

## 18. Migration from 6.7

### Preserve
- current 6.7 demo UX/reference;
- current role/business language where still valid;
- one-shared-queue invariant;
- exact-unit hierarchy;
- lock/grace business model;
- buyer property/installment UX concepts;
- manager live allocation/audit concepts;
- local AI research/runtime as an optional provider.

### Replace
- browser-owned `app.fx` truth;
- global mutable state;
- client-side-only role security;
- browser timers as business deadlines;
- file metadata without persistent secure objects;
- simulated payments/contract state;
- aggregate-only broker commission reporting;
- direct writes without domain commands/audit.

### Migration technique
For each bounded context:
1. define production schema/API/events;
2. implement server domain + tests;
3. implement production UI against API;
4. create demo data importer/fixtures;
5. parity-test against 6.7 behavior;
6. cut traffic for that context to server truth;
7. remove superseded legacy source only after parity acceptance.

Avoid a one-shot 2 MB shell rewrite.

---

## 19. Definition of production done

A feature is not production-done until all applicable conditions are true:

- domain rules documented;
- schema/migration reviewed;
- server authorization enforced;
- tenant scoping tested;
- idempotency defined;
- audit event emitted;
- failure/retry behavior defined;
- Temporal workflow used where the process is long-running;
- metrics/logs/traces added;
- permissions reflected in UI and API DTOs;
- unit/integration/e2e tests pass;
- concurrency test exists if state contention is possible;
- accessibility/responsive behavior reviewed;
- bilingual terminology considered;
- runbook/support notes exist for operationally significant components.

---

## 20. Engineering rules / no-go list

Do not:
- build production truth in localStorage/browser memory;
- use n8n as the authoritative transaction engine;
- use Redis as the only copy of business state;
- hide sensitive fields only with CSS;
- calculate money using JavaScript floating-point arithmetic;
- let AI infer authoritative availability, price, payment or commission state;
- update completed contracts after signing;
- silently overwrite published pricing/import data;
- accept unscanned uploaded files as trusted documents;
- create a microservice per domain before operational need exists;
- add Kafka/Elasticsearch/ClickHouse/Kubernetes solely for architectural fashion;
- permit PRENEURA staff to impersonate a tenant invisibly;
- mutate audit history.

---

## 21. Architecture review checkpoints

Architecture Decision Records are required for:
- authentication/session model;
- tenant isolation strategy;
- atomic lock SQL/constraint design;
- money/ledger representation;
- pricing calculation precedence;
- commission policy DSL/representation;
- contract signing provider/legal evidence model;
- storage/data residency;
- Temporal Cloud vs self-hosted;
- production cloud/runtime;
- AI provider/privacy model;
- support/break-glass access.

The master plan stays stable; ADRs record implementation-specific decisions and their rationale.

---

## 22. Final target

PRENEURA production should operate one continuous auditable lifecycle:

```text
Lead / Buyer / Broker
    -> EOI + eligibility
    -> shared allocation queue
    -> live inventory + deterministic pricing
    -> exact physical unit lock
    -> transaction requirements
    -> down payment + cheques + documents
    -> contract generation + buyer/company execution
    -> completed sale + My Property
    -> installments + collections/reminders
    -> broker commission eligibility + due countdown + payout
    -> analytics / audit / management intelligence
```

All of it is tenant-isolated, role-scoped, realtime, durable across restarts, auditable, exportable and operable from the PRENEURA Control Plane.
