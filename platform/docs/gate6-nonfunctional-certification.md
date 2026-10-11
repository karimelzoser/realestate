# Gate 6 — Non-Functional Certification

This document defines PRENEURA's minimum production reliability, security, observability, backup/restore and concurrency evidence. Gate 6 is not satisfied by a successful demo or by build success alone.

## 1. Correlation and structured logs

The API uses Fastify structured request logs and a bounded request correlation identifier.

- accepted incoming header: `x-request-id`
- allowed characters: `A-Z a-z 0-9 . _ : -`
- maximum length: 128 characters
- invalid/missing IDs are replaced with a cryptographically random UUID
- the authoritative request ID is echoed as `x-request-id` in the response
- Fastify request logs include the request ID

Workers already include a stable `workerId` and timestamp in every structured JSON record. Provider idempotency keys, transaction IDs and domain aggregate IDs must be used to connect asynchronous evidence without logging PII.

Never log raw phone numbers, National IDs, signatures, contract files, OTPs, payment credentials, provider bearer tokens or encryption keys.

## 2. SLO and alert contract

`platform/ops/alert-policy.json` is the versioned alert/SLO source used during production setup.

Minimum targets:

- API availability: 99.9%
- ordinary API p95: <= 500 ms
- atomic unit-lock p95: <= 750 ms
- oldest unpublished outbox event: <= 60 seconds
- notification terminal failure ratio: <= 1%
- successful backup age: <= 24 hours
- restore rehearsal age: <= 30 days

Critical alerts include API not-ready, excessive 5xx burn, outbox lag, finance reconciliation failure and stale backups.

Production infrastructure may translate the policy into Grafana/Prometheus, CloudWatch, Datadog or another approved monitoring backend, but thresholds/ownership may not silently disappear during translation.

## 3. Backup policy

Production PostgreSQL must use provider-managed point-in-time recovery plus independent logical backup evidence.

Minimum policy:

- PITR enabled before launch
- daily logical backup retained according to customer/legal policy
- encryption at rest and in transit
- backup account/resource access separated from ordinary application credentials
- successful backup timestamp monitored
- restore rehearsal at least monthly and before major data-model cutovers

Object storage requires versioning/retention appropriate to executed contracts and financial evidence. Database backup alone is not sufficient for document recovery.

## 4. Restore procedure

For an incident or rehearsal:

1. isolate the target recovery environment;
2. identify the approved recovery point;
3. create a new empty PostgreSQL database—never overwrite production during rehearsal;
4. restore the selected database backup;
5. verify `platform_runtime_contract` compatibility;
6. compare critical table counts/fingerprints;
7. verify tenant/project witness records;
8. start API in readiness-only validation mode;
9. start workers only after readiness succeeds;
10. validate private object-storage access separately;
11. execute finance reconciliation and critical journey smoke tests;
12. record actual RTO/RPO evidence and approver.

`platform/scripts/certify-backup-restore.sh` automates the database portion and is executed by Gate 6 CI against PostgreSQL 18.

## 5. Atomic-lock/load certification

`platform/scripts/certify-lock-concurrency.sh` starts hundreds of simultaneous lock attempts against one physical inventory slot.

Acceptance:

- exactly one active lock is committed;
- every competing insert is rejected by the authoritative database invariant;
- releasing the winner permits a later contention round;
- the second round again yields exactly one active winner.

The CI profile uses 200 contenders per round with bounded parallelism. Event-day staging rehearsals should also run realistic API-level load using expected launch concurrency and network latency.

## 6. Security baseline

Gate 6 CI requires:

- frozen dependency installation;
- no critical production dependency advisories from `pnpm audit`;
- no tracked `.env`/production secret file;
- no obvious private keys, AWS access keys or GitHub tokens committed to source;
- existing authentication, tenant/broker isolation, document-trust and finance certification gates remain green.

This baseline does not replace penetration testing. Before public launch, perform an authenticated web/API security review covering OWASP ASVS L2 concerns, tenant isolation, IDOR, session handling, upload abuse, rate limits, SSRF, injection and privilege escalation.

## 7. Failure behavior

The system is designed to fail closed at authoritative boundaries:

- stale/unavailable PostgreSQL => API readiness 503 and worker startup failure;
- external AI unavailable => deterministic/manual path continues;
- notification provider unavailable => durable retries, no duplicate logical job;
- malware scanner unavailable => uploaded evidence remains untrusted;
- duplicate payment event => idempotent financial ingestion;
- process restart => durable database/outbox state remains authoritative.

## 8. Deployment and rollback

Use expand/contract migrations and the runtime compatibility contract from `runtime-readiness.md`.

Recommended order:

1. backup/PITR health confirmed;
2. additive schema migration;
3. runtime compatibility probe;
4. deploy API with readiness gate;
5. deploy worker after API/readiness is healthy;
6. deploy web/gateway;
7. run synthetic smoke journey;
8. observe error/latency/backlog dashboards;
9. proceed with traffic ramp.

Rollback means application rollback only while the database declares that runtime compatible. Applied production migrations are repaired forward; they are not casually reversed against live financial/contract evidence.

## 9. Gate 6 evidence

The required GitHub workflow is:

`Gate 6 Non-Functional Certification`

It produces four independent results:

1. atomic-lock concurrency;
2. backup/restore equality;
3. security/dependency baseline;
4. observability/readiness smoke including request correlation and bounded latency.

Gate 6 is complete only when those checks and all earlier domain certification gates are green on the release candidate stack.
