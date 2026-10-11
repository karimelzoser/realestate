# Gate 7 — Production Go / No-Go

Gate 7 is PRENEURA Real Estate OS's final deployment decision. It is intentionally stricter than feature completion or CI-only certification: **GO** requires the exact certified software bundle plus real evidence from the target production environment.

## Release identity

Gate 7 uses two immutable release identities instead of one ambiguous SHA:

- **Application runtime SHA:** `c2746523eb434898cbb4c46cf5df452d122ba78f` — PR #81, the emitted full-stack acceptance candidate.
- **Deployment bundle SHA:** `8750f94180b89cf58a1963f739c24aa0a56babbd` — PR #82, the self-hosted Docker/Compose/Nginx bundle built around that accepted runtime.

The machine-readable source of truth is `platform/ops/selfhosted-gate7-staging.json`.

This separation is deliberate. Governance/evidence code may advance after the deployable artifact is frozen; it must not silently redefine what binary/source bundle is authorized for deployment.

The certified runtime contract remains schema **41** / migration `0041_inventory_lock_expiry_durability.sql`.

## Certified self-hosted topology

The PR #82 bundle is:

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
- Chromium regression coverage.

These prove the software artifact. They do **not** prove that a real public environment has valid DNS/TLS, production credentials, monitoring, backup retention or operational ownership.

## Structural Gate 7 preflight

`platform/scripts/certify-gate7-preflight.mjs` and `.github/workflows/gate7-go-no-go.yml` verify before any live decision that:

- required Gates 1–6, full-stack and deployment certification workflows exist;
- schema 41 / migration 0041 remain canonical;
- application runtime SHA is a Git ancestor of the certified deployment bundle SHA;
- Gate 7 governance descends from the certified deployment bundle;
- PostgreSQL remains private PostgreSQL 18;
- object storage remains private S3-compatible storage;
- all four PRENEURA application services are private;
- `re-edge` is the only public application ingress contract;
- Nginx route/readiness/liveness mappings match the certified Compose bundle;
- migrations remain one-shot-before-rollout and applications do not auto-migrate;
- every required live evidence category remains represented;
- no open GitHub issue labeled P0/P1 exists.

The structural job depends on both **Full Stack Acceptance Certification** and **Self-Hosted Deployment Certification**.

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
  "topologyTls": "change:CHG-1234",
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

1. deployed bundle SHA exactly equals the certified bundle SHA;
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

- **topologyTls:** real DNS, TLS termination, reverse-proxy routing, firewall/private-network boundaries and process supervision;
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
6. Build/deploy **deployment bundle SHA `8750f94180b89cf58a1963f739c24aa0a56babbd`**.
7. Run the certified one-shot migration job and require success.
8. Start notification gateway, API and worker; require API readiness and `worker.ready`.
9. Start web and public edge; verify HTTPS routes/SSE behavior.
10. Run OIDC/provider/scanner/finance/monitoring smoke tests.
11. Rehearse restore, migration and rollback/cutover using the target environment.
12. Resolve every P0/P1 defect.
13. Gather the 12 traceable evidence references.
14. Run the manual final Gate 7 workflow against the real URLs and exact deployed bundle SHA.

## Current release decision

**NO-GO for live production until the final live Gate 7 workflow succeeds against a real environment.**

This is not a statement that core product software is unfinished. The software/deployment artifact has substantial automated certification. What remains is evidence that the actual production environment, credentials/providers, monitoring/recovery processes and human ownership are real and working.

## GO / NO-GO rule

**GO** only when:

- both software dependencies (full-stack + self-hosted deployment certification) pass;
- structural preflight and P0/P1 check pass;
- every required evidence reference is supplied and reviewed;
- DNS/TLS/API/Web/OIDC live probes pass;
- the deployed bundle SHA equals the certified bundle;
- the production environment approval job is authorized.

Any missing evidence category, mismatched bundle SHA, failed readiness/TLS/OIDC probe, open P0/P1, missing owner, unverified backup/rollback/provider path or failed environment approval means **NO-GO**.
