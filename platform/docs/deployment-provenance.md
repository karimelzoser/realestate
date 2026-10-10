# PRENEURA deployment provenance

PRENEURA production containers carry explicit source provenance so Gate 7 can verify the running workload rather than trusting an operator-entered Git SHA.

## Image labels

Every PRENEURA-built application image (`api`, `worker`, `notification-gateway`, `web`, and `migrate`) inherits these immutable OCI/application labels:

```text
org.opencontainers.image.source=https://github.com/karimelzoser/realestate
org.opencontainers.image.revision=<PRENEURA_SOURCE_SHA>
com.preneura.application-runtime-sha=<PRENEURA_APPLICATION_RUNTIME_SHA>
com.preneura.runtime-schema-version=41
```

`PRENEURA_SOURCE_SHA` is the exact full Git SHA of the deployment/source bundle being built.

`PRENEURA_APPLICATION_RUNTIME_SHA` is the accepted application runtime commit contained by that deployment bundle. Keeping the two values separate allows deployment/governance files to advance without pretending that the product runtime changed.

The Docker build rejects missing or non-40-character lowercase hexadecimal SHA values.

## Required production environment values

Before `docker compose build`, set:

```text
PRENEURA_SOURCE_SHA=<exact certified deployment source SHA>
PRENEURA_APPLICATION_RUNTIME_SHA=<exact accepted application runtime SHA>
OTEL_SERVICE_VERSION=<same value as PRENEURA_SOURCE_SHA>
```

For a Git checkout, derive the source SHA directly instead of typing it manually:

```bash
export PRENEURA_SOURCE_SHA="$(git rev-parse HEAD)"
```

Then compare that value with the release manifest/approved deployment change before building.

Do not reuse an old environment file after checking out another release: the image build may succeed only when the required values are present, and Gate 7 must reject containers whose label values do not match the approved release identity.

## Certification

`Self-Hosted Deployment Certification` overrides the synthetic local source value with `${GITHUB_SHA}` and validates every PRENEURA-built running container using allow-listed `docker inspect --format` reads.

For each service the workflow requires:

- image source revision exactly equals the workflow Git SHA;
- application runtime label equals the accepted runtime SHA;
- runtime schema label equals `41`;
- source repository label equals the PRENEURA repository;
- application container user remains `node`;
- private-service port isolation remains intact.

This means the deployment certification proves that the executable containers under test were built from the same commit that GitHub Actions is certifying.

## Gate 7 host evidence collector

`platform/scripts/collect-gate7-host-evidence.mjs` is the production-safe target-host collector. It verifies the actual running Compose deployment and writes a bounded JSON evidence report without serializing container environment variables.

From `platform/` on the deployed Linux host:

```bash
GATE7_COMPOSE_ENV_FILE=deploy/.env.production \
GATE7_COMPOSE_FILE=deploy/docker-compose.production.yml \
GATE7_LOCAL_EDGE_URL=http://127.0.0.1:8080 \
GATE7_HOST_EVIDENCE_PATH=gate7-host-evidence.json \
node scripts/collect-gate7-host-evidence.mjs
```

In normal production use the expected deployment SHA is read from `ops/selfhosted-gate7-staging.json`. A caller cannot override that SHA. The only override path is deliberately restricted to GitHub Actions certification with both `GITHUB_ACTIONS=true` and `GATE7_COLLECTOR_ALLOW_SHA_OVERRIDE=true`.

The collector records only allow-listed evidence such as:

- Linux/CPU/memory/disk capacity signals;
- Docker and Compose versions;
- container ID and image ID/repository digest metadata;
- image source/runtime/schema labels;
- container user, privileged state, `no-new-privileges`, dropped capabilities;
- running/health/exit state and restart count;
- safe network names and host-port bindings;
- one-shot migration exit status;
- `worker.ready` presence without embedding worker log contents;
- local edge liveness, readiness and login-page probes;
- sanitized database/schema compatibility fields returned by readiness.

It actively fails when, among other cases:

- a PRENEURA image was built from a different source SHA;
- the accepted application-runtime SHA or schema label does not match;
- a private application service exposes a host port;
- a long-running service is not running or a health-checked service is unhealthy;
- a PRENEURA application container is privileged, runs as the wrong user, lacks `no-new-privileges`, or has not dropped all capabilities;
- migration did not exit successfully;
- edge is not the only host-published service;
- worker readiness is missing;
- local liveness/readiness/web probes fail;
- the host does not meet the configured CPU/memory/disk floor.

The JSON report is written mode `0600`, contains a SHA-256 evidence digest, and exits non-zero on any failed assertion. Store the resulting artifact in a controlled evidence location and reference it from Gate 7 using an `artifact:` or HTTPS evidence reference.

### Secret-safety rule

Never attach raw `docker inspect`, `docker compose config`, an env file, or unrestricted service logs to Gate 7 evidence. `.Config.Env` and rendered Compose configuration can contain production credentials.

The collector intentionally reads individual fields and labels only. Its serialized output is also checked for known secret-variable markers before the evidence file is written.

## Relationship to final Gate 7

Host evidence proves **what is actually running on the Linux/Compose host** and whether that local deployment matches the certified image/topology policy.

It does not replace the final live checks. `certify-gate7-live.mjs` still independently verifies public DNS, TLS, API/Web reachability and OIDC, while Gate 7 still requires traceable evidence for messaging, document scanning, finance/settlement, observability, backup/restore, migration/rollback rehearsal, security approval and operational ownership.

Container provenance and host evidence close source/topology identity; they do not manufacture external production evidence.
