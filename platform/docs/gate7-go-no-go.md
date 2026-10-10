# Gate 7 — Production Go / No-Go

Gate 7 is the final operational release decision for PRENEURA Real Estate OS. It is intentionally separate from feature completeness and CI-only certification.

A green Gate 7 means the exact release SHA has both:

1. the complete automated production evidence from Gates 1–6; and
2. verified live deployment/integration/operations evidence for the target production environment.

## Canonical deployable candidate

The certified Real Estate runtime candidate is:

`288f4afba3b87dbc123eff6b198e1720075edc7d`

from PR #77, which integrates the Gate 4/5/6 candidate with restart-safe inventory-lock expiry.

The Gate 7 governance branch/PR may advance independently for workflow and evidence changes. A Gate 7 GO therefore requires the operator to provide the deployed runtime SHA explicitly; the workflow rejects any runtime SHA that does not equal the pinned canonical candidate in `platform/ops/railway-gate7-staging.json`.

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

## Gate 7 automated structural preflight

`.github/workflows/gate7-go-no-go.yml` runs an automatic structural preflight which verifies:

- the required production certification workflows and release artifacts exist;
- the canonical latest migration and runtime schema agree;
- required production configuration keys are represented;
- the Railway staging manifest remains Real Estate-only and pinned to the certified runtime SHA;
- the intended service set/build/start/health configuration remains intact;
- the separate `preneura-platform-preview` project is explicitly protected from reuse by this release;
- the formal Gate 7 requirements remain present;
- no open GitHub issue labeled `P0` or `P1` exists.

This job deliberately does **not** certify provider credentials, live monitoring, or human operational ownership.

## Final live certification

The same workflow exposes a manual `workflow_dispatch` final certification. It cannot return `GATE7_FINAL_DECISION=GO` unless the release operator explicitly provides/attests all of the following:

- exact deployed Real Estate runtime SHA;
- deployed API HTTPS origin;
- deployed web HTTPS origin;
- deployed OIDC issuer HTTPS URL;
- named operational owner;
- production integrations verified;
- migration rehearsal completed on production-like topology/data;
- backup/restore evidence reviewed;
- monitoring dashboards and alerts live;
- rollback path rehearsed/validated.

The workflow rejects a deployed runtime SHA that does not equal the canonical SHA above, then performs live probes against:

- `/v1/health/live`;
- `/v1/health/ready`;
- the deployed web application;
- OIDC discovery metadata.

Final provider-specific business smoke tests remain part of the operator evidence for `integrations_verified` and must not be replaced by placeholder credentials.

## Railway staging target

Real Estate staging is isolated in:

- project: `preneura-re-gate7-staging`
- environment: `staging`

The separate Railway project `preneura-platform-preview` belongs to the different platform-core product. It is explicitly out of scope for this Real Estate release and must not be deleted, repurposed, or used to free capacity unless the owner separately authorizes that unrelated action.

The machine-checkable target topology is committed at:

`platform/ops/railway-gate7-staging.json`

It defines:

- PostgreSQL 18 from Railway's `postgres` template (`ghcr.io/railwayapp-templates/postgres-ssl:18`);
- the existing `preneura-documents-staging` S3-compatible bucket;
- `re-web`;
- `re-api`;
- `re-worker`;
- `re-notification-gateway`;
- API pre-deploy execution of the certified database migrator;
- Real Estate-only source pinning to the canonical runtime SHA;
- public/private and health-check boundaries;
- required variable names without storing secret values in Git.

### Current Railway state verified 2026-10-10

The Real Estate staging project currently has:

- live bucket `preneura-documents-staging` in region `ams`;
- no live application services;
- no live PostgreSQL service.

The environment also contains an older pending staged create for a second bucket named `preneura-documents`. It has not been deployed and must be reviewed/discarded before the final Gate 7 deploy so only the intended existing staging bucket is used.

Railway's current `postgres` template was inspected and resolves to PostgreSQL 18. A staged template request was attempted, but no PostgreSQL resource appeared in the pending environment state.

Creating the first Real Estate application service (`re-web`) was then attempted and Railway returned:

`Free plan resource provision limit exceeded. Please upgrade to provision more resources!`

**Status:** NO-GO for live Real Estate staging deployment until the Railway workspace can provision PostgreSQL 18 plus the four Real Estate application services. No capacity will be reclaimed from `preneura-platform-preview` implicitly.

## Production integration credentials/endpoints

The repository correctly fails closed for production configuration, but real production credentials/endpoints are not stored in Git and must be supplied through the deployment secret manager for:

- Google/Keycloak OIDC client;
- Meta WhatsApp / messaging provider;
- document malware scanner;
- finance provider ingress;
- settlement provider ingress;
- production observability exporter where applicable.

**Status:** requires deployment-owner/provider evidence before final GO.

## Operational ownership

Gate 7 requires named release/on-call owners and an agreed cutover window.

**Status:** requires explicit production-release assignment before final GO.

## Intended staging topology and deployment order

Once resource capacity is available, staging must use the manifest and this sequence:

1. ensure the pending environment contains only intended Real Estate resources;
2. provision PostgreSQL 18 and use the existing staging object bucket;
3. create the four application services and pin every GitHub-backed service to `288f4afba3b87dbc123eff6b198e1720075edc7d`;
4. configure real staging secrets/endpoints through Railway variables/secrets, never Git;
5. deploy API with its certified migration pre-deploy command;
6. require `/v1/health/ready` before admitting API traffic;
7. deploy the private notification gateway and worker after schema readiness;
8. deploy web with the final API HTTPS origin available at build time;
9. execute integration smoke tests, monitoring/alert checks, migration rehearsal and restore/rollback evidence;
10. run the manual Gate 7 workflow with the exact deployed runtime SHA and all required attestations.

No API or worker replica should independently auto-migrate on process startup; the controlled pre-deploy migrator remains the schema authority.

## Go / no-go rule

**GO** only when the manual final Gate 7 workflow passes on the exact certified runtime SHA intended for production and the release authority has reviewed the provider-specific evidence.

Any missing external credential, failed live readiness probe, unverified rollback, missing monitoring, open P0/P1 issue, absent operational owner, mismatched deployed SHA, or insufficient infrastructure capacity means **NO-GO**.
