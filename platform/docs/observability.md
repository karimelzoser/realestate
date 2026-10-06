# PRENEURA Production Observability

This document defines the launch baseline for traces, metrics, structured logs, correlation IDs, dashboards and alerts across the production Node.js services.

## 1. Runtime topology

```text
Browser / integrations
        |
        v
PRENEURA API -----------+
PRENEURA Worker --------+---- OTLP ----> OpenTelemetry Collector
Notification Gateway ---+                    |      |
                                             |      +--> metrics backend / Prometheus-compatible storage
                                             +--------> trace backend / Tempo-compatible storage

API / Worker / Gateway ---- JSON stdout ----> Railway log drain / Loki-compatible storage
```

The application exports telemetry through standard OpenTelemetry environment variables. The backend vendor may change without changing domain code.

Recommended production service names:

- `preneura-api`
- `preneura-worker`
- `preneura-notification-gateway`

Set these independently with `PRENEURA_SERVICE_NAME`.

## 2. Production telemetry configuration

Required on every production Node service:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=https://<collector>
PRENEURA_SERVICE_NAME=<service-name>
LOG_LEVEL=info
```

Optional collector authentication is supplied through the standard secret:

```text
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer <secret>
```

`OTEL_EXPORTER_OTLP_HEADERS` must be stored in the deployment secrets manager and must never be printed into logs, screenshots or support tickets.

Production startup fails when telemetry is disabled, missing, malformed, or pointed at localhost. HTTPS is preferred. A private plain-HTTP collector requires the explicit acknowledgement:

```text
OTEL_EXPORTER_OTLP_INSECURE=true
```

Local development may omit the OTLP endpoint entirely.

## 3. What is instrumented

The runtime preloads OpenTelemetry before application libraries load. Node auto-instrumentation therefore covers supported HTTP, `fetch`, PostgreSQL and framework activity without domain code owning vendor-specific instrumentation.

PRENEURA also emits explicit runtime telemetry:

- request correlation through `x-request-id`;
- API trace attribute `preneura.request_id`;
- trace/span IDs injected into shared Pino logs;
- worker spans per durable loop iteration;
- worker duration, processed-record and failure metrics;
- notification-gateway request count and duration metric helpers;
- API/worker/gateway process and outbound-provider spans from auto-instrumentation.

The realtime/browser protocol remains signal-only and is not changed by telemetry.

## 4. Request correlation

The API accepts `x-request-id` only when it contains 1-128 characters from the bounded set:

```text
A-Z a-z 0-9 . _ : -
```

Unsafe/malformed values are ignored and replaced with a server-generated UUID. The authoritative request ID is returned on the response as `x-request-id`.

When reporting a production incident, capture:

- request ID;
- approximate timestamp/timezone;
- tenant/project if operationally known;
- user-visible action and result.

Do not ask users to send passwords, OTPs, National IDs, phone numbers, access tokens, contracts or other sensitive payloads merely to correlate a request.

## 5. Structured logging and PII policy

Production logs are JSON. The shared logger redacts sensitive fields including:

- authorization/cookie values;
- passwords/secrets/tokens;
- OTPs;
- National IDs;
- phone/email/contact destinations;
- provider access tokens/client secrets.

API HTTP logging also redacts authorization/cookie/token/identity/contact fields at the Fastify logger boundary.

Rules:

1. log stable IDs, state names and bounded error classifications where useful;
2. do not log raw message bodies, document contents, signatures, cheque images or provider credentials;
3. do not log buyer PII to make debugging easier;
4. use request ID + trace ID + authoritative record ID for correlation;
5. production support exports must retain the same field-level authorization policy as the application.

## 6. Core dashboard set

### API reliability

Track:

- request rate by route/status class;
- 4xx and 5xx rate;
- p50/p95/p99 latency;
- `/v1/health/ready` state;
- PostgreSQL latency/error rate;
- active/failed outbound provider requests;
- top failing route classes without exposing request bodies.

### Worker health

Track:

- `preneura.worker.loop.duration` by loop;
- `preneura.worker.loop.processed` by loop;
- `preneura.worker.loop.failures` by loop;
- process restarts;
- outbox age/backlog;
- notification-job age/backlog;
- reminder scheduling lag;
- commission due-state scan failures.

### Messaging gateway

Track:

- `preneura.notification_gateway.requests` by route/status;
- `preneura.notification_gateway.request.duration`;
- Meta/SMS/email provider latency/error rate;
- idempotent replay count where available;
- terminal delivery failure rate;
- stale `PROCESSING` delivery claims.

### Business-operational safety

Derived operational dashboards should include authoritative server data for:

- active inventory locks nearing expiry;
- queue wait time;
- incomplete transaction backlog;
- overdue installments;
- commission eligibility-to-payment latency;
- notification SLA breaches.

Business KPIs must never be derived from browser-only state.

## 7. Launch alert baseline

Tune thresholds after staging/load evidence; these are the initial launch values.

| Alert | Initial condition | Severity |
|---|---|---|
| API not ready | readiness fails for 2 consecutive probes | Page |
| API 5xx elevated | >2% for 5 min with meaningful traffic | Warning |
| API 5xx critical | >5% for 5 min | Page |
| API p95 latency | >1.5 s for 10 min | Warning |
| PostgreSQL connectivity | any sustained readiness/database failure | Page |
| Worker loop failures | same loop fails 3+ times in 5 min | Page |
| Outbox lag | oldest unpublished event >60 s | Warning |
| Notification dispatch lag | oldest due pending job >120 s | Warning |
| Terminal notification failures | >1% over 15 min, min-volume guarded | Warning/Page by volume |
| Gateway provider 5xx/timeout | >5% over 5 min | Page |
| Telemetry exporter unavailable | sustained collector/export failure >5 min | Warning |
| Process restart storm | >3 restarts in 10 min per service | Page |

Event-day/allocation periods may use tighter alert windows, but thresholds must not be changed ad hoc without recording the operational reason.

## 8. Incident drill-down

Preferred sequence:

1. confirm `/v1/health/ready` and service deployment status;
2. locate request ID / trace ID;
3. inspect trace waterfall for API -> PostgreSQL/provider boundaries;
4. inspect redacted structured logs for the same trace/request ID;
5. inspect worker/gateway metrics and backlog age;
6. inspect authoritative database state through approved operational/support tooling;
7. only then decide whether to retry, compensate, pause integration traffic, or roll back application code.

Financial or inventory inconsistencies must never be repaired by editing projection/status rows manually. Use the domain compensation/reconciliation procedures.

## 9. Collector and retention guidance

Recommended production path:

- one managed or HA OpenTelemetry Collector endpoint per environment;
- TLS for public/network-crossing collector traffic;
- collector authentication stored as deployment secret;
- traces routed to a Tempo-compatible or managed trace backend;
- metrics routed to Prometheus-compatible or managed metrics storage;
- JSON stdout logs routed through Railway/log drain into Loki-compatible or managed log storage.

Retention should be chosen by security/legal/operations policy. Telemetry must not become an alternate PII archive.

## 10. Executable certification

Run:

```bash
cd platform
bash scripts/certify-observability.sh
```

The dedicated `Production Observability Certification` workflow proves on PostgreSQL 18 that:

- the workspace installs from the frozen lockfile;
- strict TypeScript and emitted Node services build;
- production preload rejects missing/disabled/localhost telemetry;
- Pino redaction removes test token/phone values;
- API request IDs round-trip and malformed IDs are replaced;
- real API traffic exports OTLP traces;
- real worker execution exports OTLP metrics;
- the existing runtime/database contract remains usable.

## 11. Release requirement

Gate 6/7 must not be approved until:

- production collector endpoint is configured for every Node service;
- dashboards exist and are shared with the operational owner;
- paging/warning routes are tested;
- at least one synthetic alert is fired and acknowledged;
- request/trace correlation is demonstrated in staging;
- no sensitive-value leakage is found in the telemetry certification/security review.
