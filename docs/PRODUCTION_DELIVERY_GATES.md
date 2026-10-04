# PRENEURA Real Estate OS — Production Delivery, Governance & Release Gates

This document is the project-management execution model for delivering the complete production system described in `PRODUCTION_MASTER_PLAN.md` and `PRODUCTION_DOMAIN_MODEL.md`.

All named workstreams are required launch scope. The gates below sequence dependencies and quality acceptance; they are not permission to launch a partial system as the final product.

---

## 1. Governance model

### Product authority
Owns:
- business rules;
- customer feedback interpretation;
- terminology;
- launch-scope decisions;
- acceptance of workflow behavior.

### System/solution architecture authority
Owns:
- cross-domain boundaries;
- data consistency;
- integration standards;
- infrastructure/security decisions;
- architecture decision records.

### Engineering leads
Own:
- implementation quality;
- code review;
- module contracts;
- test strategy;
- migration safety.

### QA/release authority
Owns:
- acceptance evidence;
- regression suite;
- concurrency/load tests;
- go/no-go checklist.

No person should be able to bypass production gates merely because a demo path appears to work.

---

## 2. Recommended delivery team capabilities

A production build requires these capabilities, whether filled by dedicated people or combined responsibly:

- Product Owner / real-estate domain owner
- Technical Project Manager / Delivery Lead
- Solution/System Architect
- Backend/Domain Engineering
- Frontend/Product Engineering
- QA Automation / Test Engineering
- DevOps/SRE/Platform Engineering
- Security review capability
- UX/Product Design
- AI/ML engineering for the optional agent/recommendation layer
- Integration engineering for payments, messaging, e-sign/ERP where required

Sensitive financial/security code requires peer review. Do not create a single-maintainer bottleneck for locking, payments, permissions or commission logic.

---

## 3. Backlog hierarchy

Use one traceable hierarchy:

```text
Business Outcome
  -> Domain Epic
      -> Capability
          -> User/Operator Story
              -> Engineering Task
              -> Test Case
              -> Acceptance Evidence
```

Every story must identify:
- actor;
- tenant/project scope;
- preconditions;
- command/action;
- success state;
- failure/exception behavior;
- permission required;
- audit event;
- notification/SLA effect if any;
- observability requirement;
- test evidence.

---

## 4. Definition of Ready

A feature may enter implementation only when:

- product behavior is unambiguous;
- source-of-truth module is identified;
- state transitions are listed;
- permission scope is defined;
- relevant schema/API/event contract is drafted;
- money/timezone/idempotency consequences are understood;
- failure/retry behavior is known;
- acceptance tests are specified.

If these are missing, development is likely to produce demo logic rather than production logic.

---

## 5. Definition of Done

A story is done only when:

- production code merged;
- migrations reviewed and reversible/recoverable where required;
- API contract updated;
- role authorization covered;
- tenant isolation test covered;
- audit event covered;
- unit/integration tests pass;
- E2E test added for critical user paths;
- telemetry/logging added;
- documentation/runbook updated where operationally relevant;
- product acceptance completed.

For financial/locking/security features add:
- concurrency/idempotency tests;
- negative authorization tests;
- failure/retry tests;
- explicit peer review from the appropriate technical owner.

---

## 6. Workstreams and required outputs

### WS-A — Platform Foundation
Deliverables:
- pnpm/Turborepo TypeScript monorepo;
- `apps/web`, `apps/admin`, `apps/api`, `apps/worker`;
- environment/config package;
- PostgreSQL migration/data layer;
- Keycloak integration;
- tenant/project membership/permissions;
- OTel/Pino baseline;
- CI build/test/security workflows;
- Docker local stack;
- staging environment;
- production infrastructure IaC skeleton.

Acceptance:
- authenticated user can only access authorized tenant/project;
- cross-tenant tests prove isolation;
- trace/correlation ID crosses web -> API -> database/workflow boundary;
- one audited sample command executes end to end.

### WS-B — Project, Inventory, Pricing & Imports
Deliverables:
- project/phase/building/floor/unit schema;
- inventory publication;
- price version engine;
- m²/type/garden/roof/modifier calculations;
- quote line-item breakdown;
- unit/price/payment-plan import templates;
- mapping/validation/error preview/publish workflow;
- rollback/version visibility.

Acceptance:
- imported invalid unit references cannot publish;
- published price is deterministic;
- a locked quote remains unchanged after a later price publication;
- formula property tests pass.

### WS-C — Buyer, EOI, Queue & Allocation
Deliverables:
- canonical buyer;
- broker/direct/sales attribution;
- EOI and eligibility;
- allocation day/check-in;
- shared queue;
- online/human channel service;
- unit hierarchy selection;
- atomic unit lock;
- short + extended grace.

Acceptance:
- Online vs Sales Center does not silently alter priority;
- competing requests for one unit yield exactly one successful active lock;
- lock expiry/release is durable through worker/process restart;
- manager and buyer see consistent server truth.

### WS-D — Transaction Completion, Documents & Contracts
Deliverables:
- transaction requirement templates/instances;
- deferred completion queues;
- document object storage, malware scan and verification;
- contract templates/versioning;
- contract generation/hash;
- signature envelopes;
- buyer/company signature/stamp path;
- physical executed-contract upload path.

Acceptance:
- incomplete transactions can resume later;
- executed contract cannot be mutated;
- permission-checked document access works;
- stale/superseded document versions remain historically attributable.

### WS-E — Payments, Cheques, Installments & Collections
Deliverables:
- payment/evidence model;
- webhook inbox/deduplication;
- financial ledger;
- down-payment allocation;
- cheque lifecycle;
- installment schedules;
- partial payment allocation;
- overdue/aging read models;
- reversal/refund financial entries.

Acceptance:
- duplicate webhook cannot duplicate money;
- reversal preserves history;
- bounced/replaced cheque retains both records;
- installment balances reconcile exactly to ledger allocations.

### WS-F — Broker Organization & Commission
Deliverables:
- Broker Company;
- Broker Manager, Broker Finance, Broker Agent accounts;
- broker/project scopes;
- attribution;
- buyer completion timeline;
- versioned commission agreement/policy;
- milestone engine;
- entitlement calculation;
- due countdown;
- invoice/payment/reconciliation.

Acceptance:
- policy determines commission eligibility from authoritative transaction facts;
- changing a policy never mutates historical entitlement calculations;
- Broker Agent responses contain no confidential rate/amount fields;
- Finance/Manager views reconcile entitlement -> invoice -> paid amount.

### WS-G — Tasks, Notifications, SLA & EOI Refunds
Deliverables:
- task/assignment engine;
- notification template library;
- in-app notification center;
- Meta WhatsApp adapter;
- email adapter;
- delivery status/retries/deduplication;
- installment reminders;
- missing-step reminders/escalation;
- EOI refund policy versions;
- refund workflow and approvals.

Acceptance:
- state is rechecked before any reminder is sent;
- retries do not duplicate logical notifications;
- refund uses the correct historical policy version;
- buyer/staff/broker recipients receive only messages relevant to their responsibilities.

### WS-H — AI Gateway & Recommendations
Deliverables:
- deterministic structured recommendation baseline;
- PRENEURA local/private provider adapter;
- third-party provider abstraction;
- optional Buyer AI toggle;
- optional Manager AI;
- read-only manager tools by default;
- explicit confirmation for mutating AI-prepared actions;
- prompt/model versioning;
- AI evaluation suite;
- latency/cost/fallback telemetry.

Acceptance:
- AI unavailable does not block manual workflow;
- AI cannot override authoritative eligibility/price/lock/payment/commission truth;
- recommendation output references live unit IDs and is revalidated before action.

### WS-I — Manager, Operations Director & PRENEURA Control Plane
Deliverables:
- project operational overview;
- live allocation;
- Buyer 360°;
- transaction backlogs;
- finance/collections;
- broker/commission dashboards;
- imports/exports;
- audit search;
- Operations Director cross-project governance;
- PRENEURA tenant/system health console;
- audited support/break-glass access.

Acceptance:
- every KPI drills to the underlying authoritative records;
- no KPI is produced from browser-only state;
- PRENEURA support access is explicit and auditable;
- all exports enforce field-level permissions.

### WS-J — Release Engineering, Reliability & Security
Deliverables:
- load profiles;
- performance baseline;
- backup/PITR;
- restore runbook + successful restore test;
- incident runbooks;
- security baseline scan;
- secrets rotation procedure;
- deployment/canary/rollback procedure;
- event-day allocation runbook;
- DR rehearsal;
- final production readiness evidence.

---

## 7. Release gates

### Gate 0 — Architecture Baseline Approved
Required:
- master plan approved;
- domain model approved;
- key ADRs created;
- launch scope frozen except controlled change process.

### Gate 1 — Platform Foundation Certified
Required:
- auth/tenant isolation;
- migrations;
- CI/CD;
- staging;
- observability;
- baseline security.

No production domain is allowed to invent its own authentication, DB conventions or audit format after this point.

### Gate 2 — Inventory/Allocation Consistency Certified
Required:
- project/inventory/pricing;
- buyer/EOI/queue;
- atomic unit locks;
- concurrency evidence;
- realtime consistency.

This is the first critical transactional gate.

### Gate 3 — Transaction/Financial Consistency Certified
Required:
- requirements;
- documents;
- payments;
- cheques;
- installments;
- contract execution;
- reconciliation evidence.

### Gate 4 — Broker/Commission/Notification Certified
Required:
- broker role split;
- commission engine;
- countdown;
- reminders/SLA;
- refund workflow;
- sensitive field projection tests.

### Gate 5 — Full Role/Product Parity Certified
Required:
- Buyer;
- Sales;
- Receptionist;
- Allocator;
- Transaction Operator;
- Manager;
- Operations Director;
- Broker Manager;
- Broker Finance;
- Broker Agent;
- PRENEURA Admin;
- optional AI paths and non-AI paths.

### Gate 6 — Non-Functional Certification
Required:
- load/concurrency;
- security;
- accessibility/responsiveness;
- backup/restore;
- observability/alerting;
- failover/failure behavior;
- production runbooks.

### Gate 7 — Production Go/No-Go
Required:
- no open P0/P1 launch defects;
- migration rehearsal complete;
- production configuration reviewed;
- integrations verified with production credentials/endpoints;
- data backup/restore verified;
- monitoring dashboards and alerts live;
- rollback path validated;
- named operational owners available.

---

## 8. Environment strategy

### Local
- Docker Compose dependencies;
- seed tenants/projects;
- fake provider adapters by default;
- developer never needs production credentials.

### CI
- ephemeral tests;
- deterministic fixtures;
- disposable database;
- no shared mutable test environment required for unit/integration checks.

### Staging
- production-like topology;
- synthetic data only unless approved masked dataset is used;
- real sandbox provider integrations;
- performance/security test target.

### Production
- separate accounts/projects/resources/secrets;
- restricted operator access;
- migrations executed through controlled release workflow;
- no manual database changes outside emergency runbook.

Optional customer/private deployment profile should be built from the same containers/IaC principles rather than a separate codebase.

---

## 9. Branch and PR policy

Recommended:
- `main`: production/releasable baseline;
- `develop`: integration while migration is active if the team retains this model;
- short-lived feature branches;
- release tags for deployed versions.

Required PR checks:
- format/lint;
- TypeScript;
- unit tests;
- integration tests for affected domains;
- migration validation;
- build;
- E2E smoke for critical routes;
- security/dependency scan;
- architecture boundary check.

`main` must be protected. Direct pushes should be disabled once production development begins.

Critical paths require CODEOWNERS review:
- auth/permissions;
- DB migrations;
- lock engine;
- payments/ledger;
- contracts/signatures;
- commission rules;
- infrastructure/security.

---

## 10. Architecture Decision Record set

Create ADRs before implementation locks these choices:

1. Modular monolith + Temporal workers.
2. Keycloak/OIDC session architecture.
3. Tenant/project authorization and optional PostgreSQL RLS defense-in-depth.
4. PostgreSQL locking constraint/transaction algorithm.
5. Money and ledger representation.
6. Price rule precedence and snapshot strategy.
7. Commission rule representation/versioning.
8. Notification retry/dedup semantics.
9. Object storage/scan/retention.
10. Contract/e-sign provider model.
11. Cloud/data region strategy.
12. Temporal deployment strategy.
13. AI provider/privacy/tool-authorization model.
14. Realtime transport/outbox design.
15. Support/break-glass model.

---

## 11. Test matrix by role

Each role receives positive and negative tests.

### Buyer
- own records only;
- AI on/off;
- EOI/refund;
- allocation/lock confirmation;
- transaction requirements;
- contract/property/installments.

### Sales
- assigned/project buyer operations;
- cannot approve finance/commission rules without permission.

### Receptionist
- check-in/token only;
- cannot reorder priority directly.

### Allocator
- only assigned/next eligible session;
- can lock under policy;
- cannot approve finance/grace authority outside role.

### Transaction Operator
- requirements/payments/cheques/docs/contracts;
- cannot change published pricing without permission.

### Broker Agent
- assigned buyers;
- no confidential commission economics.

### Broker Manager
- company agents/performance and allowed commission details.

### Broker Finance
- entitlement/invoice/payment operations.

### Manager
- project governance subject to explicit permissions.

### Operations Director
- cross-project tenant governance.

### PRENEURA Super Admin
- control plane;
- tenant data access only through audited support mechanism.

---

## 12. Production migration/cutover strategy

Do not convert the 6.7 browser state directly into production truth.

### Step A — preserve
Archive/reference the 6.7 experience and its deterministic presentation fixtures.

### Step B — build server truth
Implement production modules with explicit schema/API/events.

### Step C — parity adapters
Where useful, production UI can initially mimic existing page IDs/terminology while reading real APIs.

### Step D — data import
Existing client data uses controlled import jobs with validation/publish, not raw table inserts.

### Step E — rehearsal
Run complete synthetic buyer journeys including exceptions, restarts and duplicate events.

### Step F — production cutover
- freeze configuration imports;
- take backup;
- publish validated project/inventory/pricing data;
- enable users/integrations;
- execute smoke suite;
- open sales/allocation only after go/no-go checks.

### Step G — stabilization
Use audit/metrics/error budgets to detect issues. Do not delete the recoverable demo/reference assets until production migration is accepted.

---

## 13. Change control

Customer feedback is classified as:

- **Rule change**: changes authoritative business behavior; requires domain + migration/test impact review.
- **Configuration change**: supported by versioned policy/config without code.
- **UX change**: presentation/workflow usability with unchanged source-of-truth semantics.
- **Integration change**: provider adapter/API mapping.
- **Reporting change**: read model/KPI/export.

The goal is to move repeated customer-specific requests from code changes into safe versioned configuration whenever the rule is legitimately configurable.

---

## 14. Risk register

### R1 — Prototype logic leaks into production
Mitigation: no production authority in legacy browser state; parity tests only.

### R2 — Unit oversell
Mitigation: PostgreSQL atomic lock + unique active-lock invariant + concurrency tests.

### R3 — Cross-tenant/broker data leak
Mitigation: explicit scopes, field projection, automated isolation tests, optional RLS defense-in-depth.

### R4 — Financial inconsistency
Mitigation: immutable ledger, idempotent webhooks, reconciliation, no float arithmetic.

### R5 — Commission disputes
Mitigation: versioned agreement/policy + milestone evidence + immutable entitlement snapshot.

### R6 — Stale reminder harassment
Mitigation: durable schedule plus authoritative state check immediately before send.

### R7 — Document/security incident
Mitigation: private storage, scan, MIME validation, signed access, retention policy.

### R8 — AI unsafe action
Mitigation: structured read tools, server authorization, explicit action confirmation, deterministic business engines.

### R9 — Over-engineering slows delivery
Mitigation: modular monolith; no distributed infrastructure without measured requirement.

### R10 — Production operations neglected
Mitigation: SRE/runbooks/restore/load/security gates are launch requirements, not afterthoughts.

---

## 15. Presentation/demo strategy during production build

The customer demo remains useful but must be clearly labeled as demonstration data.

Maintain deterministic scenarios for:
- normal allocation;
- high queue load;
- unit-lock conflict;
- missing transaction documents;
- cheque pending/bounced/replaced;
- installment due/overdue reminder;
- broker commission prerequisites;
- commission becomes eligible + countdown;
- EOI refund approved/rejected;
- AI available/unavailable;
- multi-project Operations Director view;
- PRENEURA tenant health view.

Once corresponding production modules exist, these scenarios should be driven through production APIs with synthetic tenants rather than browser-only mutations.

---

## 16. Launch acceptance statement

PRENEURA is ready for live real-estate operations only when a complete buyer journey can survive:

- multiple browsers/devices;
- process restart;
- duplicate requests/webhooks;
- delayed documents;
- delayed cheques;
- provider outage;
- user reconnect;
- high allocation concurrency;
- price version changes;
- commission policy history;
- tenant isolation attempts;

while preserving one authoritative, auditable result in PostgreSQL.
