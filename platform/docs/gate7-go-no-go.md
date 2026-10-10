# Gate 7 — Production Go / No-Go

Gate 7 is PRENEURA Real Estate OS's final deployment decision. It is intentionally stricter than feature completion or CI-only certification: **GO** requires the exact certified software bundle plus real evidence from the target production environment.

## Release identity

Gate 7 uses two immutable release identities instead of one ambiguous SHA:

- **Application runtime SHA:** `c2746523eb434898cbb4c46cf5df452d122ba78f` — PR #81, the emitted full-stack acceptance candidate.
- **Deployment bundle SHA:** `4da4a83f7c5ca17ed7033237b9aca74186b912ce` — PR #85, the self-hosted Docker/Compose/Nginx bundle with verifiable container provenance.

The machine-readable source of truth is `platform/ops/selfhosted-gate7-staging.json`.

This separation is deliberate. Governance/evidence code may advance after the deployable artifact is frozen; it must not silently redefine what binary/source bundle is authorized for deployment.

The certified runtime contract remains schema **41** / migration `0041_inventory_lock_expiry_durability.sql`.

## Certified self-hosted topology

The PR #85 bundle is:

```text
Public HTTPS / TLS terminator
          |
       re-edge (Nginx)
          |-- /        -> re-web:3000
          |-- /api/    -> re-api:4100
          |-- /healthz -> API readiness
          `-- /livez   -> API liveness

Private backend network
  - re-web
  - re-api
  - re-worker
  - re-notification-gateway
  - PostgreSQL 18
  - one-shot migration job
  - S3-compatible object storage / Keycloak / Redis as provisioned infrastructure
```

Only the trusted edge is host/public-facing. Web, API, worker and notification gateway remain private behind that boundary. TLS termination is external to the Compose bundle and must be proven in the live environment.

Every PRENEURA-built image in this bundle also carries the exact source SHA, accepted application-runtime SHA, schema version and repository source label. The self-hosted certification verifies those labels on the **running containers**, not only in the Dockerfile.

## Automated evidence already available

The release chain has executable evidence for:

- strict TypeScript, frozen dependencies and production builds;
- PostgreSQL migrations/runtime readiness;
- deterministic pricing and immutable reservation quotes;
- atomic/restart-safe inventory locks;
- buyer/EOI/queue/allocation workflows;
- trusted documents and immutable contract execution;
- immutable finance, EOI/refund and settlement evidence;
- broker commissions/reminders and confidential-field isolation;
- complete role/product parity and governed exports;
- production configuration fail-fast behavior;
- concurrency/resilience/security certification;
- backup/restore certification;
- OpenTelemetry/logging/alert-policy baseline;
- full emitted-stack acceptance;
- executable self-hosted Compose deployment certification;
- running-container source provenance certification;
- sanitized target-host evidence collection;
- Chromium regression coverage.

These prove the software artifact and give us a safe mechanism to inspect a real host. They do **not** prove that a real public environment has valid DNS/TLS, production credentials, monitoring, backup retention or operational ownership.

## Structural Gate 7 preflight

`platform/scripts/certify-gate7-preflight.mjs` and `.github/workflows/gate7-go-no-go.yml` verify before any live decision that:

- required Gates 1–6, full-stack and deployment certification workflows exist;
- schema 41 / migration 0041 remain canonical;
- application runtime SHA is a Git ancestor of the certified deployment bundle SHA;
- Gate 7 governance descends from the certified deployment bundle;
- the deployment-provenance runbook and target-host evidence collector exist;
- PostgreSQL remains private PostgreSQL 18;
- object storage remains private S3-compatible storage;
- all four PRENEURA application services are private;
- `re-edge` is the only public application ingress contract;
- Nginx route/readiness/liveness mappings match the certified Compose bundle;
- migrations remain one-shot-before-rollout and applications do not auto-migrate;
- every required live evidence category remains represented;
- no open GitHub issue labeled P0/P1 exists.

The structural job depends on both **Full Stack Acceptance Certification** and **Self-Hosted Deployment Certification**.

## Production-host evidence

Before the final live workflow, collect sanitized evidence from the actual deployed Linux/Compose host.

From `platform/`:

```bash
GATE7_COMPOSE_ENV_FILE=deploy/.env.production \
GATE7_COMPOSE_FILE=deploy/docker-compose.production.yml \
GATE7_LOCAL_EDGE_URL=http://127.0.0.1:8080 \
GATE7_HOST_EVIDENCE_PATH=gate7-host-evidence.json \
node scripts/collect-gate7-host-evidence.mjs
```

In production the collector is locked to the deployment bundle SHA in the Gate 7 manifest. A caller cannot substitute another expected SHA. The only override path exists inside GitHub Actions certification and is explicitly recorded in the output.

The collector verifies and records only allow-listed host/container facts, including:

- Linux/CPU/memory/disk capacity;
- Docker/Compose versions;
- container/image IDs and available repository digests;
- image provenance labels;
- running/health/exit/restart state;
- non-root/no-new-privileges/capability-drop posture;
- private application ports and edge-only publication;
- migration exit status;
- worker readiness;
- local edge liveness/readiness/web probes;
- sanitized runtime/database schema compatibility.

The resulting JSON is written mode `0600`, carries a SHA-256 evidence digest and fails closed on policy violations. Store it in an access-controlled evidence location and use its artifact/HTTPS reference as part of the Gate 7 topology evidence.

Do **not** substitute raw `docker inspect`, `docker compose config`, env files or unrestricted logs. Those surfaces can reveal production secrets. The collector was designed specifically to avoid serializing container environments.

## Final live evidence

The manual `Gate 7 Production Go-No-Go` workflow accepts no anonymous `verified=true` shortcuts. A final certification requires:

- exact deployed deployment-bundle SHA;
- public API HTTPS base (for the certified edge this is normally `https://host/api`);
- public web HTTPS origin;
- exact production OIDC issuer URL;
- named operational owner;
- one traceable evidence reference for every required evidence category.

Evidence references must be references, **never credentials or secrets**. Accepted forms are HTTPS references or bounded references prefixed with `gh-run:`, `artifact:`, `ticket:`, `runbook:`, `change:`, `incident:` or `approval:`.

The `evidence_json` workflow input must contain all of these keys:

```json
{
  "topologyTls": "artifact:gate7-host-and-tls-2026-10-11",
  "oidc": "artifact:oidc-smoke-2026-10-11",
  "objectStorage": "ticket:OPS-201",
  "messaging": "gh-run:123456789",
  "documentScanner": "artifact:scanner-smoke-2026-10-11",
  "financeSettlement": "approval:FIN-44",
  "observability": "https://monitoring.example/evidence/release-42",
  "backupRestore": "artifact:restore-rehearsal-42",
  "migrationRehearsal": "runbook:release-42-migration",
  "rollbackCutover": "runbook:release-42-rollback",
  "securityApproval": "approval:SEC-42",
  "operationalOwnership": "ticket:OPS-ONCALL-42"
}
```

The workflow rejects unknown or missing categories.

## Machine-verified live probes

`platform/scripts/certify-gate7-live.mjs` independently verifies the live environment before it can emit GO:

1. deployed bundle SHA exactly equals the certified PR #85 bundle SHA;
2. API/web/OIDC URLs are public HTTPS URLs without embedded credentials;
3. DNS resolves for every public host;
4. TLS validates against the system trust store with TLS 1.2+ and a configurable minimum remaining certificate lifetime (default 14 days);
5. API liveness returns the PRENEURA API identity;
6. API readiness reports database/schema healthy;
7. runtime schema is exactly 41 and the database is compatible with runtime 41;
8. migration marker is correct when database/runtime schemas are equal;
9. the public web returns usable HTML;
10. OIDC discovery is reachable and its `issuer` exactly matches the supplied issuer;
11. OIDC JWKS/authorization/token endpoints are HTTPS.

A successful run writes `gate7-live-evidence.json` and uploads it as a 90-day GitHub Actions artifact. The report contains the release identity, evidence **references**, probe outputs, certificate fingerprint/expiry and workflow/run identity. It does not contain provider credentials.

## Evidence meaning

The external evidence references must substantively prove the following:

- **topologyTls:** sanitized host collector output, real DNS, TLS termination, reverse-proxy routing, firewall/private-network boundaries and process supervision;
- **oidc:** production Keycloak/Google configuration and an authenticated smoke path;
- **objectStorage:** private bucket/access policy, versioning/backup protection and restore accessibility;
- **messaging:** real Meta WhatsApp and any enabled SMS/email delivery smoke tests;
- **documentScanner:** real malware-scanner integration and fail-closed behavior;
- **financeSettlement:** production finance/refund/settlement provider/webhook validation and reconciliation authority;
- **observability:** reachable telemetry backend, dashboards and alert routing;
- **backupRestore:** target-environment backup evidence and isolated restore rehearsal;
- **migrationRehearsal:** migration rehearsal against production-like topology/data;
- **rollbackCutover:** cutover and application rollback rehearsal within the schema-compatibility rules;
- **securityApproval:** deployment/network/security review approval;
- **operationalOwnership:** named release/on-call ownership and escalation path.

A reference that merely says “done” without underlying evidence is not sufficient operational approval.

## Deployment order

1. Provision Linux capacity and private network boundaries.
2. Provision PostgreSQL 18, private S3-compatible storage, Keycloak and any required supporting services.
3. Configure backup/PITR/storage-versioning policy.
4. Configure public TLS and trusted Nginx/LB forwarding.
5. Configure real production secrets outside Git.
6. Check out/build/deploy **deployment bundle SHA `4da4a83f7c5ca17ed7033237b9aca74186b912ce`** with `PRENEURA_SOURCE_SHA` set to that same value and `PRENEURA_APPLICATION_RUNTIME_SHA=c2746523eb434898cbb4c46cf5df452d122ba78f`.
7. Run the certified one-shot migration job and require success.
8. Start notification gateway, API and worker; require API readiness and `worker.ready`.
9. Start web and public edge; verify HTTPS routes/SSE behavior.
10. Run the target-host evidence collector and store its JSON artifact/digest.
11. Run OIDC/provider/scanner/finance/monitoring smoke tests.
12. Rehearse restore, migration and rollback/cutover using the target environment.
13. Resolve every P0/P1 defect.
14. Gather the 12 traceable evidence references.
15. Run the manual final Gate 7 workflow against the real URLs and exact deployed bundle SHA.

## Current release decision

**NO-GO for live production until the final live Gate 7 workflow succeeds against a real environment.**

This is not a statement that core product software is unfinished. The software/deployment artifact has substantial automated certification. What remains is evidence that the actual production environment, credentials/providers, monitoring/recovery processes and human ownership are real and working.

## GO / NO-GO rule

**GO** only when:

- both software dependencies (full-stack + self-hosted deployment certification) pass;
- structural preflight and P0/P1 check pass;
- the actual production host passes the sanitized host-evidence collector for the manifest-pinned bundle;
- every required evidence reference is supplied and reviewed;
- DNS/TLS/API/Web/OIDC live probes pass;
- the deployed bundle SHA equals the certified bundle;
- the production environment approval job is authorized.

Any missing evidence category, mismatched bundle/container provenance, failed host/readiness/TLS/OIDC probe, open P0/P1, missing owner, unverified backup/rollback/provider path or failed environment approval means **NO-GO**.
