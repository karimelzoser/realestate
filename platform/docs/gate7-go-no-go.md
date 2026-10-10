# Gate 7 — Production Go / No-Go

Gate 7 is the final operational release decision for PRENEURA Real Estate OS. It is intentionally separate from feature completeness and CI-only certification.

A green Gate 7 means the exact release SHA has both:

1. the complete automated production evidence from Gates 1–6; and
2. verified live deployment/integration/operations evidence for the target production environment.

## Canonical candidate

The current canonical candidate line is based on the Gate 4/5/6 candidate plus the restart-safe inventory-lock durability integration.

The durability integration is independently certified and advances the runtime schema to version 41 / migration `0041_inventory_lock_expiry_durability`.

## Automated evidence already available

The release candidate has executable evidence for:

- strict TypeScript and production builds;
- PostgreSQL migrations/runtime readiness;
- project catalog, pricing and quote immutability;
- atomic and restart-safe inventory locking;
- buyer/EOI/queue/allocation flows;
- trusted documents and immutable contract execution;
- immutable finance ledger/provider idempotency/cheque history;
- broker commissions, reminders, refunds and sensitive-field projection;
- complete role/product parity;
- production configuration fail-closed behavior;
- concurrency/load baselines;
- backup/restore certification;
- HTTP/security/dependency checks;
- observability/alert-policy structure;
- Chromium regression coverage.

This evidence is necessary but is not sufficient to claim a production GO.

## Gate 7 automated structural preflight

`.github/workflows/gate7-go-no-go.yml` runs an automatic structural preflight which verifies:

- the required production certification workflows and release artifacts exist;
- the canonical latest migration and runtime schema agree;
- required production configuration keys are represented;
- the formal Gate 7 requirements remain present;
- no open GitHub issue labeled `P0` or `P1` exists.

This job deliberately does **not** certify provider credentials, live monitoring, or human operational ownership.

## Final live certification

The same workflow exposes a manual `workflow_dispatch` final certification. It cannot return `GATE7_FINAL_DECISION=GO` unless the release operator explicitly provides/attests all of the following:

- deployed API HTTPS origin;
- deployed web HTTPS origin;
- deployed OIDC issuer HTTPS URL;
- named operational owner;
- production integrations verified;
- migration rehearsal completed on production-like topology/data;
- backup/restore evidence reviewed;
- monitoring dashboards and alerts live;
- rollback path rehearsed/validated.

The workflow then performs live probes against:

- `/v1/health/live`;
- `/v1/health/ready`;
- the deployed web application;
- OIDC discovery metadata.

Final provider-specific business smoke tests remain part of the operator evidence for `integrations_verified` and must not be replaced by placeholder credentials.

## Current external blockers — 2026-10-10

### Railway staging capacity

An isolated Railway project exists:

`preneura-re-gate7-staging`

with environment:

`staging`

During Gate 7 provisioning Railway rejected the first PRENEURA application service with:

`Free plan resource provision limit exceeded.`

The connected Railway workspace already contains a separate live `preneura-platform-preview` project with five services. That project belongs to the broader platform-core preview and must not be deleted or repurposed implicitly by this Real Estate release.

**Status:** NO-GO for live Real Estate staging deployment until Railway capacity is increased or the owner explicitly authorizes retirement/reuse of existing resources.

### Production integration credentials/endpoints

The repository correctly fails closed for production configuration, but real production credentials/endpoints are not stored in Git and must be supplied through the deployment secret manager for:

- Google/Keycloak OIDC client;
- Meta WhatsApp / messaging provider;
- document malware scanner;
- finance provider ingress;
- settlement provider ingress;
- production observability exporter where applicable.

**Status:** requires deployment-owner/provider evidence before final GO.

### Operational ownership

Gate 7 requires named release/on-call owners and an agreed cutover window.

**Status:** requires explicit production-release assignment before final GO.

## Railway staging target topology

Once resource capacity is available, the intended staging topology is:

- PRENEURA Web;
- PRENEURA API;
- PRENEURA Worker;
- PRENEURA Notification Gateway;
- PostgreSQL 18;
- S3-compatible object storage;
- staging OIDC/Keycloak or approved sandbox issuer;
- approved staging scanner/provider adapters.

Every PRENEURA repository service should be pinned to the exact release commit for the Gate 7 rehearsal, not a moving branch head.

The API deployment must run migrations through the controlled migration command before readiness is used to accept traffic. `/v1/health/ready` is the traffic gate; worker startup separately refuses a stale runtime schema.

## Go / no-go rule

**GO** only when the manual final Gate 7 workflow passes on the exact SHA intended for production and the release authority has reviewed the provider-specific evidence.

Any missing external credential, failed live readiness probe, unverified rollback, missing monitoring, open P0/P1 issue, or absent operational owner means **NO-GO**.
