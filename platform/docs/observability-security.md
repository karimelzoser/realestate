# PRENEURA Observability & HTTP Security Operating Contract

This document defines the production observability and HTTP-boundary requirements for PRENEURA Real Estate OS.

## 1. Trace topology

PRENEURA uses OpenTelemetry for server-side traces.

Services:

- `preneura-api`
- `preneura-worker`
- `preneura-notification-gateway`

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the OTLP/HTTP trace endpoint for the production collector. When the variable is absent, telemetry is intentionally a no-op; production release review must explicitly decide whether that is acceptable for the target environment.

The API initializes telemetry before loading NestJS/Fastify and database-dependent modules. The worker initializes telemetry before loading its durable loop implementations. The notification gateway preloads telemetry before its runtime bootstrap.

Worker loops create explicit spans for:

- outbox publication;
- notification dispatch;
- milestone reminder reconciliation;
- installment reminder reconciliation;
- commission due-state refresh.

Auto-instrumentation adds supported Node HTTP/client/database context around the service runtime.

## 2. Request correlation

The web client sends an `x-request-id` on API requests.

The API:

- accepts only bounded safe request IDs;
- generates a UUID when the supplied ID is absent/invalid;
- returns the final request ID as `x-request-id`;
- includes OpenTelemetry trace/span identity in structured runtime logs when a span is active.

Do not put buyer names, phones, National IDs, contract content, OTP values, tokens, cheque numbers, or document bodies into request IDs or trace attributes.

## 3. Structured logging and redaction

API runtime logging redacts:

- `Authorization`;
- `Cookie`;
- `Set-Cookie`.

All production services must treat logs as operational metadata, not a secondary data warehouse. Sensitive domain data must be represented by stable IDs/statuses only when necessary for diagnosis.

Worker logs are structured JSON and include worker ID plus trace/span identity when present.

The notification gateway must never log resolved phone/email destinations, OTP payloads, provider access tokens, contact ciphertext, or raw credential headers.

## 4. HTTP security boundary

The API uses Fastify Helmet and emits defensive response headers including content-type sniffing protection.

Every API response is marked `Cache-Control: no-store` at the request boundary because authenticated operational responses can contain sensitive buyer/financial state.

Credentialed unsafe browser methods (`POST`, `PUT`, `PATCH`, `DELETE`) are protected by an Origin allow-list when the PRENEURA session cookie is present. The browser origin must match one of the configured `WEB_ORIGIN` entries.

Bearer-token provider traffic is not forced through the browser-cookie Origin rule.

## 5. Session cookie

Production defaults to:

`__Host-preneura_session`

The `__Host-` prefix requires:

- Secure transport;
- `Path=/`;
- no Domain attribute.

The cookie is HttpOnly and SameSite=Lax. If `SESSION_COOKIE_NAME` is overridden in production, the runtime validator requires another `__Host-*` name.

## 6. Rate limiting

The API uses a global Fastify rate limit. The default is 300 requests per minute per resolved client identity/IP unless `API_RATE_LIMIT_PER_MINUTE` is configured.

Health probes are excluded from throttling.

Domain-specific anti-abuse protections remain authoritative where stricter semantics are required, especially OTP request windows/attempt counts and provider idempotency.

A global throttle is not a substitute for WAF/bot controls on the public edge.

## 7. Production alert minimums

The production monitoring destination should alert on, at minimum:

### Availability
- API readiness failures;
- API 5xx ratio;
- notification gateway process/startup failures;
- worker restart/fatal error rate.

### Latency
- API p95/p99 latency by route family;
- PostgreSQL query/connection latency;
- object-storage/provider latency;
- notification provider latency.

### Durable backlogs
- unpublished domain outbox age/count;
- pending/processing notification age/count;
- failed notification deliveries;
- overdue milestone reminder reconciliation;
- overdue installment reminder reconciliation;
- commission cases whose due-state refresh is stale.

### Commercial/financial safety
- unit lock conflicts/errors;
- payment-provider event failures/idempotency collisions;
- document scan failures;
- contract execution failures;
- ledger certification/reconciliation exceptions.

## 8. Trace retention and sampling

Do not sample away all error traces.

Recommended starting policy:

- 100% errors/high-severity security events;
- elevated sampling around allocation windows/event days;
- lower baseline sampling for successful repetitive reads;
- retention aligned with incident/compliance requirements.

Never use trace payloads as storage for buyer PII or document contents.

## 9. Edge controls

Production should place the public web/API behind TLS and an edge/WAF layer with:

- volumetric protection;
- bot/rate controls;
- request-size limits;
- TLS policy;
- security event logging.

Application authorization, tenant isolation, database invariants, OTP throttling and provider idempotency remain required even when the WAF is present.

## 10. Release evidence

`.github/workflows/observability-security-certification.yml` is the executable Gate 6 evidence for this boundary.

It proves:

- frozen dependency install;
- high-severity production dependency audit;
- emitted production builds;
- OTLP trace export to a real HTTP collector endpoint;
- request-ID propagation;
- no-store/security headers;
- cookie-session Origin rejection;
- API rate limiting;
- notification gateway stale-schema fail-closed startup.

A green workflow demonstrates implementation behavior. Production go/no-go additionally requires the real collector/dashboards/alerts/WAF endpoints and credentials to be configured in the deployed environment.
