# PRENEURA Task Ledger

Legend: `[x]` complete/certified in current stack, `[~]` active/in progress, `[ ]` not complete, `[!]` external/live verification dependency only.

## A. Existing certified foundation

- [x] Passwordless phone / National ID OTP identity boundary.
- [x] Google OIDC / Keycloak identity integration boundary.
- [x] Tenant/project/broker scoped RBAC and ownership controls.
- [x] Project catalog, hierarchy, unit types and physical-unit import model.
- [x] Versioned pricing and immutable quote certification.
- [x] Buyer, EOI/refund, queue, reservation and transaction core.
- [x] Document templates, trusted object storage, signatures and executed-contract evidence.
- [x] Immutable finance ledger, partial allocations, reversals/refunds, provider replay protection and cheque replacement evidence.
- [x] Broker commission plan/case/eligibility/countdown and confidentiality controls.
- [x] Reminder policies, installment/milestone scheduler, notification inbox and gateway boundary.
- [x] Realtime SSE/replay/outbox foundation.
- [x] PRENEURA Super Admin + audited support access.
- [x] Optional deterministic / third-party AI advisory layer.
- [x] Dependency lock/frozen install certification.
- [x] Serialized migrations + checksum drift protection.
- [x] API readiness/schema compatibility and worker fail-closed startup.
- [x] GitHub Pages synthetic demonstration regression suite.

## B. Product-correctness blockers

- [~] **B1 — EOI unit type → exact physical apartment allocation.**
  - [ ] Add/confirm `unit_type_id` snapshot on each EOI.
  - [ ] Validate requested type belongs to the same active project.
  - [ ] Add exact physical-unit eligibility query for allocation.
  - [ ] Exact unit carries building/floor/internal public reference.
  - [ ] Lock must bind exact physical unit, not only type capacity.
  - [ ] PostgreSQL unique active exact-unit lock invariant.
  - [ ] Reservation/transaction snapshots exact unit.
  - [ ] Release/expiry/conversion restores/commits exact-unit state correctly.
  - [ ] Allocator UI shows only eligible exact apartments for the EOI type.
  - [ ] Concurrency certification with one exact winner.

- [ ] **B2 — English/Arabic production UI.**
  - [ ] i18n framework and locale persistence.
  - [ ] English dictionaries.
  - [ ] Arabic dictionaries.
  - [ ] RTL layout/navigation/forms/tables.
  - [ ] locale-aware money/date/number formatting.
  - [ ] EN + AR Playwright smoke journeys.

- [ ] **B3 — English voice production integration.**
  - [ ] production authenticated API bridge.
  - [ ] permission-aware navigation/advisory actions.
  - [ ] explicit confirmations before any mutating command.
  - [ ] synthetic/local speech adapter for CI.
  - [!] live speech-provider verification if external credentials are chosen.

## C. Contract / workflow completion

- [ ] Deterministic contract generation from versioned template + buyer/unit/quote/payment snapshot.
- [ ] Generated contract hash before signature.
- [ ] External e-sign adapter interface + fake CI provider.
- [ ] E-sign callback signature/idempotency handling.
- [ ] Preserve physical/offline signature/fingerprint path.
- [ ] Long-running workflow durability decision implemented and certified:
  - [ ] allocation grace/expiry;
  - [ ] transaction completion;
  - [ ] refund lifecycle;
  - [ ] contract execution;
  - [ ] commission lifecycle.
- [ ] If Temporal remains the selected orchestrator, add Temporal runtime + restart-durability tests; otherwise create an explicit ADR certifying the durable PostgreSQL workflow alternative.

## D. Provider adapters

- [ ] Meta WhatsApp adapter + webhook verification + fixture tests.
- [ ] SMS adapter + fake provider.
- [ ] Email adapter + fake provider.
- [ ] Payment-provider native adapters -> normalized finance ingress.
- [ ] E-sign native adapter.
- [ ] S3-compatible provider certification with disposable MinIO.
- [ ] Malware scanner disposable/fake certification.
- [ ] Google/Keycloak deployment configuration tests.
- [ ] External AI adapter fixture tests.
- [!] Live provider credentials/domains/callback verification deferred and tracked separately.

## E. Portable deployment package — no live host access

- [ ] Production Dockerfile: web.
- [ ] Production Dockerfile: API.
- [ ] Production Dockerfile: worker.
- [ ] Production Dockerfile: notification gateway.
- [ ] Migration/CLI image or deterministic migration runner image.
- [ ] Non-root runtime users and minimal runtime layers.
- [ ] OCI revision/version labels.
- [ ] SBOM generation.
- [ ] Container vulnerability scan.
- [ ] `compose.local.yml`.
- [ ] `compose.staging.yml`.
- [ ] `compose.production.yml`.
- [ ] Private backend networks.
- [ ] Health-based dependencies.
- [ ] Persistent volumes.
- [ ] Resource limits/reservations.
- [ ] Restart policies.
- [ ] Canonical reverse proxy configuration with SSE buffering disabled.
- [ ] HTTPS-ready placeholder-domain configuration.
- [ ] Secret examples: names/placeholders only.
- [ ] Preflight script.
- [ ] Serialized migration script/entrypoint.
- [ ] Rollout script.
- [ ] Smoke-test script.
- [ ] Compatibility-aware rollback script.
- [ ] Version/image manifest generation.

## F. Backup / restore / operations

- [ ] PostgreSQL backup procedure.
- [ ] PostgreSQL disposable restore certification.
- [ ] Identity/Keycloak DB backup + restore procedure.
- [ ] Object-storage backup/versioning procedure.
- [ ] Object-storage disposable restore/integrity certification.
- [ ] Post-restore consistency checks.
- [ ] Metrics/health dashboard definitions.
- [ ] Alert rules for API readiness, DB saturation, worker backlog, notification failures, finance/provider ingestion, object storage, scanner, SSE/replay backlog.
- [ ] Incident runbooks.
- [ ] Provider outage runbooks.
- [ ] Migration/rollback runbook.
- [ ] Complete portable installation/release guide.

## G. Non-functional / release certification

- [ ] Exact-unit lock concurrency/load suite.
- [ ] Cross-tenant/broker/buyer isolation security suite.
- [ ] Provider webhook replay/signature fixtures.
- [ ] Compose full-stack disposable CI boot.
- [ ] Container health/readiness smoke suite.
- [ ] Backup/restore CI job.
- [ ] Arabic/English browser E2E.
- [ ] Baseline load/latency report.
- [ ] Dependency/container scanning.
- [ ] Release artifact provenance + checksums.
- [ ] Complete SOFTWARE_READY_FOR_DEPLOYMENT evidence matrix.

## H. Explicitly deferred live-production tasks

- [!] SSH/server inspection.
- [!] Server Docker/OS/network installation/configuration.
- [!] Production DNS and domains.
- [!] Live TLS certificate issuance.
- [!] Production secret injection.
- [!] Live provider credentials and callback URLs.
- [!] Real production data migration.
- [!] LIVE_PRODUCTION_GO.

These deferred items must not block sections B–G.
