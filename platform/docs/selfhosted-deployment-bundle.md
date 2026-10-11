# PRENEURA self-hosted deployment bundle

This bundle turns the emitted PRENEURA production applications into one reproducible container deployment while preserving their existing runtime/security boundaries.

It is a software deployment artifact, not proof that a real production environment is ready. Gate 7 still requires real TLS/DNS, secrets, provider credentials, object storage, OIDC, monitoring, backups and named on-call ownership.

## Included services

`platform/deploy/docker-compose.production.yml` defines:

1. `migrate` — one-shot migration job; waits for PostgreSQL, then runs the append-only migration ledger;
2. `notification-gateway` — private provider gateway;
3. `api` — private NestJS/Fastify API;
4. `worker` — private durable background worker;
5. `web` — private Next.js server;
6. `edge` — the only host-published application service.

The certification override adds PostgreSQL only for CI/self-contained deployment certification. Real production may point `DATABASE_URL` to managed or HA PostgreSQL instead.

## Network boundary

Only `edge` publishes a host port. API, web and notification-gateway use Compose `expose` only; worker and migration have no listener.

The edge routes:

```text
/             -> web:3000
/api/*        -> api:4100/*
/healthz      -> API readiness
/livez        -> API liveness
```

`/api/` has proxy buffering disabled and a long read timeout so authenticated SSE streams remain usable through the proxy.

The notification gateway deliberately has no public route in this bundle. Add a narrowly scoped callback route only if a selected provider genuinely requires inbound callbacks.

## TLS boundary

The bundled edge listens on container port `8080`. In production, place it behind the host/load-balancer TLS terminator and expose that upstream only on the private host/network.

`PUBLIC_ORIGIN` must be the final HTTPS browser origin, for example:

```text
https://realestate.example.com
```

The web build embeds `${PUBLIC_ORIGIN}/api` as `NEXT_PUBLIC_API_URL`, and the API accepts only `PUBLIC_ORIGIN` as its browser CORS origin.

The TLS terminator must preserve `X-Forwarded-Proto: https`, client forwarding information and the configured trusted-proxy hop count.

## Build contract

All application targets are produced from the same Dockerfile and committed lockfile:

```text
platform/deploy/Dockerfile
```

The build uses:

- Node 24;
- pnpm 12.9.1;
- `pnpm install --frozen-lockfile`;
- the same source tree for web, API, worker, gateway and migration images.

Image targets are:

```text
api
worker
notification-gateway
web
migrate
```

Application processes run as the unprivileged Node user and drop Linux capabilities in Compose.

## Configure

Copy the environment contract outside source control:

```bash
cd platform/deploy
cp .env.production.example /etc/preneura/production.env
chmod 600 /etc/preneura/production.env
```

Replace every placeholder. Production runtime validators intentionally reject placeholder values.

Do not put real secrets in the repository. Prefer a host secret manager and render the environment file immediately before deployment.

Required external dependencies include:

- PostgreSQL 18-compatible database;
- Keycloak/OIDC issuer with Google configured where required;
- private S3-compatible object storage;
- document malware scanner;
- Meta WhatsApp/provider credentials;
- OpenTelemetry collector;
- optional SMS/email/AI providers.

## Validate configuration before rollout

```bash
cd platform/deploy
docker compose \
  --env-file /etc/preneura/production.env \
  -f docker-compose.production.yml \
  config --quiet
```

A missing required variable stops Compose before deployment.

## Build

```bash
docker compose \
  --env-file /etc/preneura/production.env \
  -f docker-compose.production.yml \
  build --pull
```

Use an immutable repository SHA/tag for the source checkout. Record that SHA in `OTEL_SERVICE_VERSION` and the Gate 7 evidence package.

## Deploy

```bash
docker compose \
  --env-file /etc/preneura/production.env \
  -f docker-compose.production.yml \
  up -d
```

Compose ordering is intentional:

```text
PostgreSQL reachable
  -> migration exits 0
  -> notification gateway starts healthy
  -> API + worker start against certified schema
  -> web starts after API readiness
  -> edge starts after API + web health
```

`migrate` has `restart: "no"`. If migration fails, dependent runtime services do not start. Do not bypass this with manual `--no-deps` startup.

## Verify

From the host/private load-balancer path:

```bash
curl -fsS http://127.0.0.1:${HTTP_PORT:-8080}/healthz
curl -fsS http://127.0.0.1:${HTTP_PORT:-8080}/livez
curl -fsS http://127.0.0.1:${HTTP_PORT:-8080}/api/v1/health/ready
curl -fsS http://127.0.0.1:${HTTP_PORT:-8080}/login >/dev/null
```

Then verify the public HTTPS origin through the real TLS terminator before GO.

Check migration and worker state:

```bash
docker compose --env-file /etc/preneura/production.env -f docker-compose.production.yml ps -a
docker compose --env-file /etc/preneura/production.env -f docker-compose.production.yml logs worker
```

The migration container must exit `0`; worker logs must contain `worker.ready` before operational traffic is considered healthy.

## Upgrade

1. verify database/object backups and recovery evidence;
2. checkout the certified immutable release SHA;
3. render the production environment;
4. build the new image set;
5. run `docker compose up -d`;
6. allow the one-shot migration to finish;
7. wait for readiness checks;
8. execute the post-deploy Gate 7 evidence/health checks;
9. record exact image/source SHA and migration state.

Never edit an applied migration. Fix migration problems with a forward migration.

## Application rollback

If the new application release must be rolled back:

1. confirm the previous runtime remains compatible with the database minimum runtime version;
2. checkout/redeploy the previous certified image/source SHA;
3. do **not** down-migrate PostgreSQL;
4. verify `/healthz`, API readiness, worker startup and gateway health;
5. create a forward code/migration repair for the failed release.

## CI certification

`Self-Hosted Deployment Certification` is intentionally stronger than `docker compose config` alone. It:

- validates the merged Compose model;
- builds every production image target from the frozen lockfile;
- launches PostgreSQL plus the production service topology;
- executes the one-shot migration;
- waits for edge/API/web readiness;
- proves API/web/gateway ports are not host-published;
- proves the worker reached `worker.ready`;
- exercises web and API routing through Nginx;
- tears down the stack and volume after the test.

This proves the deployment artifact is internally executable. It does **not** replace the manual/live Gate 7 requirements for TLS, credentials, provider connectivity, dashboards, backups, cutover rehearsal and on-call ownership.
