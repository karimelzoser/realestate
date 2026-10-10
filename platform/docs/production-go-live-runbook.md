# PRENEURA Real Estate OS — Production Go-Live Runbook

This runbook governs the final production release. It is intentionally fail-closed: a green CI stack is necessary but does not by itself authorize production traffic.

## 1. Required preconditions

Before a production GO decision:

- the intended PR stack is merged/rebased into one immutable release candidate SHA;
- frozen dependency installation succeeds from the committed lockfile;
- Production Platform Foundation is green;
- Runtime Readiness Certification is green;
- Gate 2 Pricing Certification is green;
- Gate 3 Document & Contract Trust Certification is green;
- Gate 3 Finance Ledger Certification is green;
- Gate 4-5 Product Parity Certification is green;
- Gate 6 Non-Functional Certification is green;
- full Chromium/product validation is green;
- migration rehearsal has been performed against production-like data;
- database PITR is enabled and fresh backup evidence exists;
- object-storage recovery/versioning/retention has been verified;
- monitoring dashboards and alert routes are deployed;
- external security review/penetration evidence is approved;
- required provider credentials/templates/webhook verification are configured;
- primary and secondary on-call owners are confirmed;
- customer/business release signoff is recorded.

All evidence identifiers belong in a release-evidence document matching `platform/ops/release-evidence.schema.json`. Do not put credentials or secrets in that file.

## 2. Final preflight command

Run from `platform/` with the exact candidate SHA:

```bash
export EXPECTED_RELEASE_SHA="<40-char release SHA>"
export PRODUCTION_READY_URL="https://api.example.com"
export GATE7_EXTERNAL_ATTESTED=true
node scripts/production-go-no-go.mjs /secure/path/release-evidence.json
```

A valid production run must print JSON with:

```json
{"decision":"GO"}
```

Anything else is a NO_GO. Offline structural-test mode never issues a GO.

## 3. Deployment order

Use expand/contract database changes and the runtime compatibility contract.

1. **Declare change window.** Record release SHA, change ticket and release manager.
2. **Confirm recovery posture.** PITR healthy, latest backup successful, restore rehearsal evidence accepted.
3. **Apply additive schema migrations.** Use the exact release artifacts; stop on first error.
4. **Verify schema/runtime contract.** The expected runtime marker must be present before application traffic.
5. **Deploy API canary.** Keep traffic at zero/internal-only until `/v1/health/ready` is 200.
6. **Deploy workers.** They must refuse startup if schema/database readiness fails.
7. **Deploy notification gateway.** Verify private service authentication and provider connectivity without broadcasting customer traffic.
8. **Deploy web.** Confirm correct public API origin/session-cookie/CORS behavior.
9. **Run synthetic journeys.** See section 4.
10. **Start controlled traffic ramp.** 5% → 25% → 50% → 100% or equivalent tenant/project canary sequence.
11. **Observe each stage.** Do not advance while stop conditions are active.
12. **Record final GO evidence.** Store monitoring snapshot/change evidence outside source control according to operations policy.

## 4. Synthetic go-live journeys

Use approved non-customer test identities/data.

### Identity

- phone OTP login;
- National-ID lookup + OTP without identity enumeration leakage;
- Google OIDC login;
- pending identity cannot gain project authority without role assignment.

### Allocation

- load buyer/EOI/queue;
- check in/call next buyer;
- view type-based availability and current pricing;
- lock one unit-type capacity slot;
- prove competing lock attempt fails;
- convert lock to reservation with immutable price components.

### Transaction/document

- upload required document through presigned storage;
- scanner/type trust succeeds;
- buyer/company signatures satisfy required signer order;
- execute/stamp contract;
- verify immutable execution manifest/hash.

### Finance

- create schedule;
- ingest a partial receipt;
- replay provider event and confirm idempotency;
- create reversal/refund compensation and confirm original event is unchanged;
- exercise cheque receive/return/replacement chain;
- confirm finance reconciliation remains balanced.

### Broker/commission

- verify milestone-driven completion;
- commission becomes eligible only after required prerequisites;
- countdown/due state is correct;
- Broker Manager/Finance can see permitted financial fields;
- Broker Agent cannot receive rate/amount via UI, API or CSV export.

### Notification

- create one installment reminder and one missing-step reminder;
- verify intended recipient/audience/channel;
- validate external provider idempotency;
- ensure failed provider delivery retries without duplicate logical notification.

### AI

- run buyer recommendation with AI enabled;
- exercise provider failure/fallback;
- confirm manual product workflow remains functional;
- verify AI cannot mutate price, inventory, queue, payment or contract state.

### Control plane/export

- Super Admin sees tenants/projects without implicit tenant mutation rights;
- open and close a time-limited audited support session;
- export at least one internal dataset;
- export broker-agent commissions and confirm financial columns are absent;
- test CSV formula-injection neutralization with synthetic hostile cell text.

## 5. Traffic-ramp stop conditions

Immediately stop promotion/traffic ramp when any of these are true:

- API readiness is non-200 or flapping;
- elevated 5xx/error-budget burn exceeds alert threshold;
- ordinary/API or lock latency breaches the approved SLO for the defined alert period;
- duplicate active lock or oversell invariant violation;
- any finance event is unbalanced or provider replay creates duplicate money;
- executed-contract trust/manifest inconsistency;
- cross-tenant/broker data exposure or authorization anomaly;
- PII/OTP/token/signature appears in logs;
- outbox/notification backlog exceeds critical threshold;
- customer/provider integration fails in a way that can create wrong authoritative state;
- backup/PITR protection becomes unhealthy during the change window.

Do not override a critical stop condition because the customer-facing UI appears healthy.

## 6. Rollback and forward repair

### Application rollback

Application rollback is allowed only when the currently applied database schema is compatible with the previous application release. Verify runtime compatibility before switching traffic.

### Database changes

Applied production financial/contract migrations are not casually reversed. Use forward repair unless a specifically rehearsed reversible migration has been approved in the release evidence.

### Optional/degraded integrations

When safe and documented:

- disable external AI and use deterministic/manual path;
- pause external notification channels while retaining durable queued evidence;
- stop workers if repeated downstream execution would be unsafe;
- keep API/web read paths available only if authoritative state remains consistent.

Never “rollback” by deleting ledger events, execution manifests, audit entries, provider idempotency rows or signed evidence.

## 7. Incident command

Minimum incident roles:

- Incident/Release Manager
- Platform On-call Primary
- Platform On-call Secondary
- Domain owner when finance/contracts/inventory is affected
- Customer/operations communication owner

Record timestamps for detection, mitigation, decision, rollback/forward-fix and recovery. Correlate API evidence using `x-request-id`, worker ID, transaction ID, provider idempotency/event IDs and domain aggregate IDs—never raw PII.

## 8. First-hour and first-day aftercare

For at least the first hour after 100% traffic, actively observe:

- readiness/5xx/p95;
- database connection/lock pressure;
- outbox age;
- notification backlog/provider failures;
- unit-lock conflict rate;
- finance reconciliation exceptions;
- document-scanner failures;
- commission due-state anomalies.

Within the first business day:

- verify backup completed after release;
- reconcile financial/provider events;
- review failed notifications/documents;
- review support-access sessions;
- review security/audit anomalies;
- capture release retrospective/action items.

## 9. Final authority

The codebase may certify implementation and structural release controls. Only the production evidence plus the live readiness result can authorize a GO. If evidence is incomplete, stale, placeholder, mismatched to the release SHA, or readiness is unavailable, the required decision is **NO_GO**.
