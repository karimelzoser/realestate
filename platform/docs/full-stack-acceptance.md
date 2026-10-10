# PRENEURA emitted full-stack acceptance

This certification closes the gap between independently green domain gates and one production-shaped runtime operating as a system.

## What runs together

`.github/workflows/full-stack-acceptance-certification.yml` builds and starts the emitted production artifacts against one PostgreSQL 18 database:

- PRENEURA API
- PRENEURA background worker
- PRENEURA notification gateway
- PRENEURA Next.js web application

Dependencies are installed with the committed frozen lockfile. The database is created from zero with the production migration runner before a minimal acceptance fixture is added.

## What the certification proves

The cross-process acceptance script proves all of the following against the same running system:

1. API liveness and database/schema readiness are healthy.
2. The production web application renders its login surface.
3. The notification gateway is healthy and rejects unauthorized delivery requests.
4. Protected API routes reject missing sessions.
5. Real HttpOnly-session-equivalent cookie tokens resolve through the production session store.
6. A project Manager receives only the assigned project and cannot read another tenant/project.
7. A Buyer sees the buyer's own transaction and cannot see another buyer's transaction.
8. A Broker Agent sees only broker-attributed transactions.
9. Broker Agent commission responses omit rate, amount and basis financial fields.
10. Broker Manager commission responses include authorized financial fields.
11. The emitted worker delivers a due in-app notification job.
12. The worker materializes exactly one user notification for that job.
13. The worker publishes a transactional outbox event into the durable realtime replay stream exactly once.
14. The worker expires/reclaims an overdue inventory lock.
15. The authenticated buyer notification inbox exposes the worker-materialized notification.
16. Logout revokes the server-side session and the same cookie is rejected afterward.

The initial integration run discovered that the NestJS logout handler inherited the framework's default `201 Created` status for POST requests. The API now explicitly returns `200 OK`, matching the operation's semantics, and the full-stack certification verifies revocation afterward.

## Why this gate is different from domain certification

Domain certifications prove individual invariants such as pricing immutability, document trust, financial reconciliation, queue ordering, role capabilities, concurrency and backup/restore behavior.

This gate instead proves the integration seams between those systems:

- emitted application packaging
- shared database state
- authentication/session propagation
- cross-role authorization
- field-level confidentiality
- worker-to-database effects
- outbox/realtime durability
- notification projection
- web/API/gateway process startup

A domain can therefore be locally correct but still fail this gate if its integration contract is broken.

## What this gate intentionally does not claim

A green full-stack acceptance workflow is **software release evidence**, not final production-environment evidence. It does not prove:

- public TLS/reverse-proxy/network topology on the target server
- real Google/Keycloak production configuration
- live Meta WhatsApp credentials/templates and delivery
- live SMS/email provider credentials
- real object-storage credentials and bucket policy
- live malware-scanner provider behavior
- live payment/refund/settlement provider webhooks
- production OTLP/monitoring/alert routing
- real backup retention and restore timing on the target infrastructure
- live cutover/rollback rehearsal
- named operational/security/finance ownership

Those remain Gate 7 live-environment requirements and must not be replaced by CI mocks or self-attestation from software tests.

## Release rule

A candidate must not be considered software-ready if this workflow is red. A green result should be retained with the exact candidate SHA as part of the Gate 7 release evidence bundle.
