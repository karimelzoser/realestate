# Gate 7 — Production Go / No-Go

Gate 7 is the final operational release decision for PRENEURA Real Estate OS. It is intentionally separate from feature completeness and CI-only certification.

A green Gate 7 means the exact release SHA has both:

1. the complete automated production evidence from Gates 1–6; and
2. verified live deployment/integration/operations evidence for the target self-hosted production environment.

## Canonical deployable candidate

The certified Real Estate runtime candidate is:

`288f4afba3b87dbc123eff6b198e1720075edc7d`

from PR #77, which integrates the Gate 4/5/6 candidate with restart-safe inventory-lock expiry.

The Gate 7 governance branch/PR may advance independently for deployment/evidence changes. A Gate 7 GO therefore requires the operator to provide the deployed runtime SHA explicitly; the workflow rejects any runtime SHA that does not equal the pinned candidate in `platform/ops/selfhosted-gate7-staging.json`.

The runtime contract is schema 41 / migration `0041_inventory_lock_expiry_durability`.

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

## Gate 7 structural preflight

`.github/workflows/gate7-go-no-go.yml` runs an automatic structural preflight which verifies:

- the required production certification workflows and release artifacts exist;
- the canonical latest migration and runtime schema agree;
- required production configuration keys are represented;
- the deployment manifest is explicitly `self-hosted` and pinned to the certified runtime SHA;
- PostgreSQL remains major version 18 and private;
- S3-compatible object storage remains private by default;
- the intended service set/build/start/health configuration remains intact;
- worker and notification-gateway application surfaces remain private by default;
- the migration process runs before application rollout and applications do not auto-migrate;
- the formal Gate 7 production requirements remain present;
- no open GitHub issue labeled `P0` or `P1` exists.

This job deliberately does **not** fabricate host capacity, provider credentials, TLS certificates, monitoring, backups or human operational ownership.

## Final live certification

The same workflow exposes a manual `workflow_dispatch` final certification. It cannot return `GATE7_FINAL_DECISION=GO` unless the release operator explicitly provides/attests all of the following:

- exact deployed Real Estate runtime SHA;
- deployed API HTTPS origin;
- deployed web HTTPS origin;
- deployed OIDC issuer HTTPS URL;
- named operational owner;
- production integrations verified;
- migration rehearsal completed on production-like data/topology;
- backup/restore evidence reviewed;
- monitoring dashboards and alerts live;
- rollback path rehearsed/validated;
- self-hosted Linux topology, TLS, reverse-proxy and private-network boundaries verified.

The workflow rejects a deployed runtime SHA that does not equal the canonical SHA above, then performs live probes against:

- `/v1/health/live`;
- `/v1/health/ready`;
- the deployed web application;
- OIDC discovery metadata.

Final provider-specific business smoke tests remain part of the operator evidence for `integrations_verified` and must not be replaced by placeholder credentials.

## Self-hosted staging target

The machine-checkable target topology is committed at:

`platform/ops/selfhosted-gate7-staging.json`

It defines:

- Linux/self-hosted deployment mode;
- PostgreSQL 18;
- private S3-compatible object storage;
- `re-web`;
- `re-api`;
- `re-worker`;
- `re-notification-gateway`;
- certified one-shot database migration before application rollout;
- source pinning to the canonical runtime SHA;
- public/private and health-check boundaries;
- required variable names without storing secret values in Git.

The application does not depend on any specific hosting vendor. The same contract can run on one properly sized Linux server initially or on multiple hosts/containers later without changing domain code.

## Recommended host layout

A practical first production topology is:

```text
Internet
   |
Nginx / HAProxy / TLS
   |-- re-web
   |-- re-api
   `-- notification gateway callback route when required

Private network / host services
   |-- re-worker
   |-- PostgreSQL 18
   |-- Redis
   |-- S3-compatible object storage
   |-- Keycloak
   `-- one-shot migration process during release
```

Keep PostgreSQL, Redis, worker ports and object-storage administration endpoints private.

A single Linux host may run the first deployment if sizing, disk durability and backup requirements are satisfied. Process boundaries must remain separate even on one machine so the worker/gateway/API can be restarted or scaled independently.

## Process supervision

Use systemd, Docker Compose, Nomad, Kubernetes or another local orchestrator/process manager.

Required behavior:

- API is not admitted to traffic until `/v1/health/ready` returns 200;
- worker restarts on unexpected non-zero exit but never bypasses readiness/preflight;
- notification gateway restarts only through its package `start` command so provider/config preflight runs;
- web is independently restartable;
- migration is one-shot and never a long-running service;
- no application process runs schema migrations automatically on startup.

## Reverse proxy / TLS

The external edge must:

- terminate HTTPS using valid certificates;
- forward only trusted proxy headers;
- preserve SSE connections/timeouts for realtime streams;
- enforce request size/burst controls;
- route public web/API traffic only;
- expose notification-gateway callbacks only when the provider requires inbound callbacks;
- keep internal infrastructure unreachable from the public network.

## Database and storage requirements

Before Gate 7 GO:

- PostgreSQL major version is 18;
- database storage has adequate disk headroom and monitoring;
- automated backups exist;
- WAL/PITR is enabled when the production RPO requires it;
- at least one restore rehearsal has been completed against an isolated database;
- S3-compatible business documents are private, versioned/backup-protected and restorable;
- Redis loss does not destroy authoritative business state;
- the migration ledger and runtime contract are verified after restore.

## Production integration credentials/endpoints

Real production credentials/endpoints are not stored in Git and must be supplied through protected server-side secret configuration for:

- Google/Keycloak OIDC client;
- Meta WhatsApp / messaging provider;
- document malware scanner;
- finance provider ingress;
- settlement provider ingress;
- production observability exporter where applicable.

**Status:** requires deployment-owner/provider evidence before final GO.

## Operational ownership

Gate 7 requires named release/on-call owners and an agreed cutover window.

The owner must know how to:

- run migrations;
- inspect readiness and logs;
- restart each process independently;
- restore PostgreSQL and object storage;
- rotate/revoke provider credentials;
- roll back application binaries while respecting schema compatibility;
- execute the incident/rollback runbook.

## Intended self-hosted staging deployment order

1. provision or prepare the Linux staging host(s);
2. configure firewall/private-network boundaries and TLS reverse proxy;
3. provision PostgreSQL 18, Redis, Keycloak and S3-compatible object storage;
4. verify PostgreSQL/object-storage backup jobs;
5. pin application code to `288f4afba3b87dbc123eff6b198e1720075edc7d`;
6. run `pnpm install --frozen-lockfile` and build the four application packages;
7. configure real staging secrets/endpoints outside Git;
8. run the certified migration command exactly once;
9. start API and require `/v1/health/ready` before routing traffic;
10. start notification gateway and require preflight/liveness success;
11. start worker and require readiness startup success;
12. start web with the final API HTTPS origin available at build time;
13. run provider smoke tests, realtime checks, monitoring/alert checks and business smoke paths;
14. rehearse backup/restore and application rollback;
15. execute the manual Gate 7 workflow with the exact deployed runtime SHA and truthful attestations.

## Current release decision

**NO-GO for live production until external Gate 7 evidence is real and reviewed.**

The software candidate itself has completed automated production certification. Remaining blockers are deployment/environment evidence rather than missing core application architecture:

1. actual self-hosted Linux capacity/sizing and TLS/network setup;
2. real provider/OIDC/scanner/finance/settlement/observability credentials and endpoints;
3. named operational owner and cutover window;
4. live migration/monitoring/backup-restore/rollback/provider evidence;
5. final manual Gate 7 workflow execution against the deployed certified SHA.

## Go / no-go rule

**GO** only when the manual final Gate 7 workflow passes on the exact certified runtime SHA intended for production and the release authority has reviewed the provider-specific and self-hosted operational evidence.

Any missing external credential, failed live readiness probe, unverified rollback, missing monitoring, open P0/P1 issue, absent operational owner, mismatched deployed SHA, unverified backup/restore, or insufficient host capacity means **NO-GO**.
