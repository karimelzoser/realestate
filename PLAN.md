# PRENEURA Completion Plan

Status: **active authoritative continuation plan**  
Target: **SOFTWARE_READY_FOR_DEPLOYMENT**  
Live deployment: **deferred**  
Continuation branch: `integration/software-ready-for-deployment`

This plan continues the existing PRENEURA production program. It does not replace the detailed architecture documents under `docs/`; it records the current execution order and completion criteria after the hosting/product-scope corrections in `DECISIONS.md`.

## 1. Product scope that must be complete

### Market and personas

- Egypt initial market.
- Developer organizations and projects.
- Broker companies with Broker Manager, Broker Finance, and Broker Agent roles.
- Buyer direct and broker-attributed journeys.
- Developer Operations Director, Manager, Sales, Queue Receptionist, Allocator, and Transaction Operator roles.
- PRENEURA Super Admin control plane with explicit audited support access.

### Buyer/sales journey

1. Buyer identity/profile.
2. Apartment/unit-type exploration.
3. EOI created for an apartment/unit type.
4. Shared queue/check-in/priority.
5. Allocation session shows eligible **exact physical apartments** belonging to the EOI type.
6. Buyer/allocator selects one exact apartment.
7. PostgreSQL atomically locks that exact apartment; queue position alone never reserves it.
8. Reservation freezes certified price/version and exact physical-unit identity.
9. Transaction Operations completes payments, cheques, documents, signatures, stamped contract, and later missing requirements.
10. Buyer sees post-sale/installment/property state.

### Commercial/operations scope

- versioned price-per-m² engine including indoor/roof/garden and approved premiums/discounts;
- payment plans and installments;
- immutable financial ledger, reversals/refunds, provider idempotency, cheque replacement history;
- EOI refund policy/version/request/review flow;
- secure document templates/uploads/trust scanning;
- buyer/company signatures and immutable contract execution evidence;
- broker commission plan, eligibility, invoice/due/paid/disputed state, completion %, countdown and field-level confidentiality;
- task/SLA/reminder engine for missing steps and installment due dates;
- WhatsApp/SMS/email/in-app provider gateway boundary;
- CSV/XLSX import templates, validation/preview/publish/rollback and exports;
- project hierarchy/master-plan assets;
- optional buyer/manager AI and third-party recommendation gateway;
- platform-wide admin/control-plane views;
- audit/realtime/SSE/notification inbox.

### Language and interaction scope

- English production UI.
- Arabic production UI with real RTL layout/formatting, not machine-reversed strings.
- English voice assistant production integration first.
- Arabic voice remains later unless separately promoted into initial release scope.

## 2. Already implemented/certified in the current stack

The current integration base inherits the completed stacked production work through runtime-readiness PR #52, including:

- passwordless phone/National-ID OTP and Google OIDC identity boundary;
- tenant/project/broker scoped capability authorization;
- project/unit-type catalog and price versions;
- project hierarchy, physical-unit import model and master-plan asset ingestion;
- buyer, EOI/refund, queue, reservation and transaction domains;
- document templates, secure direct uploads, malware/type trust, signatures and immutable executed-contract evidence;
- payment schedules, append-only ledger, payment allocations, reversals/refunds, provider-ingress idempotency and cheque replacement evidence;
- broker commission rules/eligibility/countdowns and redacted agent views;
- notification policies, installment/milestone schedulers, user inbox and external notification gateway;
- role-aware production web workspace and transaction operations UI;
- project setup/import center and export paths;
- optional deterministic/third-party AI recommendation layer;
- PRENEURA Super Admin control plane and time-limited support access;
- transactional outbox + durable realtime replay/SSE;
- strict TypeScript production build gates;
- PostgreSQL migration/constraint/certification gates;
- immutable pricing certification;
- document/contract trust certification;
- finance-ledger certification;
- frozen dependency graph/reproducible install gate;
- runtime liveness/readiness, serialized migrations, schema compatibility and migration-drift protection;
- GitHub Pages synthetic demonstration and legacy 6.7 browser regression suite.

## 3. Highest-priority unfinished work

### P0 — Correct inventory commitment journey

**Current product correction:** EOI is type-level; allocation is exact-apartment-level.

Required work:

- persist/validate EOI requested unit type;
- expose exact physical units eligible for that EOI during allocation;
- make the active lock reference an exact physical unit, not only anonymous type capacity;
- prevent type mismatch, cross-project assignment and double locking in PostgreSQL;
- persist exact physical unit on reservation/transaction;
- show building/floor/unit reference and current type price/availability in allocator UI;
- preserve type-level availability cards before allocation;
- concurrency certification: many simultaneous lock attempts against one physical unit yield exactly one winner;
- regression tests for release/expiry/conversion and price snapshot immutability.

### P0 — Complete bilingual production UI

- introduce production i18n routing/dictionaries for English + Arabic;
- RTL layout and component behavior;
- locale-aware money/date/number formatting;
- Arabic validation/status/navigation copy;
- automated smoke/e2e coverage for both locales;
- ensure user-entered Arabic strings render in correct logical order.

### P0 — Production contract generation/e-sign orchestration

Existing trusted document/signature evidence must be completed with:

- deterministic contract generation from versioned template + buyer/unit/price/payment snapshot;
- generated-document hash before signing;
- external e-sign provider adapter contract with synthetic fake provider for CI;
- physical/offline signing path preserved;
- callback idempotency and signer-order verification;
- no live-provider success claim without credentials.

### P0 — Durable workflow completion

- reconcile the current durable PostgreSQL worker loops with the master-plan workflow requirements;
- implement Temporal-backed orchestration where required for long-running allocation grace, transaction completion, refund, contract and commission workflows, or explicitly document/certify the PostgreSQL durable-state equivalent where chosen;
- crash/restart/idempotency tests for every long-running process.

### P0 — English voice production path

- connect the English voice UI to authenticated, authorized production read/command APIs;
- use voice as navigation/advisory input only unless a command passes the same deterministic permission/confirmation boundary as normal UI;
- no browser-local business truth;
- synthetic/local provider path for CI when external speech credentials are unavailable.

## 4. Provider/integration completion

Implement provider adapters behind existing internal contracts, each with a fake/test adapter and explicit live-verification status:

- Meta WhatsApp templates/delivery/webhooks;
- SMS provider;
- email provider;
- Google/Keycloak production OIDC configuration contract;
- S3-compatible storage;
- malware scanner;
- payment-provider normalized webhook adapters;
- external e-sign provider;
- optional external AI providers.

Unavailable credentials are dependencies, not blockers for code completion. Provider adapters must be signature/idempotency tested with fixtures where possible.

## 5. Portable deployment package — prepare now, deploy later

The package must be host-neutral and Docker Compose authoritative.

### Images

- production multi-stage Dockerfile for web;
- production multi-stage Dockerfile for API;
- production multi-stage Dockerfile for worker;
- production multi-stage Dockerfile for notification gateway;
- migration/CLI image or deterministic migration command;
- OCI labels, git SHA/version tags, non-root runtime users, health checks;
- reproducible builds from committed `pnpm-lock.yaml`;
- SBOM + vulnerability scan in CI.

### Compose

- `compose.local.yml` for disposable developer integration;
- `compose.staging.yml` for production-like disposable validation;
- `compose.production.yml` portable production definition;
- private backend network;
- only reverse proxy published publicly in production compose;
- persistent volumes for PostgreSQL, Keycloak DB/data as applicable, and S3-compatible object storage when self-hosted;
- restart policies and resource limits/reservations;
- health-based dependency ordering;
- no embedded secrets.

### Edge/realtime

- portable reverse proxy configuration (Caddy or Nginx; choose and document one canonical default);
- HTTPS-ready configuration with placeholder domains only;
- SSE proxy buffering disabled and long-lived connection timeouts configured;
- forwarded headers/trusted proxy behavior documented;
- secure headers and upload-size/time limits.

### Release tooling

- serialized migration script;
- deployment preflight;
- image/version manifest;
- rollout script;
- smoke-test script;
- rollback script constrained by runtime/schema compatibility;
- backup verification before migrations;
- zero live-host assumptions.

### Backup/restore and operations

- PostgreSQL backup/restore and PITR guidance;
- Keycloak/identity database backup/restore;
- object-storage backup/versioning/restore;
- integrity checks after restore;
- monitoring dashboards/alerts;
- incident, provider outage, queue backlog, notification failure, database saturation, storage/scanner and rollback runbooks.

## 6. Synthetic demonstration

GitHub Pages remains a synthetic product demonstration only.

Requirements:

- clearly labeled synthetic/demo data;
- cannot imply real backend persistence or real transactions;
- maintained as presentation evidence while the production Next.js/NestJS system is tested separately in CI/disposable environments.

## 7. Release engineering / non-functional certification

Before SOFTWARE_READY_FOR_DEPLOYMENT:

- unit/domain tests for critical rules;
- API integration tests;
- PostgreSQL migration-from-zero and upgrade tests;
- exact-apartment concurrency test;
- webhook replay/idempotency tests;
- browser E2E for English + Arabic;
- role/tenant isolation tests;
- backup/restore disposable test;
- container build/start/health certification;
- Compose full-stack disposable certification;
- basic load/latency/concurrency baseline;
- dependency/container/SBOM security checks;
- config/secret fail-closed tests;
- complete operator docs and state ledger.

## 8. SOFTWARE_READY_FOR_DEPLOYMENT definition

The milestone is reached only when:

1. required product scope is implemented and server-authoritative;
2. the EOI type → exact apartment allocation rule is certified;
3. English/Arabic production UI and English voice path meet scope;
4. all portable Docker/Compose artifacts build and boot in disposable CI;
5. migrations, readiness, backup/restore, smoke/rollback and operational runbooks are tested without a live host;
6. every unavailable live provider/domain/credential verification is explicitly listed;
7. GitHub Pages demo is clearly synthetic;
8. `WORK_STATE.json` records `software_ready_for_deployment: true` with supporting workflow/commit evidence.

This milestone does **not** mean the platform has been deployed to the user's server.

## 9. Deferred LIVE_PRODUCTION_GO assignment

Only after explicit authorization:

- select/confirm actual host;
- inspect server capacity/OS/network;
- configure DNS/firewall/TLS/secrets;
- restore/initialize production data;
- run production preflight/migrations/rollout;
- validate live providers and external callbacks;
- execute final go/no-go.

Until then, server access is neither requested nor required.
