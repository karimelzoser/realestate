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

`Self-Hosted Deployment Certification` overrides the synthetic local source value with `${GITHUB_SHA}` and validates every PRENEURA-built running container using `docker inspect`.

For each service the workflow requires:

- image source revision exactly equals the workflow Git SHA;
- application runtime label equals the accepted runtime SHA;
- runtime schema label equals `41`;
- source repository label equals the PRENEURA repository;
- application container user remains `node`;
- private-service port isolation remains intact.

This means the deployment certification proves that the executable containers under test were built from the same commit that GitHub Actions is certifying.

## Gate 7 host evidence

A production-host evidence collector should record, without dumping container environments or secrets:

- container ID and image ID/digest;
- the four provenance labels above;
- container user and health/status;
- safe host-port bindings;
- migration exit status;
- worker readiness marker;
- public edge health/readiness results;
- Docker/Compose/OS versions and bounded capacity signals.

The collector must never emit `docker inspect` wholesale because `.Config.Env` contains production secrets. Only explicitly allow-listed fields and labels may be written into evidence artifacts.

The final Gate 7 decision still requires independent live DNS/TLS/OIDC/provider/backup/monitoring/ownership evidence. Container provenance closes source identity; it does not replace those environment checks.
