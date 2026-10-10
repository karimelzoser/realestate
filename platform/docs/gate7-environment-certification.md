# Gate 7 — Deployed Environment Certification

Gate 7 is the final infrastructure/go-live boundary for PRENEURA Real Estate OS. Earlier gates certify application correctness, security, concurrency, finance/document integrity, runtime readiness and local/CI resilience. Gate 7 must prove that the **actual deployed environment** preserves those guarantees.

Passing CI alone is not a Gate 7 pass.

## Authoritative deployment target

The machine-readable Railway target is:

```text
platform/ops/gate7-railway-target.json
```

The reusable static/live certifier is:

```text
platform/scripts/certify-gate7-environment.mjs
```

The go-live evidence record starts from:

```text
platform/ops/gate7-evidence-template.json
```

The target runtime contains these roles only:

- public web;
- public API;
- private worker;
- private notification gateway;
- public Keycloak/OIDC edge;
- private PostgreSQL 18;
- private S3-compatible object storage.

NATS and Temporal are not dependencies of the certified Real Estate runtime currently implemented in `platform/` and must not be required merely because another PRENEURA preview stack uses them.

## Deployment authority and order

For a database-affecting release:

1. build from the committed `pnpm-lock.yaml`;
2. apply migrations once using the declared release command;
3. require migration success before runtime rollout;
4. roll API and admit traffic only after `/v1/health/ready` = HTTP 200;
5. roll workers after the same runtime/schema contract is compatible;
6. roll the notification gateway independently;
7. verify public web/API/Keycloak TLS and private worker/gateway/database exposure;
8. run live Gate 7 certification against the deployed URLs.

Database downgrade is not a rollback mechanism. Schema defects use forward repair. Application rollback is allowed only while the runtime/schema compatibility contract accepts the older runtime.

## Railway target controls

Minimum production topology:

- web: at least two replicas;
- API: at least two replicas;
- worker: at least one replica;
- notification gateway: at least one replica;
- one primary region for latency and data-affinity unless a reviewed multi-region design supersedes this policy;
- PostgreSQL 18 with durable storage, automated backups and PITR;
- no public database TCP endpoint;
- private/versioned/encrypted object storage;
- API healthcheck path `/v1/health/ready`;
- worker and notification gateway without public domains;
- frozen-lockfile builds only.

Secrets belong in Railway/provider secret storage. Do not copy secret values into Git, CI output, evidence files, PR bodies or logs.

## Live edge certification

Static contract:

```bash
cd platform
pnpm certify:gate7
```

Live certification:

```bash
cd platform
GATE7_WEB_URL=https://app.example.com \
GATE7_API_URL=https://api.example.com \
pnpm certify:gate7
```

The live probe requires:

- HTTPS web/API origins;
- API liveness HTTP 200;
- API readiness HTTP 200 with database/schema checks = `ok`;
- expected security headers;
- HSTS;
- server-generated UUID request ID;
- exact credentialed CORS for the certified web origin;
- reachable public web edge.

The live script is necessary but not sufficient for Gate 7. Database backups, object-storage recovery, provider integrations, load capacity and penetration testing require separate evidence below.

## Database and recovery evidence

The release evidence must record:

- PostgreSQL major version = 18;
- public TCP disabled;
- encryption status;
- automated backup status;
- PITR status/retention;
- restore rehearsal timestamp;
- measured RPO <= 5 minutes target;
- measured RTO <= 60 minutes target;
- restored `/v1/health/ready` success;
- domain reconciliation after restore.

The restore procedure is defined in `docs/backup-restore.md`.

## Object-storage evidence

Document/master-plan storage must prove:

- bucket is private;
- object versioning is enabled;
- server-side encryption is enabled;
- delete privileges are restricted;
- one transaction-critical object can be restored from a retained version;
- restored bytes match the immutable PostgreSQL SHA-256 reference;
- measured restore RTO <= 60 minutes target.

## Edge/network evidence

Record and review:

- TLS certificate validity;
- HSTS at public edge;
- exact `WEB_ORIGIN` allowlist;
- `TRUST_PROXY_HOPS` justification for the actual provider topology;
- WAF/rate-limit policy;
- stricter anonymous/login policies;
- SSE connection limits;
- body-size policy;
- provider-ingress restrictions/allowlists where feasible;
- confirmation that worker, notification gateway and PostgreSQL do not have public endpoints.

Application HTTP controls are documented in `docs/http-security.md`.

## Identity/provider evidence

Verify production paths for:

- Keycloak realm/client configuration;
- Google OIDC callback/login;
- phone OTP through the private gateway;
- account-enrollment verification;
- WhatsApp approved templates through Meta;
- document malware scanner;
- finance provider ingress signature adapter + normalized event ingress;
- settlement provider ingress signature adapter + normalized settlement ingress;
- optional SMS/email paths if launch scope enables them.

A provider configuration existing in environment variables is not evidence by itself. Each launch-critical path needs a controlled successful transaction plus failure-path evidence where applicable.

## Observability evidence

Gate 7 requires deployed evidence for:

- central structured logs;
- deployment failure/crash/OOM alerting;
- API request correlation IDs;
- distributed tracing where enabled;
- database dependency spans;
- external provider dependency spans;
- resource metrics for web/API/worker/gateway/database;
- alert escalation owner/runbook.

## Deployed capacity/SLO evidence

Gate 6 CI budgets only detect regressions. Gate 7 must measure the actual topology.

Record at minimum:

- load profile and duration;
- HTTP request rate;
- API p95/p99 latency;
- HTTP 5xx rate;
- SSE concurrent connections;
- API/web CPU and memory;
- database CPU, memory, storage and connection saturation;
- worker backlog/drain time;
- notification provider latency/failure rate.

Production sizing must be based on these measurements, not GitHub-runner elapsed times.

## Security go-live evidence

Before final go/no-go:

- Gate 6 dependency audit = green;
- Gate 6 CodeQL = green;
- production secret review complete;
- public exposure review complete;
- dependency/provider credentials rotated from staging where required;
- independent penetration test or equivalent approved security assessment complete;
- zero unresolved critical findings;
- zero unresolved high findings unless formal release authority accepts a documented exception.

## Railway staging isolation

Do not repurpose unrelated PRENEURA preview infrastructure as proof for this system. The Real Estate Gate 7 environment must map to the topology above and to the exact release SHA being certified.

On 10 October 2026 the connected legacy preview environment was observed to contain a different application (`platform-core`), PostgreSQL 16/pgvector, NATS, Temporal and Keycloak, with no Real Estate split web/API/worker/gateway topology or document bucket. It is therefore **not** Gate 7 evidence for this repository.

A separate Railway staging project was created for this certification effort. PostgreSQL 18 and the private document bucket were staged, but Railway then returned a workspace resource-provision limit when the application service shells were added. No staged changes were committed/deployed. Gate 7 remains blocked until sufficient Railway capacity is available or a different approved staging account/environment is provided.

Do not delete the existing preview stack merely to make this certification fit within a plan limit without explicit infrastructure-owner approval.

## Go/no-go rule

Gate 7 status is **GO** only when `platform/ops/gate7-evidence-template.json` has been populated for the exact release SHA and all mandatory controls are proven.

A missing measurement is a blocker, not an assumed pass.

A staged topology is not a deployment.

A successful deployment is not a certification.

A certification without recovery/security evidence is not a production go-live approval.
