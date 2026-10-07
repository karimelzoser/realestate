# PRENEURA HTTP Edge Security Contract

This document defines the application-side HTTP boundary for PRENEURA Real Estate OS. It complements, and does not replace, the production WAF/load-balancer/API-gateway policy.

## Server-generated request identity

Every API request receives a server-generated UUID request ID.

- client supplied `X-Request-Id` is not trusted as the authoritative ID;
- the authoritative ID is returned as `X-Request-Id` on responses, including errors;
- logs and future distributed tracing should correlate on this server-generated value;
- request IDs are correlation metadata only and never authorization credentials.

## Trusted proxy boundary

The API no longer uses `trustProxy: true`.

`TRUST_PROXY_HOPS` explicitly defines how many reverse-proxy hops are trusted before the application considers the next address to be the client address.

Production requirements:

1. set `TRUST_PROXY_HOPS` to the actual deployment topology;
2. do not expose the application container directly around the configured trusted proxy chain;
3. revalidate this value whenever Railway/load-balancer/API-gateway topology changes;
4. use network/security-group controls so application instances accept ingress only from the intended platform edge where the provider supports it.

A hop-based proxy trust rule is an operational topology contract, not an identity mechanism.

## Request body limit

`API_BODY_LIMIT_BYTES` controls Fastify's parsed-body maximum.

Production accepted range:

- minimum: 64 KiB;
- maximum: 16 MiB;
- recommended default: 8 MiB.

The current 8 MiB default accommodates controlled project import row batches (up to 2,000 normalized rows) while preventing unbounded JSON/form bodies.

Document, signature and master-plan file bytes do **not** pass through this limit. Those uploads use presigned object-storage URLs and are independently constrained, checksummed and verified.

## Security response headers

The API emits these headers globally:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- restrictive `Permissions-Policy`
- API-only `Content-Security-Policy` (`default-src 'none'`, no framing, no base URI)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-DNS-Prefetch-Control: off`
- `Cache-Control: no-store` unless a route deliberately sets a stricter/route-specific cache policy
- `X-Request-Id` with the server-generated correlation ID

The API does not rely on the obsolete `X-XSS-Protection` header.

## CORS

Credentialed browser CORS is allowlisted from `WEB_ORIGIN`.

Production `WEB_ORIGIN` entries must be complete HTTPS origins without path, query or fragment. Do not use `*` with credentialed browser sessions.

## Abuse/rate-limit boundary

Application-level durable controls already protect the most sensitive account paths:

- OTP request windows and resend cooldowns;
- bounded OTP attempts;
- session validation/revocation;
- database concurrency constraints around locks, money and provider idempotency.

General volumetric HTTP abuse must additionally be controlled at the production edge/WAF because an in-process limiter can be bypassed by horizontal replica scaling.

Minimum production edge policy should include:

- global per-source request-rate and burst controls;
- stricter anonymous/login route policies;
- concurrent-connection limits for SSE streams;
- body-size enforcement at or below the application/API-gateway contractual maximum where practical;
- bot/abuse controls appropriate to the customer-facing buyer portal;
- provider-ingress allowlisting where stable provider networks are available;
- explicit exclusions/appropriate thresholds for health probes so platform health checks do not self-throttle.

Provider-native webhook signatures must still be verified by provider adapters before they normalize financial events into PRENEURA.

## Fastify security baseline

The committed lockfile resolves Fastify to the security-fixed 5.12.x line. Dependency changes remain controlled by the committed `pnpm-lock.yaml` and the **Release Dependency Reproducibility** gate.

## Certification

`.github/workflows/http-security-certification.yml` boots the real API and proves:

- proxy/body-limit resolver boundaries;
- server-generated UUID request IDs cannot be overridden by a client header;
- security headers are present;
- sensitive API responses default to `no-store`;
- oversized JSON is rejected with HTTP 413 before application authentication/business handling;
- error responses still contain correlation/security headers.

`Runtime Readiness Certification` separately proves that the required proxy/body settings are present in the complete production-shaped configuration.

## Release checklist

Before Gate 7 production approval, capture:

- deployed `TRUST_PROXY_HOPS` and topology justification;
- edge/WAF rate-limit policy and exclusions;
- allowed `WEB_ORIGIN` list;
- maximum request-body setting at edge and app;
- security-header sample from the deployed API;
- request-ID correlation sample across API logs;
- evidence that application services are not directly exposed around the trusted proxy path.
